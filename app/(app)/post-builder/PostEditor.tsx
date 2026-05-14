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
  onClose,
  onSave,
}: PostEditorProps) {
  // ── Tree state + history ───────────────────────────────────────────
  const [tree, setTree] = useState<LayerTree>(initialTree);
  const [history, setHistory] = useState<LayerTree[]>([initialTree]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [dirty, setDirty] = useState<boolean>(false);

  // ── Selection ──────────────────────────────────────────────────────
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // ── Canvas / viewport ──────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const moveableTargetRef = useRef<HTMLDivElement | null>(null);
  const [moveableTick, setMoveableTick] = useState<number>(0);

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

  // ── Selected layer + safe accessor ─────────────────────────────────
  const selectedLayer: Layer | null = useMemo(() => {
    if (!selectedLayerId) return null;
    return findLayer(tree, selectedLayerId);
  }, [tree, selectedLayerId]);

  // Re-position Moveable when the selected layer's box changes (drag/edit).
  useEffect(() => {
    setMoveableTick((t) => t + 1);
  }, [selectedLayer?.x, selectedLayer?.y, selectedLayer?.w, selectedLayer?.h, selectedLayer?.rotation, zoom]);

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

  const updateSelectedLayer = useCallback(
    (mutator: (l: Layer) => Layer) => {
      if (!selectedLayerId) return;
      updateLayer(selectedLayerId, mutator);
    },
    [selectedLayerId, updateLayer],
  );

  const deleteLayer = useCallback(
    (id: string) => {
      pushHistory(removeLayer(tree, id));
      if (selectedLayerId === id) setSelectedLayerId(null);
    },
    [tree, pushHistory, selectedLayerId],
  );

  const duplicateLayer = useCallback(
    (id: string) => {
      const orig = findLayer(tree, id);
      if (!orig) return;
      // Deep clone; offset a bit so it doesn't perfectly overlap.
      const cloned: Layer = {
        ...orig,
        id: newLayerId(orig.type),
        x: orig.x + 24,
        y: orig.y + 24,
        name: orig.name ? `${orig.name} copy` : undefined,
      } as Layer;
      // Copy is shallow on top-level, but groups need their children re-id'd
      // so future edits don't double-mutate. For v1 we just shallow-clone the
      // top layer — group duplication keeps original child ids (acceptable
      // tradeoff; users rarely duplicate groups in v1).
      pushHistory({ ...tree, layers: [...tree.layers, cloned] });
      setSelectedLayerId(cloned.id);
    },
    [tree, pushHistory],
  );

  /**
   * Move a top-level layer up (toward the front of the canvas) or down
   * (toward the back). Layers nested in groups are not reorderable in v1
   * — that requires path-aware indexing. ADHD-friendly: ignore the action
   * silently rather than half-do it.
   */
  const reorderLayer = useCallback(
    (id: string, direction: "forward" | "backward" | "front" | "back") => {
      const idx = tree.layers.findIndex((l) => l.id === id);
      if (idx === -1) return; // nested in a group — ignore
      const next = [...tree.layers];
      const [layer] = next.splice(idx, 1);
      let target: number;
      switch (direction) {
        case "forward":
          target = Math.min(next.length, idx + 1);
          break;
        case "backward":
          target = Math.max(0, idx - 1);
          break;
        case "front":
          target = next.length;
          break;
        case "back":
          target = 0;
          break;
      }
      next.splice(target, 0, layer);
      pushHistory({ ...tree, layers: next });
    },
    [tree, pushHistory],
  );

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
      setSelectedLayerId(layer.id);
    },
    [tree, availablePhotos, pushHistory],
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLayerId) {
        e.preventDefault();
        deleteLayer(selectedLayerId);
        return;
      }
      if (e.key === "Escape") {
        if (selectedLayerId) {
          setSelectedLayerId(null);
        } else {
          handleClose();
        }
        return;
      }
      if (selectedLayerId) {
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          updateSelectedLayer((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteLayer, selectedLayerId, updateSelectedLayer, handleClose]);

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

  // ── Click on canvas to select / deselect ───────────────────────────
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Look up the closest element with data-layer-id; if none, deselect.
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el !== canvasInnerRef.current) {
        const id = el.getAttribute("data-layer-id");
        if (id) {
          setSelectedLayerId(id);
          return;
        }
        el = el.parentElement;
      }
      setSelectedLayerId(null);
    },
    [],
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

      {/* ── MAIN SPLIT ─────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ── LAYER PANEL (left) ────────────────────────────── */}
        <aside className="w-[220px] flex-shrink-0 bg-neutral-900 text-white border-r border-neutral-800 flex flex-col">
          <div className="px-3 pt-3 pb-2 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-widest text-neutral-400">Layers</div>
            <div className="text-[10px] text-neutral-500">{totalLayerCount}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            {layerListItems.length === 0 ? (
              <div className="text-xs text-neutral-500 italic px-2 py-3">No layers yet.</div>
            ) : (
              layerListItems.map(({ layer }) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  selected={layer.id === selectedLayerId}
                  onSelect={() => setSelectedLayerId(layer.id)}
                  onRename={(name) => updateLayer(layer.id, (l) => ({ ...l, name }))}
                  onToggleHidden={() =>
                    updateLayer(layer.id, (l) => ({ ...l, hidden: !l.hidden }))
                  }
                  onToggleLocked={() =>
                    updateLayer(layer.id, (l) => ({ ...l, locked: !l.locked }))
                  }
                  onDelete={() => deleteLayer(layer.id)}
                  onDuplicate={() => duplicateLayer(layer.id)}
                  onForward={() => reorderLayer(layer.id, "forward")}
                  onBackward={() => reorderLayer(layer.id, "backward")}
                />
              ))
            )}
          </div>
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
          <div
            ref={canvasViewportRef}
            className="flex-1 overflow-hidden relative"
            onMouseDown={(e) => {
              // Click on the gray viewport (not the canvas itself) deselects.
              if (e.target === canvasViewportRef.current) {
                setSelectedLayerId(null);
              }
            }}
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
                // On every tree change React re-creates the inner HTML — for
                // the asset volumes here (a few hundred layers max) this is
                // imperceptibly fast.
                dangerouslySetInnerHTML={{ __html: enhanceSvgWithLayerIds(svgMarkup, tree) }}
              />
              {/* Moveable target overlay — invisible div positioned over the
                  selected layer in template-space. */}
              {selectedLayer && !selectedLayer.locked && !selectedLayer.hidden ? (
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
                    key={`mv-${selectedLayer.id}-${moveableTick}`}
                    target={moveableTargetRef.current}
                    draggable
                    resizable
                    rotatable
                    keepRatio={false}
                    throttleDrag={0}
                    throttleResize={0}
                    throttleRotate={0}
                    origin={false}
                    edge={false}
                    zoom={1}
                    onDrag={({ beforeDelta }) => {
                      // beforeDelta is in screen pixels; divide by zoom to
                      // get template-space delta.
                      const dx = beforeDelta[0] / zoom;
                      const dy = beforeDelta[1] / zoom;
                      updateSelectedLayer((l) => ({
                        ...l,
                        x: Math.round(l.x + dx),
                        y: Math.round(l.y + dy),
                      }));
                    }}
                    onResize={({ width, height, drag }) => {
                      const newW = Math.max(8, Math.round(width / zoom));
                      const newH = Math.max(8, Math.round(height / zoom));
                      const dx = drag.beforeTranslate[0] / zoom;
                      const dy = drag.beforeTranslate[1] / zoom;
                      updateSelectedLayer((l) => ({
                        ...l,
                        x: Math.round(l.x + dx),
                        y: Math.round(l.y + dy),
                        w: newW,
                        h: newH,
                      }));
                    }}
                    onRotate={({ beforeRotate }) => {
                      // beforeRotate is the absolute rotation as Moveable
                      // tracks its own delta from the original. Since we
                      // re-mount Moveable each frame via key+tick, we use it
                      // additively against the layer's current rotation —
                      // but to avoid double-application, we instead set the
                      // layer rotation to `current + beforeRotate` only on
                      // rotateEnd. For continuous feedback, rely on the
                      // rotation state Moveable shows on its own handle.
                      updateSelectedLayer((l) => ({
                        ...l,
                        rotation: Math.round(((l.rotation ?? 0) + beforeRotate) % 360),
                      }));
                    }}
                  />
                </>
              ) : null}
            </div>
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
          </div>
        </section>

        {/* ── PROPERTY PANEL (right) ───────────────────────── */}
        <aside className="w-[320px] flex-shrink-0 bg-neutral-900 text-white border-l border-neutral-800 overflow-y-auto">
          {selectedLayer ? (
            <PropertyPanel
              layer={selectedLayer}
              tree={tree}
              availablePhotos={availablePhotos}
              onChange={(next) => updateLayer(selectedLayer.id, () => next)}
              onDelete={() => deleteLayer(selectedLayer.id)}
            />
          ) : (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              Select a layer to edit its properties.
              <div className="mt-2 text-[11px] text-neutral-500">
                Click a layer in the canvas or the layers list.
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
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onForward: () => void;
  onBackward: () => void;
}

function LayerRow(props: LayerRowProps) {
  const { layer, selected } = props;
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
      onClick={props.onSelect}
      className={[
        "flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition border",
        selected
          ? "bg-gold-500/10 border-gold-500/60 ring-1 ring-gold-500/40"
          : "border-transparent hover:bg-neutral-800",
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
}

function PropertyPanel({ layer, availablePhotos, onChange, onDelete }: PropertyPanelProps) {
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
            Group layers contain {(layer as GroupLayer).children.length} child layers. To
            edit children, ungroup or use a future B-5 build.
          </p>
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
        <select
          value={layer.font ?? FONT_FAMILIES[0].family}
          onChange={(e) => update({ font: e.target.value })}
          className="input-dark"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.id} value={f.family} style={{ fontFamily: f.family }}>
              {f.label} · {f.category}
            </option>
          ))}
        </select>
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
