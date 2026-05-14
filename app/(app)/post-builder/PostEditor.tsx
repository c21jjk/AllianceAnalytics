"use client";

/**
 * Path B — Post Editor (Phase B-3 scaffold + B-4 property panels).
 *
 * A fullscreen overlay (modal) editor for the layer tree. Replaces the
 * inline Customize panel for power users — exposes 30+ per-layer knobs
 * (font, size, color, position, rotation, opacity, etc) with a Canva-style
 * three-pane layout: Layers (left) · Canvas (center) · Properties (right).
 *
 * Lifecycle:
 *   - Mounted from PostBuilderClient when "Edit in Editor" is clicked
 *   - Receives an `initialTree` (seeded from templateToLayerTree() OR
 *     loaded from generated_posts.layer_tree on existing posts)
 *   - Maintains tree state internally with undo/redo (cap 50)
 *   - On Save: POSTs to /api/post-builder/render-tree, then calls onSave
 *     so the parent can persist the row + close the editor
 *
 * Hard rule from user feedback (feedback_post_editor_overlay.md):
 *   Renders as fixed-inset full-screen overlay, never inline. ADHD-friendly
 *   isolation — one focused workspace per decision.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Moveable from "react-moveable";
import type {
  GradientLayer,
  GradientStop,
  GroupLayer,
  ImageLayer,
  Layer,
  LayerTree,
  LineLayer,
  RectLayer,
  TextLayer,
} from "@/lib/post-builder/layers/types";
import {
  findLayer,
  newLayerId,
  removeLayer,
  replaceLayer,
  walkLayers,
} from "@/lib/post-builder/layers/types";
import { FONT_FAMILIES, layerTreeToSvg } from "@/lib/post-builder/layers/svg-renderer";
import type { PostBuilderListing } from "@/lib/post-builder/types";

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Brand color palette used across every color picker in the editor. Order
 * matters — the on-brand swatches come first so they're the default eye-line.
 * "transparent" is included specifically for fills and shadows.
 */
const BRAND_PALETTE: ReadonlyArray<{
  id: string;
  label: string;
  value: string;
  on_brand: boolean;
}> = [
  { id: "alliance_gold", label: "Alliance Gold", value: "#C9A84C", on_brand: true },
  { id: "obsessed_grey", label: "Obsessed Grey", value: "#252526", on_brand: true },
  { id: "white", label: "White", value: "#FFFFFF", on_brand: true },
  { id: "off_white", label: "Off-White", value: "#FBF7EE", on_brand: true },
  { id: "black", label: "Pure Black", value: "#000000", on_brand: true },
  { id: "deep_navy", label: "Deep Navy", value: "#1E3A5F", on_brand: false },
  { id: "emerald", label: "Emerald", value: "#2F8F5C", on_brand: false },
  { id: "burgundy", label: "Burgundy", value: "#8B2C3C", on_brand: false },
  { id: "rosewood", label: "Rosewood", value: "#C0584F", on_brand: false },
  { id: "transparent", label: "Transparent", value: "transparent", on_brand: true },
];

/** Cap on undo/redo history. 50 is plenty for a single editing session. */
const HISTORY_CAP = 50;
/** Editor zoom limits. */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
/** Initial dimensions for newly-added layers (template-space pixels). */
const NEW_TEXT_DEFAULT = { w: 600, h: 120 };
const NEW_RECT_DEFAULT = { w: 400, h: 240 };
const NEW_IMAGE_DEFAULT = { w: 500, h: 500 };
const NEW_GRADIENT_DEFAULT = { w: 600, h: 400 };

/** Snap threshold in template-space pixels. */
const SNAP_THRESHOLD_PX = 8;
/** Pixel offset applied to copy/paste/duplicate to make the new layer visible. */
const PASTE_SHIFT_PX = 20;

// ─── Tree-mutation helpers (B-5) ─────────────────────────────────────
//
// These helpers operate on top-level layers only — group children are not
// addressable from the layer-panel UI in v1. Each helper returns a NEW tree
// so `pushHistory(...)` can be applied as a single undo step.

/** Axis-aligned bounding box of a single layer. Rotation ignored. */
interface LayerBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function getLayerBounds(layer: Layer): LayerBounds {
  return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
}

/** Bounding box of multiple layers (union). Returns null if list is empty. */
function getMultiBounds(layers: Layer[]): LayerBounds | null {
  if (layers.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.w);
    maxY = Math.max(maxY, l.y + l.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Group a list of TOP-LEVEL layer ids into a new GroupLayer. The group is
 * positioned at the union bbox; child coordinates are translated to be
 * relative to the group origin. Returns the new tree + new group id.
 *
 * If any of the ids isn't found at the top level (e.g. it's already nested
 * in a group), it is silently skipped. Need at least 2 valid ids — otherwise
 * returns the tree unchanged.
 */
function groupLayers(
  tree: LayerTree,
  ids: string[],
): { tree: LayerTree; newGroupId: string | null } {
  const idSet = new Set(ids);
  const selected: Layer[] = [];
  const others: Layer[] = [];
  // Capture insertion order from the source tree so the group renders
  // correctly relative to the un-grouped layers.
  let firstSelectedIdx = -1;
  tree.layers.forEach((l, i) => {
    if (idSet.has(l.id)) {
      if (firstSelectedIdx === -1) firstSelectedIdx = i;
      selected.push(l);
    } else {
      others.push(l);
    }
  });
  if (selected.length < 2) return { tree, newGroupId: null };
  const bounds = getMultiBounds(selected);
  if (!bounds) return { tree, newGroupId: null };
  // Translate children to be relative to group origin.
  const children: Layer[] = selected.map((l) => ({
    ...l,
    x: l.x - bounds.x,
    y: l.y - bounds.y,
  }));
  const newGroupId = newLayerId("group");
  const group: GroupLayer = {
    id: newGroupId,
    type: "group",
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    children,
    name: "Group",
  };
  // Insert the group where the first selected layer was, so z-order is
  // preserved as much as possible. Since we removed the selected entries
  // from `others`, we need to insert at the original index minus the count
  // of selected entries that came before that index — but `firstSelectedIdx`
  // is the original position; subtract preceding selected count to land in
  // the correct slot in `others`.
  let precedingSelected = 0;
  for (let i = 0; i < firstSelectedIdx; i += 1) {
    if (idSet.has(tree.layers[i].id)) precedingSelected += 1;
  }
  const insertAt = firstSelectedIdx - precedingSelected;
  const nextLayers = [...others.slice(0, insertAt), group, ...others.slice(insertAt)];
  return { tree: { ...tree, layers: nextLayers }, newGroupId };
}

/**
 * Inverse of groupLayers: hoist a group's children back to top-level,
 * converting their relative coordinates back to absolute (group.x + child.x).
 * If id doesn't refer to a top-level group, returns tree unchanged.
 */
function ungroupLayer(
  tree: LayerTree,
  groupId: string,
): { tree: LayerTree; childIds: string[] } {
  const idx = tree.layers.findIndex((l) => l.id === groupId && l.type === "group");
  if (idx < 0) return { tree, childIds: [] };
  const group = tree.layers[idx] as GroupLayer;
  const children: Layer[] = group.children.map((c) => ({
    ...c,
    x: c.x + group.x,
    y: c.y + group.y,
  }));
  const next = [
    ...tree.layers.slice(0, idx),
    ...children,
    ...tree.layers.slice(idx + 1),
  ];
  return {
    tree: { ...tree, layers: next },
    childIds: children.map((c) => c.id),
  };
}

/**
 * Recursively re-id a layer (and any descendants if it's a group) so the
 * clone doesn't collide with the original. Returns the cloned layer.
 */
function cloneLayerWithFreshIds(layer: Layer): Layer {
  const baseId = newLayerId(layer.type);
  if (layer.type === "group") {
    const g = layer as GroupLayer;
    const cloned: GroupLayer = {
      ...g,
      id: baseId,
      children: g.children.map((c) => cloneLayerWithFreshIds(c)),
    };
    return cloned;
  }
  return { ...layer, id: baseId } as Layer;
}

/**
 * Duplicate a list of TOP-LEVEL layers. Each clone is shifted by `dx,dy`
 * (template-space px). Returns new tree + the cloned layer ids (so the
 * caller can update selection).
 */
function duplicateLayers(
  tree: LayerTree,
  ids: string[],
  dx: number,
  dy: number,
): { tree: LayerTree; newIds: string[] } {
  const idSet = new Set(ids);
  const newIds: string[] = [];
  const additions: Layer[] = [];
  for (const l of tree.layers) {
    if (!idSet.has(l.id)) continue;
    const clone = cloneLayerWithFreshIds(l);
    clone.x = l.x + dx;
    clone.y = l.y + dy;
    if (l.name) clone.name = `${l.name} copy`;
    additions.push(clone);
    newIds.push(clone.id);
  }
  if (additions.length === 0) return { tree, newIds: [] };
  return {
    tree: { ...tree, layers: [...tree.layers, ...additions] },
    newIds,
  };
}

type ReorderDirection = "forward" | "back" | "front" | "back_full";

/**
 * Reorder a single TOP-LEVEL layer in `tree.layers`. Supports the four
 * standard moves. Layers nested in groups aren't reorderable in v1
 * (matches the layer panel — only top-level rows are exposed).
 */
function reorderLayer(
  tree: LayerTree,
  id: string,
  direction: ReorderDirection,
): LayerTree {
  const idx = tree.layers.findIndex((l) => l.id === id);
  if (idx === -1) return tree;
  const next = [...tree.layers];
  const [layer] = next.splice(idx, 1);
  let target: number;
  switch (direction) {
    case "forward":
      target = Math.min(next.length, idx + 1);
      break;
    case "back":
      target = Math.max(0, idx - 1);
      break;
    case "front":
      target = next.length;
      break;
    case "back_full":
      target = 0;
      break;
  }
  next.splice(target, 0, layer);
  return { ...tree, layers: next };
}

/**
 * Move a single TOP-LEVEL layer to an explicit index in `tree.layers`.
 * Used by the layer-panel drag-reorder. The index is in the SAME array
 * as `tree.layers` (front = end of array; the layer-panel UI reverses
 * this for display).
 */
function moveLayerToIndex(tree: LayerTree, id: string, targetIdx: number): LayerTree {
  const fromIdx = tree.layers.findIndex((l) => l.id === id);
  if (fromIdx === -1) return tree;
  const next = [...tree.layers];
  const [layer] = next.splice(fromIdx, 1);
  // Adjust target if we removed an entry before it.
  const adjusted = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
  const clamped = Math.max(0, Math.min(next.length, adjusted));
  next.splice(clamped, 0, layer);
  return { ...tree, layers: next };
}

/** A line we draw across the canvas during snap. */
interface SnapLine {
  /** Axis: "x" → vertical line at template-x; "y" → horizontal line at template-y. */
  axis: "x" | "y";
  /** Position in template-space pixels. */
  pos: number;
}

/** Source candidate edge/center used during snap. */
interface SnapCandidate {
  axis: "x" | "y";
  pos: number;
}

/**
 * Build the list of snap candidates for the current tree. Includes:
 *   - Canvas edges (0, w, h) and centers (w/2, h/2)
 *   - Each non-excluded TOP-LEVEL layer's left/right/top/bottom + centers
 */
function computeSnapCandidates(tree: LayerTree, excludeIds: Set<string>): SnapCandidate[] {
  const out: SnapCandidate[] = [
    { axis: "x", pos: 0 },
    { axis: "x", pos: tree.width },
    { axis: "x", pos: tree.width / 2 },
    { axis: "y", pos: 0 },
    { axis: "y", pos: tree.height },
    { axis: "y", pos: tree.height / 2 },
  ];
  for (const l of tree.layers) {
    if (excludeIds.has(l.id)) continue;
    if (l.hidden) continue;
    out.push({ axis: "x", pos: l.x });
    out.push({ axis: "x", pos: l.x + l.w });
    out.push({ axis: "x", pos: l.x + l.w / 2 });
    out.push({ axis: "y", pos: l.y });
    out.push({ axis: "y", pos: l.y + l.h });
    out.push({ axis: "y", pos: l.y + l.h / 2 });
  }
  return out;
}

/**
 * Snap a moving box's edges/centers to the nearest candidates. Returns the
 * adjusted (x, y) plus the snap lines that fired (for visual feedback).
 *
 * Box is axis-aligned (x, y, w, h). For each axis we pick the snap with
 * the smallest absolute distance under threshold.
 */
function applySnap(
  box: LayerBounds,
  candidates: SnapCandidate[],
  threshold: number,
): { x: number; y: number; lines: SnapLine[] } {
  // Edges/centers of the moving box for each axis.
  const xPoints = [box.x, box.x + box.w / 2, box.x + box.w];
  const yPoints = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX: { delta: number; line: SnapLine } | null = null;
  let bestY: { delta: number; line: SnapLine } | null = null;
  for (const c of candidates) {
    if (c.axis === "x") {
      for (const p of xPoints) {
        const d = c.pos - p;
        if (Math.abs(d) <= threshold) {
          if (!bestX || Math.abs(d) < Math.abs(bestX.delta)) {
            bestX = { delta: d, line: { axis: "x", pos: c.pos } };
          }
        }
      }
    } else {
      for (const p of yPoints) {
        const d = c.pos - p;
        if (Math.abs(d) <= threshold) {
          if (!bestY || Math.abs(d) < Math.abs(bestY.delta)) {
            bestY = { delta: d, line: { axis: "y", pos: c.pos } };
          }
        }
      }
    }
  }
  const lines: SnapLine[] = [];
  let nx = box.x;
  let ny = box.y;
  if (bestX) {
    nx += bestX.delta;
    lines.push(bestX.line);
  }
  if (bestY) {
    ny += bestY.delta;
    lines.push(bestY.line);
  }
  return { x: nx, y: ny, lines };
}

// ─── Types ───────────────────────────────────────────────────────────

interface PostEditorProps {
  initialTree: LayerTree;
  /**
   * Generated post id, if this editor is opened on an existing saved post.
   * When null, "Save" still calls render-tree but the parent should create
   * a new generated_posts row from the result.
   */
  generatedPostId: string | null;
  /** Available photos for the listing — used by Image layer source picker. */
  availablePhotos: Array<{ url: string; sequence: number }>;
  /**
   * Listing for the title bar context. Read-only — this editor mutates
   * the layer tree, not the listing.
   */
  listing: { mls_number: string; address: string | null } & Partial<PostBuilderListing>;
  /**
   * B-6 — when the editor is opened on a single card from an OH-multi
   * (FB Open House gallery) bundle, this carries the "card N of M" context
   * so the editor can show a banner reminding the user that Save updates
   * just this listing's card, not the entire bundle.
   */
  ohMultiContext?: { current: number; total: number; address: string } | null;
  onClose: () => void;
  /**
   * Called after successful Save — provides the new image URL so the
   * parent can update its preview. The tree is also passed so the parent
   * can persist it without re-fetching.
   */
  onSave: (result: { tree: LayerTree; image_url: string; image_path: string }) => void;
}

interface ToastMessage {
  kind: "success" | "error";
  text: string;
}

// ─── Component ───────────────────────────────────────────────────────

export default function PostEditor({
  initialTree,
  generatedPostId: _generatedPostId,
  availablePhotos,
  listing,
  ohMultiContext,
  onClose,
  onSave,
}: PostEditorProps) {
  // ── Tree state + history ───────────────────────────────────────────
  const [tree, setTree] = useState<LayerTree>(initialTree);
  const [history, setHistory] = useState<LayerTree[]>([initialTree]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [dirty, setDirty] = useState<boolean>(false);

  // ── Font loading (B-6) ─────────────────────────────────────────────
  // The SVG renderer @imports the Google Fonts for the rendered output,
  // but the editor UI itself (font picker preview, property labels) needs
  // the fonts loaded into the document head too. Inject one stylesheet
  // <link> per family on mount; clean up on unmount.
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (const f of FONT_FAMILIES) {
      const href = `https://fonts.googleapis.com/css2?family=${f.google_url}&display=swap`;
      // De-dup: skip if a stylesheet with this href already exists.
      const existing = document.head.querySelector(
        `link[rel="stylesheet"][href="${href}"]`,
      );
      if (existing) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.postEditorFont = f.id;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      // Only remove the ones we added — leave any pre-existing alone.
      for (const link of links) {
        if (link.parentNode) link.parentNode.removeChild(link);
      }
    };
  }, []);

  // ── Selection ──────────────────────────────────────────────────────
  // Multi-selection. An empty array means nothing is selected. The first
  // entry is treated as the "primary" selection for the property panel.
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);

  // Convenience setter for single-layer selection (replaces the old
  // setSelectedLayerId).
  const selectOnly = useCallback((id: string | null) => {
    setSelectedLayerIds(id ? [id] : []);
  }, []);

  // ── Canvas / viewport ──────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const moveableTargetRef = useRef<HTMLDivElement | null>(null);
  const [moveableTick, setMoveableTick] = useState<number>(0);

  // ── B-5: Snap, clipboard, marquee ──────────────────────────────────
  /** Snap-to-grid toggle (default ON). Cmd-drag temporarily bypasses. */
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  /** Snap lines to draw during the current drag. Cleared on drag end. */
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  /** In-component clipboard. Cleared with the editor. */
  const [clipboard, setClipboard] = useState<Layer[]>([]);
  /** Last cursor position over the canvas (template-space). Used for paste. */
  const cursorTemplatePosRef = useRef<{ x: number; y: number } | null>(null);
  /** Marquee drag-select state. */
  const [marquee, setMarquee] = useState<{
    /** Anchor point in template-space. */
    startX: number;
    startY: number;
    /** Current point in template-space. */
    curX: number;
    curY: number;
    /** Were we additive (shift held)? */
    additive: boolean;
  } | null>(null);
  /** Whether the modifier key was held when the current drag started — disables snapping. */
  const dragModifierBypassRef = useRef<boolean>(false);

  // ── Save flow ──────────────────────────────────────────────────────
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // ── Auto-fit zoom on mount + when window resizes ───────────────────
  const fitToViewport = useCallback(() => {
    const vp = canvasViewportRef.current;
    if (!vp) return;
    const padding = 64; // breathing room around the canvas
    const availW = vp.clientWidth - padding;
    const availH = vp.clientHeight - padding;
    if (availW <= 0 || availH <= 0) return;
    const fit = Math.min(availW / tree.width, availH / tree.height);
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)));
  }, [tree.width, tree.height]);

  useLayoutEffect(() => {
    fitToViewport();
    const ro = new ResizeObserver(() => fitToViewport());
    if (canvasViewportRef.current) ro.observe(canvasViewportRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-run when tree dimensions change
  }, [tree.width, tree.height]);

  // ── History helpers ────────────────────────────────────────────────

  /** Push a new tree state. Truncates redo branch + caps to HISTORY_CAP. */
  const pushHistory = useCallback(
    (next: LayerTree) => {
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1);
        truncated.push(next);
        // Cap from the front so the most recent HISTORY_CAP states win.
        const overflow = truncated.length - HISTORY_CAP;
        const final = overflow > 0 ? truncated.slice(overflow) : truncated;
        // Update historyIndex to point at the latest entry.
        setHistoryIndex(final.length - 1);
        return final;
      });
      setTree(next);
      setDirty(true);
    },
    [historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setTree(history[idx]);
    setDirty(true);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setTree(history[idx]);
    setDirty(true);
  }, [history, historyIndex]);

  // ── Selected layer + safe accessors ────────────────────────────────
  /** All currently-selected layers (resolved from ids). */
  const selectedLayers: Layer[] = useMemo(() => {
    if (selectedLayerIds.length === 0) return [];
    const out: Layer[] = [];
    for (const id of selectedLayerIds) {
      const l = findLayer(tree, id);
      if (l) out.push(l);
    }
    return out;
  }, [tree, selectedLayerIds]);

  /** "Primary" selected layer — used by the Moveable single-target path,
   * the property panel header, and keyboard nudge. */
  const selectedLayer: Layer | null = selectedLayers[0] ?? null;
  /** True when 2+ layers are selected — switches Moveable into virtual-bbox mode. */
  const hasMultiSelect = selectedLayers.length >= 2;
  /** Bounding box covering all selected layers (multi-select Moveable target). */
  const multiBounds: LayerBounds | null = useMemo(() => {
    if (!hasMultiSelect) return null;
    return getMultiBounds(selectedLayers);
  }, [hasMultiSelect, selectedLayers]);

  // Re-position Moveable when the selected layer's box changes (drag/edit),
  // or when the multi-select bbox shifts.
  useEffect(() => {
    setMoveableTick((t) => t + 1);
  }, [
    selectedLayer?.x,
    selectedLayer?.y,
    selectedLayer?.w,
    selectedLayer?.h,
    selectedLayer?.rotation,
    multiBounds?.x,
    multiBounds?.y,
    multiBounds?.w,
    multiBounds?.h,
    zoom,
  ]);

  // ── Tree mutation helpers ──────────────────────────────────────────

  const updateLayer = useCallback(
    (id: string, mutator: (l: Layer) => Layer) => {
      const target = findLayer(tree, id);
      if (!target) return;
      const next = mutator(target);
      pushHistory(replaceLayer(tree, id, next));
    },
    [tree, pushHistory],
  );

  /**
   * Apply a mutator to every selected layer in a single history entry.
   * Used by the property panel when 1+ layers share the universal section.
   */
  const updateSelectedLayers = useCallback(
    (mutator: (l: Layer) => Layer) => {
      if (selectedLayerIds.length === 0) return;
      let next = tree;
      for (const id of selectedLayerIds) {
        const target = findLayer(next, id);
        if (!target) continue;
        next = replaceLayer(next, id, mutator(target));
      }
      if (next !== tree) pushHistory(next);
    },
    [tree, selectedLayerIds, pushHistory],
  );

  const deleteSelectedLayers = useCallback(() => {
    if (selectedLayerIds.length === 0) return;
    let next = tree;
    for (const id of selectedLayerIds) {
      next = removeLayer(next, id);
    }
    if (next !== tree) {
      pushHistory(next);
      setSelectedLayerIds([]);
    }
  }, [tree, selectedLayerIds, pushHistory]);

  const deleteLayer = useCallback(
    (id: string) => {
      pushHistory(removeLayer(tree, id));
      setSelectedLayerIds((prev) => prev.filter((sid) => sid !== id));
    },
    [tree, pushHistory],
  );

  const duplicateLayer = useCallback(
    (id: string) => {
      const { tree: nextTree, newIds } = duplicateLayers(
        tree,
        [id],
        PASTE_SHIFT_PX,
        PASTE_SHIFT_PX,
      );
      if (newIds.length === 0) return;
      pushHistory(nextTree);
      setSelectedLayerIds(newIds);
    },
    [tree, pushHistory],
  );

  /** Duplicate the current selection in place (with a small shift). */
  const duplicateSelection = useCallback(() => {
    if (selectedLayerIds.length === 0) return;
    const { tree: nextTree, newIds } = duplicateLayers(
      tree,
      selectedLayerIds,
      PASTE_SHIFT_PX,
      PASTE_SHIFT_PX,
    );
    if (newIds.length === 0) return;
    pushHistory(nextTree);
    setSelectedLayerIds(newIds);
  }, [tree, selectedLayerIds, pushHistory]);

  /**
   * Reorder the active selection. For multi-select we apply the reorder to
   * each selected id in the right order so the relative order is preserved
   * within the moved block.
   */
  const reorderSelection = useCallback(
    (direction: ReorderDirection) => {
      if (selectedLayerIds.length === 0) return;
      // Sort the ids by their current index in tree.layers to preserve the
      // relative ordering after the move. For "forward" / "front" we move
      // back-to-front; for "back" / "back_full" we move front-to-back, so
      // the leftmost stays leftmost.
      const indexed: Array<{ id: string; idx: number }> = [];
      selectedLayerIds.forEach((id) => {
        const idx = tree.layers.findIndex((l) => l.id === id);
        if (idx >= 0) indexed.push({ id, idx });
      });
      indexed.sort((a, b) =>
        direction === "forward" || direction === "front"
          ? b.idx - a.idx
          : a.idx - b.idx,
      );
      let next = tree;
      for (const { id } of indexed) {
        next = reorderLayer(next, id, direction);
      }
      if (next !== tree) pushHistory(next);
    },
    [tree, selectedLayerIds, pushHistory],
  );

  // ── Group / ungroup ────────────────────────────────────────────────
  const groupSelection = useCallback(() => {
    if (selectedLayerIds.length < 2) return;
    const { tree: nextTree, newGroupId } = groupLayers(tree, selectedLayerIds);
    if (!newGroupId) return;
    pushHistory(nextTree);
    setSelectedLayerIds([newGroupId]);
  }, [tree, selectedLayerIds, pushHistory]);

  const ungroupSelection = useCallback(() => {
    if (selectedLayerIds.length === 0) return;
    let next = tree;
    let outIds: string[] = [];
    for (const id of selectedLayerIds) {
      const r = ungroupLayer(next, id);
      next = r.tree;
      if (r.childIds.length > 0) outIds = outIds.concat(r.childIds);
    }
    if (next !== tree) {
      pushHistory(next);
      if (outIds.length > 0) setSelectedLayerIds(outIds);
    }
  }, [tree, selectedLayerIds, pushHistory]);

  // ── Clipboard (copy / paste) ───────────────────────────────────────
  const copySelection = useCallback(() => {
    if (selectedLayerIds.length === 0) return;
    const idSet = new Set(selectedLayerIds);
    const out: Layer[] = [];
    for (const l of tree.layers) {
      if (idSet.has(l.id)) out.push(l);
    }
    if (out.length > 0) {
      // Deep-snapshot via JSON so later edits don't mutate the clipboard.
      setClipboard(JSON.parse(JSON.stringify(out)) as Layer[]);
    }
  }, [tree.layers, selectedLayerIds]);

  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0) return;
    // Compute the bbox of the clipboard so we can position it sensibly.
    const bounds = getMultiBounds(clipboard);
    if (!bounds) return;
    let dx = PASTE_SHIFT_PX;
    let dy = PASTE_SHIFT_PX;
    const cursor = cursorTemplatePosRef.current;
    if (cursor) {
      // Anchor the clipboard's center on the cursor for a natural feel.
      dx = Math.round(cursor.x - (bounds.x + bounds.w / 2));
      dy = Math.round(cursor.y - (bounds.y + bounds.h / 2));
    }
    const additions: Layer[] = clipboard.map((l) => {
      const c = cloneLayerWithFreshIds(l);
      c.x = l.x + dx;
      c.y = l.y + dy;
      return c;
    });
    pushHistory({ ...tree, layers: [...tree.layers, ...additions] });
    setSelectedLayerIds(additions.map((c) => c.id));
  }, [clipboard, tree, pushHistory]);

  // ── Add-layer factories ────────────────────────────────────────────

  const addLayer = useCallback(
    (kind: "text" | "rect" | "image" | "gradient") => {
      const cx = tree.width / 2;
      const cy = tree.height / 2;
      let layer: Layer;
      switch (kind) {
        case "text": {
          const w = NEW_TEXT_DEFAULT.w;
          const h = NEW_TEXT_DEFAULT.h;
          const t: TextLayer = {
            id: newLayerId("text"),
            type: "text",
            x: Math.round(cx - w / 2),
            y: Math.round(cy - h / 2),
            w,
            h,
            text: "Add your text",
            font: FONT_FAMILIES[0].family,
            size: 48,
            weight: 700,
            color: "#252526",
            align: "center",
            vertical_align: "middle",
            line_height: 1.2,
            name: "New text",
          };
          layer = t;
          break;
        }
        case "rect": {
          const w = NEW_RECT_DEFAULT.w;
          const h = NEW_RECT_DEFAULT.h;
          const r: RectLayer = {
            id: newLayerId("rect"),
            type: "rect",
            x: Math.round(cx - w / 2),
            y: Math.round(cy - h / 2),
            w,
            h,
            fill: "#C9A84C",
            stroke: "transparent",
            stroke_width: 0,
            radius: 0,
            name: "New rectangle",
          };
          layer = r;
          break;
        }
        case "image": {
          const w = NEW_IMAGE_DEFAULT.w;
          const h = NEW_IMAGE_DEFAULT.h;
          // Default to first available photo, fall back to a 1x1 placeholder.
          const src = availablePhotos[0]?.url ?? PLACEHOLDER_PIXEL;
          const i: ImageLayer = {
            id: newLayerId("image"),
            type: "image",
            x: Math.round(cx - w / 2),
            y: Math.round(cy - h / 2),
            w,
            h,
            src,
            fit: "cover",
            radius: 0,
            name: "New image",
          };
          layer = i;
          break;
        }
        case "gradient": {
          const w = NEW_GRADIENT_DEFAULT.w;
          const h = NEW_GRADIENT_DEFAULT.h;
          const g: GradientLayer = {
            id: newLayerId("gradient"),
            type: "gradient",
            x: Math.round(cx - w / 2),
            y: Math.round(cy - h / 2),
            w,
            h,
            variant: "linear",
            angle: 180,
            stops: [
              { offset: 0, color: "#252526", opacity: 1 },
              { offset: 1, color: "#252526", opacity: 0 },
            ],
            radius: 0,
            name: "New gradient",
          };
          layer = g;
          break;
        }
      }
      pushHistory({ ...tree, layers: [...tree.layers, layer] });
      selectOnly(layer.id);
    },
    [tree, availablePhotos, pushHistory, selectOnly],
  );

  // ── Save flow ──────────────────────────────────────────────────────

  const save = useCallback(async () => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/post-builder/render-tree", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tree }),
      });
      type RenderTreeOk = { ok: true; image_url: string; image_path: string };
      type RenderTreeErr = { ok: false; error: string };
      let json: RenderTreeOk | RenderTreeErr | null = null;
      try {
        json = (await res.json()) as RenderTreeOk | RenderTreeErr;
      } catch {
        json = null;
      }
      if (!res.ok || !json || json.ok === false) {
        const err = !json ? `HTTP ${res.status}` : (json as RenderTreeErr).error;
        setToast({ kind: "error", text: `Save failed: ${err}` });
        return;
      }
      onSave({ tree, image_url: json.image_url, image_path: json.image_path });
      setToast({ kind: "success", text: "Saved." });
      setDirty(false);
    } catch (e) {
      setToast({
        kind: "error",
        text: `Save threw: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [tree, onSave]);

  // Auto-clear success toast.
  useEffect(() => {
    if (toast?.kind !== "success") return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Close handler with dirty-check ─────────────────────────────────
  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(
        "You have unsaved changes. Discard and close the editor?",
      );
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      // Avoid hijacking the user's typing in the property panel inputs.
      if (isEditableTarget(e.target)) {
        // Still allow undo/redo from inputs — that's the universal behavior.
        const cmd = e.metaKey || e.ctrlKey;
        if (cmd && (e.key === "z" || e.key === "Z")) {
          // Let the browser undo run inside text inputs; don't intercept.
          return;
        }
        return;
      }
      const cmd = e.metaKey || e.ctrlKey;
      const hasSelection = selectedLayerIds.length > 0;
      // ── Undo / redo ───────────────────────────────────────────────
      if (cmd && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (cmd && ((e.key === "z" || e.key === "Z") && e.shiftKey || e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      // ── Group / ungroup ───────────────────────────────────────────
      if (cmd && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) {
          ungroupSelection();
        } else {
          groupSelection();
        }
        return;
      }
      // ── Z-order: Cmd+] forward, Cmd+[ back, +Shift = front/back ──
      if (cmd && e.key === "]") {
        e.preventDefault();
        reorderSelection(e.shiftKey ? "front" : "forward");
        return;
      }
      if (cmd && e.key === "[") {
        e.preventDefault();
        reorderSelection(e.shiftKey ? "back_full" : "back");
        return;
      }
      // ── Copy / paste / duplicate ──────────────────────────────────
      if (cmd && (e.key === "c" || e.key === "C")) {
        if (hasSelection) {
          e.preventDefault();
          copySelection();
        }
        return;
      }
      if (cmd && (e.key === "v" || e.key === "V")) {
        if (clipboard.length > 0) {
          e.preventDefault();
          pasteClipboard();
        }
        return;
      }
      if (cmd && (e.key === "d" || e.key === "D")) {
        if (hasSelection) {
          e.preventDefault();
          duplicateSelection();
        }
        return;
      }
      // ── Select-all (top-level layers) ─────────────────────────────
      if (cmd && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedLayerIds(tree.layers.map((l) => l.id));
        return;
      }
      // ── Delete / backspace ────────────────────────────────────────
      if ((e.key === "Delete" || e.key === "Backspace") && hasSelection) {
        e.preventDefault();
        deleteSelectedLayers();
        return;
      }
      // ── Escape: clear selection or close editor ───────────────────
      if (e.key === "Escape") {
        if (hasSelection) {
          setSelectedLayerIds([]);
        } else {
          handleClose();
        }
        return;
      }
      // ── Arrow-key nudge ───────────────────────────────────────────
      if (hasSelection) {
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          updateSelectedLayers((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    deleteSelectedLayers,
    selectedLayerIds,
    updateSelectedLayers,
    handleClose,
    groupSelection,
    ungroupSelection,
    reorderSelection,
    copySelection,
    pasteClipboard,
    duplicateSelection,
    clipboard,
    tree.layers,
  ]);

  // ── SVG render of the tree (live) ──────────────────────────────────
  const svgMarkup = useMemo(() => layerTreeToSvg(tree), [tree]);

  // ── Flat layer list (top-level only, top-of-list = front) ──────────
  // For v1 we expose only the top-level layers in the panel. Group children
  // are rendered via the SVG but not directly editable in the layer list —
  // selecting a group lets you move/resize it as a unit. Listings templates
  // already use this pattern (a "content stack" group), so this matches the
  // mental model.
  const layerListItems = useMemo(() => {
    const out: Array<{ layer: Layer; depth: number }> = [];
    for (const l of tree.layers) {
      out.push({ layer: l, depth: 0 });
    }
    // Reverse so the top-of-canvas (last in render order) is first in the list.
    return out.reverse();
  }, [tree.layers]);

  // ── Layer count for header ─────────────────────────────────────────
  const totalLayerCount = useMemo(() => {
    let c = 0;
    for (const _ of walkLayers(tree)) c += 1;
    return c;
  }, [tree]);

  // ── Title for header ───────────────────────────────────────────────
  const title = listing.address ?? listing.mls_number ?? "Untitled post";

  // ── Click on canvas to select / deselect (shift = additive) ────────
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Look up the closest element with data-layer-id; if none, deselect.
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el !== canvasInnerRef.current) {
        const id = el.getAttribute("data-layer-id");
        if (id) {
          if (e.shiftKey) {
            setSelectedLayerIds((prev) =>
              prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
            );
          } else {
            selectOnly(id);
          }
          return;
        }
        el = el.parentElement;
      }
      // Click on empty canvas — only deselect if not shift-modified (a marquee
      // drag will handle empty-area shift-clicks). On a plain click that
      // doesn't hit a layer, the marquee handler's mouseup decides whether to
      // clear; we leave the existing behavior unchanged here.
      if (!e.shiftKey) selectOnly(null);
    },
    [selectOnly],
  );

  // ── Compute Moveable target rect (in the moveable-overlay div coords) ──
  // We use approach #1 from the brief: render a transparent div positioned
  // over the selected layer's bounds inside the unscaled canvas coordinate
  // space, attach Moveable to it. Because the parent uses CSS transform:
  // scale(zoom), Moveable's getBoundingClientRect picks up the on-screen
  // size correctly. On drag/resize we divide deltas by zoom to convert
  // screen-pixels back to template-pixels.

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Post editor"
    >
      {/* ── TOP TOOLBAR ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 h-14 px-4 bg-neutral-900 text-white border-b border-neutral-800 flex-shrink-0">
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-neutral-300 hover:bg-neutral-800 hover:text-white transition"
          title="Close (Esc)"
          aria-label="Close editor"
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex flex-col leading-tight min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-neutral-400">Post Editor</div>
          <div className="text-sm font-semibold truncate">{title}</div>
        </div>
        <div className="ml-6 flex items-center gap-1">
          <ToolbarButton onClick={undo} disabled={historyIndex === 0} title="Undo (Cmd+Z)">
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <path d="M7 7H13a4 4 0 110 8H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 4L6 7l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={redo}
            disabled={historyIndex === history.length - 1}
            title="Redo (Cmd+Shift+Z)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <path d="M13 7H7a4 4 0 100 8h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 4l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
        </div>
        <div className="ml-6 flex items-center gap-1 text-xs">
          <ToolbarButton
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))}
            title="Zoom out"
          >
            −
          </ToolbarButton>
          <div className="px-2 min-w-[50px] text-center font-mono text-neutral-200">
            {Math.round(zoom * 100)}%
          </div>
          <ToolbarButton
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))}
            title="Zoom in"
          >
            +
          </ToolbarButton>
          <ToolbarButton onClick={fitToViewport} title="Fit to viewport">
            Fit
          </ToolbarButton>
        </div>
        {/* ── B-5: Z-order + group/ungroup + snap toggle ──────────── */}
        <div className="ml-6 flex items-center gap-1">
          <ToolbarButton
            onClick={() => reorderSelection("back_full")}
            disabled={selectedLayerIds.length === 0}
            title="Send to back (Cmd+Shift+[)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="6" y="6" width="8" height="8" stroke="currentColor" strokeWidth="1.6" />
              <rect x="2" y="10" width="8" height="8" fill="currentColor" opacity="0.4" />
              <rect x="10" y="2" width="8" height="8" fill="currentColor" opacity="0.4" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => reorderSelection("back")}
            disabled={selectedLayerIds.length === 0}
            title="Send back (Cmd+[)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="3" y="3" width="10" height="10" fill="currentColor" opacity="0.4" />
              <rect x="7" y="7" width="10" height="10" stroke="currentColor" strokeWidth="1.6" fill="#1a1a1a" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => reorderSelection("forward")}
            disabled={selectedLayerIds.length === 0}
            title="Bring forward (Cmd+])"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="7" y="7" width="10" height="10" fill="currentColor" opacity="0.4" />
              <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.6" fill="#1a1a1a" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => reorderSelection("front")}
            disabled={selectedLayerIds.length === 0}
            title="Bring to front (Cmd+Shift+])"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="2" y="10" width="8" height="8" fill="currentColor" opacity="0.4" />
              <rect x="10" y="2" width="8" height="8" fill="currentColor" opacity="0.4" />
              <rect x="6" y="6" width="8" height="8" stroke="currentColor" strokeWidth="1.6" fill="#1a1a1a" />
            </svg>
          </ToolbarButton>
        </div>
        <div className="ml-3 flex items-center gap-1">
          <ToolbarButton
            onClick={groupSelection}
            disabled={selectedLayerIds.length < 2}
            title="Group selection (Cmd+G)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
              <rect x="12" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
              <rect x="2" y="12" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
              <rect x="12" y="12" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
              <rect x="0.5" y="0.5" width="19" height="19" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={ungroupSelection}
            disabled={!selectedLayers.some((l) => l.type === "group")}
            title="Ungroup (Cmd+Shift+G)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
              <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
              <rect x="12" y="12" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </ToolbarButton>
        </div>
        <div className="ml-3">
          <button
            type="button"
            onClick={() => setSnapEnabled((v) => !v)}
            title={snapEnabled ? "Snap on (click to disable). Hold Cmd while dragging to bypass." : "Snap off (click to enable)"}
            className={[
              "px-2.5 h-8 rounded-md text-[11px] font-medium transition flex items-center gap-1.5",
              snapEnabled
                ? "bg-gold-500/20 text-gold-200 hover:bg-gold-500/30"
                : "text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
              <path d="M2 5h12M2 8h12M2 11h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Snap
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-[11px] text-neutral-400">Unsaved changes</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-gold-500 hover:bg-gold-400 text-neutral-900 text-sm font-semibold disabled:opacity-50 transition"
          >
            {saving ? "Rendering…" : "Save"}
          </button>
        </div>
      </div>

      {/* ── B-6: OH-multi context banner ────────────────────────── */}
      {ohMultiContext ? (
        <div className="flex items-center gap-2 h-9 px-4 bg-emerald-900/40 text-emerald-100 border-b border-emerald-800 text-[12px] flex-shrink-0">
          <span aria-hidden="true">🗓</span>
          <span className="font-semibold">
            Editing card {ohMultiContext.current} of {ohMultiContext.total}
          </span>
          <span className="text-emerald-200/80">— {ohMultiContext.address}</span>
          <span className="text-emerald-300/80 ml-auto">
            Save updates this listing&apos;s card. Re-open editor for the others.
          </span>
        </div>
      ) : null}

      {/* ── MAIN SPLIT ─────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ── LAYER PANEL (left) ────────────────────────────── */}
        <aside className="w-[220px] flex-shrink-0 bg-neutral-900 text-white border-r border-neutral-800 flex flex-col">
          <div className="px-3 pt-3 pb-2 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-widest text-neutral-400">Layers</div>
            <div className="text-[10px] text-neutral-500">{totalLayerCount}</div>
          </div>
          <LayerPanelList
            items={layerListItems}
            selectedIds={selectedLayerIds}
            onSelect={(id, additive) => {
              if (additive) {
                setSelectedLayerIds((prev) =>
                  prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
                );
              } else {
                selectOnly(id);
              }
            }}
            onRename={(id, name) => updateLayer(id, (l) => ({ ...l, name }))}
            onToggleHidden={(id) =>
              updateLayer(id, (l) => ({ ...l, hidden: !l.hidden }))
            }
            onToggleLocked={(id) =>
              updateLayer(id, (l) => ({ ...l, locked: !l.locked }))
            }
            onDelete={(id) => deleteLayer(id)}
            onDuplicate={(id) => duplicateLayer(id)}
            onForward={(id) => pushHistory(reorderLayer(tree, id, "forward"))}
            onBackward={(id) => pushHistory(reorderLayer(tree, id, "back"))}
            onReorder={(fromId, toIdx) => pushHistory(moveLayerToIndex(tree, fromId, toIdx))}
            totalLayerCount={tree.layers.length}
          />
        </aside>

        {/* ── CANVAS (center) ──────────────────────────────── */}
        <section className="flex-1 flex flex-col min-w-0 bg-neutral-950">
          <div className="flex items-center gap-1 h-11 px-3 border-b border-neutral-800 bg-neutral-900">
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mr-2">
              Add layer
            </div>
            <AddLayerButton onClick={() => addLayer("text")} icon="T" label="Text" />
            <AddLayerButton onClick={() => addLayer("rect")} icon="▭" label="Rectangle" />
            <AddLayerButton
              onClick={() => addLayer("image")}
              icon="◧"
              label="Image"
              disabled={availablePhotos.length === 0}
              title={
                availablePhotos.length === 0
                  ? "No photos available — pick a listing with photos first."
                  : "Add image layer"
              }
            />
            <AddLayerButton onClick={() => addLayer("gradient")} icon="◐" label="Gradient" />
            <div className="ml-auto text-[11px] text-neutral-500">
              {tree.width} × {tree.height}px
            </div>
          </div>
          <CanvasArea
            tree={tree}
            zoom={zoom}
            svgMarkup={svgMarkup}
            selectedLayer={selectedLayer}
            selectedLayers={selectedLayers}
            multiBounds={multiBounds}
            hasMultiSelect={hasMultiSelect}
            moveableTick={moveableTick}
            snapEnabled={snapEnabled}
            snapLines={snapLines}
            setSnapLines={setSnapLines}
            dragModifierBypassRef={dragModifierBypassRef}
            cursorTemplatePosRef={cursorTemplatePosRef}
            marquee={marquee}
            setMarquee={setMarquee}
            canvasViewportRef={canvasViewportRef}
            canvasInnerRef={canvasInnerRef}
            moveableTargetRef={moveableTargetRef}
            handleCanvasClick={handleCanvasClick}
            updateSelectedLayers={updateSelectedLayers}
            setSelectedLayerIds={setSelectedLayerIds}
            selectOnly={selectOnly}
          >
            {toast ? (
              <div
                className={[
                  "absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg",
                  toast.kind === "success"
                    ? "bg-emerald-600 text-white"
                    : "bg-rose-600 text-white",
                ].join(" ")}
              >
                {toast.text}
              </div>
            ) : null}
          </CanvasArea>
        </section>

        {/* ── PROPERTY PANEL (right) ───────────────────────── */}
        <aside className="w-[320px] flex-shrink-0 bg-neutral-900 text-white border-l border-neutral-800 overflow-y-auto">
          {hasMultiSelect ? (
            <MultiSelectPropertyPanel
              layers={selectedLayers}
              onUpdateAll={(mutator) => updateSelectedLayers(mutator)}
              onDelete={deleteSelectedLayers}
              onGroup={groupSelection}
            />
          ) : selectedLayer ? (
            <PropertyPanel
              layer={selectedLayer}
              tree={tree}
              availablePhotos={availablePhotos}
              onChange={(next) => updateLayer(selectedLayer.id, () => next)}
              onDelete={() => deleteLayer(selectedLayer.id)}
              onUngroup={
                selectedLayer.type === "group"
                  ? () => ungroupSelection()
                  : undefined
              }
            />
          ) : (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              Select a layer to edit its properties.
              <div className="mt-2 text-[11px] text-neutral-500">
                Click a layer in the canvas or the layers list.
                <br />
                Shift+click to select multiple layers.
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 h-8 min-w-[32px] rounded-md text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent transition flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function AddLayerButton({
  onClick,
  icon,
  label,
  disabled,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? `Add ${label.toLowerCase()}`}
      className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
    >
      <span className="font-mono text-[14px] leading-none w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

interface LayerRowProps {
  layer: Layer;
  selected: boolean;
  /** True when this row is the drag-over drop target. */
  dropAbove?: boolean;
  dropBelow?: boolean;
  /** True if a row is currently being dragged anywhere in the panel. */
  dragInProgress?: boolean;
  onSelect: (additive: boolean) => void;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onForward: () => void;
  onBackward: () => void;
  /** HTML5 drag-and-drop wiring from LayerPanelList. */
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

function LayerRow(props: LayerRowProps) {
  const { layer, selected, dropAbove, dropBelow } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name ?? defaultLayerName(layer));
  const [menuOpen, setMenuOpen] = useState(false);

  // Sync local name when layer.name changes externally.
  useEffect(() => {
    setName(layer.name ?? defaultLayerName(layer));
  }, [layer.name, layer.id, layer.type]);

  // Close the more-menu on outside click.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onClick={(e) => props.onSelect(e.shiftKey)}
      className={[
        "relative flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition border",
        selected
          ? "bg-gold-500/10 border-gold-500/60 ring-1 ring-gold-500/40"
          : "border-transparent hover:bg-neutral-800",
        dropAbove ? "shadow-[inset_0_2px_0_0_rgba(201,168,76,1)]" : "",
        dropBelow ? "shadow-[inset_0_-2px_0_0_rgba(201,168,76,1)]" : "",
      ].join(" ")}
    >
      <span className="w-4 text-center text-[11px] text-neutral-400 font-mono">
        {layerTypeIcon(layer.type)}
      </span>
      {editing ? (
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            props.onRename(name.trim() || defaultLayerName(layer));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setEditing(false);
              props.onRename(name.trim() || defaultLayerName(layer));
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setName(layer.name ?? defaultLayerName(layer));
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-neutral-800 text-white text-xs px-1.5 py-0.5 rounded outline-none ring-1 ring-gold-500"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => setEditing(true)}
          className="flex-1 min-w-0 text-left text-xs text-neutral-100 truncate"
          title={name}
        >
          {name}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleHidden();
        }}
        className={[
          "w-5 h-5 rounded flex items-center justify-center transition",
          layer.hidden ? "text-neutral-500" : "text-neutral-300 hover:text-white",
        ].join(" ")}
        title={layer.hidden ? "Show layer" : "Hide layer"}
      >
        {layer.hidden ? (
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
            <path d="M2 8s2-4 6-4c1 0 2 .2 2.7.6M14 8s-2 4-6 4c-1 0-2-.2-2.7-.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
            <path d="M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleLocked();
        }}
        className={[
          "w-5 h-5 rounded flex items-center justify-center transition",
          layer.locked ? "text-gold-400" : "text-neutral-400 hover:text-white",
        ].join(" ")}
        title={layer.locked ? "Unlock layer" : "Lock layer"}
      >
        {layer.locked ? (
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
            <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
            <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5 7V5a3 3 0 015.83-1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
      </button>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="w-5 h-5 rounded flex items-center justify-center text-neutral-400 hover:text-white"
          title="More"
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-6 z-10 w-40 rounded-md bg-neutral-800 border border-neutral-700 py-1 shadow-xl">
            <MenuItem onClick={props.onDuplicate} label="Duplicate" />
            <MenuItem onClick={props.onForward} label="Bring forward" />
            <MenuItem onClick={props.onBackward} label="Send back" />
            <div className="my-1 h-px bg-neutral-700" />
            <MenuItem onClick={props.onDelete} label="Delete" danger />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  label,
  danger,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        "w-full text-left px-3 py-1.5 text-xs transition",
        danger ? "text-rose-300 hover:bg-rose-900/40" : "text-neutral-200 hover:bg-neutral-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ─── Property panel ──────────────────────────────────────────────────

interface PropertyPanelProps {
  layer: Layer;
  tree: LayerTree;
  availablePhotos: Array<{ url: string; sequence: number }>;
  onChange: (next: Layer) => void;
  onDelete: () => void;
  /** Provided when the selected layer is a Group — unwraps it. */
  onUngroup?: () => void;
}

function PropertyPanel({ layer, availablePhotos, onChange, onDelete, onUngroup }: PropertyPanelProps) {
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-neutral-400">
          {layerTypeLabel(layer.type)}
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-rose-300 hover:text-rose-200"
          title="Delete this layer"
        >
          Delete
        </button>
      </div>

      <UniversalSection layer={layer} onChange={onChange} />

      {layer.type === "text" ? (
        <TextSection layer={layer} onChange={onChange} />
      ) : null}
      {layer.type === "image" ? (
        <ImageSection layer={layer} onChange={onChange} availablePhotos={availablePhotos} />
      ) : null}
      {layer.type === "rect" ? (
        <RectSection layer={layer} onChange={onChange} />
      ) : null}
      {layer.type === "gradient" ? (
        <GradientSection layer={layer} onChange={onChange} />
      ) : null}
      {layer.type === "line" ? (
        <LineSection layer={layer} onChange={onChange} />
      ) : null}
      {layer.type === "group" ? (
        <FieldGroup label="Group">
          <p className="text-[11px] text-neutral-400">
            Group layer contains {(layer as GroupLayer).children.length} child layers.
            Ungroup to edit children individually.
          </p>
          {onUngroup ? (
            <button
              type="button"
              onClick={onUngroup}
              className="mt-2 w-full px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-100 transition"
            >
              Ungroup (Cmd+Shift+G)
            </button>
          ) : null}
        </FieldGroup>
      ) : null}
    </div>
  );
}

function UniversalSection({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (next: Layer) => void;
}) {
  const update = (patch: Partial<Layer>) => onChange({ ...layer, ...patch } as Layer);
  return (
    <FieldGroup label="Position & size">
      <Field label="Name">
        <input
          type="text"
          value={layer.name ?? ""}
          onChange={(e) => update({ name: e.target.value || undefined })}
          placeholder={defaultLayerName(layer)}
          className="input-dark"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput value={layer.x} onChange={(v) => update({ x: v })} />
        </Field>
        <Field label="Y">
          <NumberInput value={layer.y} onChange={(v) => update({ y: v })} />
        </Field>
        <Field label="Width">
          <NumberInput value={layer.w} min={1} onChange={(v) => update({ w: v })} />
        </Field>
        <Field label="Height">
          <NumberInput value={layer.h} min={1} onChange={(v) => update({ h: v })} />
        </Field>
      </div>
      <Field label={`Rotation (${Math.round(layer.rotation ?? 0)}°)`}>
        <SliderWithNumber
          value={layer.rotation ?? 0}
          min={0}
          max={360}
          step={1}
          onChange={(v) => update({ rotation: v })}
        />
      </Field>
      <Field label={`Opacity (${Math.round((layer.opacity ?? 1) * 100)}%)`}>
        <SliderWithNumber
          value={Math.round((layer.opacity ?? 1) * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => update({ opacity: v / 100 })}
        />
      </Field>
      <div className="flex gap-3 pt-1">
        <Checkbox
          label="Hidden"
          checked={!!layer.hidden}
          onChange={(v) => update({ hidden: v })}
        />
        <Checkbox
          label="Locked"
          checked={!!layer.locked}
          onChange={(v) => update({ locked: v })}
        />
      </div>
    </FieldGroup>
  );
}

function TextSection({
  layer,
  onChange,
}: {
  layer: TextLayer;
  onChange: (next: TextLayer) => void;
}) {
  const update = (patch: Partial<TextLayer>) => onChange({ ...layer, ...patch });
  const weight = typeof layer.weight === "number" ? layer.weight : 400;
  const align = layer.align ?? "left";
  const vAlign = layer.vertical_align ?? "top";
  return (
    <FieldGroup label="Text">
      <Field label="Content">
        <textarea
          value={layer.text}
          onChange={(e) => update({ text: e.target.value })}
          rows={3}
          className="input-dark resize-y min-h-[64px]"
        />
      </Field>
      <Field label="Font">
        <FontPicker
          value={layer.font ?? FONT_FAMILIES[0].family}
          onChange={(v) => update({ font: v })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Size (${layer.size ?? 32}px)`}>
          <SliderWithNumber
            value={layer.size ?? 32}
            min={6}
            max={400}
            step={1}
            onChange={(v) => update({ size: v })}
          />
        </Field>
        <Field label="Weight">
          <select
            value={String(weight)}
            onChange={(e) => update({ weight: Number(e.target.value) })}
            className="input-dark"
          >
            {[400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Color">
        <ColorPicker
          value={layer.color ?? "#252526"}
          onChange={(v) => update({ color: v })}
        />
      </Field>
      <Field label="Horizontal align">
        <Segmented
          value={align}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
          onChange={(v) => update({ align: v as TextLayer["align"] })}
        />
      </Field>
      <Field label="Vertical align">
        <Segmented
          value={vAlign}
          options={[
            { value: "top", label: "Top" },
            { value: "middle", label: "Middle" },
            { value: "bottom", label: "Bottom" },
          ]}
          onChange={(v) => update({ vertical_align: v as TextLayer["vertical_align"] })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Letter spacing (em)">
          <NumberInput
            value={layer.letter_spacing ?? 0}
            step={0.01}
            onChange={(v) => update({ letter_spacing: v })}
          />
        </Field>
        <Field label="Line height (×)">
          <NumberInput
            value={layer.line_height ?? 1.2}
            min={0.5}
            step={0.05}
            onChange={(v) => update({ line_height: v })}
          />
        </Field>
      </div>
      <Checkbox
        label="UPPERCASE"
        checked={!!layer.uppercase}
        onChange={(v) => update({ uppercase: v })}
      />
      <Field label="Text shadow (CSS)">
        <input
          type="text"
          value={layer.text_shadow ?? ""}
          onChange={(e) => update({ text_shadow: e.target.value || undefined })}
          placeholder="0 2px 4px rgba(0,0,0,0.4)"
          className="input-dark"
        />
      </Field>
    </FieldGroup>
  );
}

function ImageSection({
  layer,
  onChange,
  availablePhotos,
}: {
  layer: ImageLayer;
  onChange: (next: ImageLayer) => void;
  availablePhotos: Array<{ url: string; sequence: number }>;
}) {
  const update = (patch: Partial<ImageLayer>) => onChange({ ...layer, ...patch });
  // Detect whether the current src matches one of the available photos so
  // the dropdown shows the right "selected" state.
  const matchedPhoto = availablePhotos.find((p) => p.url === layer.src);
  const [cropOpen, setCropOpen] = useState(false);
  // Close the crop panel if the underlying src changes (otherwise the
  // user would be cropping the wrong image).
  useEffect(() => {
    setCropOpen(false);
  }, [layer.src]);
  const hasCrop = !!(
    layer.crop &&
    !(layer.crop.x === 0 && layer.crop.y === 0 && layer.crop.w === 1 && layer.crop.h === 1)
  );
  return (
    <FieldGroup label="Image">
      <Field label="Source">
        <select
          value={matchedPhoto ? `photo:${matchedPhoto.sequence}` : "custom"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") return;
            const seq = Number(v.replace("photo:", ""));
            const photo = availablePhotos.find((p) => p.sequence === seq);
            if (photo) update({ src: photo.url });
          }}
          className="input-dark"
        >
          <option value="custom">Custom URL</option>
          {availablePhotos.map((p) => (
            <option key={p.sequence} value={`photo:${p.sequence}`}>
              Photo {p.sequence + 1}
            </option>
          ))}
        </select>
      </Field>
      <Field label="URL">
        <input
          type="text"
          value={layer.src}
          onChange={(e) => update({ src: e.target.value })}
          className="input-dark font-mono text-[11px]"
          placeholder="https://…"
        />
      </Field>
      <Field label="Fit mode">
        <Segmented
          value={layer.fit ?? "cover"}
          options={[
            { value: "cover", label: "Cover" },
            { value: "contain", label: "Contain" },
            { value: "fill", label: "Fill" },
          ]}
          onChange={(v) => update({ fit: v as ImageLayer["fit"] })}
        />
      </Field>
      <Field label={`Corner radius (${layer.radius ?? 0}px)`}>
        <SliderWithNumber
          value={layer.radius ?? 0}
          min={0}
          max={200}
          step={1}
          onChange={(v) => update({ radius: v })}
        />
      </Field>
      {/* B-6: Crop tool — opens an in-place crop UI below the fields. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCropOpen((v) => !v)}
          className={[
            "flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium transition",
            cropOpen
              ? "bg-gold-500/20 text-gold-200 ring-1 ring-gold-500/60"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-100",
          ].join(" ")}
          title="Crop the source image to a sub-region"
        >
          {cropOpen ? "Close crop" : `✂ Crop${hasCrop ? " (active)" : ""}`}
        </button>
        {hasCrop ? (
          <button
            type="button"
            onClick={() => {
              // Reset crop in a single mutation so undo restores in one step.
              const { crop: _drop, ...rest } = layer;
              void _drop;
              onChange(rest as ImageLayer);
            }}
            className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-rose-900/40 text-[11px] text-rose-300 transition"
            title="Remove crop window"
          >
            Reset
          </button>
        ) : null}
      </div>
      {cropOpen ? (
        <CropTool
          src={layer.src}
          initial={layer.crop}
          onApply={(crop) => {
            update({ crop });
            setCropOpen(false);
          }}
          onCancel={() => setCropOpen(false)}
        />
      ) : null}
    </FieldGroup>
  );
}

function RectSection({
  layer,
  onChange,
}: {
  layer: RectLayer;
  onChange: (next: RectLayer) => void;
}) {
  const update = (patch: Partial<RectLayer>) => onChange({ ...layer, ...patch });
  return (
    <FieldGroup label="Rectangle">
      <Field label="Fill">
        <ColorPicker
          value={layer.fill ?? "transparent"}
          onChange={(v) => update({ fill: v })}
        />
      </Field>
      <Field label="Stroke">
        <ColorPicker
          value={layer.stroke ?? "transparent"}
          onChange={(v) => update({ stroke: v })}
        />
      </Field>
      <Field label="Stroke width (px)">
        <NumberInput
          value={layer.stroke_width ?? 0}
          min={0}
          step={0.5}
          onChange={(v) => update({ stroke_width: v })}
        />
      </Field>
      <Field label={`Corner radius (${layer.radius ?? 0}px)`}>
        <SliderWithNumber
          value={layer.radius ?? 0}
          min={0}
          max={200}
          step={1}
          onChange={(v) => update({ radius: v })}
        />
      </Field>
    </FieldGroup>
  );
}

function GradientSection({
  layer,
  onChange,
}: {
  layer: GradientLayer;
  onChange: (next: GradientLayer) => void;
}) {
  const update = (patch: Partial<GradientLayer>) => onChange({ ...layer, ...patch });
  const updateStop = (idx: number, patch: Partial<GradientStop>) => {
    const stops = layer.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update({ stops });
  };
  const addStop = () => {
    const stops = [...layer.stops, { offset: 0.5, color: "#FFFFFF", opacity: 1 }];
    update({ stops });
  };
  const removeStop = (idx: number) => {
    if (layer.stops.length <= 2) return; // keep at least 2 stops
    update({ stops: layer.stops.filter((_, i) => i !== idx) });
  };
  return (
    <FieldGroup label="Gradient">
      <Field label="Variant">
        <Segmented
          value={layer.variant}
          options={[
            { value: "linear", label: "Linear" },
            { value: "radial", label: "Radial" },
          ]}
          onChange={(v) => update({ variant: v as GradientLayer["variant"] })}
        />
      </Field>
      {layer.variant === "linear" ? (
        <Field label={`Angle (${Math.round(layer.angle ?? 0)}°)`}>
          <SliderWithNumber
            value={layer.angle ?? 0}
            min={0}
            max={360}
            step={1}
            onChange={(v) => update({ angle: v })}
          />
        </Field>
      ) : null}
      <Field label="Stops">
        <div className="space-y-2">
          {layer.stops.map((stop, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <ColorPicker
                value={stop.color}
                onChange={(v) => updateStop(idx, { color: v })}
                compact
              />
              <input
                type="number"
                value={stop.offset}
                min={0}
                max={1}
                step={0.05}
                onChange={(e) => updateStop(idx, { offset: Number(e.target.value) })}
                className="input-dark w-16 font-mono text-[11px]"
                title="Offset (0..1)"
              />
              <input
                type="number"
                value={stop.opacity ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(e) => updateStop(idx, { opacity: Number(e.target.value) })}
                className="input-dark w-16 font-mono text-[11px]"
                title="Opacity (0..1)"
              />
              <button
                type="button"
                onClick={() => removeStop(idx)}
                disabled={layer.stops.length <= 2}
                className="w-6 h-6 rounded text-rose-300 hover:bg-rose-900/40 disabled:opacity-30 text-xs"
                title="Remove stop"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addStop}
            className="text-[11px] text-gold-300 hover:text-gold-200"
          >
            + Add stop
          </button>
        </div>
      </Field>
      <Field label={`Corner radius (${layer.radius ?? 0}px)`}>
        <SliderWithNumber
          value={layer.radius ?? 0}
          min={0}
          max={200}
          step={1}
          onChange={(v) => update({ radius: v })}
        />
      </Field>
    </FieldGroup>
  );
}

function LineSection({
  layer,
  onChange,
}: {
  layer: LineLayer;
  onChange: (next: LineLayer) => void;
}) {
  const update = (patch: Partial<LineLayer>) => onChange({ ...layer, ...patch });
  return (
    <FieldGroup label="Line">
      <Field label="Stroke">
        <ColorPicker
          value={layer.stroke ?? "#000000"}
          onChange={(v) => update({ stroke: v })}
        />
      </Field>
      <Field label="Stroke width (px)">
        <NumberInput
          value={layer.stroke_width ?? 1}
          min={0}
          step={0.5}
          onChange={(v) => update({ stroke_width: v })}
        />
      </Field>
    </FieldGroup>
  );
}

// ─── Generic form primitives ─────────────────────────────────────────

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] uppercase tracking-widest text-neutral-500 border-b border-neutral-800 pb-1.5">
        {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{label}</div>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      className="input-dark"
    />
  );
}

function SliderWithNumber({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-gold-500"
      />
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="input-dark w-16 text-right font-mono text-[11px]"
      />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-neutral-800 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "flex-1 px-2 py-1 rounded text-[11px] font-medium transition",
            value === opt.value
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:text-white",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-300 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-gold-500"
      />
      <span>{label}</span>
    </label>
  );
}

function ColorPicker({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const isValidHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)
    || hex === "transparent";
  // B-6: surface a small "off-brand" hint when the current value isn't in
  // the brand palette. The user is free to use it — this is informational
  // so they know they're stepping outside the system.
  const matchedBrand = BRAND_PALETTE.find(
    (c) => c.value.toLowerCase() === value.toLowerCase(),
  );
  const isOffBrand =
    isValidHex && !!value && !matchedBrand && value !== "transparent";
  return (
    <div className={compact ? "flex items-center gap-1" : "space-y-2"}>
      <div className={compact ? "" : "grid grid-cols-5 gap-1"}>
        {compact ? (
          <button
            type="button"
            className="w-6 h-6 rounded border border-neutral-700"
            style={{
              background:
                value === "transparent"
                  ? "linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333), linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333) 4px 4px / 8px 8px"
                  : value,
            }}
            title={value}
          />
        ) : (
          BRAND_PALETTE.map((c) => {
            const active = c.value.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c.value)}
                className={[
                  "h-7 rounded border transition relative",
                  active
                    ? "border-gold-400 ring-2 ring-gold-500/50"
                    : "border-neutral-700 hover:border-neutral-500",
                ].join(" ")}
                style={{
                  background:
                    c.value === "transparent"
                      ? "linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333), linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333) 4px 4px / 8px 8px"
                      : c.value,
                }}
                title={`${c.label}${c.on_brand ? "" : " (off-brand)"}`}
              >
                {!c.on_brand ? (
                  <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[7px] font-bold rounded-full px-1 leading-none py-px">
                    !
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <input
        type="text"
        value={hex}
        onChange={(e) => {
          const v = e.target.value.trim();
          setHex(v);
          if (
            v === "transparent" ||
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
          ) {
            onChange(v);
          }
        }}
        placeholder="#RRGGBB"
        className={[
          "input-dark font-mono text-[11px]",
          compact ? "w-24" : "",
          !isValidHex ? "ring-1 ring-rose-500" : "",
        ].join(" ")}
      />
      {!compact && isOffBrand ? (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-300/80">
          <span aria-hidden="true">✓</span>
          <span>Off-brand color — fine, just noting.</span>
        </div>
      ) : null}
    </div>
  );
}

// ─── B-6: Font picker (visual popover) ───────────────────────────────

/**
 * Font picker that shows each family rendered IN ITS OWN font, grouped
 * by category. Click the trigger button to open a popover panel; click
 * a family to select + close. Closes on outside click + Escape.
 *
 * The trigger button itself shows the currently-selected family in that
 * family's font, so the user gets feedback without opening the picker.
 */
function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Resolve the current family entry (fallback to first if unknown).
  const current =
    FONT_FAMILIES.find((f) => f.family === value || f.id === value) ??
    FONT_FAMILIES[0];

  // Group families by category — section headers in the popover.
  const groups = useMemo(() => {
    const byCat = new Map<string, typeof FONT_FAMILIES[number][]>();
    for (const f of FONT_FAMILIES) {
      const list = byCat.get(f.category) ?? [];
      list.push(f);
      byCat.set(f.category, list);
    }
    // Stable display order: sans → serif → display → mono.
    const labels: Record<string, string> = {
      sans: "Sans-serif",
      serif: "Serif",
      display: "Display",
      mono: "Monospace",
    };
    const order = ["sans", "serif", "display", "mono"];
    return order
      .filter((c) => byCat.has(c))
      .map((c) => ({
        category: c,
        label: labels[c] ?? c,
        families: byCat.get(c)!,
      }));
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input-dark w-full flex items-center justify-between gap-2 cursor-pointer text-left"
        style={{ fontFamily: `'${current.family}', sans-serif` }}
        title={`${current.label} · ${current.category}`}
      >
        <span className="truncate">{current.label}</span>
        <span className="text-neutral-500 text-xs flex-shrink-0">▾</span>
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-80 overflow-y-auto rounded-md bg-neutral-800 border border-neutral-700 shadow-xl py-1"
          role="listbox"
          aria-label="Choose a font"
        >
          {groups.map((g) => (
            <div key={g.category}>
              <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-neutral-500 font-semibold">
                {g.label}
              </div>
              {g.families.map((f) => {
                const active = f.family === current.family;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(f.family);
                      setOpen(false);
                    }}
                    className={[
                      "w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition",
                      active
                        ? "bg-gold-500/15 text-gold-200"
                        : "text-neutral-100 hover:bg-neutral-700",
                    ].join(" ")}
                    style={{ fontFamily: `'${f.family}', sans-serif` }}
                  >
                    <span className="text-sm truncate">{f.label}</span>
                    <span className="text-base text-neutral-300 flex-shrink-0">
                      Aa
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── B-6: Image crop tool (in-place panel UI) ────────────────────────

/**
 * Inline crop UI — renders a small preview of the image with a draggable
 * crop rectangle on top. User can drag the crop box body to move, or one
 * of 8 handles to resize. Apply commits a normalized {x,y,w,h} crop window
 * to the layer; Cancel reverts.
 *
 * Lives inside ImageSection — opened by the "Crop" button. Roughly 280px
 * tall, scales the image to fit while keeping aspect ratio.
 */
function CropTool({
  src,
  initial,
  onApply,
  onCancel,
}: {
  src: string;
  initial: { x: number; y: number; w: number; h: number } | undefined;
  onApply: (crop: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
}) {
  // Crop box is in normalized 0..1 coordinates.
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number }>(
    () =>
      initial && initial.w > 0 && initial.h > 0
        ? initial
        : { x: 0, y: 0, w: 1, h: 1 },
  );
  // Track the loaded image's natural aspect so the preview box matches.
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Track active drag (which handle, plus pointer offset).
  type DragMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const dragRef = useRef<{
    mode: DragMode;
    startCrop: { x: number; y: number; w: number; h: number };
    startClientX: number;
    startClientY: number;
    rect: DOMRect;
  } | null>(null);

  // Helper: clamp a number to [min, max].
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));

  // Pointer move handler — installed on window during drag.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startClientX) / d.rect.width;
      const dy = (e.clientY - d.startClientY) / d.rect.height;
      const s = d.startCrop;
      let nx = s.x;
      let ny = s.y;
      let nw = s.w;
      let nh = s.h;
      const MIN = 0.05; // never let crop shrink below 5% of source
      switch (d.mode) {
        case "move":
          nx = clamp(s.x + dx, 0, 1 - s.w);
          ny = clamp(s.y + dy, 0, 1 - s.h);
          break;
        case "e":
          nw = clamp(s.w + dx, MIN, 1 - s.x);
          break;
        case "w": {
          const newX = clamp(s.x + dx, 0, s.x + s.w - MIN);
          nw = s.w - (newX - s.x);
          nx = newX;
          break;
        }
        case "s":
          nh = clamp(s.h + dy, MIN, 1 - s.y);
          break;
        case "n": {
          const newY = clamp(s.y + dy, 0, s.y + s.h - MIN);
          nh = s.h - (newY - s.y);
          ny = newY;
          break;
        }
        case "ne":
          nw = clamp(s.w + dx, MIN, 1 - s.x);
          {
            const newY = clamp(s.y + dy, 0, s.y + s.h - MIN);
            nh = s.h - (newY - s.y);
            ny = newY;
          }
          break;
        case "nw": {
          const newX = clamp(s.x + dx, 0, s.x + s.w - MIN);
          nw = s.w - (newX - s.x);
          nx = newX;
          const newY = clamp(s.y + dy, 0, s.y + s.h - MIN);
          nh = s.h - (newY - s.y);
          ny = newY;
          break;
        }
        case "se":
          nw = clamp(s.w + dx, MIN, 1 - s.x);
          nh = clamp(s.h + dy, MIN, 1 - s.y);
          break;
        case "sw": {
          const newX = clamp(s.x + dx, 0, s.x + s.w - MIN);
          nw = s.w - (newX - s.x);
          nx = newX;
          nh = clamp(s.h + dy, MIN, 1 - s.y);
          break;
        }
      }
      setCrop({ x: nx, y: ny, w: nw, h: nh });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function startDrag(mode: DragMode, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!previewRef.current) return;
    dragRef.current = {
      mode,
      startCrop: crop,
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect: previewRef.current.getBoundingClientRect(),
    };
  }

  // Determine preview aspect: prefer the image's natural aspect when known.
  // Cap height ~280px and width ~280px so the panel stays compact.
  const PREVIEW_MAX = 280;
  const previewW = imgAspect && imgAspect > 1
    ? PREVIEW_MAX
    : imgAspect
      ? Math.round(PREVIEW_MAX * imgAspect)
      : PREVIEW_MAX;
  const previewH = imgAspect && imgAspect > 1
    ? Math.round(PREVIEW_MAX / imgAspect)
    : imgAspect
      ? PREVIEW_MAX
      : PREVIEW_MAX;

  return (
    <div className="mt-3 space-y-3 rounded-md border border-neutral-700 bg-neutral-950/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-gold-400">
        Crop image
      </div>
      <div className="flex justify-center">
        <div
          ref={previewRef}
          className="relative overflow-hidden rounded bg-neutral-800 select-none"
          style={{ width: previewW, height: previewH }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setImgAspect(img.naturalWidth / img.naturalHeight);
              }
            }}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
          {/* Dim overlay outside the crop window. Drawn as 4 dim rects. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: "transparent" }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                height: `${crop.y * 100}%`,
                background: "rgba(0,0,0,0.55)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: `${(crop.y + crop.h) * 100}%`,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.55)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: `${crop.y * 100}%`,
                width: `${crop.x * 100}%`,
                height: `${crop.h * 100}%`,
                background: "rgba(0,0,0,0.55)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${(crop.x + crop.w) * 100}%`,
                top: `${crop.y * 100}%`,
                right: 0,
                height: `${crop.h * 100}%`,
                background: "rgba(0,0,0,0.55)",
              }}
            />
          </div>
          {/* The crop window — draggable body + 8 handles. */}
          <div
            role="presentation"
            onPointerDown={(e) => startDrag("move", e)}
            style={{
              position: "absolute",
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.w * 100}%`,
              height: `${crop.h * 100}%`,
              boxSizing: "border-box",
              border: "1.5px solid #C9A84C",
              cursor: "move",
            }}
          >
            {/* 8 handles — corners + edges. */}
            <CropHandle pos="nw" onPointerDown={(e) => startDrag("nw", e)} />
            <CropHandle pos="n" onPointerDown={(e) => startDrag("n", e)} />
            <CropHandle pos="ne" onPointerDown={(e) => startDrag("ne", e)} />
            <CropHandle pos="e" onPointerDown={(e) => startDrag("e", e)} />
            <CropHandle pos="se" onPointerDown={(e) => startDrag("se", e)} />
            <CropHandle pos="s" onPointerDown={(e) => startDrag("s", e)} />
            <CropHandle pos="sw" onPointerDown={(e) => startDrag("sw", e)} />
            <CropHandle pos="w" onPointerDown={(e) => startDrag("w", e)} />
          </div>
        </div>
      </div>
      <div className="text-[10px] text-neutral-500 text-center font-mono">
        {`x:${crop.x.toFixed(2)} y:${crop.y.toFixed(2)} w:${crop.w.toFixed(2)} h:${crop.h.toFixed(2)}`}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-100 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(crop)}
          className="flex-1 px-3 py-1.5 rounded-md bg-gold-500 hover:bg-gold-400 text-neutral-900 text-[11px] font-semibold transition"
        >
          Apply crop
        </button>
      </div>
    </div>
  );
}

function CropHandle({
  pos,
  onPointerDown,
}: {
  pos: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Map position → CSS offsets + cursor.
  const styleMap: Record<typeof pos, React.CSSProperties> = {
    nw: { left: -5, top: -5, cursor: "nwse-resize" },
    n: { left: "50%", top: -5, marginLeft: -5, cursor: "ns-resize" },
    ne: { right: -5, top: -5, cursor: "nesw-resize" },
    e: { right: -5, top: "50%", marginTop: -5, cursor: "ew-resize" },
    se: { right: -5, bottom: -5, cursor: "nwse-resize" },
    s: { left: "50%", bottom: -5, marginLeft: -5, cursor: "ns-resize" },
    sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
    w: { left: -5, top: "50%", marginTop: -5, cursor: "ew-resize" },
  };
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        width: 10,
        height: 10,
        background: "#C9A84C",
        border: "1px solid #1a1a1a",
        borderRadius: 2,
        ...styleMap[pos],
      }}
    />
  );
}

// ─── B-5: Layer-panel list with drag-reorder ─────────────────────────

interface LayerPanelListProps {
  /** Layer list items; first entry = top of canvas (front). */
  items: Array<{ layer: Layer; depth: number }>;
  selectedIds: string[];
  totalLayerCount: number;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onForward: (id: string) => void;
  onBackward: (id: string) => void;
  /** Drop the dragged layer at the given index in the source `tree.layers`
   * array (NOT the reversed display order). */
  onReorder: (fromId: string, toIndex: number) => void;
}

function LayerPanelList({
  items,
  selectedIds,
  totalLayerCount,
  onSelect,
  onRename,
  onToggleHidden,
  onToggleLocked,
  onDelete,
  onDuplicate,
  onForward,
  onBackward,
  onReorder,
}: LayerPanelListProps) {
  // Drag state — which row is being dragged, and the row currently being
  // hovered as a drop target (with above/below positioning).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    above: boolean;
  } | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // The display order is reversed (top-of-canvas first). To convert a
  // dropped row index into a `tree.layers` index, we map back.
  // items[0] corresponds to tree.layers[N-1]; items[N-1] to tree.layers[0].
  const N = items.length;

  return (
    <div className="flex-1 overflow-y-auto px-1.5 pb-3">
      {items.length === 0 ? (
        <div className="text-xs text-neutral-500 italic px-2 py-3">No layers yet.</div>
      ) : (
        items.map((entry, displayIdx) => {
          const { layer } = entry;
          const isDragging = draggingId === layer.id;
          const isDropTarget = dropTarget?.id === layer.id;
          return (
            <LayerRow
              key={layer.id}
              layer={layer}
              selected={selectedSet.has(layer.id)}
              dragInProgress={!!draggingId}
              dropAbove={isDropTarget && dropTarget?.above === true}
              dropBelow={isDropTarget && dropTarget?.above === false}
              onSelect={(additive) => onSelect(layer.id, additive)}
              onRename={(name) => onRename(layer.id, name)}
              onToggleHidden={() => onToggleHidden(layer.id)}
              onToggleLocked={() => onToggleLocked(layer.id)}
              onDelete={() => onDelete(layer.id)}
              onDuplicate={() => onDuplicate(layer.id)}
              onForward={() => onForward(layer.id)}
              onBackward={() => onBackward(layer.id)}
              onDragStart={(e) => {
                setDraggingId(layer.id);
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = "move";
                  // Some browsers require setData to allow the drag at all.
                  try {
                    e.dataTransfer.setData("text/plain", layer.id);
                  } catch {
                    /* setData on DnD can throw in some sandboxes — safe to ignore. */
                  }
                }
              }}
              onDragOver={(e) => {
                if (!draggingId || draggingId === layer.id) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                const target = e.currentTarget as HTMLElement;
                const rect = target.getBoundingClientRect();
                const above = e.clientY - rect.top < rect.height / 2;
                if (
                  !dropTarget ||
                  dropTarget.id !== layer.id ||
                  dropTarget.above !== above
                ) {
                  setDropTarget({ id: layer.id, above });
                }
              }}
              onDragLeave={() => {
                if (dropTarget?.id === layer.id) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!draggingId || !dropTarget) {
                  setDraggingId(null);
                  setDropTarget(null);
                  return;
                }
                // Convert displayIdx + above/below to a tree.layers index.
                // items[displayIdx] === tree.layers[N - 1 - displayIdx].
                // "Above this row in display" = "after this row in tree".
                const rowSourceIdx = N - 1 - displayIdx;
                const insertIdx = dropTarget.above ? rowSourceIdx + 1 : rowSourceIdx;
                onReorder(draggingId, insertIdx);
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
            />
          );
        })
      )}
      {/* Reserve a footer hint that shows total layers when there are many. */}
      {totalLayerCount > 0 ? (
        <div className="px-2 pt-2 text-[10px] text-neutral-600">
          {totalLayerCount} top-level layer{totalLayerCount === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

// ─── B-5: Multi-select property panel ────────────────────────────────

interface MultiSelectPropertyPanelProps {
  layers: Layer[];
  /** Apply the same delta-based mutator to every selected layer (one history step). */
  onUpdateAll: (mutator: (l: Layer) => Layer) => void;
  onDelete: () => void;
  onGroup: () => void;
}

function MultiSelectPropertyPanel({
  layers,
  onUpdateAll,
  onDelete,
  onGroup,
}: MultiSelectPropertyPanelProps) {
  // The "primary" layer is the first one — its values seed the inputs.
  const primary = layers[0];
  if (!primary) return null;
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-neutral-400">
          {layers.length} layers selected
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-rose-300 hover:text-rose-200"
          title="Delete all selected"
        >
          Delete all
        </button>
      </div>

      <div className="rounded-md bg-neutral-800/60 border border-neutral-700 px-3 py-2 text-[11px] text-neutral-300">
        Editing the universal properties below applies the change as a delta to
        every selected layer.
      </div>

      <FieldGroup label="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X (primary)">
            <NumberInput
              value={primary.x}
              onChange={(v) => {
                const dx = v - primary.x;
                onUpdateAll((l) => ({ ...l, x: l.x + dx }));
              }}
            />
          </Field>
          <Field label="Y (primary)">
            <NumberInput
              value={primary.y}
              onChange={(v) => {
                const dy = v - primary.y;
                onUpdateAll((l) => ({ ...l, y: l.y + dy }));
              }}
            />
          </Field>
          <Field label="Width (primary)">
            <NumberInput
              value={primary.w}
              min={1}
              onChange={(v) => {
                const dw = v - primary.w;
                onUpdateAll((l) => ({ ...l, w: Math.max(1, l.w + dw) }));
              }}
            />
          </Field>
          <Field label="Height (primary)">
            <NumberInput
              value={primary.h}
              min={1}
              onChange={(v) => {
                const dh = v - primary.h;
                onUpdateAll((l) => ({ ...l, h: Math.max(1, l.h + dh) }));
              }}
            />
          </Field>
        </div>
        <Field label={`Rotation (${Math.round(primary.rotation ?? 0)}°)`}>
          <SliderWithNumber
            value={primary.rotation ?? 0}
            min={0}
            max={360}
            step={1}
            onChange={(v) => {
              const dr = v - (primary.rotation ?? 0);
              onUpdateAll((l) => ({
                ...l,
                rotation: ((l.rotation ?? 0) + dr) % 360,
              }));
            }}
          />
        </Field>
        <Field label={`Opacity (${Math.round((primary.opacity ?? 1) * 100)}%)`}>
          <SliderWithNumber
            value={Math.round((primary.opacity ?? 1) * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(v) => {
              const target = v / 100;
              const dOpacity = target - (primary.opacity ?? 1);
              onUpdateAll((l) => {
                const next = Math.max(0, Math.min(1, (l.opacity ?? 1) + dOpacity));
                return { ...l, opacity: next };
              });
            }}
          />
        </Field>
      </FieldGroup>

      <button
        type="button"
        onClick={onGroup}
        disabled={layers.length < 2}
        className="w-full px-3 py-2 rounded-md bg-gold-500/20 hover:bg-gold-500/30 text-gold-200 text-[11px] font-semibold transition disabled:opacity-30"
      >
        Group selected (Cmd+G)
      </button>
    </div>
  );
}

// ─── B-5: Canvas area (marquee, snap, multi-Moveable) ────────────────

interface CanvasAreaProps {
  tree: LayerTree;
  zoom: number;
  svgMarkup: string;
  selectedLayer: Layer | null;
  selectedLayers: Layer[];
  multiBounds: LayerBounds | null;
  hasMultiSelect: boolean;
  moveableTick: number;
  snapEnabled: boolean;
  snapLines: SnapLine[];
  setSnapLines: React.Dispatch<React.SetStateAction<SnapLine[]>>;
  dragModifierBypassRef: React.MutableRefObject<boolean>;
  cursorTemplatePosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  marquee: {
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    additive: boolean;
  } | null;
  setMarquee: React.Dispatch<
    React.SetStateAction<{
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      additive: boolean;
    } | null>
  >;
  canvasViewportRef: React.MutableRefObject<HTMLDivElement | null>;
  canvasInnerRef: React.MutableRefObject<HTMLDivElement | null>;
  moveableTargetRef: React.MutableRefObject<HTMLDivElement | null>;
  handleCanvasClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  updateSelectedLayers: (mutator: (l: Layer) => Layer) => void;
  setSelectedLayerIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectOnly: (id: string | null) => void;
  children?: React.ReactNode;
}

function CanvasArea(props: CanvasAreaProps) {
  const {
    tree,
    zoom,
    svgMarkup,
    selectedLayer,
    selectedLayers,
    multiBounds,
    hasMultiSelect,
    moveableTick,
    snapEnabled,
    snapLines,
    setSnapLines,
    dragModifierBypassRef,
    cursorTemplatePosRef,
    marquee,
    setMarquee,
    canvasViewportRef,
    canvasInnerRef,
    moveableTargetRef,
    handleCanvasClick,
    updateSelectedLayers,
    setSelectedLayerIds,
    selectOnly,
    children,
  } = props;

  /**
   * Convert a clientX/clientY pair into template-space coordinates,
   * accounting for the current canvas-inner element's bounding rect AND
   * the parent's `transform: scale(zoom)`. Returns null if the canvas
   * isn't mounted yet.
   */
  const clientToTemplate = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const inner = canvasInnerRef.current;
      if (!inner) return null;
      const rect = inner.getBoundingClientRect();
      // rect already reflects the CSS scale, so we just normalize.
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;
      return { x, y };
    },
    [canvasInnerRef, zoom],
  );

  /** Track cursor over the canvas for paste-at-cursor. */
  const handleViewportMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pos = clientToTemplate(e.clientX, e.clientY);
      if (pos) cursorTemplatePosRef.current = pos;
      // Update marquee in flight.
      if (marquee) {
        const tp = pos;
        if (tp) {
          setMarquee((prev) => (prev ? { ...prev, curX: tp.x, curY: tp.y } : prev));
        }
      }
    },
    [clientToTemplate, marquee, setMarquee, cursorTemplatePosRef],
  );

  /**
   * Marquee drag-select. Triggered when the user mousedowns on the canvas
   * BACKGROUND (not on any layer). We start a rectangle and on mouseup we
   * select all layers whose AABB intersects the rectangle.
   */
  const handleViewportMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only left-click; right-clicks and middles are reserved.
      if (e.button !== 0) return;
      // If the click landed on a layer's <g data-layer-id>, let the canvas
      // click handler deal with it.
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el !== canvasViewportRef.current) {
        if (el.getAttribute("data-layer-id")) return;
        // Don't start a marquee on ANY Moveable control element. Moveable v0.56
        // emits multiple class prefixes — `.moveable-control-box`, `.moveable-area`
        // (the central body-drag region), `.moveable-line`, `.moveable-control`,
        // `.moveable-direction`, etc. The earlier check only listed two of these,
        // so dragging the layer body started a marquee that pre-empted Moveable's
        // own drag → drag silently failed. Match any class whose name starts with
        // "moveable-" to cover the full set.
        const cn = typeof el.className === "string" ? el.className : "";
        if (cn.includes("moveable-")) return;
        el = el.parentElement;
      }
      const tp = clientToTemplate(e.clientX, e.clientY);
      if (!tp) return;
      // Start a marquee. If the click is OUTSIDE the canvas (in the gray
      // viewport), we still allow marquee — it just clamps to the canvas
      // bounds visually.
      setMarquee({
        startX: tp.x,
        startY: tp.y,
        curX: tp.x,
        curY: tp.y,
        additive: e.shiftKey,
      });
    },
    [canvasViewportRef, clientToTemplate, setMarquee],
  );

  /** Finalize marquee on mouseup anywhere. */
  useEffect(() => {
    if (!marquee) return;
    function onUp() {
      setMarquee((cur) => {
        if (!cur) return null;
        const x1 = Math.min(cur.startX, cur.curX);
        const y1 = Math.min(cur.startY, cur.curY);
        const x2 = Math.max(cur.startX, cur.curX);
        const y2 = Math.max(cur.startY, cur.curY);
        // Treat tiny marquees (< 3px in either axis) as deselect-clicks.
        const tinyMarquee = x2 - x1 < 3 && y2 - y1 < 3;
        if (tinyMarquee) {
          if (!cur.additive) selectOnly(null);
          return null;
        }
        const hits: string[] = [];
        for (const l of tree.layers) {
          if (l.hidden) continue;
          const lx2 = l.x + l.w;
          const ly2 = l.y + l.h;
          if (l.x < x2 && lx2 > x1 && l.y < y2 && ly2 > y1) {
            hits.push(l.id);
          }
        }
        if (cur.additive) {
          setSelectedLayerIds((prev) => {
            const set = new Set(prev);
            for (const id of hits) set.add(id);
            return Array.from(set);
          });
        } else {
          setSelectedLayerIds(hits);
        }
        return null;
      });
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [marquee, tree.layers, selectOnly, setSelectedLayerIds, setMarquee]);

  // Marquee rectangle in template-space → render style.
  const marqueeRect = useMemo(() => {
    if (!marquee) return null;
    const x = Math.min(marquee.startX, marquee.curX);
    const y = Math.min(marquee.startY, marquee.curY);
    const w = Math.abs(marquee.curX - marquee.startX);
    const h = Math.abs(marquee.curY - marquee.startY);
    if (w < 1 && h < 1) return null;
    return { x, y, w, h };
  }, [marquee]);

  // Snap candidate cache — exclude the currently-dragging layer(s).
  const snapCandidatesForSelection = useMemo(() => {
    const exclude = new Set(selectedLayers.map((l) => l.id));
    return computeSnapCandidates(tree, exclude);
  }, [tree, selectedLayers]);

  // Reset bypass flag when the selection changes (covers edge cases where
  // a drag ends on a different element than it started).
  useEffect(() => {
    dragModifierBypassRef.current = false;
  }, [selectedLayers, dragModifierBypassRef]);

  // Build a stable Moveable target prop. For multi-select, we use the
  // virtual-bbox div the same way the single-select path does.
  const showSingleMoveable =
    !!selectedLayer &&
    !selectedLayer.locked &&
    !selectedLayer.hidden &&
    !hasMultiSelect;
  const showMultiMoveable = hasMultiSelect && multiBounds !== null;

  return (
    <div
      ref={canvasViewportRef}
      className="flex-1 overflow-hidden relative"
      onMouseDown={handleViewportMouseDown}
      onMouseMove={handleViewportMouseMove}
    >
      <CheckerBackground />
      <div
        className="absolute top-1/2 left-1/2 origin-center"
        style={{
          transform: `translate(-50%, -50%) scale(${zoom})`,
          width: tree.width,
          height: tree.height,
        }}
      >
        <div
          ref={canvasInnerRef}
          className="relative bg-white shadow-2xl"
          style={{ width: tree.width, height: tree.height }}
          onClick={handleCanvasClick}
          // The SVG is rendered inline. We use dangerouslySetInnerHTML
          // since the renderer returns a self-contained <svg> string.
          dangerouslySetInnerHTML={{ __html: enhanceSvgWithLayerIds(svgMarkup, tree) }}
        />

        {/* ── Snap lines (gold, drawn during drag) ───────────── */}
        {snapLines.length > 0 ? (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ width: tree.width, height: tree.height }}
          >
            {snapLines.map((ln, i) =>
              ln.axis === "x" ? (
                <div
                  key={`sl-${i}`}
                  style={{
                    position: "absolute",
                    left: ln.pos - 0.5,
                    top: 0,
                    width: 1,
                    height: tree.height,
                    background: "#C9A84C",
                  }}
                />
              ) : (
                <div
                  key={`sl-${i}`}
                  style={{
                    position: "absolute",
                    top: ln.pos - 0.5,
                    left: 0,
                    height: 1,
                    width: tree.width,
                    background: "#C9A84C",
                  }}
                />
              ),
            )}
          </div>
        ) : null}

        {/* ── Marquee rectangle (gold, dashed) ───────────────── */}
        {marqueeRect ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: marqueeRect.x,
              top: marqueeRect.y,
              width: marqueeRect.w,
              height: marqueeRect.h,
              border: "1px dashed #C9A84C",
              background: "rgba(201, 168, 76, 0.10)",
              pointerEvents: "none",
            }}
          />
        ) : null}

        {/* ── Multi-select bounding box (visual only — Moveable
              draws its own controls below) ──────────────────── */}
        {showMultiMoveable && multiBounds ? (
          <>
            <div
              ref={moveableTargetRef}
              style={{
                position: "absolute",
                left: multiBounds.x,
                top: multiBounds.y,
                width: multiBounds.w,
                height: multiBounds.h,
                pointerEvents: "none",
                outline: "1px dashed #C9A84C",
                outlineOffset: -1,
              }}
              aria-hidden="true"
            />
            <Moveable
              // KEY excludes moveableTick — including it caused mid-drag remounts.
              // Selection-set change (different ids) is the right invalidation trigger.
              key={`mv-multi-${selectedLayers.map((l) => l.id).join(",")}`}
              target={moveableTargetRef.current}
              // Same dragArea fix as the single-select Moveable — without it,
              // multi-select drag had no body-drag overlay (target was a virtual
              // bbox div with pointer-events: none). See note in single-select.
              dragArea
              draggable
              resizable={false}
              rotatable={false}
              throttleDrag={0}
              origin={false}
              edge={false}
              zoom={1}
              onDragStart={(e) => {
                dragModifierBypassRef.current =
                  !!e.inputEvent && (e.inputEvent.metaKey || e.inputEvent.ctrlKey);
              }}
              onDrag={({ beforeDelta }) => {
                let dx = beforeDelta[0] / zoom;
                let dy = beforeDelta[1] / zoom;
                if (snapEnabled && !dragModifierBypassRef.current && multiBounds) {
                  // Snap the union bbox.
                  const proposed: LayerBounds = {
                    x: multiBounds.x + dx,
                    y: multiBounds.y + dy,
                    w: multiBounds.w,
                    h: multiBounds.h,
                  };
                  const snap = applySnap(
                    proposed,
                    snapCandidatesForSelection,
                    SNAP_THRESHOLD_PX,
                  );
                  dx = snap.x - multiBounds.x;
                  dy = snap.y - multiBounds.y;
                  setSnapLines(snap.lines);
                } else {
                  setSnapLines([]);
                }
                const dxi = Math.round(dx);
                const dyi = Math.round(dy);
                if (dxi === 0 && dyi === 0) return;
                updateSelectedLayers((l) => ({
                  ...l,
                  x: l.x + dxi,
                  y: l.y + dyi,
                }));
              }}
              onDragEnd={() => {
                setSnapLines([]);
                dragModifierBypassRef.current = false;
              }}
            />
          </>
        ) : null}

        {/* ── Single-select Moveable target overlay ──────────── */}
        {showSingleMoveable && selectedLayer ? (
          <>
            <div
              ref={moveableTargetRef}
              style={{
                position: "absolute",
                left: selectedLayer.x,
                top: selectedLayer.y,
                width: selectedLayer.w,
                height: selectedLayer.h,
                transform: selectedLayer.rotation
                  ? `rotate(${selectedLayer.rotation}deg)`
                  : undefined,
                transformOrigin: "center center",
                pointerEvents: "none",
              }}
              aria-hidden="true"
            />
            <Moveable
              // KEY MUST NOT include any drag-changing state (x/y/w/h/rotation).
              // If the key changes mid-drag, Moveable unmounts + remounts and
              // loses pointer capture — drag/resize silently fail. The id alone
              // is the right invalidation trigger (only changes on selection swap).
              key={`mv-${selectedLayer.id}`}
              target={moveableTargetRef.current}
              draggable
              resizable
              rotatable
              // dragArea injects a transparent .moveable-area overlay over the
              // target so body-drag works even when the target itself has
              // pointer-events: none (which ours does, so SVG clicks beneath
              // can still bubble to handleCanvasClick for layer-select). Without
              // this, only corner-handle resize fired; the layer body was dead.
              // See https://github.com/daybrush/moveable/wiki/dragArea
              dragArea
              keepRatio={false}
              throttleDrag={0}
              throttleResize={0}
              throttleRotate={0}
              origin={false}
              edge={false}
              zoom={1}
              onDragStart={(e) => {
                dragModifierBypassRef.current =
                  !!e.inputEvent && (e.inputEvent.metaKey || e.inputEvent.ctrlKey);
              }}
              onDrag={({ beforeDelta }) => {
                if (!selectedLayer) return;
                let dx = beforeDelta[0] / zoom;
                let dy = beforeDelta[1] / zoom;
                if (snapEnabled && !dragModifierBypassRef.current) {
                  const proposed: LayerBounds = {
                    x: selectedLayer.x + dx,
                    y: selectedLayer.y + dy,
                    w: selectedLayer.w,
                    h: selectedLayer.h,
                  };
                  const snap = applySnap(
                    proposed,
                    snapCandidatesForSelection,
                    SNAP_THRESHOLD_PX,
                  );
                  dx = snap.x - selectedLayer.x;
                  dy = snap.y - selectedLayer.y;
                  setSnapLines(snap.lines);
                } else {
                  setSnapLines([]);
                }
                const dxi = Math.round(dx);
                const dyi = Math.round(dy);
                if (dxi === 0 && dyi === 0) return;
                updateSelectedLayers((l) => ({
                  ...l,
                  x: l.x + dxi,
                  y: l.y + dyi,
                }));
              }}
              onDragEnd={() => {
                setSnapLines([]);
                dragModifierBypassRef.current = false;
              }}
              onResize={({ width, height, drag }) => {
                if (!selectedLayer) return;
                let newW = Math.max(8, Math.round(width / zoom));
                let newH = Math.max(8, Math.round(height / zoom));
                let dx = drag.beforeTranslate[0] / zoom;
                let dy = drag.beforeTranslate[1] / zoom;
                if (snapEnabled && !dragModifierBypassRef.current) {
                  const proposed: LayerBounds = {
                    x: selectedLayer.x + dx,
                    y: selectedLayer.y + dy,
                    w: newW,
                    h: newH,
                  };
                  const snap = applySnap(
                    proposed,
                    snapCandidatesForSelection,
                    SNAP_THRESHOLD_PX,
                  );
                  // For resize we only snap position; resizing edges to
                  // candidate edges would require knowing which handle is
                  // being dragged (Moveable doesn't expose that cleanly).
                  // Snapping (x, y) covers the common case: dragging the
                  // top-left handle.
                  dx = snap.x - selectedLayer.x;
                  dy = snap.y - selectedLayer.y;
                  setSnapLines(snap.lines);
                } else {
                  setSnapLines([]);
                }
                updateSelectedLayers((l) => ({
                  ...l,
                  x: Math.round(l.x + dx),
                  y: Math.round(l.y + dy),
                  w: newW,
                  h: newH,
                }));
              }}
              onResizeEnd={() => {
                setSnapLines([]);
                dragModifierBypassRef.current = false;
              }}
              onRotate={({ beforeRotate }) => {
                updateSelectedLayers((l) => ({
                  ...l,
                  rotation: Math.round(((l.rotation ?? 0) + beforeRotate) % 360),
                }));
              }}
            />
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function defaultLayerName(layer: Layer): string {
  switch (layer.type) {
    case "text": {
      const t = (layer as TextLayer).text.trim().slice(0, 24);
      return t || "Text";
    }
    case "image":
      return "Image";
    case "rect":
      return "Rectangle";
    case "gradient":
      return "Gradient";
    case "line":
      return "Line";
    case "group":
      return "Group";
  }
}

function layerTypeIcon(type: Layer["type"]): string {
  switch (type) {
    case "text":
      return "T";
    case "image":
      return "◧";
    case "rect":
      return "▭";
    case "gradient":
      return "◐";
    case "line":
      return "/";
    case "group":
      return "▦";
  }
}

function layerTypeLabel(type: Layer["type"]): string {
  switch (type) {
    case "text":
      return "Text layer";
    case "image":
      return "Image layer";
    case "rect":
      return "Rectangle layer";
    case "gradient":
      return "Gradient layer";
    case "line":
      return "Line layer";
    case "group":
      return "Group layer";
  }
}

/**
 * Decorate the rendered SVG with `data-layer-id` attributes on each
 * top-level <g> wrapper so click selection works. The renderer wraps each
 * layer in a <g>; we tag those wrappers in render-order matching the tree's
 * top-level layers. Children of groups stay un-tagged in v1 — group selection
 * picks the group, not the child, which matches our top-level-only layer list.
 */
function enhanceSvgWithLayerIds(svg: string, tree: LayerTree): string {
  // The renderer's output begins with `<svg ...>...<defs>...</defs>
  //   <rect ... background />
  //   <g ...>` per top-level layer.
  // We use a state machine over the string to inject data-layer-id="…" on
  // the FIRST <g> after the background rect, and on every subsequent
  // top-level <g>. We must NOT touch nested <g> tags inside group layers —
  // we handle that by counting top-level groups (depth 0) only.
  //
  // A simpler approach: do a regex match for top-level `<g` that lives
  // outside any other unclosed `<g>`. Since groups in the renderer wrap
  // children with their own <g> inside, we can pre-extract the section
  // after the background rect and inject ids by scanning manually.

  // Find the position of the background rect's closing `/>`.
  const bgClose = svg.indexOf("/>", svg.indexOf("<rect"));
  if (bgClose < 0) return svg;
  const head = svg.slice(0, bgClose + 2);
  let body = svg.slice(bgClose + 2);

  // Scan body and tag top-level <g> openings. Track depth via <g … and </g>.
  // A "<g " or "<g>" at depth 0 starts a top-level layer wrapper.
  const layers = tree.layers;
  let layerIdx = 0;
  let depth = 0;
  let i = 0;
  let out = "";
  while (i < body.length) {
    // Look for the next <g or </g token.
    const nextOpen = body.indexOf("<g", i);
    const nextClose = body.indexOf("</g>", i);
    const next = (() => {
      if (nextOpen === -1 && nextClose === -1) return -1;
      if (nextOpen === -1) return nextClose;
      if (nextClose === -1) return nextOpen;
      return Math.min(nextOpen, nextClose);
    })();
    if (next === -1) {
      out += body.slice(i);
      break;
    }
    out += body.slice(i, next);
    if (next === nextClose) {
      out += "</g>";
      depth = Math.max(0, depth - 1);
      i = next + "</g>".length;
      continue;
    }
    // It's an opening "<g" — make sure it's a tag, not "<gradient" etc.
    const charAfter = body.charAt(next + 2);
    if (charAfter !== " " && charAfter !== ">" && charAfter !== "\n") {
      // Not a <g> tag — copy two chars and continue.
      out += body.slice(next, next + 2);
      i = next + 2;
      continue;
    }
    // Find the end of this <g …> opening tag.
    const tagEnd = body.indexOf(">", next);
    if (tagEnd === -1) {
      out += body.slice(next);
      break;
    }
    let opening = body.slice(next, tagEnd + 1);
    // Inject data-layer-id when this is a top-level <g> (depth==0 before
    // entering it) and we still have layers to tag.
    if (depth === 0 && layerIdx < layers.length) {
      // Skip hidden layers — the renderer omits them so they have no <g>.
      // Walk forward through hidden layers.
      while (layerIdx < layers.length && layers[layerIdx].hidden) {
        layerIdx += 1;
      }
      if (layerIdx < layers.length) {
        const id = layers[layerIdx].id;
        // Insert before the trailing `>` (or `/>` for self-closing). All
        // emitter output uses `<g …>…</g>` (never self-closing) so just use
        // `>`.
        opening = opening.replace(/>$/, ` data-layer-id="${escapeAttrJs(id)}" style="cursor:pointer">`);
        layerIdx += 1;
      }
    }
    out += opening;
    depth += 1;
    i = tagEnd + 1;
  }
  return head + out;
}

function escapeAttrJs(s: string): string {
  return s.replace(/"/g, "&quot;");
}

/** 1x1 transparent PNG used as the fallback Image source. */
const PLACEHOLDER_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// ─── Checker background (canvas viewport) ────────────────────────────

function CheckerBackground() {
  // Light/dark checker pattern via inline SVG data URI — independent of any
  // global stylesheet. Pure CSS would also work, but the data URI keeps the
  // styling self-contained and consistent with other SVG-driven rendering.
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><rect width='20' height='20' fill='%23262626'/><rect width='10' height='10' fill='%23303030'/><rect x='10' y='10' width='10' height='10' fill='%23303030'/></svg>\")",
      }}
    />
  );
}
