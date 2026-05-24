"use client";

/**
 * CanvasEditor — Phase 1 foundation (Step 1 of the Canva-clone rebuild)
 * ----------------------------------------------------------------------
 *
 * Renders a single Fabric.js v6 canvas inside a Tailwind-styled overlay shell.
 * Consumes a CanvasTemplateSchema + MLSListingPayload, hydrates bound fields
 * into Fabric objects, lets the user select / move / resize / reorder / lock /
 * delete those objects, and exports the final canvas as a PNG File via onSave.
 *
 * Scope discipline (read this before extending):
 *   • Phase 1 = foundation. Add NEW layers? Not yet. Brand panel? Not yet.
 *     Color picker? Not yet. This file handles existing layers from a template
 *     and the basic selection + layer-panel + export loop. Phases 2–5 plug in
 *     additional panels (Brand / Templates / Uploads / Photos / Elements)
 *     around the existing shell — don't bake them into this file.
 *   • V1 (the Path-A headless-Chromium pipeline) is LOCKED. Nothing in this
 *     file imports from `lib/post-builder/render.ts` or `chromium.ts`, and
 *     nothing in V1 imports from here. The two systems coexist until V2.
 *
 * Fabric.js v6 API notes for future maintainers:
 *   • Use `FabricImage` (not `Image`) — v6 renamed it to avoid colliding with
 *     the DOM `Image` global.
 *   • `FabricImage.fromURL(url, options)` is now a Promise (v5 was callback).
 *   • `canvas.dispose()` is async in v6, returning Promise<boolean>. We
 *     fire-and-forget in the React cleanup (React's cleanup is sync). Safe
 *     because no further code touches the canvas after cleanup.
 *   • Fabric uses `angle` in degrees, `left`/`top` for position, `charSpacing`
 *     in 1/1000 em units. The schema mirrors these names exactly so we can
 *     spread schema layer fields straight into Fabric constructors.
 */

import {
  ActiveSelection,
  Canvas,
  FabricImage,
  type FabricObject,
  Rect,
  Textbox,
} from "fabric";
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type CanvasEditorProps,
  type CanvasExportResult,
  type CanvasLayer,
  type CanvasTemplateSchema,
  type CarouselSlide,
  EXPORT_RESOLUTION_MULTIPLIER,
  type ImageLayer,
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  type MLSListingPayload,
  PLATFORM_DIMENSIONS,
  type PostFormat,
  type TextLayer,
} from "./types";
// Phase 2D (2026-05-22): factories + resolvers extracted to fabric-factory.ts
// so the headless render pipeline shares visual output with the editor by
// construction (instead of by manually-mirrored duplicates).
import {
  createFabricImage,
  createFabricShape,
  createFabricTextbox,
  getLayerData,
  resolveImageBoundField,
  resolveTextBoundField,
  setLayerData,
} from "./fabric-factory";
import {
  clearAutosave,
  formatAutosaveAge,
  readAutosave,
  writeAutosave,
  type AutosavePayload,
} from "./autosave";

// === Phase 2 panel integrations ===
// why: imported here at the orchestrator so the integration surface is
// reviewable in one place. Each agent's component is consumed by name; the
// contracts.ts file is the shared interface they were all written against.
import type {
  BrandAsset,
  BrandSyncOutcome,
  BrandSyncStatus,
  ListingPhoto,
  OfficeOption,
  SelectionMode,
} from "./contracts";
import {
  getBrandSyncStatusAction,
  syncBrandAssetsAction,
} from "@/app/(app)/post-builder/actions";
import {
  handlePhase2KeyDown,
  handleToolsKeyDown,
} from "./history/keyboard-shortcuts";
import { useUndoRedoHistory } from "./history/useUndoRedoHistory";
import AddLayerToolbar, {
  spawnCircle as spawnCircleObj,
  spawnLine as spawnLineObj,
  spawnRect as spawnRectObj,
  spawnText as spawnTextObj,
} from "./panels/AddLayerToolbar";
import AgentPanel from "./panels/AgentPanel";
import BrandPanel from "./panels/BrandPanel";
import ContextualTopToolbar from "./panels/ContextualTopToolbar";
import LayerListPanel from "./panels/LayerListPanel";
import PhotosPanel from "./panels/PhotosPanel";
import ToolsPanel, { type ToolMode } from "./panels/ToolsPanel";
import SelectionPropertiesPanel from "./panels/SelectionPropertiesPanel";
import CarouselPreview from "./panels/CarouselPreview";
import CarouselSlidePicker from "./panels/CarouselSlidePicker";
import CarouselStrip from "./panels/CarouselStrip";
import ResizeMenu, {
  type ResizeMenuOption,
} from "./panels/ResizeMenu";
import TemplatesPanel from "./panels/TemplatesPanel";
import { CANVAS_TEMPLATES, findCanvasTemplate } from "./templates";
import SaveAsTemplateModal, {
  type CanvasStateSnapshot,
} from "./SaveAsTemplateModal";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";

// why: fonts.css contains Google Fonts @import statements for the 9 fonts
// that aren't already loaded at the app level. Importing the CSS here (not
// in app/globals.css) scopes the network cost to ONLY when the editor
// actually mounts — no font fetch on the dashboard, listings page, etc.
// Next.js's CSS chunking handles the per-route loading automatically.
import "./fonts.css";


// ===========================================================================
// SECTION 3 — CanvasEditor component
// ===========================================================================

interface SelectionState {
  layerId: string | null;
  /** When true, the selection covers multiple objects (Phase 2+ — not selectable in Phase 1 by default). */
  isMulti: boolean;
  /** Number of currently-selected objects on the canvas. Drives the
   *  Distribute buttons' enabled state in the footer (requires ≥3). */
  count: number;
}

interface LayerEntry {
  id: string;
  name: string;
  kind: CanvasLayer["kind"];
  visible: boolean;
  locked: boolean;
}

interface EditorError {
  kind: "image_load" | "export" | "init";
  message: string;
}

export default function CanvasEditor(props: CanvasEditorProps): JSX.Element {
  // why: keep the raw prop as `initialTemplate` and introduce a stateful
  // `currentTemplate` underneath. This lets the in-editor Templates panel
  // (Phase 4) swap the active template without the parent caring — the
  // canvas re-initializes from the new schema while listing context is
  // preserved. The `template` alias below means every existing reference
  // in this file (template.width / template.layers / etc.) keeps working
  // unchanged. Canva-mindset note: template swap is a destructive op (it
  // discards the user's layer edits), so the handler below gates on the
  // undo-history `canUndo` flag and prompts before swapping.
  const {
    template: initialTemplate,
    listing,
    onSave,
    onClose,
    saveLabel,
    isSaving,
    onTemplateSwitched,
    onResize,
    carousel,
    onMakeReel,
    onSaveAsTemplate,
    customTemplate,
  } = props;
  const [currentTemplate, setCurrentTemplate] =
    useState<CanvasTemplateSchema>(initialTemplate);
  // why: if the parent passes a new template prop (e.g., overlay closed and
  // reopened with a different starting template), sync the internal state.
  // Comparing by id avoids re-syncing on identical refs that happen to be
  // new objects across renders.
  useEffect(() => {
    setCurrentTemplate(initialTemplate);
  }, [initialTemplate]);
  // why: keep the legacy `template` name in scope so every reference below
  // (init useEffect, export handler, dimension warning, etc.) continues to
  // work without a rename sweep. Identical reference to `currentTemplate`.
  const template = currentTemplate;

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  // why: separate refs for the DOM <canvas> element and the Fabric Canvas
  // instance. The DOM ref is set by React on mount; the Fabric ref is set
  // inside useEffect once Fabric initializes. Splitting them avoids
  // initialization-order races.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  // why: track export-in-progress separately from React state so the export
  // handler can early-return without a stale-closure issue.
  const isExportingRef = useRef<boolean>(false);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [selection, setSelection] = useState<SelectionState>({
    layerId: null,
    isMulti: false,
    count: 0,
  });
  // why: a version counter that increments whenever Fabric's object list
  // mutates. The layer panel reads from Fabric's getObjects() inside a
  // useMemo keyed off this counter, so the panel re-renders on layer
  // add/remove/visibility-toggle without us managing a parallel state mirror.
  const [layerVersion, setLayerVersion] = useState<number>(0);
  const [editorError, setEditorError] = useState<EditorError | null>(null);
  const [isLocalSaving, setIsLocalSaving] = useState<boolean>(false);
  // why: drives the "Save as Template" modal. Closed by default; opens
  // when the user clicks the header button (rendered only when the parent
  // wired `onSaveAsTemplate`). State lives here (not at the parent) because
  // the modal needs synchronous access to the canvas ref to read
  // toJSON/toDataURL at submit-time.
  const [saveAsTemplateModalOpen, setSaveAsTemplateModalOpen] =
    useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Phase 2 — undo/redo history hook
  // -------------------------------------------------------------------------
  // why: installed at top-level so the hook sees the same fabricRef the
  // canvas init effect populates. The hook auto-attaches Fabric event
  // listeners but stays inert until `history.start()` is called (see init
  // effect below) — that prevents the burst of object:added events during
  // initial template hydration from creating spurious undo entries.
  const history = useUndoRedoHistory(fabricRef);

  // -------------------------------------------------------------------------
  // Phase 3 — Brand + Agent sidebar state
  // -------------------------------------------------------------------------
  // why: the left sidebar shows two panels (Brand logos + Agent headshots),
  // both reading from the new brand_assets Supabase table. Loaded once per
  // editor mount; cached locally. Empty/loading states render until the
  // first fetch resolves, so the panels never flash placeholder noise.
  // why: Phase 4 — adds a "templates" tab as the first item in the strip so
  // the user can swap templates mid-edit. Default-active stays "brand" so
  // existing flow (Larissa lands on brand assets when opening Studio) is
  // unchanged — Canva-mindset call: highlight the new affordance without
  // disrupting the established opening behavior.
  const [sidebarTab, setSidebarTab] = useState<
    "templates" | "brand" | "agents" | "photos" | "tools"
  >("brand");
  // why: ToolsPanel (Canva-parity Tools tab — 2026-05-23) owns its own
  // popout but the active TOOL state (Select vs Draw) lives here at the
  // editor level so:
  //   • Esc inside the editor can force-exit Draw mode
  //   • Switching sidebarTab AWAY from "tools" auto-resets to Select so
  //     the user doesn't accidentally keep drawing on the canvas
  //   • Keyboard shortcuts (P for draw, V for select) can toggle it
  // The brush sub-state (pen/marker/highlighter/eraser + color + width)
  // is owned inside ToolsPanel; we don't need to lift that here.
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  // why: Canva-style icon-rail UX — the left rail is always visible at 64px;
  // the 280px expanded panel slides out next to it when a tab is active.
  // Clicking the active tab's icon collapses the panel back to just the rail
  // so Larissa can max out canvas space. Default-open at mount so the
  // existing "land on Brand assets" flow is unchanged.
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);

  // why: when the user leaves the Tools tab (or collapses the sidebar
  // entirely), force-exit Draw mode. Otherwise the canvas stays in
  // isDrawingMode and the user has no visible affordance explaining
  // why their click-to-select gestures are painting strokes instead.
  // This is the inverse of the "switch INTO tools enters Draw" pattern —
  // the latter is intentionally NOT here because picking a brush
  // explicitly is the right gesture for "I want to draw".
  useEffect(() => {
    const onToolsTab = sidebarExpanded && sidebarTab === "tools";
    if (!onToolsTab && toolMode === "draw") {
      setToolMode("select");
    }
  }, [sidebarTab, sidebarExpanded, toolMode]);

  // why: right-side Layers/properties panel mirror — collapses to a 48px
  // vertical rail showing a single Layers icon. Stays expanded by default.
  const [layersExpanded, setLayersExpanded] = useState<boolean>(true);
  // why: user-driven zoom on top of the fit-to-viewport `displayScale`. Range
  // 0.25-2.0 mirrors Canva's bottom-bar zoom. "Fit" resets to 1 which means
  // "use displayScale as-is" — the canvas always fits the viewport at zoom=1.
  const [zoom, setZoom] = useState<number>(1);
  const [brandAssets, setBrandAssets] = useState<readonly BrandAsset[]>([]);
  const [officesForFilter, setOfficesForFilter] = useState<readonly OfficeOption[]>([]);
  const [brandAssetsLoading, setBrandAssetsLoading] = useState<boolean>(true);
  // why: most-recent-sync metadata written by sync-brand-assets into
  // api_credentials. Loaded once on mount + refreshed after every manual
  // sync click so the "Synced 12m ago" pill stays accurate without a page
  // reload. `undefined` while we haven't checked yet; the panel hides the
  // pill in that state to avoid a "Never synced" flash.
  const [brandSyncStatus, setBrandSyncStatus] = useState<BrandSyncStatus | undefined>(
    undefined,
  );
  // why: listing photos for the Photos sidebar tab. Loaded from the same
  // /api/post-builder/photos endpoint the picker uses; falls back to a
  // single-photo array using listing.photos[0] if the endpoint errors.
  const [listingPhotos, setListingPhotos] = useState<readonly ListingPhoto[]>([]);
  const [listingPhotosLoading, setListingPhotosLoading] = useState<boolean>(true);

  // why: extracted into a useCallback so both the initial-mount load AND the
  // manual Sync button can call it. The Sync handler awaits this after the
  // Edge Function completes so the UI shows the freshly-synced rows.
  const loadBrandAssets = useCallback(async (): Promise<void> => {
    const supabase = createSupabaseBrowserClient();
    try {
      const [assetsRes, officesRes] = await Promise.all([
        supabase
          .from("brand_assets")
          .select("*")
          .eq("status", "active")
          .order("label", { ascending: true }),
        supabase
          .from("offices")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);
      if (assetsRes.error) {
        console.error("[CanvasEditor] brand_assets fetch error:", assetsRes.error);
      }
      if (officesRes.error) {
        console.error("[CanvasEditor] offices fetch error:", officesRes.error);
      }
      setBrandAssets(assetsRes.data ?? []);
      setOfficesForFilter(officesRes.data ?? []);
    } catch (err) {
      console.error("[CanvasEditor] brand assets load threw:", err);
    }
  }, []);

  // why: separate fetch for the last-sync metadata so we can refresh it
  // independently after the Sync button runs (the timestamp changes; the
  // asset list might not). Routes through the server action because the
  // `api_credentials` table is service-role-only — a client-side query
  // would return 0 rows under RLS.
  const loadBrandSyncStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await getBrandSyncStatusAction();
      setBrandSyncStatus({
        lastSyncedAt: result.lastSyncedAt,
        lastSyncError: result.lastSyncError,
      });
    } catch (err) {
      // why: a failed metadata fetch shouldn't break the editor — the
      // panels just degrade to "no pill". Log it so we'd notice in dev.
      console.error("[CanvasEditor] brand sync status fetch failed:", err);
    }
  }, []);

  useEffect(() => {
    // why: load brand assets + offices from Supabase on mount. Both tables
    // are small (<200 rows total), cheap to fetch in one shot. We use the
    // browser client; RLS lets any authenticated user read `status=active`
    // rows so we don't need the admin client. The sync-status fetch runs
    // in parallel (separate server action because api_credentials is
    // service-role-only).
    let cancelled = false;
    (async () => {
      await Promise.all([loadBrandAssets(), loadBrandSyncStatus()]);
      if (!cancelled) setBrandAssetsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBrandAssets, loadBrandSyncStatus]);

  // Manual sync handler — fired from BrandPanel or AgentPanel's Sync button.
  // Calls the server action that invokes the sync-brand-assets Edge Function,
  // then re-fetches the assets list so the new/updated rows appear. The
  // returned BrandSyncOutcome shape is what the panel toast renders.
  const handleSyncBrandAssets = useCallback(async (): Promise<BrandSyncOutcome> => {
    const res = await syncBrandAssetsAction();
    if (!res.ok) {
      // why: refresh status even on failure — the Edge Function writes its
      // failure metadata to api_credentials before returning, so the panel
      // pill should flip to "Last sync failed" right away.
      await loadBrandSyncStatus();
      return { ok: false, summary: `Sync failed: ${res.error}` };
    }
    // why: re-query brand_assets + sync status so the freshly-synced rows
    // render and the "Synced X ago" pill resets without a page reload.
    // Offices rarely change between syncs but we re-query both in one shot
    // anyway — keeps the parallel query pattern intact.
    await Promise.all([loadBrandAssets(), loadBrandSyncStatus()]);
    const { added, updated, unchanged, errors } = res.report;
    const archived = typeof res.report.archived === "number" ? res.report.archived : 0;
    const errCount = Array.isArray(errors) ? errors.length : 0;
    const seconds = Math.round(res.report.durationMs / 100) / 10;
    // why: surface archived count when nonzero — that's how the user
    // confirms the drift fix actually purged a stale row. Skip it otherwise
    // to keep the toast terse.
    const archivedFragment = archived > 0 ? `, ${archived} archived` : "";
    const summary =
      added + updated > 0
        ? `Synced in ${seconds}s — ${added} added, ${updated} updated, ${unchanged} unchanged${archivedFragment}${
            errCount > 0 ? `, ${errCount} errors` : ""
          }`
        : `Already up to date (${unchanged} unchanged${archivedFragment} in ${seconds}s)`;
    return { ok: true, summary };
  }, [loadBrandAssets, loadBrandSyncStatus]);

  // -------------------------------------------------------------------------
  // Listing photos — load for the Photos sidebar tab
  // -------------------------------------------------------------------------
  // why: same /api/post-builder/photos endpoint the picker uses. Tries to
  // get the full ordered photo array; falls back to MLSListingPayload.photos
  // (typically just the hero) if the endpoint errors. Sequence numbers
  // are used as stable React keys + the slot badges in the panel.
  useEffect(() => {
    let cancelled = false;
    setListingPhotosLoading(true);
    if (!listing.mlsNumber) {
      // why: edge case — Studio opened against a listing with no MLS
      // number (manual/dev). Fall back to whatever photos came in the
      // payload (usually just the hero).
      const fallback: ListingPhoto[] = listing.photos.map((url, i) => ({
        url,
        sequence: i + 1,
      }));
      setListingPhotos(fallback);
      setListingPhotosLoading(false);
      return;
    }
    fetch(
      `/api/post-builder/photos?mls=${encodeURIComponent(listing.mlsNumber)}`,
    )
      .then((r) => r.json())
      .then((json: { ok: boolean; photos?: Array<{ url: string; sequence: number }> }) => {
        if (cancelled) return;
        const arr = json.ok && json.photos ? json.photos : [];
        if (arr.length === 0) {
          // why: API returned ok but no rows — synth a 1-photo array from
          // the payload's hero so the panel isn't blank when the MLS just
          // hasn't been fully synced yet.
          const fallback: ListingPhoto[] = listing.photos.map((url, i) => ({
            url,
            sequence: i + 1,
          }));
          setListingPhotos(fallback);
        } else {
          setListingPhotos(arr.map((p) => ({ url: p.url, sequence: p.sequence })));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[CanvasEditor] listing photos fetch threw:", err);
        const fallback: ListingPhoto[] = listing.photos.map((url, i) => ({
          url,
          sequence: i + 1,
        }));
        setListingPhotos(fallback);
      })
      .finally(() => {
        if (!cancelled) setListingPhotosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listing.mlsNumber, listing.photos]);

  // why: dropping a listing photo onto the canvas — same shape as
  // handleSidebarAssetPicked but without the agent_headshot auto-circle
  // and without a brand-asset id. Caps the long edge to MAX_DIM (280)
  // so a 1080×1080 hero doesn't dominate the canvas; user resizes via
  // selection handles after.
  const handleListingPhotoPicked = useCallback(
    async (photo: ListingPhoto): Promise<void> => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      try {
        const img = await FabricImage.fromURL(photo.url, {
          crossOrigin: "anonymous",
        });
        const natW = img.width || 280;
        const natH = img.height || 280;
        const MAX_DIM = 280;
        const scale = Math.min(MAX_DIM / natW, MAX_DIM / natH, 1);
        img.set({
          left: (template.width - natW * scale) / 2,
          top: (template.height - natH * scale) / 2,
          scaleX: scale,
          scaleY: scale,
          cornerStyle: "circle",
          cornerSize: 10,
          transparentCorners: false,
          borderColor: "#C9A961",
          cornerColor: "#C9A961",
        });
        setLayerData(img, {
          layerId: `photo_${photo.sequence}_${Date.now()}`,
          layerKind: "image",
          displayName: `Photo ${photo.sequence}`,
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        setLayerVersion((v) => v + 1);
        history.record();
      } catch (err) {
        setEditorError({
          kind: "image_load",
          message: `Couldn't load photo: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
    [template.width, template.height, history],
  );

  // -------------------------------------------------------------------------
  // Phase 4 — template swap handler (TemplatesPanel → here)
  // -------------------------------------------------------------------------
  // why: when the user clicks a tile in TemplatesPanel (after passing the
  // panel's hasUnsavedEdits confirmation gate), we replace the active
  // template. The init useEffect's `[template.id, listing.id]` dependency
  // pair re-fires the entire canvas init pipeline — old Fabric canvas is
  // disposed in cleanup, a new one is created, layers re-hydrate against
  // the same listing. History auto-resets because the hook reads from
  // fabricRef which is rebuilt.
  //
  // Canva-mindset note: the proper end-game here is that template swap is
  // an undoable operation — Cmd+Z restores the prior canvas. That would
  // require snapshotting the outgoing schema + layer state and feeding it
  // back into the history stack, which is a meaningful refactor of the
  // history hook. Tonight we ship the confirm-then-swap pattern; the
  // undoable-swap is a follow-up worth queuing.
  const handleTemplatePicked = useCallback(
    (next: CanvasTemplateSchema): void => {
      // why: no-op if the user clicked the already-active template. The
      // panel filters this case too but defending in depth keeps the
      // re-init path from firing on stale clicks.
      if (next.id === currentTemplate.id) return;
      setCurrentTemplate(next);
      // why: the outgoing canvas's selection + error state belongs to the
      // template we're leaving. Clear them so the new canvas opens clean.
      setSelection({ layerId: null, isMulti: false, count: 0 });
      setEditorError(null);
      // why: notify the parent so its post-type / variant / format state
      // tracks what's actually on the canvas. Without this, re-opening
      // Studio from the same parent context after a swap would re-derive
      // the OLD template via findCanvasTemplate(staleTuple), AND the row
      // saved out of this session would carry mismatched metadata (template
      // says Just Sold, parent state says Just Listed).
      onTemplateSwitched?.(next);
    },
    [currentTemplate.id, onTemplateSwitched],
  );

  // -------------------------------------------------------------------------
  // Phase 4 — Smart Resize handler (ResizeMenu → here)
  // -------------------------------------------------------------------------
  // why: when the user picks a target format from the Resize menu, look up
  // the sibling template via the registry (same category + variant, new
  // format), then drive the same swap pipeline `handleTemplatePicked` uses.
  // Difference is downstream: parent treats it as a new sibling post
  // (nulls `generatedPostId`) so next Save inserts a row instead of
  // updating the current one.
  //
  // Confirmation gate matches the template-swap pattern — `window.confirm`
  // when the history has undo entries. The Canva-mindset follow-up here is
  // "Save & Resize" as a combined operation; today's MVP keeps it simple
  // and relies on the user to save first if they want to preserve current
  // edits.
  const handleResizePicked = useCallback(
    (targetFormat: PostFormat): void => {
      if (targetFormat === currentTemplate.format) return;
      const target = findCanvasTemplate(
        currentTemplate.category,
        currentTemplate.variant,
        targetFormat,
      );
      if (!target) {
        // why: should be impossible because the menu disables unavailable
        // options. Defend in depth — surface a clear toast rather than
        // crashing if the registry drifts from the menu.
        setEditorError({
          kind: "init",
          message: `No canvas template exists for ${currentTemplate.category} / ${currentTemplate.variant} at ${targetFormat}. The Resize option should not have been enabled.`,
        });
        return;
      }
      if (history.canUndo) {
        const ok = window.confirm(
          "Resize to a new aspect ratio? Your unsaved edits to this design will be discarded — save the current version first if you want to keep it.\n\nThe resized version will be saved as a separate post.",
        );
        if (!ok) return;
      }
      setCurrentTemplate(target);
      setSelection({ layerId: null, isMulti: false, count: 0 });
      setEditorError(null);
      onResize?.(target);
    },
    [
      currentTemplate.category,
      currentTemplate.variant,
      currentTemplate.format,
      history.canUndo,
      onResize,
    ],
  );

  // -------------------------------------------------------------------------
  // Phase 5 — Carousel modal state + handlers
  // -------------------------------------------------------------------------
  // why: the strip itself is a pure UI component; opening the picker /
  // preview overlays is the editor's responsibility because they're modal
  // surfaces that need to sit above the entire editor (including the
  // sidebars). Tracking state at the editor level — rather than pushing it
  // into the strip — keeps the strip self-contained and lets us add more
  // entry points later (e.g., a "Preview" keyboard shortcut).
  const [carouselPickerOpen, setCarouselPickerOpen] = useState(false);
  const [carouselPreviewOpen, setCarouselPreviewOpen] = useState(false);

  // why: merge the picker's "add these" output into the existing slides
  // array. We append in the order the user picked (the picker already
  // orders by pick order), then defer the dedupe + cap policy to the
  // picker (which enforces both visually). The orchestrator's job is just
  // to wire the wire.
  const handleCarouselPickerAdd = useCallback(
    (newSlides: readonly CarouselSlide[]): void => {
      if (!carousel) return;
      const merged = [...carousel.slides, ...newSlides];
      carousel.onSlidesChanged(merged);
      setCarouselPickerOpen(false);
    },
    [carousel],
  );

  // -------------------------------------------------------------------------
  // Phase 2 — force-load Google Fonts so Fabric can actually use them
  // -------------------------------------------------------------------------
  // why: just importing fonts.css declares the @font-face rules but the
  // browser only DOWNLOADS each woff2 file when something in the document
  // references that family. Fabric writes the font name into the canvas's
  // text-rendering call, but the canvas API doesn't trigger a font fetch —
  // it silently falls back to the next font in the stack if the requested
  // family isn't loaded yet. That's why "Playfair Display" looked like
  // Georgia and "Bebas Neue" looked like Arial Narrow.
  //
  // Fix: ask document.fonts.load() to fetch each one explicitly, then
  // re-render the canvas as each font resolves so already-drawn text picks
  // up the right typeface.
  useEffect(() => {
    // why: these are the Google Fonts families from fonts.css. System
    // fallbacks (Inter, Georgia, SF Mono) aren't here — Inter is preloaded
    // by app/layout.tsx via next/font, Georgia + SF Mono are OS fonts.
    const familiesToLoad: readonly string[] = [
      "Montserrat",
      "Poppins",
      "Lato",
      "Oswald",
      "Bebas Neue",
      "Playfair Display",
      "Cormorant Garamond",
      "Lora",
      "Merriweather",
      "Pacifico",
    ];
    // why: bail in environments without the FontFace API (older browsers,
    // SSR safety — though "use client" should keep us off the server here).
    if (typeof document === "undefined" || !document.fonts) return;

    let cancelled = false;

    familiesToLoad.forEach((family) => {
      // why: load() expects a CSS font shorthand. Size doesn't matter — any
      // size triggers a fetch. We request a generic weight so the regular
      // file fires; Fabric will use the weight from the layer schema when
      // it actually draws, and that triggers any additional weight fetches.
      document.fonts
        .load(`16px "${family}"`)
        .then(() => {
          if (cancelled) return;
          // why: re-render the canvas now that THIS font is ready. We
          // re-render on every individual resolve (not just at the end)
          // so the user sees fonts pop in one-by-one rather than waiting
          // for the slowest one.
          fabricRef.current?.requestRenderAll();
        })
        .catch(() => {
          // why: a single font failing shouldn't break the others. Most
          // common cause: blocked third-party CDN. Silent — the dropdown
          // still lists the font and the system fallback renders.
        });
    });

    return () => {
      cancelled = true;
    };
    // why: empty deps — fonts only need to load once per editor mount. The
    // request is shared across all canvas re-inits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Schema validation (memo — runs once per template change)
  // -------------------------------------------------------------------------
  // why: invariant check from types.ts — canvas dimensions MUST match the
  // platform's fixed defaults. If a template was authored against the wrong
  // dimensions, we surface the error UP-FRONT rather than letting the user
  // edit on a misshapen canvas and have the export not match social specs.
  const dimensionWarning = useMemo<string | null>(() => {
    const expected = PLATFORM_DIMENSIONS[template.format];
    if (
      template.width !== expected.width ||
      template.height !== expected.height
    ) {
      return `Template "${template.name}" has dimensions ${template.width}×${template.height}, expected ${expected.width}×${expected.height} for ${template.format}.`;
    }
    return null;
  }, [template.format, template.height, template.name, template.width]);

  // -------------------------------------------------------------------------
  // Canvas init effect — runs on mount + when template/listing identity changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    // why: `cancelled` flag protects against late-arriving async work (font
    // loading, image fetches) when the effect has been cleaned up. Without it,
    // we'd be calling .add() on a disposed canvas if the user navigates away
    // mid-load.
    let cancelled = false;

    // why: create the Fabric Canvas synchronously so the dispose cleanup can
    // always find it. Hydration of layers happens in the async IIFE below.
    const fabricCanvas = new Canvas(canvasEl, {
      width: template.width,
      height: template.height,
      backgroundColor:
        template.backgroundColor === "transparent"
          ? undefined
          : template.backgroundColor,
      preserveObjectStacking: true, // why: when an object is selected, don't auto-raise it above others — keeps schema z-order stable.
      selection: true,
      enableRetinaScaling: true, // why: Fabric handles hi-DPI rendering for us at the display layer; export uses our own multiplier.
      controlsAboveOverlay: true,
    });
    fabricRef.current = fabricCanvas;

    // why: wire selection events FIRST so they're armed before any object
    // gets added (in case a template defaults to having an object pre-selected
    // in some future Phase 2 enhancement).
    fabricCanvas.on("selection:created", (e) => {
      const target = e.selected?.[0];
      if (!target) {
        setSelection({ layerId: null, isMulti: false, count: 0 });
        return;
      }
      const data = getLayerData(target);
      const count = e.selected?.length ?? 0;
      setSelection({
        layerId: data?.layerId ?? null,
        isMulti: count > 1,
        count,
      });
    });
    fabricCanvas.on("selection:updated", (e) => {
      const target = e.selected?.[0];
      const data = target ? getLayerData(target) : null;
      const count = e.selected?.length ?? 0;
      setSelection({
        layerId: data?.layerId ?? null,
        isMulti: count > 1,
        count,
      });
    });
    fabricCanvas.on("selection:cleared", () => {
      setSelection({ layerId: null, isMulti: false, count: 0 });
    });

    // why: bump layer version on any object set mutation so the layer panel
    // refreshes. We listen to the broadest set of events that affect layer
    // visibility / ordering / membership.
    const bumpVersion = () => {
      if (cancelled) return;
      setLayerVersion((v) => v + 1);
    };
    fabricCanvas.on("object:added", bumpVersion);
    fabricCanvas.on("object:removed", bumpVersion);
    fabricCanvas.on("object:modified", bumpVersion);

    // why: optional background image. Drawn UNDERNEATH all layers, not in the
    // layer panel (the user can't move/delete the bg from the editor). Loaded
    // with crossOrigin: "anonymous" same as any other image.
    const loadBackground = async (): Promise<void> => {
      if (!template.backgroundImage) return;
      try {
        const bg = await FabricImage.fromURL(template.backgroundImage, {
          crossOrigin: "anonymous",
        });
        if (cancelled || !fabricRef.current) return;
        // why: scale background to cover the canvas regardless of natural size.
        const scaleX = template.width / (bg.width || 1);
        const scaleY = template.height / (bg.height || 1);
        const scale = Math.max(scaleX, scaleY);
        bg.set({
          left: 0,
          top: 0,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
        });
        // why: Fabric v6 deprecated `setBackgroundImage` in favor of
        // setting backgroundImage directly + calling renderAll.
        fabricRef.current.backgroundImage = bg;
        fabricRef.current.requestRenderAll();
      } catch (err) {
        if (cancelled) return;
        setEditorError({
          kind: "image_load",
          message: `Background image failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    };

    // why: hydrate layers in the order they appear in the schema, then
    // re-sort by z. We can't just push them in z-order because async image
    // loads complete out of order. Two-pass approach: add as they arrive,
    // then call canvas.sendObjectToBack/bringObjectToFront to enforce z.
    //
    // Custom Templates branch (2026-05-17): when `customTemplate.fabricJson`
    // is provided, we SKIP the schema-driven hydration and call
    // `canvas.loadFromJSON()` instead. The fabricJson encodes every Fabric
    // object the user had on canvas at save-time, including the `data`
    // metadata that carries `boundField` for text/image layers. After load
    // completes we walk the objects and re-bind any boundField values to
    // the CURRENT listing — so when Larissa opens her saved template on a
    // different property, the price + address + photos update automatically.
    const hydrateFromCustomTemplate = async (): Promise<void> => {
      try {
        await document.fonts.ready;
      } catch {
        // ignore — see fonts.ready commentary in hydrateLayers
      }
      if (!fabricRef.current || cancelled) return;
      try {
        // why: loadFromJSON returns a Promise<Canvas> in Fabric v6. The
        // reviver callback (second arg) fires per-object and is the
        // canonical place to wire custom revival logic, but we don't need
        // it — Fabric preserves arbitrary `data` properties through the
        // serialization round-trip natively.
        await fabricRef.current.loadFromJSON(
          customTemplate!.fabricJson as Record<string, unknown>,
        );
      } catch (err) {
        if (cancelled) return;
        setEditorError({
          kind: "init",
          message: `Custom template load failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        return;
      }
      if (cancelled || !fabricRef.current) return;

      // ---- Re-bind text + image layers to the CURRENT listing data ----
      // why: the saved fabric_json was authored against a different listing
      // (or with literal text). When we open it on a new listing, every
      // text object with a `boundField` should re-resolve against the new
      // MLS data; image objects with a boundField should swap to the new
      // photo/logo URL. The `data` metadata on each object carries the
      // layer id + kind we need, but boundField is stored on the original
      // schema, not on the Fabric object. To reach it, we look up the
      // matching layer in the factory template by id — custom templates
      // are built FROM a factory variant, so the layer id space lines up
      // 1:1 for the layers the user kept. Layers the user added (e.g.
      // new text via the toolbar) have no schema entry and are left as-is.
      const objectsForRebind = fabricRef.current.getObjects();
      for (const obj of objectsForRebind) {
        const data = getLayerData(obj);
        if (!data) continue;
        const schemaLayer = template.layers.find((l) => l.id === data.layerId);
        if (!schemaLayer) continue;
        if (isTextLayer(schemaLayer) && schemaLayer.boundField) {
          const resolved = resolveTextBoundField(schemaLayer.boundField, listing);
          if (resolved && resolved.trim().length > 0) {
            // why: Textbox is the only Fabric text class we emit in
            // createFabricTextbox. set() with `text` updates the content
            // and triggers a layout pass; type-narrow via instanceof to
            // satisfy TS.
            if (obj instanceof Textbox) {
              obj.set({ text: resolved });
            }
          }
        } else if (
          isImageLayer(schemaLayer) &&
          schemaLayer.boundField
        ) {
          const resolved = resolveImageBoundField(
            schemaLayer.boundField,
            listing,
          );
          if (resolved && obj instanceof FabricImage) {
            // why: setSrc is async (loads + replaces the underlying
            // HTMLImageElement). We fire-and-forget here — the next
            // renderAll after the await chain completes will show the
            // new image. Errors swallow to a warning; the placeholder
            // (or stale image) keeps showing if the swap fails.
            try {
              await obj.setSrc(resolved, { crossOrigin: "anonymous" });
            } catch (err) {
              console.warn("[customTemplate] image rebind failed:", err);
            }
          }
        }
      }

      if (cancelled || !fabricRef.current) return;
      fabricRef.current.requestRenderAll();
      setLayerVersion((v) => v + 1);
      history.start();
    };

    const hydrateLayers = async (): Promise<void> => {
      // why: wait for fonts to be ready before drawing text. Otherwise the
      // first frame uses the fallback font and looks wrong until the custom
      // font loads + a re-render is triggered. document.fonts.ready resolves
      // when ALL @font-face declarations have loaded or failed.
      try {
        await document.fonts.ready;
      } catch {
        // why: document.fonts.ready is widely supported but we don't want to
        // block hydration on a browser that doesn't expose it. Worst case:
        // text draws in fallback font once, then re-renders.
      }

      const sortedLayers = [...template.layers].sort((a, b) => a.z - b.z);

      for (const layer of sortedLayers) {
        if (cancelled || !fabricRef.current) return;

        if (isTextLayer(layer)) {
          const resolved = layer.boundField
            ? resolveTextBoundField(layer.boundField, listing)
            : layer.text;
          // why: if the bound field resolves to empty, fall back to the
          // template's literal `text` value so the canvas still shows
          // something sensible. The user can edit/delete after.
          const tb = createFabricTextbox(
            layer,
            resolved.trim() || layer.text,
          );
          fabricRef.current.add(tb);
        } else if (isImageLayer(layer)) {
          const resolved = layer.boundField
            ? resolveImageBoundField(layer.boundField, listing)
            : layer.src;
          const outcome = await createFabricImage(layer, resolved);
          if (cancelled || !fabricRef.current) return;
          if (outcome.ok) {
            fabricRef.current.add(outcome.image);
          } else {
            // why: image load failed — add a placeholder Rect with a dashed
            // outline at the layer's intended position, so the user sees
            // there WAS supposed to be an image here and can swap it in
            // Phase 4 (uploads/photos panels). Better UX than silently
            // dropping the layer.
            const placeholder = new Rect({
              left: layer.left,
              top: layer.top,
              width: layer.width,
              height: layer.height,
              fill: "rgba(201, 169, 97, 0.08)", // gold-500 at 8% alpha
              stroke: "#C9A961",
              strokeWidth: 2,
              strokeDashArray: [8, 6],
              rx: layer.cornerRadius,
              ry: layer.cornerRadius,
              selectable: !layer.locked,
              cornerStyle: "circle",
              cornerSize: 10,
              transparentCorners: false,
              borderColor: "#C9A961",
              cornerColor: "#C9A961",
            });
            setLayerData(placeholder, {
              layerId: layer.id,
              layerKind: "image",
              displayName: `${layer.name} (no image)`,
            });
            fabricRef.current.add(placeholder);
            // why: only surface CORS errors. Missing-photo (no_src) is a
            // normal data state, not an error. Generic load_error is shown
            // as a non-blocking warning.
            if (outcome.reason === "cors_blocked") {
              setEditorError({
                kind: "image_load",
                message: outcome.message,
              });
            }
          }
        } else if (isShapeLayer(layer)) {
          const shape = createFabricShape(layer);
          fabricRef.current.add(shape);
        }
        // why: GroupLayer is reserved — skip silently in Phase 1. Schema
        // validation upstream (Phase 2 templates panel) prevents authored
        // templates from including groups until the implementation lands.
      }

      if (cancelled || !fabricRef.current) return;
      fabricRef.current.requestRenderAll();
      // why: prime the layer panel with the freshly added objects.
      setLayerVersion((v) => v + 1);
      // why: Phase 2 — activate the undo/redo auto-snapshot now that the
      // canvas holds its hydrated baseline. Before this call, the history
      // hook ignores Fabric events; after this call, every debounced
      // mutation becomes a real undo step. Idempotent — extra calls no-op.
      history.start();
    };

    void loadBackground();
    // why: dispatch on `customTemplate` presence. When a custom row is
    // supplied, the saved Fabric JSON already encodes every object the
    // user wants — we load + rebind to the current listing. Otherwise
    // we hydrate from the factory schema as usual.
    if (customTemplate?.fabricJson) {
      void hydrateFromCustomTemplate();
    } else {
      void hydrateLayers();
    }

    return () => {
      cancelled = true;
      // why: Fabric v6 dispose() returns Promise<boolean>. React effect
      // cleanup is sync, so we kick it off and ignore the result. Safe
      // because no subsequent code references the canvas after this point —
      // the ref is nulled below before any new effect can touch it.
      const dyingCanvas = fabricRef.current;
      fabricRef.current = null;
      if (dyingCanvas) {
        // why: remove our listeners before dispose to avoid any final-frame
        // bumpVersion calls into a stale React tree.
        dyingCanvas.off();
        // why: dispose returns a promise; we don't await but we DO catch
        // the rejection to keep dev consoles clean. A failed dispose is
        // not actionable in user-space.
        dyingCanvas.dispose().catch(() => {});
      }
    };
    // why: include only identity fields in deps. Including the full template
    // object would re-init the canvas on every parent re-render (since most
    // parents pass a new object reference each render). The id pair is
    // sufficient for "should we recreate the canvas".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, listing.id, customTemplate?.id]);

  // -------------------------------------------------------------------------
  // Layer panel data — derived from Fabric on each layerVersion bump
  // -------------------------------------------------------------------------
  const layerEntries = useMemo<LayerEntry[]>(() => {
    const canvas = fabricRef.current;
    if (!canvas) return [];
    // why: getObjects returns in stacking order (bottom to top). The layer
    // panel convention is "top of list = top of stack" (Photoshop / Canva
    // standard), so we reverse.
    return canvas
      .getObjects()
      .slice()
      .reverse()
      .map((obj): LayerEntry | null => {
        const data = getLayerData(obj);
        if (!data) return null;
        return {
          id: data.layerId,
          name: data.displayName,
          kind: data.layerKind,
          visible: obj.visible !== false,
          locked: obj.selectable === false,
        };
      })
      .filter((entry): entry is LayerEntry => entry !== null);
    // why: layerVersion in deps — getObjects() output isn't itself reactive;
    // we re-derive whenever Fabric emits an add/remove/modify event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerVersion]);

  // -------------------------------------------------------------------------
  // Selection-driven action handlers
  // -------------------------------------------------------------------------
  const getObjectByLayerId = useCallback(
    (layerId: string | null): FabricObject | null => {
      if (!layerId || !fabricRef.current) return null;
      const match = fabricRef.current
        .getObjects()
        .find((obj) => getLayerData(obj)?.layerId === layerId);
      return match ?? null;
    },
    [],
  );

  const handleDeleteSelection = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, []);

  const handleBringForward = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    // why: Fabric v6 method names. bringObjectForward moves one step toward
    // the top; bringObjectToFront jumps to the very top. We bind the toolbar
    // button to one-step-forward to match Canva's behavior.
    canvas.bringObjectForward(active);
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  const handleSendBackward = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.sendObjectBackwards(active);
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  // -------------------------------------------------------------------------
  // Phase B.1 — Alignment + Distribute
  // -------------------------------------------------------------------------
  //
  // Rules:
  //   • Single selected object       → align to template/canvas bounds.
  //   • Multi-selection (2+)          → align children within their shared
  //                                     bounding rectangle (the bounding box
  //                                     of all selected objects).
  //   • Distribute h/v                → requires ≥3 objects. Keeps leftmost +
  //                                     rightmost (or top/bottom) pinned and
  //                                     evenly distributes the gaps between
  //                                     interior objects.
  //
  // Implementation note (Fabric v6):
  //   When objects sit inside an ActiveSelection, their `left`/`top` are
  //   stored RELATIVE to the parent group's center. To keep the math
  //   straightforward we `discardActiveObject()` first — that flushes each
  //   child back to absolute canvas coords — apply the alignment, then
  //   re-create the ActiveSelection so the user's selection is preserved.

  /**
   * The 8 directions the footer can dispatch. Single-object alignment uses
   * canvas bounds; multi uses the selection bounding box; distribute is
   * multi-only and rejects when fewer than 3 objects are selected.
   */
  type AlignDirection =
    | "left"
    | "center"
    | "right"
    | "top"
    | "middle"
    | "bottom"
    | "distribute_horizontal"
    | "distribute_vertical";

  const handleAlign = useCallback(
    (direction: AlignDirection): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const objs = canvas.getActiveObjects();
      if (objs.length === 0) return;

      const isDistribute =
        direction === "distribute_horizontal" ||
        direction === "distribute_vertical";

      // Distribute requires 3 objects to be meaningful — guard here so a
      // stale click doesn't shuffle a 2-object selection unexpectedly.
      if (isDistribute && objs.length < 3) return;

      const canvasW = currentTemplate.width;
      const canvasH = currentTemplate.height;

      // ---- Single-object alignment — align to canvas bounds ------------
      if (objs.length === 1) {
        const obj = objs[0]!;
        if (isDistribute) return; // Distribute is multi-only.
        const bb = obj.getBoundingRect();
        let dx = 0;
        let dy = 0;
        switch (direction) {
          case "left":
            dx = 0 - bb.left;
            break;
          case "center":
            dx = (canvasW - bb.width) / 2 - bb.left;
            break;
          case "right":
            dx = canvasW - bb.width - bb.left;
            break;
          case "top":
            dy = 0 - bb.top;
            break;
          case "middle":
            dy = (canvasH - bb.height) / 2 - bb.top;
            break;
          case "bottom":
            dy = canvasH - bb.height - bb.top;
            break;
        }
        obj.set({
          left: (obj.left ?? 0) + dx,
          top: (obj.top ?? 0) + dy,
        });
        obj.setCoords();
        canvas.fire("object:modified", { target: obj });
        canvas.requestRenderAll();
        setLayerVersion((v) => v + 1);
        return;
      }

      // ---- Multi-selection alignment ----------------------------------
      // Step 1: release the ActiveSelection so each child has absolute
      // canvas coords in its own left/top.
      canvas.discardActiveObject();
      // why: snapshot each object's bounding rect AFTER the discard so the
      // numbers reflect absolute canvas coords (not group-relative).
      objs.forEach((o) => o.setCoords());

      const boxes = objs.map((o) => ({ obj: o, bb: o.getBoundingRect() }));

      if (isDistribute) {
        const axis = direction === "distribute_horizontal" ? "x" : "y";
        // Sort by leading edge along the distribution axis.
        const sorted = boxes
          .slice()
          .sort((a, b) =>
            axis === "x" ? a.bb.left - b.bb.left : a.bb.top - b.bb.top,
          );
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        // Total free space = (last leading edge) - (first trailing edge)
        // minus the sum of the interior objects' span on the axis.
        const firstTrailing =
          axis === "x" ? first.bb.left + first.bb.width : first.bb.top + first.bb.height;
        const lastLeading = axis === "x" ? last.bb.left : last.bb.top;
        const interior = sorted.slice(1, -1);
        const interiorSpan = interior.reduce(
          (sum, item) => sum + (axis === "x" ? item.bb.width : item.bb.height),
          0,
        );
        const totalGap = lastLeading - firstTrailing - interiorSpan;
        // why: clamp negative gaps to 0 — if the interior objects overlap
        // the leading/trailing edges, distribute degrades gracefully to
        // a tight packing rather than producing nonsense placement.
        const gap = Math.max(0, totalGap / (interior.length + 1));
        let cursor = firstTrailing + gap;
        interior.forEach((item) => {
          const targetLeading = cursor;
          const currentLeading = axis === "x" ? item.bb.left : item.bb.top;
          const delta = targetLeading - currentLeading;
          if (axis === "x") {
            item.obj.set({ left: (item.obj.left ?? 0) + delta });
          } else {
            item.obj.set({ top: (item.obj.top ?? 0) + delta });
          }
          item.obj.setCoords();
          cursor += (axis === "x" ? item.bb.width : item.bb.height) + gap;
        });
      } else {
        // Align within the selection bounding box (union of all child bbs).
        const minLeft = Math.min(...boxes.map((b) => b.bb.left));
        const maxRight = Math.max(...boxes.map((b) => b.bb.left + b.bb.width));
        const minTop = Math.min(...boxes.map((b) => b.bb.top));
        const maxBottom = Math.max(...boxes.map((b) => b.bb.top + b.bb.height));
        const selW = maxRight - minLeft;
        const selH = maxBottom - minTop;

        boxes.forEach(({ obj, bb }) => {
          let dx = 0;
          let dy = 0;
          switch (direction) {
            case "left":
              dx = minLeft - bb.left;
              break;
            case "center":
              dx = minLeft + (selW - bb.width) / 2 - bb.left;
              break;
            case "right":
              dx = minLeft + selW - bb.width - bb.left;
              break;
            case "top":
              dy = minTop - bb.top;
              break;
            case "middle":
              dy = minTop + (selH - bb.height) / 2 - bb.top;
              break;
            case "bottom":
              dy = minTop + selH - bb.height - bb.top;
              break;
          }
          obj.set({
            left: (obj.left ?? 0) + dx,
            top: (obj.top ?? 0) + dy,
          });
          obj.setCoords();
        });
      }

      // Step 2: recreate the ActiveSelection so the user's selection is
      // preserved after the alignment lands.
      const sel = new ActiveSelection(objs, { canvas });
      canvas.setActiveObject(sel);
      canvas.fire("object:modified", { target: sel });
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
    },
    [currentTemplate.width, currentTemplate.height],
  );

  const handleToggleLock = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const newLocked = active.selectable !== false; // currently selectable → going to lock
    active.set({
      selectable: !newLocked,
      evented: !newLocked,
      lockMovementX: newLocked,
      lockMovementY: newLocked,
      lockScalingX: newLocked,
      lockScalingY: newLocked,
      lockRotation: newLocked,
    });
    // why: discard selection if we just locked the active object, so the user
    // can't keep editing through the lock state. They click again to re-select
    // (which is still possible if evented stays true, but we've turned that
    // off above). To re-edit, they unlock via the layer panel.
    if (newLocked) canvas.discardActiveObject();
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  const handleDuplicateSelection = useCallback(async (): Promise<void> => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    // why: Fabric v6 clone is async (returns Promise) for Image and Group
    // because they may need to re-fetch source data. Use it for everything
    // for consistency.
    const cloned = await active.clone(["data"]);
    cloned.set({
      left: (active.left ?? 0) + 20,
      top: (active.top ?? 0) + 20,
    });
    // why: regenerate layer id on the clone so the layer panel treats it as a
    // distinct entry. The displayName gets a "(copy)" suffix for clarity.
    const data = getLayerData(active);
    if (data) {
      setLayerData(cloned, {
        layerId: `${data.layerId}_copy_${Date.now()}`,
        layerKind: data.layerKind,
        displayName: `${data.displayName} (copy)`,
      });
    }
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.requestRenderAll();
  }, []);

  // -------------------------------------------------------------------------
  // Layer panel handlers
  // -------------------------------------------------------------------------
  const handleSelectLayer = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    },
    [getObjectByLayerId],
  );

  const handleToggleLayerVisibility = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      obj.visible = obj.visible === false ? true : false;
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
    },
    [getObjectByLayerId],
  );

  const handleDeleteLayer = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      canvas.remove(obj);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    },
    [getObjectByLayerId],
  );

  // -------------------------------------------------------------------------
  // Phase 2 — handlers for the new panels (LayerListPanel, AddLayerToolbar,
  // SelectionPropertiesPanel)
  // -------------------------------------------------------------------------

  // why: receives the new top-of-stack-first ID order from LayerListPanel and
  // applies it to Fabric by moving each object to its target stacking index.
  // We reverse first because Fabric's stacking is bottom-first whereas the
  // panel reports top-first (Photoshop convention). moveObjectTo is the v6
  // API for absolute repositioning.
  const handleReorderLayers = useCallback(
    (topFirstIds: string[]): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const bottomFirst = [...topFirstIds].reverse();
      bottomFirst.forEach((id, targetIndex) => {
        const obj = canvas
          .getObjects()
          .find((o) => getLayerData(o)?.layerId === id);
        if (obj) canvas.moveObjectTo(obj, targetIndex);
      });
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
      history.record();
    },
    [history],
  );

  // why: AddLayerToolbar fires this after it adds a new object. We bump the
  // layer panel and select the new layer so the user lands directly in
  // "edit this fresh layer" mode.
  const handleLayerAdded = useCallback(
    (newObj: FabricObject): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.setActiveObject(newObj);
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
    },
    [],
  );

  // why: SelectionPropertiesPanel's "Back to layers" button calls this so the
  // orchestrator can swap the right-side panel back to LayerListPanel.
  const handleClearSelection = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSelection({ layerId: null, isMulti: false, count: 0 });
  }, []);

  // -------------------------------------------------------------------------
  // Phase B.4 — Layers panel hover-preview
  // -------------------------------------------------------------------------
  //
  // When the user hovers a row in LayerListPanel, draw a temporary outline
  // rect around the corresponding Fabric object so they can visually
  // identify what the row refers to without committing to selecting it
  // (selecting auto-switches the right panel to SelectionPropertiesPanel,
  // which is a context jump). The rect is non-interactive — `evented:
  // false, selectable: false` — and lives only as long as the hover.
  //
  // Implementation: a ref holds the current hover Rect. On enter we add a
  // new rect around the target object's bounding box; on leave we remove
  // it. We never persist the rect to the canvas state — it's purely a
  // visual artifact of the panel hover.

  const hoverHighlightRef = useRef<Rect | null>(null);

  // -------------------------------------------------------------------------
  // Phase B.6 — Autosave to localStorage
  // -------------------------------------------------------------------------
  //
  // Two halves:
  //   1. Read on mount — if a (template, mls) autosave exists, surface a
  //      banner offering to restore. The banner is non-blocking; the user
  //      can ignore it and the autosave keeps writing.
  //   2. Debounced write — every time layerVersion bumps, schedule a write
  //      3s after the last bump. Cancels any pending write so we never
  //      flood localStorage during a slider drag.
  //
  // Both halves are gated on the (template.id, listing.mlsNumber) pair so
  // a listing or template switch resets the autosave channel cleanly.

  const [pendingAutosave, setPendingAutosave] = useState<AutosavePayload | null>(
    null,
  );
  // why: persist the banner-dismissed state per session so a user who
  // declines the restore once doesn't see it re-appear on every layerVersion
  // bump. Not stored in localStorage — a closed tab forgets the dismissal.
  const [autosaveBannerDismissed, setAutosaveBannerDismissed] = useState<boolean>(false);
  const autosaveWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read on mount (and on template/listing change). The Fabric canvas may
  // not be fully hydrated yet, but the read is sync from localStorage so
  // it's fine to do early — the banner just shows while the hydration
  // finishes in the background.
  useEffect(() => {
    const found = readAutosave(currentTemplate.id, listing.mlsNumber);
    if (found) {
      setPendingAutosave(found);
      setAutosaveBannerDismissed(false);
    } else {
      setPendingAutosave(null);
    }
    // why: depend on the identity-pair, not on every prop bump. A listing
    // detail change (e.g., agent name) shouldn't blow away the autosave.
  }, [currentTemplate.id, listing.mlsNumber]);

  // Debounced write. Triggers on every layerVersion bump; clears any
  // pending timer first so we end up writing only once per 3s of silence.
  useEffect(() => {
    // why: skip the initial bump (layerVersion === 0) — writing an
    // unmutated canvas state right after hydration is wasted work AND
    // would mark a fresh canvas as "has an autosave," confusing the
    // restore flow on a future open.
    if (layerVersion === 0) return;
    const canvas = fabricRef.current;
    if (!canvas) return;
    // Belt-and-suspenders: don't autosave the hover-preview rect. Filter
    // it out by checking its layer-id marker before serializing.
    if (autosaveWriteTimerRef.current) {
      clearTimeout(autosaveWriteTimerRef.current);
    }
    autosaveWriteTimerRef.current = setTimeout(() => {
      const current = fabricRef.current;
      if (!current) return;
      // Strip the hover-preview rect (if any) so it doesn't get persisted.
      const hover = hoverHighlightRef.current;
      if (hover) current.remove(hover);
      try {
        // why: Fabric v6 `toJSON()` takes no args; the supported way to
        // include custom properties (our `data` metadata) is to call
        // `toObject(propertiesToInclude)` directly. Mirrors the pattern
        // in useUndoRedoHistory's captureSnapshot.
        const propsToInclude: string[] = [
          "data",
          "selectable",
          "evented",
          "lockMovementX",
          "lockMovementY",
        ];
        const json = current.toObject(propsToInclude);
        writeAutosave(currentTemplate.id, listing.mlsNumber, json);
      } catch {
        // best-effort
      } finally {
        // Re-add the hover preview if we just removed it for the snapshot.
        if (hover) {
          current.add(hover);
          current.bringObjectToFront(hover);
        }
      }
    }, 3_000);

    return () => {
      if (autosaveWriteTimerRef.current) {
        clearTimeout(autosaveWriteTimerRef.current);
        autosaveWriteTimerRef.current = null;
      }
    };
  }, [layerVersion, currentTemplate.id, listing.mlsNumber]);

  /** Apply the pending autosave to the live Fabric canvas. */
  const handleRestoreAutosave = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas || !pendingAutosave) return;
    // why: defensive — re-verify the autosave matches the current
    // (template, mls). The pendingAutosave state was set when the
    // identifier pair last changed; if a race somehow lands a stale
    // payload, we'd rather no-op than overwrite the canvas with
    // unrelated data.
    if (
      pendingAutosave.templateId !== currentTemplate.id ||
      pendingAutosave.mlsNumber !== listing.mlsNumber
    ) {
      setPendingAutosave(null);
      return;
    }
    // Clear active selection + hover preview before reloading so they
    // don't reference soon-to-be-stale Fabric objects.
    canvas.discardActiveObject();
    if (hoverHighlightRef.current) {
      canvas.remove(hoverHighlightRef.current);
      hoverHighlightRef.current = null;
    }
    // why: loadFromJSON returns a Promise<Canvas> in Fabric v6.
    void canvas
      .loadFromJSON(pendingAutosave.fabricJson as object)
      .then(() => {
        canvas.requestRenderAll();
        setLayerVersion((v) => v + 1);
      });
    setPendingAutosave(null);
  }, [pendingAutosave, currentTemplate.id, listing.mlsNumber]);

  /** Discard the autosave entry and dismiss the banner. */
  const handleDiscardAutosave = useCallback((): void => {
    clearAutosave(currentTemplate.id, listing.mlsNumber);
    setPendingAutosave(null);
    setAutosaveBannerDismissed(true);
  }, [currentTemplate.id, listing.mlsNumber]);

  const handleHoverEntry = useCallback(
    (layerId: string | null): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      // Always clear any prior highlight first — covers both leave and
      // enter-on-a-different-row in one path.
      if (hoverHighlightRef.current) {
        canvas.remove(hoverHighlightRef.current);
        hoverHighlightRef.current = null;
      }
      if (!layerId) {
        canvas.requestRenderAll();
        return;
      }
      const target = canvas
        .getObjects()
        .find((o) => getLayerData(o)?.layerId === layerId);
      if (!target) {
        canvas.requestRenderAll();
        return;
      }
      // Use the target's absolute bounding rect so the highlight matches
      // the object's true on-canvas footprint even when it's rotated/scaled.
      const bb = target.getBoundingRect();
      const highlight = new Rect({
        left: bb.left,
        top: bb.top,
        width: bb.width,
        height: bb.height,
        fill: "transparent",
        stroke: "#C9A961", // gold-500 — matches the selection ring
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        // why: skipTargetFind keeps the rect from intercepting clicks on
        // the underlying object — the user can still click through to
        // select what they're previewing.
        evented: false,
        selectable: false,
        hoverCursor: "default",
      });
      // Stamp a marker on the rect's data so a defensive sweep can clean
      // up stragglers (shouldn't be needed, but cheap insurance).
      setLayerData(highlight, {
        layerId: `__hover_preview__:${layerId}`,
        layerKind: "shape",
        displayName: "(hover preview)",
      });
      hoverHighlightRef.current = highlight;
      canvas.add(highlight);
      canvas.bringObjectToFront(highlight);
      canvas.requestRenderAll();
    },
    [],
  );

  // why: clean up the hover highlight if the canvas unmounts or the
  // active selection changes mid-hover (the panel might not get a
  // mouseLeave event in those cases). Belt-and-suspenders.
  useEffect(() => {
    return () => {
      const canvas = fabricRef.current;
      if (canvas && hoverHighlightRef.current) {
        canvas.remove(hoverHighlightRef.current);
        hoverHighlightRef.current = null;
        canvas.requestRenderAll();
      }
    };
  }, []);

  // why: when the user clicks a thumbnail in BrandPanel or AgentPanel, we
  // create a new Fabric image at canvas center and select it. Dimensions
  // are capped so a huge source image doesn't dominate the canvas — we
  // scale to fit within 280px on the long edge while preserving aspect.
  // crossOrigin: "anonymous" is required so the canvas stays exportable.
  const handleSidebarAssetPicked = useCallback(
    async (asset: BrandAsset): Promise<void> => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      try {
        const img = await FabricImage.fromURL(asset.public_url, {
          crossOrigin: "anonymous",
        });
        const natW = img.width || 280;
        const natH = img.height || 280;
        const MAX_DIM = 280;
        // why: agent_headshots start as a perfect circle so the first-drop
        // visual matches the sidebar thumbnail. We force the bounding box
        // to a square (using the shorter source dim, scaled to MAX_DIM)
        // and cover-fit the photo into that square. Logos + partner marks
        // keep their natural aspect ratio so wordmarks aren't cropped.
        const isAgentHeadshot = asset.kind === "agent_headshot";
        let scaleX: number;
        let scaleY: number;
        let displayW: number;
        let displayH: number;
        if (isAgentHeadshot) {
          // Square box sized to fit MAX_DIM on each side.
          const shortNat = Math.min(natW, natH);
          const target = Math.min(MAX_DIM, shortNat);
          // cover-fit a non-square source into a target × target box.
          const coverScale = Math.max(target / natW, target / natH);
          scaleX = coverScale;
          scaleY = coverScale;
          // why: scaled natural dims may exceed `target` along the long
          // side under cover-fit (that's the crop). The visible bounding
          // box stays target×target because the clipPath is applied next.
          displayW = target;
          displayH = target;
        } else {
          // Preserve aspect ratio, scale longest side to MAX_DIM.
          const fitScale = Math.min(MAX_DIM / natW, MAX_DIM / natH, 1);
          scaleX = fitScale;
          scaleY = fitScale;
          displayW = natW * fitScale;
          displayH = natH * fitScale;
        }
        img.set({
          left: (template.width - displayW) / 2,
          top: (template.height - displayH) / 2,
          scaleX,
          scaleY,
          cornerStyle: "circle",
          cornerSize: 10,
          transparentCorners: false,
          borderColor: "#C9A961",
          cornerColor: "#C9A961",
        });
        // why: apply the circular clipPath AFTER set() so the scale values
        // are stable when we divide the half-dim radius into image-local
        // space. side/2 in display px → (side/2) / scaleX in image-local.
        if (isAgentHeadshot) {
          const radiusLocalX = displayW / 2 / scaleX;
          const radiusLocalY = displayH / 2 / scaleY;
          img.clipPath = new Rect({
            width: natW,
            height: natH,
            rx: radiusLocalX,
            ry: radiusLocalY,
            originX: "center",
            originY: "center",
            absolutePositioned: false,
          });
          // why: stamp objectFit='cover' on the data bag so the Image
          // properties panel can pick up the right active state when the
          // user re-selects the headshot.
          const dataBag = img as unknown as { data?: Record<string, unknown> };
          dataBag.data = { ...(dataBag.data ?? {}), objectFit: "cover" };
        }
        // why: stamp our standard layer metadata so the layer panel + selection
        // panel can recognize this object the same way they handle hydrated
        // template layers. Brand assets are user-added "free" layers with no
        // boundField — literal images, not data-bound.
        setLayerData(img, {
          layerId: `brand_${asset.id}_${Date.now()}`,
          layerKind: "image",
          displayName: asset.label,
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        setLayerVersion((v) => v + 1);
        history.record();
      } catch (err) {
        setEditorError({
          kind: "image_load",
          message: `Couldn't load brand asset: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
    [template.width, template.height, history],
  );

  // -------------------------------------------------------------------------
  // Export handler — the whole point of Phase 1
  // -------------------------------------------------------------------------
  const handleExport = useCallback(async (): Promise<void> => {
    if (isExportingRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    isExportingRef.current = true;
    setIsLocalSaving(true);
    setEditorError(null);
    try {
      // why: discard the active selection BEFORE export so the selection
      // bounding-box artwork (corners, dashed border) doesn't bleed into the
      // PNG. We restore selection state implicitly — the user can re-select
      // after a successful save.
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      // why: export as JPEG (quality 0.92) instead of PNG. A 2x retina PNG
      // of a 1080×1080 listing photo is typically 4-8MB, which blows past
      // Vercel's serverless body limit (~4.5MB) when we POST it to the save
      // endpoint. JPEG at q92 drops the same image to ~600KB-1.5MB with no
      // perceptible quality loss — and social platforms re-encode to JPEG
      // anyway. Trade-off: JPEG has no alpha, so transparent pixels become
      // the canvas's background color (we ensure that's something sensible
      // by temporarily filling the canvas background white before export).
      //
      // why white BG: most templates explicitly set a backgroundColor in
      // the schema (e.g. "#FFFFFF"), but some templates might use
      // backgroundColor: "transparent" — without an explicit fill those
      // pixels would come out black in JPEG. Forcing white before export
      // matches what social posts typically expect.
      const originalBackgroundColor = canvas.backgroundColor;
      let dataUrl: string;
      try {
        if (!originalBackgroundColor || originalBackgroundColor === "transparent") {
          canvas.backgroundColor = "#FFFFFF";
          canvas.requestRenderAll();
        }
        dataUrl = canvas.toDataURL({
          format: "jpeg",
          quality: 0.92,
          multiplier: EXPORT_RESOLUTION_MULTIPLIER,
          enableRetinaScaling: false, // why: we control retina via multiplier — don't double-up.
        });
      } catch (err) {
        // why: tainted canvas surfaces as SecurityError on toDataURL. This is
        // the failure mode we MUST handle explicitly because it means a
        // third-party image (likely a non-CORS MLS photo host) tainted the
        // canvas at load time. The fix is server-side (proxy through our own
        // CORS-correct endpoint), not client-side.
        const message =
          err instanceof Error ? err.message : String(err);
        const isSecurityError =
          err instanceof Error && err.name === "SecurityError";
        throw new Error(
          isSecurityError
            ? `Export blocked: a layer image is not CORS-safe and tainted the canvas. Re-upload through Supabase Storage or use a CORS-enabled proxy. (${message})`
            : `Export failed: ${message}`,
        );
      } finally {
        // why: restore the canvas background to whatever it was so the
        // editor visuals don't change after a save. Only restored when we
        // actually overwrote it.
        if (canvas.backgroundColor === "#FFFFFF" && originalBackgroundColor !== "#FFFFFF") {
          canvas.backgroundColor = originalBackgroundColor;
          canvas.requestRenderAll();
        }
      }

      // why: dataURL → Blob → File. We can't use the Canvas.toBlob() API
      // because Fabric's toDataURL gives us the multiplier-aware bytes, but
      // converting via fetch(dataUrl).then(r=>r.blob()) is the cleanest path
      // that respects the multiplier we just applied.
      const blob = await (await fetch(dataUrl)).blob();
      const filename = `${template.id}_${Date.now()}.jpg`;
      const file = new File([blob], filename, { type: "image/jpeg" });

      const exportResult: CanvasExportResult = {
        file,
        dataUrl,
        // why: in Phase 1 we return the ORIGINAL hydrated schema, not the
        // user's edits. The Fabric→schema serializer lands in Phase 2 so the
        // parent can persist the editable source. For now, the rendered PNG
        // is the artifact of record.
        // TODO(phase-2): serialize current Fabric state back to schema here.
        schema: template,
        width: template.width * EXPORT_RESOLUTION_MULTIPLIER,
        height: template.height * EXPORT_RESOLUTION_MULTIPLIER,
        mimeType: "image/jpeg",
      };

      // why: await the parent's onSave so we can surface upload failures.
      // If onSave is sync (returns void, not Promise), `await` is a no-op.
      await Promise.resolve(onSave(exportResult));
      // Phase B.6 — the DB row is now authoritative; the localStorage copy
      // can be cleared so a future open of the same (template, mls) won't
      // offer a stale restore. Only fired on a successful onSave —
      // failures throw above and skip this line, preserving the autosave
      // as a safety net.
      clearAutosave(currentTemplate.id, listing.mlsNumber);
      setPendingAutosave(null);
    } catch (err) {
      setEditorError({
        kind: "export",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isExportingRef.current = false;
      setIsLocalSaving(false);
    }
  }, [onSave, template, currentTemplate.id, listing.mlsNumber]);

  // -------------------------------------------------------------------------
  // Custom Template — canvas-state snapshot + submit handler
  // -------------------------------------------------------------------------
  //
  // why: the SaveAsTemplateModal needs the latest `canvas.toJSON()` AND a
  // half-scale PNG preview at submit-time. Both reads are synchronous; we
  // expose them as a single callback the modal calls inside its own submit
  // handler so the data is captured at the moment of save (not at modal
  // open, where the user might still be editing).
  //
  // The multiplier of 0.5 keeps the preview data URI to ~150-250KB for a
  // 1080×1350 canvas — small enough to round-trip through a Server Action
  // body without hitting Vercel's ~4.5MB ceiling. PNG (not JPEG) because
  // the preview is small and the variant grid card benefits from the
  // sharper edges on text overlays.
  const getCanvasStateForTemplate = useCallback((): CanvasStateSnapshot | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    // why: discard the active selection before snapshotting so the
    // selection-corner artwork doesn't bleed into the preview PNG. Mirrors
    // the discard inside handleExport.
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    let fabricJson: unknown;
    let previewImageDataUri = "";
    try {
      fabricJson = canvas.toJSON();
    } catch (err) {
      console.warn("[SaveAsTemplate] toJSON failed:", err);
      return null;
    }
    try {
      previewImageDataUri = canvas.toDataURL({
        format: "png",
        multiplier: 0.5,
        enableRetinaScaling: false,
      });
    } catch (err) {
      // why: tainted-canvas → SecurityError. The Save flow downstream will
      // reject without a preview; we return an empty string so the modal
      // can show a helpful inline error rather than crashing here.
      console.warn("[SaveAsTemplate] toDataURL failed:", err);
      previewImageDataUri = "";
    }
    return { fabricJson, previewImageDataUri };
  }, []);

  // why: lookup the current variant's display name from the registry so the
  // modal's checkbox copy reads naturally ("Make this the new default for
  // Excellence Collection"). VARIANT_META lives in the templates registry
  // (registry.ts) but isn't exported; the editor doesn't import it directly,
  // so we replicate the display-name fallback table here. Source of truth
  // stays the registry — keep these in sync if a new variant ships.
  const VARIANT_DISPLAY_NAMES: Record<string, string> = useMemo(
    () => ({
      v1: "Hero Editorial",
      v2: "Bold Stats",
      v3: "Excellence Collection",
      v4: "Two-Photo Diptych",
      v5: "Three-Photo Grid",
      v6: "Magazine Cover",
      v7: "Polaroid",
      v8: "Standard NEW LISTING",
      v9: "Just Sold Celebration",
      v10: "Coming Soon Teaser",
    }),
    [],
  );
  const POST_TYPE_DISPLAY_NAMES: Record<string, string> = useMemo(
    () => ({
      just_listed: "Just Listed",
      just_sold: "Just Sold",
      under_contract: "Under Contract",
      open_house: "Open House",
      price_reduction: "Price Reduced",
    }),
    [],
  );
  const FORMAT_DISPLAY_NAMES: Record<string, string> = useMemo(
    () => ({
      portrait_4x5: "Portrait (4:5)",
      story_9x16: "Story (9:16)",
    }),
    [],
  );

  // -------------------------------------------------------------------------
  // Display-scale calculation for the canvas viewport
  // -------------------------------------------------------------------------
  // why: the canvas is 1080×1350 (or larger) logical pixels — way too big for
  // a typical viewport. We scale the WRAPPER via CSS transform, not Fabric's
  // internal zoom, so toDataURL still emits at full logical resolution.
  // Computed from the canvas's intrinsic dimensions vs an assumed available
  // viewport. Phase 2 will replace this with a ResizeObserver-driven fit.
  const displayScale = useMemo<number>(() => {
    // why: target a 720px max display height (leaves room for top header +
    // bottom controls in a ~1080px viewport). Width is bounded by the right
    // layer panel + future left toolbar, so we use 880px max display width.
    const maxDisplayWidth = 880;
    const maxDisplayHeight = 720;
    const scaleW = maxDisplayWidth / template.width;
    const scaleH = maxDisplayHeight / template.height;
    return Math.min(scaleW, scaleH, 1);
  }, [template.width, template.height]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts — Delete, Backspace, Cmd+D
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      // why: if the user is editing text inside a Textbox (Fabric's IText
      // editing mode), the keystrokes belong to the text input, not our
      // shortcut handler. Bail out.
      const active = canvas.getActiveObject();
      if (active && (active as { isEditing?: boolean }).isEditing) return;

      // why: ignore shortcuts while focus is in a real form input — the layer
      // panel will eventually have a rename input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (canvas.getActiveObjects().length > 0) {
          e.preventDefault();
          handleDeleteSelection();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (canvas.getActiveObject()) {
          e.preventDefault();
          void handleDuplicateSelection();
        }
      } else {
        // why: Phase 2 — delegate Cmd+Z/Cmd+Shift+Z (undo/redo) and arrow-key
        // nudging to Agent B's handler. It returns true if it consumed the
        // event (the helper internally calls e.preventDefault when needed).
        const consumed = handlePhase2KeyDown(e, {
          canvas,
          history,
          onCanvasMutated: () => setLayerVersion((v) => v + 1),
        });
        // why: only fall through to Tools shortcuts (R/O/L/T/P/E/Escape)
        // when Phase 2 didn't already consume the event. This preserves
        // the precedence: undo/redo + nudge win over any letter that
        // might collide. The current bindings don't actually collide,
        // but defending against future additions is cheap.
        if (!consumed) {
          const toolsConsumed = handleToolsKeyDown(e, {
            canvas,
            toolMode,
            setToolMode,
            // why: each spawn shim mirrors what AddLayerToolbar does on
            // click — add to canvas, select, bump version, record history.
            // Reusing the toolbar's exported factories keeps defaults
            // (color/size/font) identical between mouse and keyboard paths.
            onSpawnRect: () => {
              const obj = spawnRectObj(canvas);
              canvas.add(obj);
              handleLayerAdded(obj);
              history.record?.();
            },
            onSpawnCircle: () => {
              const obj = spawnCircleObj(canvas);
              canvas.add(obj);
              handleLayerAdded(obj);
              history.record?.();
            },
            onSpawnLine: () => {
              const obj = spawnLineObj(canvas);
              canvas.add(obj);
              handleLayerAdded(obj);
              history.record?.();
            },
            onSpawnText: () => {
              const obj = spawnTextObj(canvas);
              canvas.add(obj);
              handleLayerAdded(obj);
              history.record?.();
            },
          });
          if (toolsConsumed) {
            e.preventDefault();
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleDeleteSelection,
    handleDuplicateSelection,
    history,
    // why: Tools-shortcut deps. toolMode changes on every Draw/Select
    // toggle so we re-attach the listener — that's the cheap way to
    // ensure the closure inside `onKey` always sees the latest tool
    // state when Esc fires.
    handleLayerAdded,
    toolMode,
    setToolMode,
  ]);

  // -------------------------------------------------------------------------
  // Selected-layer-derived computed values for the toolbar
  // -------------------------------------------------------------------------
  const selectedEntry = useMemo<LayerEntry | null>(() => {
    if (!selection.layerId) return null;
    return layerEntries.find((l) => l.id === selection.layerId) ?? null;
  }, [layerEntries, selection.layerId]);

  // why: Phase 2 — derive SelectionMode from selection + entry kind. Drives
  // which panel renders on the right side: "none" → LayerListPanel,
  // "text"/"image"/"shape" → SelectionPropertiesPanel with that mode,
  // "multi" → SelectionPropertiesPanel with multi stub.
  const selectionMode = useMemo<SelectionMode>(() => {
    if (selection.isMulti) return "multi";
    if (!selectedEntry) return "none";
    if (selectedEntry.kind === "text") return "text";
    if (selectedEntry.kind === "image") return "image";
    if (selectedEntry.kind === "shape") return "shape";
    return "none";
  }, [selection.isMulti, selectedEntry]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const effectiveSaving = isSaving || isLocalSaving;

  return (
    <div className="flex h-full w-full flex-col bg-neutral-50">
      {/* ----- Header — Canva-style 48px translucent compact bar -----
          why: drop from the prior ~56-72px chunky header to a tight 48px
          bar that feels closer to the Canva editor chrome. Title +
          listing/dimensions live on one row, separated by a 4px dot. The
          right cluster condenses to Resize / Save / Close with tighter
          gaps. Translucent (bg-white/95 + backdrop-blur) gives a hint of
          depth without competing with the canvas as the focal point. */}
      <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* why: small file-icon glyph anchors the title block — same visual
              affordance Canva uses at the leftmost edge of its top bar. */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500">
            <FileGlyphIcon />
          </span>
          <span className="truncate text-[13px] font-semibold text-neutral-900">
            {template.name}
          </span>
          {/* why: 4px dot separator (Canva's pattern). The dot is neutral-300
              so it reads as a passive separator, not a brand accent. */}
          <span
            aria-hidden="true"
            className="inline-block h-1 w-1 shrink-0 rounded-full bg-neutral-300"
          />
          <span className="truncate text-[11px] text-neutral-500">
            {listing.addressLine1 ?? listing.mlsNumber}
            <span className="mx-1.5 text-neutral-300">·</span>
            {template.width}×{template.height}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Phase 4 — Smart Resize. Sits left of Save so the reading order
              is "I want to change the format → I want to save." Renders only
              when the parent has wired the onResize callback; non-resize
              consumers (future template-author mode) hide the affordance. */}
          {onResize ? (
            <ResizeMenu
              currentFormat={template.format}
              options={buildResizeMenuOptions(
                template.category,
                template.variant,
                template.format,
              )}
              onPick={handleResizePicked}
            />
          ) : null}
          {/* Part 2 (Phase D) — "+ Reel" companion entry point. Sits left
              of Save Post so the user's eye reaches it on the way to the
              save action — and so the cluster reads as "Save OR also
              make a Reel from this." Hidden when the parent didn't wire
              `onMakeReel` (e.g., template-author embeds). */}
          {onMakeReel ? (
            <button
              type="button"
              onClick={onMakeReel}
              disabled={effectiveSaving}
              aria-label="Make a Reel from this listing"
              title="Open Reel Studio for this listing"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-[13px] font-medium text-neutral-800 shadow-sm transition-colors hover:border-gold-400 hover:bg-gold-50 hover:text-gold-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
                <path d="M7 6.5l3 1.5-3 1.5z" fill="currentColor" />
              </svg>
              + Reel
            </button>
          ) : null}
          {/* "Save as Template" — secondary, sits left of the primary Save
              Post action. Rendered only when the parent wired
              `onSaveAsTemplate` (typically the main Post Builder page; the
              template-author / standalone embeds omit it). The button uses
              the same h-8 chrome as +Reel / Resize so the cluster reads
              uniform. */}
          {onSaveAsTemplate ? (
            <button
              type="button"
              onClick={() => setSaveAsTemplateModalOpen(true)}
              disabled={effectiveSaving || dimensionWarning !== null}
              aria-label={
                customTemplate
                  ? `Update template ${customTemplate.name}`
                  : "Save current canvas as a reusable template"
              }
              title={
                customTemplate
                  ? `Update “${customTemplate.name}”`
                  : "Save as Template"
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-[13px] font-medium text-neutral-800 shadow-sm transition-colors hover:border-gold-400 hover:bg-gold-50 hover:text-gold-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* lucide BookmarkPlus */}
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                <line x1="12" y1="7" x2="12" y2="13" />
                <line x1="9" y1="10" x2="15" y2="10" />
              </svg>
              {customTemplate ? "Update template" : "Save as Template"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExport}
            disabled={effectiveSaving || dimensionWarning !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gold-500 px-3 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {effectiveSaving ? (
              <span className="flex items-center gap-1.5">
                <SpinnerIcon />
                Saving…
              </span>
            ) : (
              <>
                <SaveIcon />
                {saveLabel ?? "Save Post"}
              </>
            )}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              title="Close editor"
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
        {/* why: subtle inner shadow on the bottom edge sells the elevation —
            cheap depth cue without a heavy shadow bleeding onto the canvas
            area. Pure decorative span absolutely positioned at the bottom. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-b from-transparent to-black/[0.04]"
        />
      </header>

      {/* ----- Body ----- */}
      <div className="flex min-h-0 flex-1">
        {/* === Phase 3 — Left sidebar (icon rail + expanding panel) ===
            why: Canva-style vertical icon dock — the 64px rail is always
            visible; the 280px panel slides out next to it for the active
            tab. Clicking the active tab's icon collapses the panel back
            to just the rail so Larissa can reclaim canvas space. ADHD
            principle: one decision per screen — the rail stays as the
            navigation anchor, the panel content swaps without changing
            the rest of the page. */}
        <aside className="flex shrink-0 border-r border-neutral-200 bg-white">
          {/* Icon rail — 64px wide, always visible. why: a constant
              spatial anchor lets the user predict where their nav lives
              regardless of which panel happens to be open or collapsed. */}
          <nav
            aria-label="Editor sidebar"
            className="flex w-16 shrink-0 flex-col items-stretch border-r border-neutral-200 bg-white py-2"
          >
            <SidebarRailButton
              label="Templates"
              icon={<TemplatesTabIcon />}
              active={sidebarExpanded && sidebarTab === "templates"}
              onClick={() => {
                if (sidebarExpanded && sidebarTab === "templates") {
                  setSidebarExpanded(false);
                } else {
                  setSidebarTab("templates");
                  setSidebarExpanded(true);
                }
              }}
            />
            <SidebarRailButton
              label="Brand"
              icon={<BrandTabIcon />}
              active={sidebarExpanded && sidebarTab === "brand"}
              onClick={() => {
                if (sidebarExpanded && sidebarTab === "brand") {
                  setSidebarExpanded(false);
                } else {
                  setSidebarTab("brand");
                  setSidebarExpanded(true);
                }
              }}
            />
            <SidebarRailButton
              label="Agents"
              icon={<AgentTabIcon />}
              active={sidebarExpanded && sidebarTab === "agents"}
              onClick={() => {
                if (sidebarExpanded && sidebarTab === "agents") {
                  setSidebarExpanded(false);
                } else {
                  setSidebarTab("agents");
                  setSidebarExpanded(true);
                }
              }}
            />
            <SidebarRailButton
              label="Photos"
              icon={<PhotosTabIcon />}
              active={sidebarExpanded && sidebarTab === "photos"}
              onClick={() => {
                if (sidebarExpanded && sidebarTab === "photos") {
                  setSidebarExpanded(false);
                } else {
                  setSidebarTab("photos");
                  setSidebarExpanded(true);
                }
              }}
            />
            {/* Tools tab — Canva-parity Draw/Shapes/Lines/Text popout.
                Lives at the BOTTOM of the rail (matches Canva's placement)
                so it doesn't push the established Templates/Brand/Agents/
                Photos rhythm. */}
            <SidebarRailButton
              label="Tools"
              icon={<ToolsTabIcon />}
              active={sidebarExpanded && sidebarTab === "tools"}
              onClick={() => {
                if (sidebarExpanded && sidebarTab === "tools") {
                  setSidebarExpanded(false);
                  // why: collapsing the Tools panel must also exit Draw
                  // mode — otherwise the user has no visible affordance
                  // explaining why their clicks are now painting.
                  setToolMode("select");
                } else {
                  setSidebarTab("tools");
                  setSidebarExpanded(true);
                }
              }}
            />
          </nav>

          {/* Expanded panel — 280px wide, only when sidebarExpanded.
              Existing panel components (TemplatesPanel / BrandPanel /
              AgentPanel / PhotosPanel) render unmodified inside this
              container — they were already authored for ~280px width. */}
          {sidebarExpanded ? (
            <div className="flex w-[280px] shrink-0 flex-col bg-white">
              {/* Collapse cap — title of the active tab + « collapse button.
                  why: the panel title doubles as a sense-of-place label
                  for users who collapse + re-expand frequently. The «
                  affordance mirrors the » on the right panel for
                  symmetry. */}
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 px-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {sidebarTab === "templates"
                    ? "Templates"
                    : sidebarTab === "brand"
                      ? "Brand"
                      : sidebarTab === "agents"
                        ? "Agents"
                        : sidebarTab === "photos"
                          ? "Photos"
                          : "Tools"}
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarExpanded(false)}
                  aria-label="Collapse panel"
                  title="Collapse panel"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <ChevronDoubleLeftIcon />
                </button>
              </div>
              {/* Active panel — render only the visible one. why: keeps
                  per-render work + network fetch surface scoped to what
                  the user is actually looking at. */}
              <div className="min-h-0 flex-1 overflow-hidden">
                {sidebarTab === "templates" ? (
                  <TemplatesPanel
                    templates={CANVAS_TEMPLATES}
                    currentTemplateId={template.id}
                    currentFormat={template.format}
                    hasUnsavedEdits={history.canUndo}
                    onTemplatePicked={handleTemplatePicked}
                  />
                ) : sidebarTab === "brand" ? (
                  <BrandPanel
                    assets={brandAssets.filter(
                      (a) => a.kind === "logo" || a.kind === "partner_logo",
                    )}
                    isLoading={brandAssetsLoading}
                    onAssetPicked={(a) => void handleSidebarAssetPicked(a)}
                    onSync={handleSyncBrandAssets}
                    syncStatus={brandSyncStatus}
                    isAdmin={props.isAdmin}
                    onUploadAsset={props.onUploadBrandAsset}
                    onArchiveAsset={props.onArchiveBrandAsset}
                  />
                ) : sidebarTab === "agents" ? (
                  <AgentPanel
                    assets={brandAssets.filter(
                      (a) => a.kind === "agent_headshot",
                    )}
                    offices={officesForFilter}
                    defaultOfficeId={null}
                    isLoading={brandAssetsLoading}
                    onAssetPicked={(a) => void handleSidebarAssetPicked(a)}
                    onSync={handleSyncBrandAssets}
                    syncStatus={brandSyncStatus}
                  />
                ) : sidebarTab === "photos" ? (
                  <PhotosPanel
                    photos={listingPhotos}
                    isLoading={listingPhotosLoading}
                    onPhotoPicked={(p) => void handleListingPhotoPicked(p)}
                  />
                ) : (
                  <ToolsPanel
                    canvas={fabricRef.current}
                    activeTool={toolMode}
                    onToolChange={setToolMode}
                    onLayerAdded={handleLayerAdded}
                    recordHistory={history.record}
                  />
                )}
              </div>
            </div>
          ) : null}
        </aside>

        {/* === Center column — canvas area + footer ===
            why: stacked into its own flex-col so the canvas footer
            (zoom + undo/redo + alignment) sits inside the same column
            as the canvas itself, regardless of right-panel state. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Canvas area — gets the soft radial background + dot pattern.
              why: a barely-perceptible radial gradient draws the eye
              inward to the canvas; the white-card-on-soft-gray pattern
              is Canva's primary visual cue that "this is your canvas."
              The dot-pattern SVG is rendered at 4% opacity so it adds
              texture without competing for attention. */}
          <div
            className="relative flex flex-1 flex-col items-center justify-center overflow-auto p-6"
            style={{
              backgroundImage: `radial-gradient(ellipse at center, #fafafa 0%, #f5f5f5 100%), url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='1' cy='1' r='1' fill='%23a3a3a3' fill-opacity='0.04'/></svg>")`,
              backgroundSize: "100% 100%, 24px 24px",
            }}
          >
            {/* Phase B.6 — autosave restore banner. Renders only when we
                detected a recent localStorage autosave for this (template,
                mls) pair AND the user hasn't dismissed it yet. Non-blocking;
                shown above the AddLayerToolbar so it's noticeable but not
                in the canvas chrome. */}
            {pendingAutosave && !autosaveBannerDismissed ? (
              <div className="mb-3 flex w-full max-w-2xl items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 shadow-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.75}
                    stroke="currentColor"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="truncate">
                    Unsaved changes from{" "}
                    <strong className="font-semibold">
                      {formatAutosaveAge(pendingAutosave.savedAt)}
                    </strong>{" "}
                    — restore them?
                  </span>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={handleRestoreAutosave}
                    className="rounded-md bg-amber-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-950"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardAutosave}
                    className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}

            {/* Phase 2 — Add Layer Toolbar (always visible, top of canvas area).
                why: primary creation affordance — adding text/shape layers is
                one of the top-3 things Larissa will do once Phase 2 ships. */}
            <div className="mb-4 flex w-full justify-center">
              <AddLayerToolbar
                canvas={fabricRef.current}
                listing={listing}
                onLayerAdded={handleLayerAdded}
                recordHistory={history.record}
              />
            </div>
            {/* Phase B.2 — floating chrome above the canvas. Two stacked
                bars: contextual content controls (top) + structural ops
                (bottom). The wrapper owns positioning so both bars share
                the same horizontal anchor; either child can be null
                (image mode hides the contextual row; multi mode hides
                the structural row since there's no single layer-name to
                display). */}
            {(selectedEntry && !selectedEntry.locked) ||
            (selection.isMulti && selection.count > 0) ? (
              <div className="absolute top-6 z-10 flex flex-col items-center gap-2">
                {(selectionMode === "text" ||
                  selectionMode === "shape" ||
                  selectionMode === "multi") &&
                fabricRef.current ? (
                  <ContextualTopToolbar
                    canvas={fabricRef.current}
                    mode={selectionMode}
                    selectionVersion={layerVersion}
                    selectionCount={selection.count}
                    onCanvasMutated={() => setLayerVersion((v) => v + 1)}
                    recordHistory={history.record}
                    onAlign={handleAlign}
                  />
                ) : null}
                {selectedEntry && !selectedEntry.locked ? (
                  <SelectionToolbar
                    onDelete={handleDeleteSelection}
                    onBringForward={handleBringForward}
                    onSendBackward={handleSendBackward}
                    onToggleLock={handleToggleLock}
                    onDuplicate={() => void handleDuplicateSelection()}
                    layerName={selectedEntry.name}
                    layerKind={selectedEntry.kind}
                    canvas={fabricRef.current}
                    selectionVersion={layerVersion}
                    onOpacityCommit={history.record}
                    onCanvasMutated={() => setLayerVersion((v) => v + 1)}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Dimension warning — blocks export when template is malformed */}
            {dimensionWarning ? (
              <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 shadow-card">
                {dimensionWarning}
              </div>
            ) : null}

            {/* Non-blocking error toast */}
            {editorError ? (
              <div className="absolute bottom-6 left-1/2 z-20 max-w-[80%] -translate-x-1/2 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-700 shadow-elevated">
                <div className="flex items-start gap-3">
                  <span className="font-semibold uppercase tracking-wide">
                    {editorError.kind === "export" ? "Export" : "Warning"}
                  </span>
                  <span className="flex-1">{editorError.message}</span>
                  <button
                    type="button"
                    onClick={() => setEditorError(null)}
                    aria-label="Dismiss error"
                    className="text-neutral-400 hover:text-neutral-700"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            ) : null}

            {/* The actual canvas, scaled via CSS transform.
                why: `displayScale` fits the canvas to the viewport;
                `zoom` is the user's multiplier on top of that. We
                multiply the two for the outer dimensions so the
                container sizes correctly and the canvas stays
                centered as zoom changes. Soft Canva-style drop
                shadow (low + blurred) sells "this is a card on a
                surface" without competing with the canvas content. */}
            <div
              className="relative bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
              style={{
                width: template.width * displayScale * zoom,
                height: template.height * displayScale * zoom,
              }}
            >
              <div
                style={{
                  width: template.width,
                  height: template.height,
                  transform: `scale(${displayScale * zoom})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              >
                <canvas ref={canvasRef} />
              </div>
            </div>
          </div>

          {/* === Canvas footer — alignment / zoom / undo+redo === */}
          <CanvasFooter
            // why: Phase B.1 — alignment is live. Show the cluster whenever
            // any selection exists (single OR multi). A locked single
            // object still hides alignment because moving a locked layer
            // would silently violate the lock contract. Multi-selection
            // shows the cluster even if individual children are locked;
            // Fabric's per-object lockMovement guards prevent those rows
            // from moving during the multi-align pass.
            showAlignment={
              selection.count > 0 &&
              (selection.isMulti || (selectedEntry !== null && !selectedEntry.locked))
            }
            canDistribute={selection.count >= 3}
            onAlign={handleAlign}
            zoom={zoom}
            onZoomIn={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
            onZoomOut={() =>
              setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))
            }
            onZoomFit={() => setZoom(1)}
            onZoomChange={(z) =>
              // why: clamp to the same range the +/- buttons use so the
              // slider can never drive zoom out-of-bounds even if the
              // <input> step config drifts later.
              setZoom(Math.max(0.25, Math.min(2, +z.toFixed(2))))
            }
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => history.undo()}
            onRedo={() => history.redo()}
          />
        </div>

        {/* === Right-side panel — Layers / Selection-properties with collapse rail ===
            why: ADHD principle — preserve scroll position + minimize
            context-switching. Collapsing to a 48px rail keeps the panel
            spatially anchored while giving the canvas more room. The
            inner panel content (LayerListPanel / SelectionPropertiesPanel)
            is unchanged from before — we only wrap their <aside> shell
            with the collapse affordance + width adjustment. */}
        {layersExpanded ? (
          <div className="flex w-[280px] shrink-0 flex-col border-l border-neutral-200 bg-white">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {selectionMode === "none" ? "Layers" : "Properties"}
              </span>
              <button
                type="button"
                onClick={() => setLayersExpanded(false)}
                aria-label="Collapse layers panel"
                title="Collapse layers panel"
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              >
                <ChevronDoubleRightIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {/* why: the inner panels supply their own <aside> with
                  border-l + w-72. To avoid a double border + a fixed
                  width fighting our parent, we wrap them in a
                  full-width container and let our parent govern the
                  width. Inner components were already authored to be
                  full-height inside their flex parent. */}
              <div className="flex h-full w-full flex-col [&>aside]:w-full [&>aside]:border-l-0">
                {selectionMode === "none" ? (
                  <LayerListPanel
                    entries={layerEntries}
                    selectedLayerId={selection.layerId}
                    onSelect={handleSelectLayer}
                    onToggleVisibility={handleToggleLayerVisibility}
                    onDelete={handleDeleteLayer}
                    onReorder={handleReorderLayers}
                    onHoverEntry={handleHoverEntry}
                  />
                ) : (
                  <SelectionPropertiesPanel
                    mode={selectionMode}
                    canvas={fabricRef.current}
                    listing={listing}
                    selectionVersion={layerVersion}
                    onCanvasMutated={() => setLayerVersion((v) => v + 1)}
                    onClearSelection={handleClearSelection}
                    recordHistory={history.record}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          // why: collapsed rail — single 48px column with a Layers icon
          // that acts as the expand affordance. Vertical-label keeps the
          // rail readable when shut.
          <div className="flex w-12 shrink-0 flex-col border-l border-neutral-200 bg-white">
            <button
              type="button"
              onClick={() => setLayersExpanded(true)}
              aria-label="Expand layers panel"
              title="Expand layers panel"
              className="group flex h-12 w-full items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <LayersStackIcon />
            </button>
          </div>
        )}
      </div>

      {/* === Phase 5 — Carousel strip ===
          why: rendered below the main flex row (canvas + sidebars) so it
          spans the full editor width as a fixed-height tray. The strip
          mounts only when a parent has wired the `carousel` prop AND the
          current format is feed-eligible (not Story 9:16, unless the
          caller explicitly opted in via `enabledOnStory`).

          Feed carousels are the IG/FB use case; Story carousels are a
          different platform feature with a separate API path. We hide
          the strip on Story to avoid surfacing an affordance that can't
          publish through the existing `publish.ts` code path. */}
      {carousel && (template.format !== "story_9x16" || carousel.enabledOnStory) ? (
        <CarouselStrip
          slides={carousel.slides}
          heroFormat={template.format}
          onSlidesChanged={carousel.onSlidesChanged}
          onAddSlideClick={() => setCarouselPickerOpen(true)}
          onPreviewClick={() => setCarouselPreviewOpen(true)}
          // why: forward Multi-OH per-slide-edit hook through to the strip.
          // Strip renders the pencil affordance only when this is defined,
          // so non-multi-OH posts (single-listing carousels) still show
          // just the X-to-remove.
          onSlideEditClick={carousel.onSlideEditClick}
        />
      ) : null}

      {/* === Phase 5 — Carousel slide picker (modal) === */}
      {carousel ? (
        <CarouselSlidePicker
          open={carouselPickerOpen}
          photos={carousel.availableListingPhotos}
          existingSlides={carousel.slides}
          maxSlides={10}
          onAdd={handleCarouselPickerAdd}
          onCancel={() => setCarouselPickerOpen(false)}
        />
      ) : null}

      {/* === Phase 5 — Carousel preview overlay === */}
      {carousel ? (
        <CarouselPreview
          open={carouselPreviewOpen}
          heroUrl={carousel.heroImageUrl}
          slides={carousel.slides}
          heroFormat={template.format}
          onClose={() => setCarouselPreviewOpen(false)}
        />
      ) : null}

      {/* === Custom Template — Save as Template modal ===
          Renders ABOVE the editor (z-[60] vs z-50) so the launcher button
          in the header can keep its focus ring; the modal grabs focus on
          mount. Only mounted when (a) the parent wired onSaveAsTemplate
          and (b) the user opened it via the header button. */}
      {onSaveAsTemplate && saveAsTemplateModalOpen ? (
        <SaveAsTemplateModal
          variantDisplayName={
            VARIANT_DISPLAY_NAMES[template.variant] ?? template.variant
          }
          postTypeDisplayName={
            POST_TYPE_DISPLAY_NAMES[template.category] ?? template.category
          }
          formatDisplayName={
            FORMAT_DISPLAY_NAMES[template.format] ?? template.format
          }
          postType={template.category}
          format={template.format}
          basedOnVariant={template.variant}
          existingTemplateId={customTemplate?.id ?? null}
          existingName={customTemplate?.name}
          existingIsDefault={customTemplate?.isDefault}
          getCanvasState={getCanvasStateForTemplate}
          onSubmit={async (input) => {
            const res = await onSaveAsTemplate(input);
            return res;
          }}
          onSaved={() => {
            setSaveAsTemplateModalOpen(false);
          }}
          onClose={() => setSaveAsTemplateModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ===========================================================================
// SECTION 4 — Subcomponents
// ===========================================================================

interface SelectionToolbarProps {
  onDelete: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  layerName: string;
  layerKind: CanvasLayer["kind"];
  /** Canvas instance — used by the Transparency popover to read/write opacity. */
  canvas: Canvas | null;
  /** Forces the transparency popover to re-read opacity when the parent's selection state changes. */
  selectionVersion: number;
  /** Called once after the user releases the opacity slider so the undo stack captures one entry instead of dozens. */
  onOpacityCommit?: () => void;
  /** Called whenever opacity mutates so the layer panel / version counter refresh. */
  onCanvasMutated?: () => void;
}

function SelectionToolbar(props: SelectionToolbarProps): JSX.Element {
  // why: Phase B.2 — positioning moved to a parent wrapper that stacks
  // SelectionToolbar below ContextualTopToolbar. This element is now a
  // plain inline-flex bar; the wrapper handles top-6 / centering / z-10.
  return (
    <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-elevated animate-fade-in-up">
      <span className="ml-2 mr-3 truncate text-xs font-medium text-neutral-600">
        {props.layerName}
      </span>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Bring forward" onClick={props.onBringForward}>
        <BringForwardIcon />
      </IconButton>
      <IconButton label="Send backward" onClick={props.onSendBackward}>
        <SendBackwardIcon />
      </IconButton>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Duplicate" onClick={props.onDuplicate}>
        <DuplicateIcon />
      </IconButton>
      {/* === Transparency — opens a portaled popover with an opacity slider.
          why: matches Canva's selection-toolbar pattern; quick access without
          having to navigate into the right-side properties panel. */}
      <TransparencyButton
        canvas={props.canvas}
        selectionVersion={props.selectionVersion}
        onCanvasMutated={props.onCanvasMutated}
        onCommit={props.onOpacityCommit}
      />
      <IconButton label="Lock" onClick={props.onToggleLock}>
        <LockIcon />
      </IconButton>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Delete" onClick={props.onDelete} variant="danger">
        <TrashIcon />
      </IconButton>
    </div>
  );
}

// ===========================================================================
// TransparencyButton — toolbar trigger + portaled popover with opacity slider
// ===========================================================================
//
// Why a separate subcomponent rather than inline:
//   • Owns the open/close state + the popover's getBoundingClientRect math
//     locally; SelectionToolbar stays presentational.
//   • Uses the same Portal + position:fixed pattern as the ColorPicker —
//     escapes the canvas's transform-stacking context so the popover paints
//     above the canvas instead of behind it.
//
// Fabric's opacity is a 0..1 float. The UI works in 0..100 (percent) because
// that's how Canva does it and how the user thinks about it.

interface TransparencyButtonProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  onCommit?: () => void;
}

function TransparencyButton(
  props: TransparencyButtonProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, onCommit } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // why: read the active object's opacity each time the selection or version
  // changes. If the user changes selection while the popover is open, the
  // slider snaps to the new layer's value instead of stale state.
  const initialOpacity = useMemo<number>(() => {
    if (!canvas) return 100;
    const active = canvas.getActiveObject();
    if (!active) return 100;
    const raw = active.opacity;
    if (typeof raw !== "number") return 100;
    return Math.round(raw * 100);
  }, [canvas, selectionVersion, open]);

  const [opacityPct, setOpacityPct] = useState<number>(initialOpacity);
  useEffect(() => {
    setOpacityPct(initialOpacity);
  }, [initialOpacity]);

  // Position popover under the trigger button — viewport-clamped.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const POPOVER_WIDTH = 240;
    const GAP = 8;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + GAP;
    // Center the popover horizontally on the trigger button.
    let left =
      rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    if (left < GAP) left = GAP;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - GAP;
    if (left > maxLeft) left = maxLeft;
    setPopoverPos({ top, left });
  }, [open]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const pct = Number(e.target.value);
    if (!Number.isFinite(pct)) return;
    setOpacityPct(pct);
    const active = canvas?.getActiveObject();
    if (!active) return;
    // why: write through directly on every tick for live preview. The
    // history snapshot fires onMouseUp via onCommit — keeps undo stack
    // clean (one entry per gesture, not 100 per slider drag).
    active.set({ opacity: pct / 100 });
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleSliderCommit = (): void => {
    onCommit?.();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Transparency"
        title="Transparency"
        className={`rounded-md p-1.5 transition-colors ${
          open
            ? "bg-gold-50 text-gold-700"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <TransparencyIcon />
      </button>
      {open && popoverPos
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                width: 240,
              }}
              className="z-[100] rounded-xl border border-neutral-200 bg-white p-3 shadow-elevated animate-fade-in-up"
              role="dialog"
              aria-label="Transparency"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Transparency
                </span>
                <span className="font-mono text-xs text-neutral-700">
                  {opacityPct}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={opacityPct}
                onChange={handleSliderChange}
                onMouseUp={handleSliderCommit}
                onTouchEnd={handleSliderCommit}
                onKeyUp={handleSliderCommit}
                className="w-full accent-gold-500"
                aria-label="Opacity 0 to 100 percent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function TransparencyIcon(): JSX.Element {
  // why: classic checkerboard pattern signifying "transparency" — same
  // visual language as Canva, Figma, Photoshop's transparency indicator.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect x="3" y="3" width="2.5" height="2.5" fill="currentColor" />
      <rect x="8" y="3" width="2.5" height="2.5" fill="currentColor" />
      <rect x="5.5" y="5.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="10.5" y="5.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="3" y="8" width="2.5" height="2.5" fill="currentColor" />
      <rect x="8" y="8" width="2.5" height="2.5" fill="currentColor" />
      <rect x="5.5" y="10.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="10.5" y="10.5" width="2.5" height="2.5" fill="currentColor" />
    </svg>
  );
}

// why: the inline LayerPanel was removed in Phase 2 — replaced by
// ./panels/LayerListPanel.tsx (Agent C) which adds drag-to-reorder via
// @dnd-kit/sortable while preserving all the original row interactions.

interface IconButtonProps {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  children: React.ReactNode;
}

function IconButton(props: IconButtonProps): JSX.Element {
  const danger = props.variant === "danger";
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      className={`rounded-md p-1.5 transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      }`}
    >
      {props.children}
    </button>
  );
}

function LayerKindIcon({ kind }: { kind: CanvasLayer["kind"] }): JSX.Element {
  // why: visual cue in the layer panel so the user can scan kind at a glance.
  // Tiny 14px SVGs match the panel's row height without adding visual noise.
  switch (kind) {
    case "text":
      return <TextIcon />;
    case "image":
      return <ImageIcon />;
    case "shape":
      return <ShapeIcon />;
    case "group":
      return <GroupIcon />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// ===========================================================================
// SECTION 5 — Inline SVG icons
// ===========================================================================
//
// Why inline SVG instead of a lib like lucide:
//   • lucide-react isn't installed in this project (verified at build time).
//   • Adding a 50KB icon dependency just for Phase 1 isn't justified — Phase 4
//     (Brand panel + Uploads panel) is where icon variety actually matters.
//     If/when we add lucide, replace these. The interfaces won't change.
//   • These icons use currentColor so they inherit text color from Tailwind
//     classes on the parent — no per-icon color prop needed.
//
// All icons follow the Heroicons-mini conventions: 16×16 viewBox, 1.5 stroke.
// ---------------------------------------------------------------------------

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function SaveIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M5 3v4h5V3" />
      <path d="M5 11h6" />
    </svg>
  );
}

function SpinnerIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.25"
        fill="none"
      />
      <path
        d="M14 8a6 6 0 0 1-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L11 4" />
    </svg>
  );
}

function BringForwardIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="9" height="9" rx="1" />
      <rect
        x="2"
        y="5"
        width="9"
        height="9"
        rx="1"
        fill="white"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendBackwardIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="9" height="9" rx="1" />
      <rect
        x="5"
        y="2"
        width="9"
        height="9"
        rx="1"
        fill="white"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DuplicateIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="9" height="9" rx="1" />
      <path d="M3 5v8a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5A2 2 0 0 0 8 10a2 2 0 0 0 1.5-.6" />
      <path d="M3 8s1-2 3-3.5M13 8s-1 2-3 3.5M1 8s2.5-5 7-5c1 0 1.9.2 2.7.5" />
    </svg>
  );
}

function TextIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 4V3h10v1M8 3v10M6 13h4" />
    </svg>
  );
}

function ImageIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M3 12l3-3 2 2 3-4 4 5" />
    </svg>
  );
}

function ShapeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <circle cx="11" cy="11" r="3" />
    </svg>
  );
}

function GroupIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="6" y="6" width="8" height="8" rx="1" />
    </svg>
  );
}

// why: Phase 3 — brand-tab icon. Abstract "building / brand mark" glyph.
// why: Phase 4 — Smart Resize. Build the menu option list for the current
// (category, variant) tuple, checking the registry to mark each target
// format as available or disabled. Disabled = no canvas template exists
// for the (category, variant, target format) tuple — typically because a
// variant only ships at 2 of 3 formats during an in-progress factory port.
// Keeps the menu honest: we never let the user pick an option that would
// fail in `handleResizePicked`'s `findCanvasTemplate` lookup.
function buildResizeMenuOptions(
  category: CanvasTemplateSchema["category"],
  variant: CanvasTemplateSchema["variant"],
  currentFormat: PostFormat,
): readonly ResizeMenuOption[] {
  const allFormats: readonly PostFormat[] = [
    "portrait_4x5",
    "story_9x16",
  ];
  return allFormats.map((f) => {
    if (f === currentFormat) {
      // why: current format is omitted by the menu itself, but we include
      // it in the array so the menu's filter is the single source of
      // truth about "what's visible." Marking available=true keeps the
      // shape uniform.
      return { format: f, available: true };
    }
    const t = findCanvasTemplate(category, variant, f);
    if (t) return { format: f, available: true };
    return {
      format: f,
      available: false,
      disabledReason: `No ${variant} template at this aspect ratio yet — port pending.`,
    };
  });
}

// why: Phase 4 — templates-tab icon. 2×2 grid glyph reads as "a set of
// templates to choose from" — the canonical design-tool affordance, used
// by Canva / Figma / Adobe Express for the same panel.
function TemplatesTabIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function BrandTabIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 14h12" />
      <path d="M3 14V6l5-3 5 3v8" />
      <path d="M6 14v-4h4v4" />
    </svg>
  );
}

// why: Phase 3 — agents-tab icon. Person / user silhouette.
function AgentTabIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
    </svg>
  );
}

// why: photos-tab icon. Stack-of-photos silhouette so it reads "more than
// one image" without competing with the brand/agent glyphs above.
function PhotosTabIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="9" height="9" rx="1" />
      <path d="M2 11V3a1 1 0 011-1h8" />
    </svg>
  );
}

// Tools tab — Canva-parity Draw / Shapes / Lines / Text panel.
// why: a pencil-on-paper glyph reads as both "draw" and "tools" at
// rail size. Matches the visual language of Canva's bottom-of-rail
// "Tools" icon without being a literal copy.
function ToolsTabIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13l8.5-8.5 2 2L5 15H3v-2z" />
      <path d="M10.5 5.5l2 2" />
    </svg>
  );
}

// ===========================================================================
// SECTION 6 — Canva-style chrome subcomponents (Phase A.4 redesign)
// ===========================================================================
//
// SidebarRailButton: a single rail entry in the 64px vertical icon dock.
// Renders a 24px icon centered above a 10px label. Active state shows a
// gold-50 background, gold-700 text, and a 3px gold-500 left-border bar
// that visually attaches the button to the rail's edge — exactly the
// Canva pattern. Inactive state is muted neutral-600 with a soft hover.
// ---------------------------------------------------------------------------

interface SidebarRailButtonProps {
  label: string;
  icon: JSX.Element;
  active: boolean;
  onClick: () => void;
}

/**
 * One entry in the left icon rail. Vertically stacks a 24px icon over a
 * 10px label, both centered horizontally. The 3px gold-500 stripe on the
 * left edge anchors the active state to the rail (Canva pattern).
 */
function SidebarRailButton(props: SidebarRailButtonProps): JSX.Element {
  const { label, icon, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`relative flex h-14 w-full flex-col items-center justify-center gap-0.5 transition-colors ${
        active
          ? "bg-gold-50 text-gold-700"
          : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {/* why: 3px gold-500 stripe pinned to the LEFT edge of the rail
          (the rail's outer edge faces the viewport). Renders only on
          the active row. Visually attaches the active state to the
          rail's boundary — matches Canva's pattern. */}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-sm bg-gold-500"
        />
      ) : null}
      {/* why: scale the existing 14px tab icons up to ~22px for the rail
          via an inline style — the rail icons read MUCH bigger than the
          old text-tab icons, so we re-use the same SVGs but project them
          at a larger render size. Keeps the icon set single-sourced. */}
      <span
        className="flex items-center justify-center"
        style={{ width: 22, height: 22 }}
      >
        <span className="scale-150">{icon}</span>
      </span>
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CanvasFooter — 40px bottom bar with alignment / zoom / undo + redo
// ---------------------------------------------------------------------------
//
// Layout: three-cluster flex row. Left = alignment (UI-only for now —
// per Phase A.4 spec, wiring the alignment math is Phase B work).
// Center = zoom controls ([-] 100% [+] Fit). Right = undo / redo wired
// to the existing useUndoRedoHistory hook.
//
// Buttons are 28×28 square, icon-only, hover:bg-neutral-100. Tooltips
// via title attribute (matches existing IconButton convention).
// ---------------------------------------------------------------------------

/**
 * Direction tokens the alignment + distribute buttons dispatch. Matches
 * the `AlignDirection` union inside `CanvasEditor.handleAlign` — kept
 * loose-string here so the footer doesn't have to import the inner
 * function-scoped type.
 */
type FooterAlignDirection =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute_horizontal"
  | "distribute_vertical";

interface CanvasFooterProps {
  showAlignment: boolean;
  /** Enables the two Distribute buttons. True when ≥3 objects selected. */
  canDistribute: boolean;
  /** Phase B.1 — invoked from each alignment button. No-op when nothing
   *  is selected (parent guards) or for unsupported single-object
   *  distribute calls. */
  onAlign: (direction: FooterAlignDirection) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  /**
   * Direct setter for the slider drag (2026-05-23, Canva-parity zoom).
   * The +/- buttons keep their own callbacks because they need to clamp/step
   * differently — slider is continuous, buttons are discrete 10% jumps.
   */
  onZoomChange: (next: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Canvas footer — alignment / zoom / undo+redo. Renders below the canvas
 * area, above the carousel strip. 40px tall, white bg, top border.
 */
function CanvasFooter(props: CanvasFooterProps): JSX.Element {
  const zoomPct = Math.round(props.zoom * 100);
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-neutral-200 bg-white px-3">
      {/* === Left cluster — alignment + distribute (Phase B.1 — live) === */}
      <div className="flex items-center gap-0.5">
        {props.showAlignment ? (
          <>
            <FooterIconButton
              label="Align left"
              onClick={() => props.onAlign("left")}
            >
              <AlignLeftIcon />
            </FooterIconButton>
            <FooterIconButton
              label="Align center"
              onClick={() => props.onAlign("center")}
            >
              <AlignCenterIcon />
            </FooterIconButton>
            <FooterIconButton
              label="Align right"
              onClick={() => props.onAlign("right")}
            >
              <AlignRightIcon />
            </FooterIconButton>
            <span className="mx-1 h-4 w-px bg-neutral-200" />
            <FooterIconButton
              label="Align top"
              onClick={() => props.onAlign("top")}
            >
              <AlignTopIcon />
            </FooterIconButton>
            <FooterIconButton
              label="Align middle"
              onClick={() => props.onAlign("middle")}
            >
              <AlignMiddleIcon />
            </FooterIconButton>
            <FooterIconButton
              label="Align bottom"
              onClick={() => props.onAlign("bottom")}
            >
              <AlignBottomIcon />
            </FooterIconButton>
            <span className="mx-1 h-4 w-px bg-neutral-200" />
            {/* Distribute — needs ≥3 objects. Disabled chip stays visible
                so users can discover the feature; the tooltip explains
                the threshold. */}
            <FooterIconButton
              label={
                props.canDistribute
                  ? "Distribute horizontally"
                  : "Distribute horizontally (needs 3+ objects)"
              }
              onClick={() => props.onAlign("distribute_horizontal")}
              disabled={!props.canDistribute}
            >
              <DistributeHorizontalIcon />
            </FooterIconButton>
            <FooterIconButton
              label={
                props.canDistribute
                  ? "Distribute vertically"
                  : "Distribute vertically (needs 3+ objects)"
              }
              onClick={() => props.onAlign("distribute_vertical")}
              disabled={!props.canDistribute}
            >
              <DistributeVerticalIcon />
            </FooterIconButton>
          </>
        ) : null}
      </div>

      {/* === Center cluster — zoom controls (Canva-style slider) ===
          Layout: [-] [slider track] [+] 100% Fit
          The slider is continuous (step 0.05) for smooth dragging;
          the +/- buttons stay as discrete 10% jumps so users with
          keyboard/click muscle memory still get a predictable step. */}
      <div className="flex items-center gap-2">
        <FooterIconButton label="Zoom out" onClick={props.onZoomOut}>
          <ZoomOutIcon />
        </FooterIconButton>
        {/* why: native range input — keeps a11y (keyboard arrows work,
            screen readers announce value%). Custom-styled via a small
            inline style block so the thumb is gold and the track is
            neutral, matching the rest of the editor chrome. */}
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.05}
          value={props.zoom}
          onChange={(e) => props.onZoomChange(Number(e.target.value))}
          aria-label="Canvas zoom"
          title={`Zoom — ${zoomPct}%`}
          className="cwk-zoom-slider h-1 w-[120px] cursor-pointer appearance-none rounded-full bg-neutral-200 accent-gold-500"
        />
        <FooterIconButton label="Zoom in" onClick={props.onZoomIn}>
          <ZoomInIcon />
        </FooterIconButton>
        <span className="min-w-[36px] text-center font-mono text-[11px] tabular-nums text-neutral-600">
          {zoomPct}%
        </span>
        <span className="mx-0.5 h-4 w-px bg-neutral-200" />
        <button
          type="button"
          onClick={props.onZoomFit}
          title="Fit to viewport"
          className="flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Fit
        </button>
      </div>

      {/* === Right cluster — undo / redo === */}
      <div className="flex items-center gap-0.5">
        <FooterIconButton
          label="Undo"
          onClick={props.onUndo}
          disabled={!props.canUndo}
        >
          <UndoIcon />
        </FooterIconButton>
        <FooterIconButton
          label="Redo"
          onClick={props.onRedo}
          disabled={!props.canRedo}
        >
          <RedoIcon />
        </FooterIconButton>
      </div>
    </div>
  );
}

interface FooterIconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * 28×28 icon button used throughout the canvas footer. Hover state is
 * neutral-100 — kept gold-free per the redesign's "reserve gold for
 * brand-accent moments" rule.
 */
function FooterIconButton(props: FooterIconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
    >
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SECTION 7 — Phase A.4 inline icons (file glyph, chevrons, zoom, undo, align)
// ---------------------------------------------------------------------------

function FileGlyphIcon(): JSX.Element {
  // why: small document glyph in the header — Canva's leftmost item is the
  // app icon, but here a file glyph reads as "this is the document title."
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M9 2v3h3" />
    </svg>
  );
}

function ChevronDoubleLeftIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4L5 8l4 4M13 4l-4 4 4 4" />
    </svg>
  );
}

function ChevronDoubleRightIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4l4 4-4 4M3 4l4 4-4 4" />
    </svg>
  );
}

function LayersStackIcon(): JSX.Element {
  // why: three stacked layers — the canonical "layers" glyph in design tools.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 2L2.5 6 10 10l7.5-4L10 2z" />
      <path d="M2.5 10L10 14l7.5-4" />
      <path d="M2.5 14L10 18l7.5-4" />
    </svg>
  );
}

function ZoomInIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3M5 7h4M7 5v4" />
    </svg>
  );
}

function ZoomOutIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3M5 7h4" />
    </svg>
  );
}

function UndoIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h6a3 3 0 0 1 0 6H7" />
      <path d="M6 4L3 7l3 3" />
    </svg>
  );
}

function RedoIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7H6a3 3 0 0 0 0 6h3" />
      <path d="M10 4l3 3-3 3" />
    </svg>
  );
}

// why: alignment icons are pure UI for Phase A.4. The visuals match Canva
// — a baseline + a small rectangle anchored to the relevant edge.
function AlignLeftIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2v12" />
      <rect x="4" y="4" width="9" height="3" />
      <rect x="4" y="9" width="6" height="3" />
    </svg>
  );
}

function AlignCenterIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2v12" />
      <rect x="3.5" y="4" width="9" height="3" />
      <rect x="5" y="9" width="6" height="3" />
    </svg>
  );
}

function AlignRightIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M14 2v12" />
      <rect x="3" y="4" width="9" height="3" />
      <rect x="6" y="9" width="6" height="3" />
    </svg>
  );
}

function AlignTopIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2h12" />
      <rect x="4" y="4" width="3" height="9" />
      <rect x="9" y="4" width="3" height="6" />
    </svg>
  );
}

function AlignMiddleIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 8h12" />
      <rect x="4" y="3.5" width="3" height="9" />
      <rect x="9" y="5" width="3" height="6" />
    </svg>
  );
}

function AlignBottomIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 14h12" />
      <rect x="4" y="3" width="3" height="9" />
      <rect x="9" y="6" width="3" height="6" />
    </svg>
  );
}

// why: distribute icons match Canva's pattern — three small rectangles with
// arrows below (horizontal) or beside (vertical) indicating the axis of
// even spacing. Stroke only, currentColor so the disabled state inherits
// neutral-300 from FooterIconButton.
function DistributeHorizontalIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="4" width="2.5" height="8" />
      <rect x="6.75" y="4" width="2.5" height="8" />
      <rect x="12" y="4" width="2.5" height="8" />
    </svg>
  );
}

function DistributeVerticalIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="4" y="1.5" width="8" height="2.5" />
      <rect x="4" y="6.75" width="8" height="2.5" />
      <rect x="4" y="12" width="8" height="2.5" />
    </svg>
  );
}
