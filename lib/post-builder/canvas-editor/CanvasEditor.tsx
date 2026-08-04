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
// why (2026-05-31): Fabric's optional aligning-guidelines module. Snaps the
// dragged/resized object's edges + centers to other objects and the canvas,
// drawing a guide line while the snap holds. Lets authors drop the Hero Photo
// flush against the header/info bands without hand-pixel-hunting.
import { initAligningGuidelines } from "fabric/extensions";
import {
  AlertTriangle as LAlertTriangle,
  ArrowRight as LArrowRight,
  BookmarkPlus as LBookmarkPlus,
  Check as LCheck,
  ChevronsLeft as LChevronsLeft,
  ChevronsRight as LChevronsRight,
  Eye as LEye,
  Braces as LBraces,
  EyeOff as LEyeOff,
  FileText as LFileText,
  Film as LFilm,
  Image as LImageIcon,
  LayoutGrid as LLayoutGrid,
  Layers as LLayers,
  Loader2 as LLoader2,
  Maximize2 as LMaximize2,
  PencilRuler as LPencilRuler,
  Redo2 as LRedo2,
  Save as LSave,
  Shapes as LShapes,
  Square as LSquare,
  Type as LType,
  Undo2 as LUndo2,
  User as LUser,
  X as LX,
  ZoomIn as LZoomIn,
  ZoomOut as LZoomOut,
} from "lucide-react";
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
  drawImageBorders,
  getLayerData,
  type ImageLoadOutcome,
  resolveImageBoundField,
  resolveTextBoundField,
  setLayerBoundField,
  setLayerData,
  shrinkTextToIntendedLines,
} from "./fabric-factory";
import {
  buildPlaceholderObject,
  buildSeparatorObject,
  type PlaceholderField,
  type SeparatorChar,
} from "./placeholder-insert";
import { BRAND_GOLD } from "./canva-style-controls";

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
import AgentPanel from "./panels/AgentPanel";
import BrandPanel from "./panels/BrandPanel";
import PlaceholdersPanel from "./panels/PlaceholdersPanel";
import FloatingToolbar from "./panels/FloatingToolbar";
import ColorPickerPanel, { type ColorTarget } from "./panels/ColorPickerPanel";
import EffectsPanel from "./panels/EffectsPanel";
import FontPickerPanel from "./panels/FontPickerPanel";
import { extractPhotoColors } from "./primitives/extractPhotoColors";
import LayerListPanel from "./panels/LayerListPanel";
import { FONT_OPTIONS } from "./primitives/font-options";
import PhotosPanel from "./panels/PhotosPanel";
// why (2026-05-26): the floating AddLayerToolbar component was removed and
// its spawn factories moved into ToolsPanel. The keyboard shortcuts that
// previously called AddLayerToolbar's exports now import the same-named
// functions from ToolsPanel — semantics are identical.
import ToolsPanel, {
  spawnCircle as spawnCircleObj,
  spawnLine as spawnLineObj,
  spawnRect as spawnRectObj,
  spawnText as spawnTextObj,
  type ToolMode,
} from "./panels/ToolsPanel";
import Tooltip from "./primitives/Tooltip";
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
import { reconstructSchemaFromCanvas } from "./reconstruct-schema";
import {
  extractLayoutDelta,
  type CarouselLayoutOverrides,
} from "./layout-delta";
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
    initialFabricJson,
    onApplyLayoutToSiblings,
    onAutosaveDesign,
    sessionKey,
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
  // why (2026-05-31): editor-only render hooks (alignment-guides extension +
  // border paint) attach before/after:render listeners. Fabric's toDataURL
  // renders the scene to an OFFSCREEN context via toCanvasElement, firing those
  // same events; the guide extension's before:render clears the live
  // selection context, which during that offscreen pass throws ("clearRect" on
  // an undefined context) and aborts the render mid-resize — leaving the canvas
  // blank. handleExport suspends these hooks for the export pass (restoring the
  // pre-overlay render path) and resumes after.
  const overlayHooksRef = useRef<{
    suspend: () => void;
    resume: () => void;
  } | null>(null);

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
  // 2026-07-29: names of TEXT layers whose boundField resolved to EMPTY
  // for the current listing. The editor keeps showing the design-time
  // fallback text for these (so the canvas "looks fine"), but the headless
  // publish render DROPS empty-bound layers entirely: the published PNG
  // gets holes the editor never showed. Collected during both hydration
  // passes (schema-driven + fabric-json rebind) and surfaced as a
  // non-blocking amber strip over the canvas. Image layers are excluded:
  // their empty state already shows honestly (dashed placeholder, or the
  // intentional hideIfEmpty drop).
  const [emptyBoundLayerNames, setEmptyBoundLayerNames] = useState<
    readonly string[]
  >([]);
  // 2026-08-04 (John): the amber strip shipped without a dismiss affordance
  // and rendered at the same top-6 slot as the FloatingToolbar (higher
  // z-index), so selecting a text layer put the warning ON TOP of the text
  // toolbar with no way to close it — the template editor was effectively
  // blocked. Dismissal is per-hydration: it resets whenever a hydration pass
  // publishes a DIFFERENT set of missing fields (listing/template switch),
  // so new problems still surface.
  const [emptyBoundWarningDismissed, setEmptyBoundWarningDismissed] =
    useState<boolean>(false);
  const emptyBoundNamesKey = emptyBoundLayerNames.join("|");
  useEffect(() => {
    setEmptyBoundWarningDismissed(false);
  }, [emptyBoundNamesKey]);

  // 2026-06-10: the matboard-crop-era state/refs (cropMode, currentClipRect,
  // cropOverlayRef + the CropModeState interface) that lived here were dead
  // code since the 2026-05-31 native-crop rework (cropMode was only ever set
  // to null) and have been deleted along with the crop lifecycle effect and
  // the Done/Cancel crop bar JSX. Native crop needs none of it: the image's
  // own edge/corner handles do the cropping in place.

  // ===================================================================
  // 2026-06-10: Autosave arming (data-loss fix)
  // ===================================================================
  //
  // why: the autosave effect below keys off layerVersion, but hydration ALSO
  // bumps layerVersion. Before this fix, the canvas autosaved ~1s after open
  // with zero user input, which could bake a transient hydration state (for
  // example a dashed placeholder Rect from a failed image load) into the
  // persisted fabric_json and permanently lose the real layer. Autosave now
  // arms only after the FIRST user-driven mutation that happens AFTER
  // hydration completes. hydrationDoneRef flips true right before
  // history.start(); armAutosave() is called from canvas mutation events and
  // from the React-side handlers that mutate without firing canvas events.
  // Both refs reset at the top of every canvas init so each fresh canvas
  // starts un-armed again.
  const autosaveArmedRef = useRef<boolean>(false);
  const hydrationDoneRef = useRef<boolean>(false);
  const armAutosave = useCallback((): void => {
    if (hydrationDoneRef.current) autosaveArmedRef.current = true;
  }, []);
  // why: single helper for USER-driven layerVersion bumps that originate in
  // React handlers (layer panel, toolbar callbacks, color/font panels)
  // rather than Fabric canvas events. Arms the autosave, then bumps.
  // Hydration code paths call setLayerVersion directly so they never arm.
  const bumpUserLayerVersion = useCallback((): void => {
    armAutosave();
    setLayerVersion((v) => v + 1);
  }, [armAutosave]);
  // why: drives the "Save as Template" modal. Closed by default; opens
  // when the user clicks the header button (rendered only when the parent
  // wired `onSaveAsTemplate`). State lives here (not at the parent) because
  // the modal needs synchronous access to the canvas ref to read
  // toJSON/toDataURL at submit-time.
  const [saveAsTemplateModalOpen, setSaveAsTemplateModalOpen] =
    useState<boolean>(false);

  // 2026-05-28 — "Apply layout to all slides" button transient state.
  // `pending` drives the spinner + disabled styling on the bottom-bar button
  // while the propagation server action is in flight. `lastResult` drives a
  // 4s success/error pill shown to the right of the button after the action
  // resolves — gives the user immediate feedback without a full toast layer.
  // Both reset when the editor closes (component unmounts) so no stale
  // state leaks between sessions.
  const [applyLayoutPending, setApplyLayoutPending] = useState<boolean>(false);
  const [applyLayoutResult, setApplyLayoutResult] = useState<
    | { kind: "ok"; slideCount: number }
    | { kind: "err"; message: string }
    | null
  >(null);

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
    "templates" | "brand" | "agents" | "photos" | "tools" | "placeholders"
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
  // why: Canva-style Font picker panel (2026-05-26). Lives at editor scope
  // because the trigger (text-toolbar font pill) and the panel (left-rail
  // overlay) are separate components that both need read/write access.
  // Closing the panel when text selection clears is handled in the
  // selection effect below.
  const [fontPickerOpen, setFontPickerOpen] = useState<boolean>(false);
  // why: Canva-style Effects panel (2026-05-26). Mirrors the FontPickerPanel
  // pattern — single boolean owned at editor scope because triggers live in
  // FloatingToolbar AND TextPropertiesControls and both flip the same
  // canonical panel. Mutually exclusive with `fontPickerOpen` (both occupy
  // the same left:64px slot) — see the effect below that enforces that.
  const [effectsPanelOpen, setEffectsPanelOpen] = useState<boolean>(false);
  // why: Canva-style ColorPickerPanel (2026-05-26). Replaces the legacy
  // popover that lived inside primitives/ColorPicker.tsx. Same left:64px
  // slot + z-30 + 320px width as FontPickerPanel + EffectsPanel; mutually
  // exclusive with both (the openX helpers below enforce that). The state
  // is `null` when closed; when open, holds the target ("text" / "shape_fill"
  // / "shape_stroke" / "text_background" / "background") so the apply path
  // knows which Fabric property to mutate, plus the initial value as a
  // safety net for renders that miss the live re-read.
  const [colorPickerPanel, setColorPickerPanel] = useState<
    { target: ColorTarget; initialValue: string } | null
  >(null);
  // why: ref the editor passes to FontPickerPanel so focus can return to
  // the trigger pill on close. Updated via a callback ref because the
  // trigger itself is rendered inside FloatingToolbar — we hand the
  // ref to the toolbar via context-free prop drilling would be heavy;
  // instead we update this ref imperatively when the toolbar mounts.
  // Simplest path: skip ref-restoration. The Esc handler still closes and
  // the user can Tab back to wherever they need — focus on the input box
  // inside the panel is the bigger win we DO want to deliver.
  // Keeping the ref slot here in case a future revision wires it.
  const fontPickerTriggerRef = useRef<HTMLElement | null>(null);
  // why: user-driven zoom on top of the fit-to-viewport `displayScale`. Range
  // 0.25-2.0 mirrors Canva's bottom-bar zoom. "Fit" resets to 1 which means
  // "use displayScale as-is" — the canvas always fits the viewport at zoom=1.
  //
  // 2026-05-24 — default lowered from 1.0 → 0.8 per John. At 1.0 (Fit), the
  // canvas fills the available area but the layer panel + brand sidebar
  // crowd the visible slide so the user can't see the full composition
  // without scrolling. Leaves comfortable margin on both sides while keeping
  // detail readable for text-edit work.
  // 2026-05-31 — bumped 0.8 → 0.9 per John (a bit larger by default).
  const [zoom, setZoom] = useState<number>(0.9);
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
          borderColor: BRAND_GOLD,
          cornerColor: BRAND_GOLD,
        });
        setLayerData(img, {
          layerId: `photo_${photo.sequence}_${Date.now()}`,
          layerKind: "image",
          displayName: `Photo ${photo.sequence}`,
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        bumpUserLayerVersion();
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
  // template. The init useEffect's identity deps re-fire the entire canvas
  // init pipeline: old Fabric canvas is disposed in cleanup, a new one is
  // created, layers re-hydrate against the same listing. History does NOT
  // reset on its own (the hook's refs outlive the canvas), so the init
  // effect calls history.reset() explicitly; without that, Cmd+Z after a
  // swap replayed the previous template's snapshot onto the new canvas.
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

    // 2026-06-10: every fresh canvas starts with EMPTY undo history. The
    // hook's stacks + isStarted flag live in refs that survive canvas
    // re-init (template swap, resize, slide switch); without this reset,
    // start() no-ops on the new canvas and the first Cmd+Z replays the
    // PREVIOUS template's snapshot onto it.
    history.reset();
    // 2026-06-10: disarm autosave for the new canvas: hydration bumps to
    // layerVersion must not persist anything until the user actually edits.
    // Also drop any autosave timer still pending from the previous canvas so
    // it can't serialize the new (mid-hydration) canvas under the new
    // document identity.
    hydrationDoneRef.current = false;
    autosaveArmedRef.current = false;
    if (autosaveWriteTimerRef.current) {
      clearTimeout(autosaveWriteTimerRef.current);
      autosaveWriteTimerRef.current = null;
    }
    // 2026-07-29: drop the previous canvas's empty-bound-field warning;
    // the hydration pass below recomputes it for the new template/listing.
    setEmptyBoundLayerNames([]);

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

    // why (2026-05-31): turn on edge/center snapping with Canva-style guide
    // lines. The module hooks Fabric's move/scale events and snaps the active
    // object to any other object's edges + centers and the canvas center when
    // within `margin` px, flashing a guide line while the snap holds. margin 8
    // ≈ the distance that feels intentional without fighting small nudges.
    //
    // Canva draws those guides as a DASHED VIOLET line. The extension's drawing
    // is solid and doesn't expose a dash option, but its stroke inherits the
    // selection context's line-dash state. So we bracket the extension's
    // `after:render` draw: a handler registered BEFORE it sets a dash, one
    // registered AFTER it clears the dash. Net effect — only the guide strokes
    // are dashed; the selection borders/handles (drawn earlier in the frame,
    // while dash is clear) stay solid. Color comes through the extension config.
    // Returns a teardown we call on dispose so listeners don't leak across
    // canvas re-inits.
    // Border paint hook — draws image frames into whichever context the render
    // pass targets (live lower context, or the offscreen export context the
    // after:render event hands us, so frames appear in the saved image too).
    // Wrapped so a draw error can never abort the render cycle (which would
    // corrupt canvas state mid-export). Attached for the whole editor lifetime.
    const paintBorders = (e?: { ctx?: CanvasRenderingContext2D }): void => {
      try {
        drawImageBorders(fabricCanvas, e?.ctx);
      } catch (err) {
        console.warn("[canvas-editor] border paint failed:", err);
      }
    };
    fabricCanvas.on("after:render", paintBorders);

    // Alignment-guide hooks. These are EDITOR-ONLY: the extension's
    // before:render clears the live selection context, which throws on Fabric's
    // offscreen export render (toCanvasElement) and blanks the canvas. So they
    // live behind attach/detach and are suspended for the export pass.
    const guideCtx = fabricCanvas.getSelectionContext();
    const setGuideDash = (): void => {
      try {
        guideCtx?.setLineDash([7, 5]);
      } catch {
        /* best effort */
      }
    };
    const clearGuideDash = (): void => {
      try {
        guideCtx?.setLineDash([]);
      } catch {
        /* best effort */
      }
    };
    let teardownExt: (() => void) | null = null;
    let guidesAttached = false;
    const attachGuides = (): void => {
      if (guidesAttached) return;
      try {
        fabricCanvas.on("after:render", setGuideDash); // before ext draw
        teardownExt = initAligningGuidelines(fabricCanvas, {
          margin: 8,
          width: 1.5,
          color: "#9747FF", // Canva-style violet
        });
        // why (2026-05-31): the extension snaps the active object during
        // RESIZE/SCALE by MUTATING its width/height/scale (collect-point.mjs).
        // For a native-crop image that independently stretches the photo —
        // dragging a crop handle near a band edge distorts it and drifts its
        // width. We only want guides for MOVE (position snap). Drop the
        // resize + scale snap handlers; keep object:moving + the line drawing.
        // Nothing else in the editor listens to these two events.
        fabricCanvas.off("object:resizing");
        fabricCanvas.off("object:scaling");
        fabricCanvas.on("after:render", clearGuideDash); // after ext draw
        guidesAttached = true;
      } catch (err) {
        // Non-fatal: snapping is an enhancement, not a requirement.
        console.warn("[canvas-editor] aligning guidelines init failed:", err);
      }
    };
    const detachGuides = (): void => {
      if (!guidesAttached) return;
      fabricCanvas.off("after:render", setGuideDash);
      fabricCanvas.off("after:render", clearGuideDash);
      try {
        teardownExt?.();
      } catch {
        /* best effort */
      }
      teardownExt = null;
      guidesAttached = false;
    };
    attachGuides();
    // Expose suspend/resume so handleExport can render the export pass without
    // the guide hooks (their before:render throws on the offscreen export
    // context). The border hook stays attached — it targets the export ctx.
    overlayHooksRef.current = {
      suspend: detachGuides,
      resume: attachGuides,
    };
    const teardownGuides = (): void => {
      detachGuides();
      fabricCanvas.off("after:render", paintBorders);
      overlayHooksRef.current = null;
    };

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
      // 2026-06-10: adds/removes after hydration are user-driven: arm
      // autosave. During hydration (hydrationDoneRef false) the burst of
      // object:added events leaves autosave disarmed.
      armAutosave();
      setLayerVersion((v) => v + 1);
    };
    fabricCanvas.on("object:added", bumpVersion);
    fabricCanvas.on("object:removed", bumpVersion);
    // 2026-06-10: typing inside a Textbox fires text:changed (the matching
    // object:modified only fires when editing ends). Arm autosave on the
    // first keystroke so an edit-then-close-fast session still persists.
    fabricCanvas.on("text:changed", () => {
      if (cancelled) return;
      armAutosave();
    });

    // why (2026-05-29 — Phase 1 collapse): previously TWO separate
    // `object:modified` listeners fired on every drag/scale end — one
    // bumped layerVersion, the other rebuilt the image clipPath. That
    // double-traversed Fabric's observer array per gesture and left the
    // bump/rebuild ordering implicit. They're now a single handler:
    // rebuild the clipPath first (images only, outside crop mode), then
    // bump the version EXACTLY once. Every code path below must end with
    // a single bumpVersion() so the layer panel / autosave stay in sync.
    //
    // why (2026-05-23 — Cover/Contain/Stretch fix): when the user
    // resizes or moves a FabricImage via Fabric handles, sync the
    // image's BOX dims and clipPath to match the new displayed bounds.
    // This is what makes the user-resize feel natural (the box follows
    // the image, Canva-style). Pairs with the always-on clipPath in
    // fabric-factory.ts: because the clipPath is absolutePositioned, it
    // does NOT follow the image's transform automatically — we write the
    // new canvas-space rect here.
    fabricCanvas.on("object:modified", (e) => {
      if (cancelled) return;
      // 2026-06-10: a post-hydration modify is user-driven: arm autosave.
      armAutosave();
      const obj = e.target;
      // 2026-05-31 — TEXT: bake any residual scale into fontSize + width so
      // the glyphs are never left stretched/squished and the size readout
      // (which derives effective = fontSize × scaleY) stays truthful. Corner
      // handles scale uniformly (sx === sy) → font + box grow proportionally;
      // ml/mr use changeWidth so they don't scale at all. After baking we
      // reset scaleX/scaleY to 1 so the object renders crisp at its true size.
      if (obj instanceof Textbox) {
        const sx = obj.scaleX ?? 1;
        const sy = obj.scaleY ?? 1;
        if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) {
          obj.set({
            width: (obj.width ?? 0) * sx,
            fontSize: (obj.fontSize ?? 1) * sy,
            scaleX: 1,
            scaleY: 1,
          });
          obj.setCoords();
          fabricCanvas.requestRenderAll();
        }
        bumpVersion();
        return;
      }
      // Non-image (or no target): nothing to re-clip, just bump once.
      if (!(obj instanceof FabricImage)) {
        bumpVersion();
        return;
      }
      // 2026-05-31 — NATIVE CROP model. An image's bounding box now EQUALS its
      // visible frame (cover crop via cropX/cropY/width/height; corner handles
      // scale; edge handles trim). So a move/scale/trim needs no frame rebuild —
      // the box tracks the object automatically. The only thing to sync is the
      // rounding clipPath (present only when cornerRadius > 0), which is
      // absolutePositioned and must be re-pinned to the new box. We also keep
      // the data-bag box dims current for the fit toggle.
      const left = obj.left ?? 0;
      const top = obj.top ?? 0;
      const boxW = (obj.width ?? 0) * (obj.scaleX ?? 1);
      const boxH = (obj.height ?? 0) * (obj.scaleY ?? 1);
      const bag = (obj as unknown as { data?: Record<string, unknown> })
        .data ?? {};
      (obj as unknown as { data: Record<string, unknown> }).data = {
        ...bag,
        targetBoxWidth: boxW,
        targetBoxHeight: boxH,
      };
      const roundClip = obj.clipPath instanceof Rect ? obj.clipPath : null;
      if (roundClip) {
        const curW = (roundClip.width ?? 0) * (roundClip.scaleX ?? 1);
        const curH = (roundClip.height ?? 0) * (roundClip.scaleY ?? 1);
        const moved =
          Math.abs((roundClip.left ?? 0) - left) > 0.5 ||
          Math.abs((roundClip.top ?? 0) - top) > 0.5 ||
          Math.abs(curW - boxW) > 0.5 ||
          Math.abs(curH - boxH) > 0.5;
        if (moved) {
          const rx =
            typeof roundClip.rx === "number" ? roundClip.rx : 0;
          obj.clipPath = new Rect({
            left,
            top,
            width: boxW,
            height: boxH,
            rx,
            ry: rx,
            originX: "left",
            originY: "top",
            absolutePositioned: true,
          });
          fabricCanvas.requestRenderAll();
        }
      }
      bumpVersion();
    });

    // why mouse:dblclick (not dom click): Fabric synthesizes its own
    // double-click events that fire ONLY on canvas objects (not the
    // background). It captures the target object cleanly without us
    // having to do hit-testing.
    // 2026-05-31 — native-crop model: double-clicking a photo just SELECTS it.
    // Trimming/cropping now happens directly via the edge handles (cut off) and
    // corner handles (scale) on the selected image — no separate crop mode. The
    // old clipPath-based crop session is retired (it assumed the cover-overflow
    // framing that native crop replaced).
    fabricCanvas.on("mouse:dblclick", (e) => {
      if (cancelled) return;
      const obj = e.target;
      if (!(obj instanceof FabricImage)) return;
      if ((obj as unknown as { lockMovementX?: boolean }).lockMovementX) return;
      fabricCanvas.setActiveObject(obj);
      fabricCanvas.requestRenderAll();
    });

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
    //
    // 2026-05-24 — generalized from "custom template" to "any Fabric JSON
    // source". Now also called for `initialFabricJson` (the Studio
    // round-trip path): when a saved generated_post has fabric_json
    // populated, we load THAT instead of the factory schema so the
    // user's prior edits come back exactly as they left them.
    const hydrateFromFabricJson = async (json: unknown): Promise<void> => {
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
          json as Record<string, unknown>,
        );
      } catch (err) {
        if (cancelled) return;
        setEditorError({
          kind: "init",
          message: `Fabric JSON load failed: ${
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
      // 2026-07-29: collect text layers whose bound field has NO data for
      // this listing (see emptyBoundLayerNames docs). The canvas keeps the
      // stale/design text so the user sees something, but the published
      // render will drop the layer, warn instead of staying silent.
      const emptyBoundNames = new Set<string>();
      for (const obj of objectsForRebind) {
        const data = getLayerData(obj);
        if (!data) continue;
        const schemaLayer = template.layers.find((l) => l.id === data.layerId);
        if (!schemaLayer) continue;
        if (isTextLayer(schemaLayer) && schemaLayer.boundField) {
          const resolved = resolveTextBoundField(schemaLayer.boundField, listing);
          if (
            (!resolved || resolved.trim().length === 0) &&
            obj.visible !== false
          ) {
            emptyBoundNames.add(schemaLayer.name || schemaLayer.boundField);
          }
          if (resolved && resolved.trim().length > 0) {
            // why: Textbox is the only Fabric text class we emit in
            // createFabricTextbox. set() with `text` updates the content
            // and triggers a layout pass; type-narrow via instanceof to
            // satisfy TS.
            if (obj instanceof Textbox) {
              obj.set({ text: resolved });
              // 2026-07-24 — re-run the same shrink-to-fit the initial
              // hydrate + the headless publish render apply. Without this,
              // rebinding onto a NEW listing (e.g. reopening Studio, or the
              // wizard swapping in fresh MLS data) could re-wrap a long
              // address across two lines and overlap the layer below, even
              // though the initial mount already fit it — same bug, one
              // more path in.
              shrinkTextToIntendedLines(
                obj,
                schemaLayer.fontSize,
                schemaLayer.height,
                schemaLayer.lineHeight,
              );
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
      // 2026-07-29: publish the empty-bound-field warning for this pass.
      setEmptyBoundLayerNames([...emptyBoundNames]);
      fabricRef.current.requestRenderAll();
      setLayerVersion((v) => v + 1);
      // 2026-06-10: hydration is complete: from here on, canvas mutation
      // events count as user edits and arm the autosave. The bump above
      // itself does NOT arm (hydrationDoneRef was still false when its
      // events fired), so nothing persists until the user touches something.
      hydrationDoneRef.current = true;
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

      // 2026-06-10: kick off ALL image loads up front so a slow MLS CDN
      // photo no longer serializes hydration (previously each image was
      // awaited inside the z-order loop, so total wait was the SUM of load
      // times). createFabricImage keeps its own 15s timeout + never rejects
      // (failures come back as ok:false outcomes), so firing them eagerly is
      // safe. The loop below still ADDS objects in z-order, awaiting each
      // image's already-in-flight promise, so stacking stays schema-faithful.
      // 2026-07-29: collect text layers whose bound field has NO data for
      // this listing (see emptyBoundLayerNames docs); published at the end
      // of this pass. The canvas shows the design-time fallback text for
      // them, the headless publish render drops them.
      const emptyBoundNames = new Set<string>();

      const imageOutcomePromises = new Map<
        string,
        Promise<ImageLoadOutcome>
      >();
      for (const layer of sortedLayers) {
        if (!isImageLayer(layer)) continue;
        const resolved = layer.boundField
          ? resolveImageBoundField(layer.boundField, listing)
          : layer.src;
        imageOutcomePromises.set(layer.id, createFabricImage(layer, resolved));
      }

      for (const layer of sortedLayers) {
        if (cancelled || !fabricRef.current) return;

        if (isTextLayer(layer)) {
          const resolved = layer.boundField
            ? resolveTextBoundField(layer.boundField, listing)
            : layer.text;
          // 2026-07-29: flag the no-data case for the warning strip; the
          // fallback below keeps the canvas looking populated while the
          // publish render will drop this layer.
          if (
            layer.boundField &&
            resolved.trim().length === 0 &&
            layer.visible !== false
          ) {
            emptyBoundNames.add(layer.name || layer.boundField);
          }
          // why: if the bound field resolves to empty, fall back to the
          // template's literal `text` value so the canvas still shows
          // something sensible. The user can edit/delete after.
          const tb = createFabricTextbox(
            layer,
            resolved.trim() || layer.text,
          );
          // 2026-07-24 — shrink-to-fit for bound text, mirroring the
          // headless publish render (headless-render.ts). Live MLS data
          // can be longer than the design-time placeholder — "210
          // Congressional Court" wrapped onto a second line and overlapped
          // "MOORESTOWN" below it in Studio, even though the published PNG
          // was already correct (that path has applied this fix since
          // 2026-07-17). Free-text (non-bound) layers are left untouched —
          // their content is exactly what the designer typed.
          if (layer.boundField) {
            shrinkTextToIntendedLines(
              tb,
              layer.fontSize,
              layer.height,
              layer.lineHeight,
            );
          }
          fabricRef.current.add(tb);
        } else if (isImageLayer(layer)) {
          // why: the load was started eagerly above; this await just joins
          // the already-in-flight promise. The map is keyed by layer id and
          // populated for every image layer, so the lookup cannot miss; the
          // fallback only defends against a malformed template.
          const outcome = (await imageOutcomePromises.get(layer.id)) ?? {
            ok: false as const,
            reason: "no_src" as const,
            message: "No image URL",
          };
          if (cancelled || !fabricRef.current) return;
          if (outcome.ok) {
            fabricRef.current.add(outcome.image);
          } else if (outcome.reason === "hidden") {
            // why: layer opted out via `hideIfEmpty` — drop it entirely,
            // no placeholder. Used by the hosting-agent block's photo
            // so a missing host headshot leaves the block as text-only
            // instead of a dashed-outline placeholder rect.
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
              fill: "rgba(201, 168, 76, 0.08)", // gold-500 at 8% alpha
              stroke: BRAND_GOLD,
              strokeWidth: 2,
              strokeDashArray: [8, 6],
              rx: layer.cornerRadius,
              ry: layer.cornerRadius,
              selectable: !layer.locked,
              cornerStyle: "circle",
              cornerSize: 10,
              transparentCorners: false,
              borderColor: BRAND_GOLD,
              cornerColor: BRAND_GOLD,
              // 2026-06-10 (data-loss fix): NEVER serialize the placeholder.
              // A transient load failure (CDN hiccup, flaky wifi) used to get
              // baked into the autosaved fabric_json as this dashed Rect,
              // permanently replacing the real image layer on every reopen.
              // excludeFromExport makes every toObject/toJSON path (autosave,
              // undo snapshots, PNG export) skip it, so a failed load stays a
              // this-session-only visual cue.
              excludeFromExport: true,
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
      // 2026-07-29: publish the empty-bound-field warning for this pass.
      setEmptyBoundLayerNames([...emptyBoundNames]);
      fabricRef.current.requestRenderAll();
      // why: prime the layer panel with the freshly added objects.
      setLayerVersion((v) => v + 1);
      // 2026-06-10: hydration is complete: from here on, canvas mutation
      // events count as user edits and arm the autosave (see armAutosave).
      hydrationDoneRef.current = true;
      // why: Phase 2 — activate the undo/redo auto-snapshot now that the
      // canvas holds its hydrated baseline. Before this call, the history
      // hook ignores Fabric events; after this call, every debounced
      // mutation becomes a real undo step. Idempotent — extra calls no-op.
      history.start();
    };

    void loadBackground();
    // why: dispatch order matters.
    //   1. `initialFabricJson` — saved Studio edits from a generated_posts
    //      row. This is the "reopen a post you previously edited" path
    //      and must win over any other source. The user's prior canvas
    //      state is the most specific authoritative source.
    //   2. `customTemplate.fabricJson` — user-authored custom template
    //      (Save-as-Template flow). Authored against a different listing,
    //      now being applied to the current listing.
    //   3. Otherwise — hydrate from the factory schema's layer list.
    //
    // 1 and 2 use the same loader (hydrateFromFabricJson); the rebind
    // pass below handles bound-field updates identically for both.
    const fabricJsonSource: unknown =
      initialFabricJson ?? customTemplate?.fabricJson ?? null;
    if (fabricJsonSource) {
      void hydrateFromFabricJson(fabricJsonSource);
    } else {
      void hydrateLayers();
    }

    return () => {
      cancelled = true;
      // why: drop the alignment-guides + border-paint hooks before disposing
      // the canvas so they don't fire into a torn-down instance.
      try {
        teardownGuides();
      } catch {
        /* teardown is best-effort */
      }
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
    // parents pass a new object reference each render). The id tuple is
    // sufficient for "should we recreate the canvas".
    //
    // 2026-06-10: sessionKey added to the tuple. Multi-OH slides share one
    // template + listing, so without it, switching slides never re-ran this
    // effect: the canvas kept the previous slide's objects, ignored the new
    // initialFabricJson, and the autosave callback (which reads the CURRENT
    // slide index) could persist slide A's canvas under slide B's index.
    // sessionKey also keys the <canvas> DOM node below, so every init gets a
    // virgin element (Fabric v6 defers dispose() a frame; constructing a new
    // Canvas on the still-initialized old element threw and left the editor
    // blank until refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, listing.id, customTemplate?.id, sessionKey]);

  // 2026-06-10: the matboard crop-mode lifecycle effect (enter/exit, frame
  // border + dimmer overlays, 2x canvas extension, Done/Cancel handlers,
  // exitCropModeRef + cropAspectRef) that lived here was dead since the
  // 2026-05-31 native-crop rework: cropMode was only ever set to null, so
  // the effect body could never run. Deleted wholesale; native crop is
  // handled by the image's own edge/corner handles (see fabric-factory's
  // fitImageInFrame + the object:modified handler in the init effect).

  // 2026-05-25 — Crop mode entry via toolbar button.
  //
  // Mirrors what the mouse:dblclick handler does, but reads the
  // currently-active object instead of an event target. Wired into
  // FloatingToolbar's `onEnterCropMode` prop so users have two
  // ways to enter crop mode: double-click the image OR click the
  // Crop button in the floating toolbar.
  // 2026-05-31 — native crop: the "Crop" button just ensures the photo is
  // selected so its trim (edge) + scale (corner) handles are visible. There's
  // no separate crop session anymore — the handles do the cropping in place.
  const enterCropModeForActive = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!(active instanceof FabricImage)) return;
    canvas.setActiveObject(active);
    canvas.requestRenderAll();
  }, []);

  // 2026-05-25 — Companion to enterCropModeForActive. Resize is the
  // photo's DEFAULT selection behavior — handles attached to the
  // image scale photo + clipPath together via the object:modified
  // handler. This callback just ensures the photo IS the active
  // selection (so its handles appear). Most clicks already land
  // there, but exposing a dedicated toolbar button alongside Crop
  // makes the two operations visibly symmetric to the user.
  const activateResizeForActive = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!(active instanceof FabricImage)) return;
    // Make sure handles are visible — if anything turned them off
    // (e.g., a prior crop-mode exit that didn't restore), force
    // them back to the schema default of all-8-on.
    (
      active as unknown as {
        setControlsVisibility: (v: Record<string, boolean>) => void;
      }
    ).setControlsVisibility({
      tl: true,
      tr: true,
      bl: true,
      br: true,
      ml: true,
      mr: true,
      mt: true,
      mb: true,
      mtr: true,
    });
    active.set({ hasBorders: true });
    canvas.setActiveObject(active);
    canvas.requestRenderAll();
  }, []);

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
        // 2026-05-31 (crash fix) — crop mode (and other tool overlays) add
        // helper Fabric objects that carry partial layer-data WITHOUT a
        // layerId. Calling `.startsWith` on an undefined layerId threw
        // "Cannot read properties of undefined (reading 'startsWith')",
        // crashing the whole editor (white screen) the moment Crop was opened.
        // Skip any object without a stable layerId — it isn't a real layer.
        if (!data.layerId) return null;
        // 2026-05-29 (bug fix) — never surface transient/leaked hover-preview
        // highlight rects in the layer list.
        if (data.layerId.startsWith("__hover_preview__")) return null;
        // why (2026-05-31 fix): Fabric's enterEditing() sets selectable=false
        // on a text box for the DURATION of editing (so it can't be dragged
        // while you type). The layer list keyed "locked" off selectable===false,
        // so the instant any edit bumped layerVersion, the text box you were
        // editing got flagged locked — which hid the floating toolbar and its
        // font-size control mid-edit. A box that's merely in edit mode is NOT a
        // locked layer, so exclude that transient state.
        const isEditingText =
          obj instanceof Textbox && (obj as Textbox).isEditing === true;
        return {
          id: data.layerId,
          name: data.displayName,
          kind: data.layerKind,
          visible: obj.visible !== false,
          locked: obj.selectable === false && !isEditingText,
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
    bumpUserLayerVersion();
  }, []);

  const handleSendBackward = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.sendObjectBackwards(active);
    canvas.requestRenderAll();
    bumpUserLayerVersion();
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
   * The 6 alignment directions the FloatingToolbar can dispatch.
   * Single-object alignment uses canvas bounds; multi uses the selection
   * bounding box.
   *
   * 2026-05-26 — `distribute_horizontal` / `distribute_vertical` retired
   * with the floating-toolbar consolidation. Distribute buttons were
   * removed from both the footer and the new pill.
   */
  type AlignDirection =
    | "left"
    | "center"
    | "right"
    | "top"
    | "middle"
    | "bottom";

  const handleAlign = useCallback(
    (direction: AlignDirection): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const objs = canvas.getActiveObjects();
      if (objs.length === 0) return;

      const canvasW = currentTemplate.width;
      const canvasH = currentTemplate.height;

      // ---- Single-object alignment — align to canvas bounds ------------
      if (objs.length === 1) {
        const obj = objs[0]!;
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
        bumpUserLayerVersion();
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

      // Step 2: recreate the ActiveSelection so the user's selection is
      // preserved after the alignment lands.
      const sel = new ActiveSelection(objs, { canvas });
      canvas.setActiveObject(sel);
      canvas.fire("object:modified", { target: sel });
      canvas.requestRenderAll();
      bumpUserLayerVersion();
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
    bumpUserLayerVersion();
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
      bumpUserLayerVersion();
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
      bumpUserLayerVersion();
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
      bumpUserLayerVersion();
    },
    [],
  );

  // Template Builder — insert a bound-field placeholder. Mirrors the
  // shape-spawn flow (add → select → bump version → record history).
  const handlePlaceholderPicked = useCallback(
    (field: PlaceholderField): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = buildPlaceholderObject(
        field,
        template.width,
        template.height,
      );
      canvas.add(obj);
      handleLayerAdded(obj);
      history.record?.();
    },
    [template.width, template.height, handleLayerAdded, history],
  );

  // Insert a literal separator ("—" or "|") as a plain text layer. Same
  // add → select → bump → record flow as a placeholder, but unbound.
  const handleSeparatorInserted = useCallback(
    (char: SeparatorChar): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = buildSeparatorObject(template.width, template.height, char);
      canvas.add(obj);
      handleLayerAdded(obj);
      history.record?.();
    },
    [template.width, template.height, handleLayerAdded, history],
  );

  // Phase C — bind the currently selected text/image layer to a field,
  // turning a literal/manual layer into a placeholder that re-resolves on
  // every post. The panel only offers "Bind" when the selected layer's kind
  // matches the field's kind, so we don't text-bind an image or vice versa.
  const handleBindSelectedToField = useCallback(
    (field: PlaceholderField): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      setLayerBoundField(active, field.field);
      canvas.requestRenderAll();
      bumpUserLayerVersion();
      history.record?.();
    },
    [history],
  );

  // Kind of the currently selected single layer (text/image), used to gate
  // the Placeholders panel's "Bind selected" affordance. Null when nothing
  // bindable is selected.
  const selectedBindableKind = useMemo<"text" | "image" | null>(() => {
    if (selection.isMulti || !selection.layerId) return null;
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const obj = canvas
      .getObjects()
      .find((o) => getLayerData(o)?.layerId === selection.layerId);
    const kind = obj ? getLayerData(obj)?.layerKind : null;
    return kind === "text" || kind === "image" ? kind : null;
  }, [selection]);

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
  // Server autosave (design-only)
  // -------------------------------------------------------------------------
  //
  // 2026-05-28 — replaced the old localStorage draft + "Unsaved changes —
  // restore them?" banner with a debounced SERVER autosave. John found the
  // restore prompt confusing and wanted edits to just persist. Every change
  // (layerVersion bump) schedules a serialize-and-persist of the canvas
  // design (a Fabric `toObject` snapshot — the same shape the explicit Save
  // captures as `fabricJson`) ~1s after the last edit, via the
  // parent-supplied `onAutosaveDesign` callback. NO PNG re-render here —
  // that still happens on explicit Save/Publish. The parent persists the
  // snapshot to the slide (slide_metadata[i].fabric_json) or hero
  // (generated_posts.fabric_json); reopen restores it via initialFabricJson,
  // so there's never a "restore?" prompt.
  const autosaveWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hold the latest callback in a ref so the debounced effect doesn't reset
  // its timer every time the parent re-creates the callback (which would
  // prevent the debounce from ever firing). The effect depends only on
  // layerVersion.
  const onAutosaveDesignRef = useRef(onAutosaveDesign);
  useEffect(() => {
    onAutosaveDesignRef.current = onAutosaveDesign;
  }, [onAutosaveDesign]);

  // 2026-07-24 (John) — "Save Changes" button + a data-loss fix for the
  // per-slide Multi-OH editor. Switching slides (clicking a different
  // carousel thumbnail's pencil while Studio stays open, via CarouselStrip
  // → onSlideEditClick) re-keys this component, which UNMOUNTS it.
  // Previously the only cleanup here just cleared the pending debounce
  // timer — if the user's last edit landed inside the 1s debounce window,
  // the slide switch silently discarded it: no save, no warning. That's
  // exactly "a slide's edits get lost if we move onto another slide to
  // edit."
  //
  // `runAutosaveNow` is now the single serialize-and-persist routine used
  // by three callers: the debounce timer below, the unmount-flush effect
  // right after it (the actual data-loss fix — catches the case even if
  // the user forgets to click anything), and the new manual "Save Changes"
  // button in the bottom action bar (a guaranteed, visible checkpoint the
  // user can hit right before switching slides).
  const runAutosaveNow = useCallback((): boolean => {
    if (autosaveWriteTimerRef.current) {
      clearTimeout(autosaveWriteTimerRef.current);
      autosaveWriteTimerRef.current = null;
    }
    const persist = onAutosaveDesignRef.current;
    if (!persist) return false;
    const canvas = fabricRef.current;
    if (!canvas) return false;
    // Strip the live hover-preview rect AND any LEGACY leaked hover-preview
    // objects (older builds serialized them as permanent layers) so they're
    // removed for good and never re-persisted. The live one is re-added
    // after serialize; the legacy ones stay gone.
    const hover = hoverHighlightRef.current;
    const leakedHovers = canvas
      .getObjects()
      .filter((o) =>
        getLayerData(o)?.layerId?.startsWith("__hover_preview__"),
      );
    for (const o of leakedHovers) canvas.remove(o);
    let json: unknown = null;
    try {
      // Fabric v6: toObject(propertiesToInclude) preserves our `data`
      // metadata — crucially `boundField` — so the snapshot re-hydrates
      // with fresh listing data on reopen. Same propsToInclude as the
      // explicit-save handler (handleExport) so autosave and Save produce
      // an identical snapshot shape.
      const propsToInclude: string[] = [
        "data",
        "selectable",
        "evented",
        "lockMovementX",
        "lockMovementY",
      ];
      json = canvas.toObject(propsToInclude);
    } catch (err) {
      console.warn("[CanvasEditor] autosave toObject failed:", err);
    } finally {
      if (hover) {
        canvas.add(hover);
        canvas.bringObjectToFront(hover);
      }
    }
    if (!json) return false;
    // Fire-and-forget; the parent owns persistence + error handling.
    void Promise.resolve(persist(json)).catch((e) => {
      console.warn("[CanvasEditor] onAutosaveDesign failed:", e);
    });
    return true;
  }, []);

  const [manualSaveState, setManualSaveState] = useState<
    "idle" | "saved"
  >("idle");
  const manualSaveResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    return () => {
      if (manualSaveResetTimerRef.current) {
        clearTimeout(manualSaveResetTimerRef.current);
      }
    };
  }, []);

  const handleManualSave = useCallback((): void => {
    const didSave = runAutosaveNow();
    if (!didSave) return;
    if (manualSaveResetTimerRef.current) {
      clearTimeout(manualSaveResetTimerRef.current);
    }
    setManualSaveState("saved");
    manualSaveResetTimerRef.current = setTimeout(() => {
      setManualSaveState("idle");
    }, 2_000);
  }, [runAutosaveNow]);

  // Flush-on-unmount. Empty deps so this cleanup runs ONLY when the
  // component actually unmounts (slide switch, Studio close) — not on
  // every layerVersion change, which would fight the debounce below.
  // Declared BEFORE the debounce effect: React cleans up effects in
  // declaration order, so on unmount this fires first (flushing + clearing
  // the pending timer via runAutosaveNow), and the debounce effect's own
  // cleanup right after finds the timer ref already null and no-ops.
  useEffect(() => {
    return () => {
      if (autosaveWriteTimerRef.current) {
        runAutosaveNow();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip the initial hydration bump — the user hasn't changed anything yet.
    if (layerVersion === 0) return;
    // 2026-06-10 (data-loss fix): only persist once a USER edit has been
    // observed post-hydration (see armAutosave). Hydration also bumps
    // layerVersion, and before this gate the canvas autosaved ~1s after
    // open, which could bake a transient hydration state (failed-image
    // placeholder, half-rebound fields) into fabric_json with zero input.
    if (!autosaveArmedRef.current) return;
    if (!onAutosaveDesignRef.current) return;
    if (!fabricRef.current) return;
    if (autosaveWriteTimerRef.current) {
      clearTimeout(autosaveWriteTimerRef.current);
    }
    autosaveWriteTimerRef.current = setTimeout(() => {
      runAutosaveNow();
    }, 1_000);

    return () => {
      if (autosaveWriteTimerRef.current) {
        clearTimeout(autosaveWriteTimerRef.current);
        autosaveWriteTimerRef.current = null;
      }
    };
  }, [layerVersion, runAutosaveNow]);

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
        stroke: BRAND_GOLD, // gold-500 — matches the selection ring
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        // why: skipTargetFind keeps the rect from intercepting clicks on
        // the underlying object — the user can still click through to
        // select what they're previewing.
        evented: false,
        selectable: false,
        hoverCursor: "default",
        // 2026-05-29 (bug fix) — NEVER serialize the hover highlight. Without
        // this it leaked into autosave + history snapshots + export and
        // reloaded as a permanent "(hover preview)" layer. excludeFromExport
        // makes every toObject/toJSON path (autosave, undo/redo capture,
        // PNG export) skip it.
        excludeFromExport: true,
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
          borderColor: BRAND_GOLD,
          cornerColor: BRAND_GOLD,
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
        bumpUserLayerVersion();
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
      // why: Fabric's toDataURL renders the scene to an offscreen context,
      // firing before/after:render. Our editor-only overlay hooks (alignment
      // guides + dash) assume the live contexts and throw on that offscreen
      // pass, aborting the render and blanking the canvas. Suspend them for the
      // export and resume after. The border hook stays (it targets the export
      // context via the event ctx, so frames appear in the saved image too).
      overlayHooksRef.current?.suspend();
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
        }
        // why: re-attach the editor-only guide hooks now the export pass is
        // done, then render once so the live canvas repaints cleanly.
        overlayHooksRef.current?.resume();
        canvas.requestRenderAll();
      }

      // why: dataURL → Blob → File. We can't use the Canvas.toBlob() API
      // because Fabric's toDataURL gives us the multiplier-aware bytes, but
      // converting via fetch(dataUrl).then(r=>r.blob()) is the cleanest path
      // that respects the multiplier we just applied.
      const blob = await (await fetch(dataUrl)).blob();
      const filename = `${template.id}_${Date.now()}.jpg`;
      const file = new File([blob], filename, { type: "image/jpeg" });

      // why (2026-05-24 — Studio edit round-trip): capture the FAITHFUL
      // Fabric snapshot alongside the rendered PNG. Same propsToInclude
      // list the debounced autosave uses (line ~1638) so the `data`
      // metadata — crucially `boundField` for text/image layers —
      // survives the toObject → loadFromJSON round-trip. Strip the
      // hover-preview rect first if present so it doesn't get persisted.
      //
      // Why a sibling of `schema` (not a replacement):
      //   `schema` is the ORIGINAL template the editor was hydrated from.
      //   Downstream code (Revert link, original_template_id) still wants
      //   the original. `fabricJson` is the editable snapshot for the
      //   reopen path. Both get persisted; the editor prefers fabricJson
      //   on reopen via `initialFabricJson`.
      const propsToInclude: string[] = [
        "data",
        "selectable",
        "evented",
        "lockMovementX",
        "lockMovementY",
      ];
      const hoverForExport = hoverHighlightRef.current;
      // Strip the live hover-preview rect + any legacy leaked ones so they
      // never end up in the saved snapshot. Live one re-added after.
      const leakedHoversExport = canvas
        .getObjects()
        .filter((o) =>
          getLayerData(o)?.layerId?.startsWith("__hover_preview__"),
        );
      for (const o of leakedHoversExport) canvas.remove(o);
      let fabricJson: unknown;
      // why: reconstruct a real CanvasTemplateSchema from the LIVE canvas so
      // template-authoring saves persist the user's edits (layout, colors,
      // fonts, added/removed layers) instead of the original hydrated
      // template. Same serializer the Save-as-Template path uses; it
      // preserves boundField/token metadata. Computed here inside the
      // hover-stripped, selection-discarded window so editor artifacts don't
      // leak into the saved schema. Null on failure → caller falls back to
      // `schema`.
      let editedSchema: CanvasTemplateSchema | null = null;
      try {
        fabricJson = canvas.toObject(propsToInclude);
        try {
          editedSchema = reconstructSchemaFromCanvas(canvas, currentTemplate);
        } catch (schemaErr) {
          console.warn(
            "[CanvasEditor.handleExport] reconstructSchemaFromCanvas failed:",
            schemaErr,
          );
          editedSchema = null;
        }
      } catch (jsonErr) {
        // why: toObject doesn't normally throw, but if a layer carries a
        // non-serializable value in `data` we'd lose the snapshot. Log,
        // then surface an empty object so the rest of the save still
        // succeeds (image already uploaded, row writes with null
        // fabric_json → reopen falls back to schema hydration). Not
        // user-blocking.
        console.warn("[CanvasEditor.handleExport] toObject failed:", jsonErr);
        fabricJson = null;
      } finally {
        if (hoverForExport) {
          canvas.add(hoverForExport);
          canvas.bringObjectToFront(hoverForExport);
        }
      }

      const exportResult: CanvasExportResult = {
        file,
        dataUrl,
        // why: `schema` remains the ORIGINAL hydrated template — kept for
        // downstream consumers that key on template identity (Revert link,
        // original_template_id, post type metadata). User edits are
        // carried by `fabricJson` below; the editor prefers fabricJson on
        // reopen. Future Phase: replace this with a true Fabric→schema
        // serializer so both fields hold the same edited source of truth.
        schema: template,
        fabricJson,
        editedSchema,
        width: template.width * EXPORT_RESOLUTION_MULTIPLIER,
        height: template.height * EXPORT_RESOLUTION_MULTIPLIER,
        mimeType: "image/jpeg",
      };

      // why: await the parent's onSave so we can surface upload failures.
      // If onSave is sync (returns void, not Promise), `await` is a no-op.
      await Promise.resolve(onSave(exportResult));
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
  // why: the SaveAsTemplateModal needs the latest CanvasTemplateSchema AND
  // a half-scale PNG preview at submit-time. The schema is reconstructed
  // from the live Fabric canvas via `reconstructSchemaFromCanvas`, which
  // PRESERVES the original template's bound-field metadata + placeholder
  // tokens while overlaying the user's current layout edits. This replaces
  // the previous flow that shipped raw `canvas.toJSON()` — that path lost
  // boundField data + baked literal listing values into the saved row.
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
    let schemaJson: CanvasTemplateSchema;
    let previewImageDataUri = "";
    try {
      // why: reconstruct against the CURRENT template (post template-switch
      // / post-resize), not the initial mount template — the user may have
      // swapped templates inside Studio before saving.
      schemaJson = reconstructSchemaFromCanvas(canvas, currentTemplate);
    } catch (err) {
      console.warn("[SaveAsTemplate] reconstructSchemaFromCanvas failed:", err);
      return null;
    }
    // why: suspend the editor-only guide hooks around toDataURL — their
    // before:render throws on Fabric's offscreen export pass (see handleExport).
    overlayHooksRef.current?.suspend();
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
    } finally {
      overlayHooksRef.current?.resume();
    }
    return { schemaJson, previewImageDataUri };
  }, [currentTemplate]);

  // -------------------------------------------------------------------------
  // 2026-05-28 — "Apply layout to all slides" handler (multi-OH carousels)
  // -------------------------------------------------------------------------
  //
  // why: when the user has edited a slide in a multi-OH carousel and wants
  // those LAYOUT changes (logo position, date font size, address placement)
  // pushed to every sibling slide WITHOUT re-doing the work manually, this
  // handler builds the propagation payload and hands it off to the parent's
  // `onApplyLayoutToSiblings` callback for persistence.
  //
  // Approach:
  //   1. reconstructSchemaFromCanvas — read fresh values off the Fabric
  //      canvas while PRESERVING boundField/text/src/hideIfEmpty (which we
  //      explicitly DON'T propagate). This is the same helper the
  //      Save-as-Template flow uses, so layout reads are consistent.
  //   2. Walk the schema and call `extractLayoutDelta` on each layer to
  //      produce the `CarouselLayoutOverrides` map keyed by layer id.
  //   3. Forward to the parent. The parent owns the server call + the next-
  //      slide-load merge.
  //
  // why we never touch text content / image src / boundField:
  //   extractLayoutDelta is the source of truth for what propagates. It
  //   excludes those fields by design — the per-slide data (each property's
  //   address, photo, hosting agent) must stay distinct. See
  //   layout-delta.ts for the LayoutDelta contract.
  //
  // Idempotency: if the user hasn't actually moved anything, the deltas
  // match the canonical template values, so applying them is a no-op on
  // every sibling slide.
  const handleApplyLayoutToSiblings = useCallback(async (): Promise<void> => {
    if (!onApplyLayoutToSiblings) return;
    if (applyLayoutPending) return;
    const canvas = fabricRef.current;
    if (!canvas) return;
    setApplyLayoutPending(true);
    setApplyLayoutResult(null);
    try {
      // why: discard active selection so we don't snapshot the selection-
      // corner artwork into the reconstructed layer entries.
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      const schemaJson = reconstructSchemaFromCanvas(canvas, currentTemplate);
      const overrides: CarouselLayoutOverrides = {};
      for (const layer of schemaJson.layers) {
        overrides[layer.id] = extractLayoutDelta(layer);
        // why: recurse into group children so a layout edit inside a group
        // (rare today, allowed by schema) still propagates.
        if (layer.kind === "group") {
          for (const child of layer.children) {
            overrides[child.id] = extractLayoutDelta(child);
          }
        }
      }
      const res = await onApplyLayoutToSiblings(
        overrides as unknown as Record<string, unknown>,
      );
      if (res.ok) {
        setApplyLayoutResult({ kind: "ok", slideCount: res.slide_count });
      } else {
        setApplyLayoutResult({ kind: "err", message: res.error });
      }
    } catch (err) {
      setApplyLayoutResult({
        kind: "err",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplyLayoutPending(false);
    }
  }, [
    onApplyLayoutToSiblings,
    applyLayoutPending,
    currentTemplate,
  ]);

  // why: auto-clear the success/error pill after 4s so it doesn't linger.
  // The clear runs ONLY when there's a result to clear — the cleanup
  // function clears the timer if the user fires another apply before the
  // 4s elapses (so the new result's timer restarts cleanly).
  useEffect(() => {
    if (!applyLayoutResult) return;
    const t = window.setTimeout(() => setApplyLayoutResult(null), 4000);
    return () => window.clearTimeout(t);
  }, [applyLayoutResult]);

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

      // why (2026-05-31): Escape should DESELECT the current object first, not
      // immediately close Studio. The overlay also listens for Escape (to
      // close); we stop propagation here so a stray Escape while a photo is
      // selected just clears the selection instead of kicking the author out
      // of the editor (which read as "I can't get my handles back").
      if (e.key === "Escape") {
        const target0 = e.target as HTMLElement | null;
        const inField =
          target0 &&
          (target0.tagName === "INPUT" ||
            target0.tagName === "TEXTAREA" ||
            target0.isContentEditable);
        if (!inField && canvas.getActiveObject()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          return;
        }
      }

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
          onCanvasMutated: () => bumpUserLayerVersion(),
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
  // Escape → deselect (NOT close Studio). 2026-05-31.
  // -------------------------------------------------------------------------
  // why: the overlay shell ALSO listens for Escape to close Studio. Pressing
  // Escape with a photo selected was closing the whole editor (kicking the
  // author back to Template Details). We run this in the CAPTURE phase so it
  // fires before the overlay's bubble-phase handler regardless of mount order;
  // if something is selected we clear it and stop the event so the overlay
  // never sees it. With nothing selected, Escape still closes Studio.
  useEffect(() => {
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (inField) return;
      const active = canvas.getActiveObject();
      if (active && (active as { isEditing?: boolean }).isEditing) return;
      if (!active) return; // nothing selected → let the overlay close Studio
      e.preventDefault();
      e.stopImmediatePropagation();
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    };
    window.addEventListener("keydown", onKeyCapture, true);
    return () => window.removeEventListener("keydown", onKeyCapture, true);
  }, []);

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
  // 2026-07-24 — selection-aware FloatingToolbar docking
  // -------------------------------------------------------------------------
  // why (Larissa's 7/24 screen recording): the toolbar docks across the TOP
  // of the canvas area, and on smaller windows the fitted canvas reaches
  // right up under it. Selecting anything near the top of the slide (the
  // date/time block, the "Open" script) made the toolbar land ON the very
  // object being edited, with no way to pan the slide out from under it.
  // Fix: measure the active selection's on-screen position; when it sits in
  // the toolbar's top band (and not also in the bottom band), dock the
  // toolbar at the BOTTOM of the canvas area instead. Falls back to top on
  // any measurement hiccup.
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const [toolbarDock, setToolbarDock] = useState<"top" | "bottom">("top");
  // Pan offset (declared here because the dock effect below re-measures
  // whenever the view is panned; full pan implementation further down).
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const canvas = fabricRef.current;
    const area = canvasAreaRef.current;
    if (!canvas || !area) return;
    const active = canvas.getActiveObject();
    if (!active) {
      setToolbarDock("top");
      return;
    }
    try {
      // Zoom is applied via CSS transform on the canvas element (not
      // fabric's viewportTransform), so getBoundingRect() is in template
      // coordinates and the element's DOM rect carries the on-screen scale.
      const objRect = active.getBoundingRect();
      const el = canvas.getElement();
      const elRect = el.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      const scale = elRect.height / Math.max(1, canvas.getHeight());
      const objTop = elRect.top - areaRect.top + objRect.top * scale;
      const objBottom = objTop + objRect.height * scale;
      // Bands: top-6 (24px) + toolbar rows that wrap to 2 on narrow
      // windows (~110px); bottom band mirrors with a single-row estimate.
      const TOP_BAND_PX = 140;
      const BOTTOM_BAND_PX = 100;
      const inTopBand = objTop < TOP_BAND_PX;
      const inBottomBand = objBottom > areaRect.height - BOTTOM_BAND_PX;
      setToolbarDock(inTopBand && !inBottomBand ? "bottom" : "top");
    } catch {
      setToolbarDock("top");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.layerId, selection.isMulti, selection.count, layerVersion, zoom, displayScale, pan]);

  // -------------------------------------------------------------------------
  // 2026-07-24 (John) — canvas panning, Canva-style
  // -------------------------------------------------------------------------
  // Three ways to move the slide around the viewport:
  //   1. Hold SPACE and drag anywhere (hand cursor, exactly like Canva).
  //      While space is held the fabric canvas's pointer events are
  //      suspended so a drag can never grab/move an object by accident.
  //   2. Click-drag the dark background AROUND the slide.
  //   3. Trackpad / mouse-wheel scrolling pans; ctrl/cmd+wheel (trackpad
  //      pinch) zooms around the current view.
  // "Fit" resets both zoom and pan. Pan also resets when switching slides
  // (sessionKey change) so each slide opens centered.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panActive, setPanActive] = useState(false);
  const spaceHeldRef = useRef(false);
  const panDragRef = useRef<{
    pointerStartX: number;
    pointerStartY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);

  /** Clamp so at least a slice of the card always stays visible — a wild
   *  fling can't lose the slide entirely (Fit rescues regardless). */
  const clampPan = useCallback(
    (p: { x: number; y: number }): { x: number; y: number } => {
      const area = canvasAreaRef.current;
      if (!area) return p;
      const cardW = template.width * displayScale * zoom;
      const cardH = template.height * displayScale * zoom;
      const maxX = area.clientWidth / 2 + cardW / 2 - 80;
      const maxY = area.clientHeight / 2 + cardH / 2 - 80;
      return {
        x: Math.max(-maxX, Math.min(maxX, p.x)),
        y: Math.max(-maxY, Math.min(maxY, p.y)),
      };
    },
    [template.width, template.height, displayScale, zoom],
  );

  // Space key → hand tool. Guarded so typing a space into text (fabric
  // inline editing or any input/textarea) never triggers panning.
  useEffect(() => {
    const isTypingContext = (): boolean => {
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if ((el as HTMLElement).isContentEditable) return true;
      }
      const active = fabricRef.current?.getActiveObject() as
        | { isEditing?: boolean }
        | undefined
        | null;
      return active?.isEditing === true;
    };
    const down = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTypingContext()) return;
      e.preventDefault(); // stop the page/scroll-space default
      spaceHeldRef.current = true;
      setSpaceHeld(true);
      const upper = fabricRef.current?.upperCanvasEl as
        | HTMLCanvasElement
        | undefined;
      if (upper) upper.style.pointerEvents = "none";
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      const upper = fabricRef.current?.upperCanvasEl as
        | HTMLCanvasElement
        | undefined;
      if (upper) upper.style.pointerEvents = "";
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      // Defensive: never leave the canvas input-dead on unmount mid-hold.
      const upper = fabricRef.current?.upperCanvasEl as
        | HTMLCanvasElement
        | undefined;
      if (upper) upper.style.pointerEvents = "";
    };
  }, []);

  /** Begin a pan drag from a mousedown; window-level listeners track the
   *  move so the drag survives leaving the area element. */
  const beginPanDrag = useCallback(
    (clientX: number, clientY: number): void => {
      panDragRef.current = {
        pointerStartX: clientX,
        pointerStartY: clientY,
        panStartX: pan.x,
        panStartY: pan.y,
      };
      setPanActive(true);
      const move = (e: MouseEvent): void => {
        const d = panDragRef.current;
        if (!d) return;
        setPan(
          clampPan({
            x: d.panStartX + (e.clientX - d.pointerStartX),
            y: d.panStartY + (e.clientY - d.pointerStartY),
          }),
        );
      };
      const upListener = (): void => {
        panDragRef.current = null;
        setPanActive(false);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", upListener);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", upListener);
    },
    [pan.x, pan.y, clampPan],
  );

  const handleAreaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      // Space-drag pans from anywhere; without space, only a drag that
      // STARTS on the dark background (the area div itself or the card's
      // shadow frame, not the canvas) pans — clicks on the canvas keep
      // their normal select/move behavior.
      if (e.button !== 0) return;
      const onBackground = e.target === e.currentTarget;
      if (!spaceHeldRef.current && !onBackground) return;
      e.preventDefault();
      beginPanDrag(e.clientX, e.clientY);
    },
    [beginPanDrag],
  );

  // Wheel: pan (natural trackpad scrolling) or ctrl/cmd+wheel zoom (pinch).
  // Native non-passive listener because React's synthetic wheel can't
  // preventDefault reliably (browser marks it passive at the document root).
  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Pinch/ctrl zoom — same clamps as the footer control.
        setZoom((z) => {
          const next = z * (e.deltaY < 0 ? 1.05 : 0.95);
          return Math.max(0.25, Math.min(2, +next.toFixed(3)));
        });
        return;
      }
      setPan((p) =>
        clampPan({ x: p.x - e.deltaX, y: p.y - e.deltaY }),
      );
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [clampPan]);

  // Re-center when switching slides / editing identity.
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [sessionKey, template.id]);

  // -------------------------------------------------------------------------
  // 2026-05-26 — FontPickerPanel selection wiring
  // -------------------------------------------------------------------------
  // why: keep the panel locally coherent with the selected text object —
  // reading fontFamily off the active Fabric object so the panel highlights
  // the current font, and snapping the panel closed when the user
  // deselects (no point in an open panel with no text to apply to).
  const activeFontFamily = useMemo<string>(() => {
    if (selectionMode !== "text") return "";
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!(active instanceof Textbox)) return "";
    return String(active.fontFamily ?? "");
    // why: layerVersion bumps on any mutation; selection.layerId flips on
    // selection changes. Together they catch every case where the font
    // could have changed without us reading it.
  }, [selectionMode, selection.layerId, layerVersion]);

  // why: every distinct fontFamily currently on the canvas. Used by the
  // "Document fonts" section of the panel. We walk getObjects() once per
  // layerVersion bump (which fires on add/remove/modify) so the section
  // reflects the live state without polling.
  const documentFontValues = useMemo<ReadonlyArray<string>>(() => {
    const canvas = fabricRef.current;
    if (!canvas) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const obj of canvas.getObjects()) {
      if (!(obj instanceof Textbox)) continue;
      const fam = String(obj.fontFamily ?? "");
      if (!fam || seen.has(fam)) continue;
      seen.add(fam);
      result.push(fam);
    }
    return result;
  }, [layerVersion]);

  // why: close the panel when text selection clears. Without this, the
  // user could leave the panel open and clicking a font would do nothing
  // (no Textbox is active to receive the change). Canva snaps closed in
  // the same situation.
  useEffect(() => {
    if (selectionMode !== "text" && fontPickerOpen) {
      setFontPickerOpen(false);
    }
  }, [selectionMode, fontPickerOpen]);

  // why: same auto-close behavior for the Effects panel — if the user
  // deselects (or the active object isn't a Textbox anymore), the panel has
  // nothing to apply to. Close it so the left rail goes back to whichever
  // tab was underneath.
  useEffect(() => {
    if (selectionMode !== "text" && effectsPanelOpen) {
      setEffectsPanelOpen(false);
    }
  }, [selectionMode, effectsPanelOpen]);

  // why: FontPicker + Effects + ColorPicker panels all occupy the same
  // left:64px slot. Without mutual exclusion they'd overlap visually
  // (last-mounted wins). Whichever one opens wins — close the others.
  const openFontPicker = useCallback(() => {
    setEffectsPanelOpen(false);
    setColorPickerPanel(null);
    setFontPickerOpen((v) => !v);
  }, []);
  const openEffectsPanel = useCallback(() => {
    setFontPickerOpen(false);
    setColorPickerPanel(null);
    setEffectsPanelOpen((v) => !v);
  }, []);
  // why: ColorPickerPanel — invoked from every ColorPicker trigger AND from
  // the ScenePropertiesPanel + footer "Background color" triggers. Takes the
  // target + the current value (the panel reads live state via props too, so
  // initialValue is mostly belt-and-braces for the first paint). Setting this
  // to a non-null value triggers the panel mount via the conditional render
  // below.
  const openColorPicker = useCallback(
    (target: ColorTarget, initialValue: string) => {
      setFontPickerOpen(false);
      setEffectsPanelOpen(false);
      setColorPickerPanel({ target, initialValue });
    },
    [],
  );
  const closeColorPicker = useCallback(() => {
    setColorPickerPanel(null);
  }, []);

  // why: apply a font from the panel by reaching directly into the active
  // text object — same mechanism the floating toolbar uses. Record history
  // so each font swap is its own undo step (matches Canva's behavior:
  // every distinct font change is undoable).
  const applyFontFromPanel = useCallback(
    (next: string): void => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!(active instanceof Textbox)) return;
      active.set({ fontFamily: next });
      canvas?.requestRenderAll();
      bumpUserLayerVersion();
      history.record();
    },
    [history],
  );

  // -------------------------------------------------------------------------
  // 2026-05-26 — ColorPickerPanel wiring
  // -------------------------------------------------------------------------
  // why: write to the appropriate Fabric property based on the current
  // target. Live drag previews go through `previewColorFromPanel` (no history)
  // and final commits go through `applyColorFromPanel` (records history).
  // Without the split, an HsvPicker drag would create one undo step per
  // pixel — unusable.
  const writeColorToTarget = useCallback(
    (target: ColorTarget, value: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (target === "background") {
        // why: Fabric's canvas.backgroundColor is typed as `string | TFiller`
        // (no undefined). Store the empty string for "no fill" — the export
        // pipeline already treats falsy / "transparent" the same way
        // (forced white during PNG export). Storing "" keeps the type
        // stable while still rendering as transparent in the editor.
        canvas.backgroundColor =
          value === "transparent" || value === "" ? "" : value;
      } else {
        const active = canvas.getActiveObject();
        if (!active) return;
        switch (target) {
          case "text":
            if (active instanceof Textbox) active.set({ fill: value });
            break;
          case "shape_fill":
            active.set({ fill: value });
            break;
          case "shape_stroke":
            active.set({ stroke: value });
            break;
          case "text_background":
            if (active instanceof Textbox) {
              active.set({
                backgroundColor:
                  value === "transparent" || value === "" ? "" : value,
              });
            }
            break;
        }
      }
      canvas.requestRenderAll();
    },
    [],
  );

  const applyColorFromPanel = useCallback(
    (value: string): void => {
      const state = colorPickerPanel;
      if (!state) return;
      writeColorToTarget(state.target, value);
      bumpUserLayerVersion();
      history.record();
    },
    [colorPickerPanel, writeColorToTarget, history],
  );

  const previewColorFromPanel = useCallback(
    (value: string): void => {
      const state = colorPickerPanel;
      if (!state) return;
      writeColorToTarget(state.target, value);
      // why: we still bump layerVersion so any downstream subscribers (the
      // contextual toolbar's local mirror, the right panel's swatch chip)
      // re-read and reflect the live color. History is NOT recorded — the
      // pointer-up commit anchors the undo step.
      bumpUserLayerVersion();
    },
    [colorPickerPanel, writeColorToTarget],
  );

  // why: read the live target value for the panel each render. For "background"
  // we read canvas.backgroundColor; for selection-driven targets we re-read
  // the active object. Bumps off layerVersion + colorPickerPanel.target so
  // external mutations (e.g., user picks a different layer with a different
  // fill) bubble through.
  const colorPickerCurrentValue = useMemo<string>(() => {
    const state = colorPickerPanel;
    if (!state) return "";
    const canvas = fabricRef.current;
    if (!canvas) return state.initialValue;
    if (state.target === "background") {
      const bg = canvas.backgroundColor;
      return typeof bg === "string" && bg.length > 0 ? bg : "transparent";
    }
    const active = canvas.getActiveObject();
    if (!active) return state.initialValue;
    switch (state.target) {
      case "text":
        if (active instanceof Textbox) {
          const fill = active.fill;
          return typeof fill === "string" ? fill : state.initialValue;
        }
        return state.initialValue;
      case "shape_fill": {
        const fill = active.fill;
        return typeof fill === "string" ? fill : state.initialValue;
      }
      case "shape_stroke": {
        const stroke = active.stroke;
        return typeof stroke === "string" ? stroke : state.initialValue;
      }
      case "text_background":
        if (active instanceof Textbox) {
          const bg = active.backgroundColor;
          return typeof bg === "string" && bg.length > 0 ? bg : "transparent";
        }
        return state.initialValue;
      default:
        return state.initialValue;
    }
    // why: depends on colorPickerPanel (target identity) AND layerVersion
    // (any mutation could shift the value). selection.layerId catches the
    // "selection changed underneath the panel" case which doesn't always
    // bump layerVersion.
  }, [colorPickerPanel, layerVersion, selection.layerId]);

  // why: "Colors in this design" — walk the canvas's current objects for
  // distinct hex/rgb fill/stroke/backgroundColor values. Cheap enough to
  // recompute on every render with the panel open; gated on `colorPickerPanel`
  // so a closed picker doesn't iterate.
  const colorPickerDocumentColors = useMemo<ReadonlyArray<string>>(() => {
    if (!colorPickerPanel) return [];
    const canvas = fabricRef.current;
    if (!canvas) return [];
    const seen = new Set<string>();
    const addIfHex = (raw: unknown): void => {
      if (typeof raw !== "string") return;
      const lower = raw.trim();
      if (!lower) return;
      if (lower.startsWith("#") || lower.startsWith("rgb")) {
        seen.add(lower.toUpperCase());
      }
    };
    for (const obj of canvas.getObjects()) {
      addIfHex(obj.fill);
      addIfHex(obj.stroke);
      if (obj instanceof Textbox) {
        addIfHex(obj.backgroundColor);
      }
    }
    return Array.from(seen).slice(0, 12);
    // why: layerVersion bumps on add/remove/modify so the section adapts to
    // live edits without polling.
  }, [colorPickerPanel, layerVersion]);

  // why: "Photo colors" — extract dominant palette from every FabricImage on
  // the canvas. Median-cut quantization via the same primitive the legacy
  // popover used. Memoized per canvas-instance reference; recomputes when
  // the canvas reference changes (template reload).
  const [colorPickerPhotoColors, setColorPickerPhotoColors] = useState<
    ReadonlyArray<string>
  >([]);
  const photoColorsExtractedForRef = useRef<unknown>(null);
  useEffect(() => {
    if (!colorPickerPanel) return;
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (photoColorsExtractedForRef.current === canvas) return;
    const imageObjs = canvas
      .getObjects()
      .filter((o): o is FabricImage => o instanceof FabricImage);
    if (imageObjs.length === 0) {
      setColorPickerPhotoColors([]);
      photoColorsExtractedForRef.current = canvas;
      return;
    }
    const COLORS_PER_IMAGE = 4;
    const combined: string[] = [];
    for (const img of imageObjs) {
      const el = img.getElement();
      if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) {
        combined.push(...extractPhotoColors(el, COLORS_PER_IMAGE));
      }
    }
    const deduped = Array.from(new Set(combined)).slice(0, 12);
    setColorPickerPhotoColors(deduped);
    photoColorsExtractedForRef.current = canvas;
  }, [colorPickerPanel]);

  // why: live read of canvas.backgroundColor so the LayerListPanel's
  // "Background color" swatch + the footer's swatch reflect the current
  // value. Bumps off layerVersion so any mutation (including the panel's
  // own commits) re-derives. Falls back to "transparent" when Fabric
  // holds undefined (matches the export pipeline's understanding).
  const canvasBackgroundColor = useMemo<string>(() => {
    const canvas = fabricRef.current;
    const bg = canvas?.backgroundColor;
    if (typeof bg === "string" && bg.length > 0) return bg;
    return "transparent";
    // why: layerVersion bumps on every mutation; we treat any bump as a
    // potential bg change. Cheap memo.
  }, [layerVersion]);

  // why: whether the ColorPickerPanel currently allows the "transparent"
  // neutral chip. Background + shape stroke + text highlight allow no-fill;
  // text fill + shape fill (gradients aside) don't.
  const colorPickerAllowsTransparent = useMemo<boolean>(() => {
    if (!colorPickerPanel) return false;
    switch (colorPickerPanel.target) {
      case "shape_stroke":
      case "text_background":
      case "background":
        return true;
      case "text":
      case "shape_fill":
        return false;
    }
  }, [colorPickerPanel]);

  // why: auto-close when the selection that triggered the panel goes away.
  // Skipped for "background" — that target isn't selection-dependent and
  // should stay open while the user clicks around the canvas.
  useEffect(() => {
    if (!colorPickerPanel) return;
    if (colorPickerPanel.target === "background") return;
    const needsText =
      colorPickerPanel.target === "text" ||
      colorPickerPanel.target === "text_background";
    const needsShape =
      colorPickerPanel.target === "shape_fill" ||
      colorPickerPanel.target === "shape_stroke";
    if (needsText && selectionMode !== "text") {
      setColorPickerPanel(null);
    } else if (needsShape && selectionMode !== "shape") {
      setColorPickerPanel(null);
    }
  }, [selectionMode, colorPickerPanel]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const effectiveSaving = isSaving || isLocalSaving;

  // 2026-08-04 — mirror of the FloatingToolbar's render condition below.
  // The warning strips must never sit ON TOP of the toolbar (they carry a
  // higher z-index), so when the toolbar is up and docked at the top the
  // amber strip shifts down below the toolbar band instead.
  const floatingToolbarUp = Boolean(
    ((selectedEntry && !selectedEntry.locked) ||
      (selection.isMulti && selection.count > 0)) &&
      fabricRef.current,
  );
  const floatingToolbarDockedTop = floatingToolbarUp && toolbarDock === "top";

  return (
    <div className="flex h-full w-full flex-col bg-[var(--studio-bg)] text-[var(--studio-text)]">
      {/* ----- Header — Canva-style 48px translucent compact bar -----
          why: drop from the prior ~56-72px chunky header to a tight 48px
          bar that feels closer to the Canva editor chrome. Title +
          listing/dimensions live on one row, separated by a 4px dot. The
          right cluster condenses to Resize / Save / Close with tighter
          gaps. Translucent (bg-white/95 + backdrop-blur) gives a hint of
          depth without competing with the canvas as the focal point. */}
      <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-[var(--studio-border)] bg-[var(--studio-bg)] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* why: small file-icon glyph anchors the title block — same visual
              affordance Canva uses at the leftmost edge of its top bar. */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--studio-hover)] text-[var(--studio-text-muted)]">
            <LFileText size={14} />
          </span>
          <span className="truncate text-[13px] font-semibold text-white">
            {template.name}
          </span>
          {/* why: 4px dot separator (Canva's pattern). The dot is neutral-300
              so it reads as a passive separator, not a brand accent. */}
          <span
            aria-hidden="true"
            className="inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--studio-text-faint)]"
          />
          <span className="truncate text-[11px] text-[var(--studio-text-muted)]">
            {listing.addressLine1 ?? listing.mlsNumber}
            <span className="mx-1.5 text-[var(--studio-text-faint)]">·</span>
            {template.width}×{template.height}
          </span>
          {/* 2026-05-25 — Undo / Redo moved here from the canvas footer to
              match Canva's chrome (per John's screenshot). Visual divider on
              both sides isolates the pair from the title cluster and the
              spacer that follows. Cmd+Z / Cmd+Shift+Z shortcuts remain
              wired in keyboard-shortcuts.ts → handlePhase2KeyDown. */}
          <span aria-hidden="true" className="h-5 w-px bg-[var(--studio-border)] mx-1" />
          <button
            type="button"
            onClick={() => history.undo()}
            disabled={!history.canUndo}
            aria-label="Undo"
            title="Undo (Cmd+Z)"
            className="focus-ring-dark flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:text-[var(--studio-text-faint)] disabled:hover:bg-transparent"
          >
            <LUndo2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => history.redo()}
            disabled={!history.canRedo}
            aria-label="Redo"
            title="Redo (Cmd+Shift+Z)"
            className="focus-ring-dark flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:text-[var(--studio-text-faint)] disabled:hover:bg-transparent"
          >
            <LRedo2 size={16} />
          </button>
          <span aria-hidden="true" className="h-5 w-px bg-[var(--studio-border)] mx-1" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 2026-05-29 — Resize re-homed here (Phase 2 build-out). It was
              removed from the top toolbar on 2026-05-28 during a chrome
              cleanup and never re-mounted, which left the whole resize/
              reformat feature unreachable even though handleResizePicked +
              the parent onResize handler were fully wired. The menu emits a
              target PostFormat; handleResizePicked swaps to the sibling
              template and the parent treats it as a new sibling post.
              (Save as Template + primary Save still live in the bottom bar.) */}
          <ResizeMenu
            currentFormat={currentTemplate.format}
            options={buildResizeMenuOptions(
              currentTemplate.category,
              currentTemplate.variant,
              currentTemplate.format,
            )}
            onPick={handleResizePicked}
          />
          <span
            aria-hidden="true"
            className="h-5 w-px bg-[var(--studio-border)] mx-0.5"
          />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              title="Close editor"
              className="focus-ring-dark ml-0.5 flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)]"
            >
              <LX size={16} />
            </button>
          ) : null}
        </div>
        {/* why: subtle inner shadow on the bottom edge sells the elevation —
            cheap depth cue without a heavy shadow bleeding onto the canvas
            area. Pure decorative span absolutely positioned at the bottom. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--studio-border)]"
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
        <aside className="flex shrink-0 border-r border-[var(--studio-border)] bg-[var(--studio-bg)]">
          {/* Icon rail — 64px wide, always visible. why: a constant
              spatial anchor lets the user predict where their nav lives
              regardless of which panel happens to be open or collapsed. */}
          <nav
            aria-label="Editor sidebar"
            className="flex w-16 shrink-0 flex-col items-stretch border-r border-[var(--studio-border)] bg-[var(--studio-bg)] py-2"
          >
            <SidebarRailButton
              label="Templates"
              icon={<LLayoutGrid size={22} />}
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
              icon={<LSquare size={22} />}
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
              icon={<LUser size={22} />}
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
              icon={<LImageIcon size={22} />}
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
            {/* Placeholders tab — Template Builder ONLY. Lets an author drop
                bound-field placeholders that re-populate on each post. Gated
                on templateAuthoring so Larissa's post-building Studio never
                sees it. */}
            {props.templateAuthoring ? (
              <SidebarRailButton
                label="Placeholders"
                icon={<LBraces size={22} />}
                active={sidebarExpanded && sidebarTab === "placeholders"}
                onClick={() => {
                  if (sidebarExpanded && sidebarTab === "placeholders") {
                    setSidebarExpanded(false);
                  } else {
                    setSidebarTab("placeholders");
                    setSidebarExpanded(true);
                  }
                }}
              />
            ) : null}
            {/* Tools tab — Canva-parity Draw/Shapes/Lines/Text popout.
                Lives at the BOTTOM of the rail (matches Canva's placement)
                so it doesn't push the established Templates/Brand/Agents/
                Photos rhythm. */}
            <SidebarRailButton
              label="Tools"
              icon={<LPencilRuler size={22} />}
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
            <div className="flex w-[280px] shrink-0 flex-col bg-[var(--studio-panel)]">
              {/* Collapse cap — title of the active tab + « collapse button.
                  why: the panel title doubles as a sense-of-place label
                  for users who collapse + re-expand frequently. The «
                  affordance mirrors the » on the right panel for
                  symmetry. */}
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                  {sidebarTab === "templates"
                    ? "Templates"
                    : sidebarTab === "brand"
                      ? "Brand"
                      : sidebarTab === "agents"
                        ? "Agents"
                        : sidebarTab === "photos"
                          ? "Photos"
                          : sidebarTab === "placeholders"
                            ? "Placeholders"
                            : "Tools"}
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarExpanded(false)}
                  aria-label="Collapse panel"
                  title="Collapse panel"
                  className="focus-ring-dark flex h-6 w-6 items-center justify-center rounded-md text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
                >
                  <LChevronsLeft size={12} />
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
                ) : sidebarTab === "placeholders" ? (
                  <PlaceholdersPanel
                    onInsert={handlePlaceholderPicked}
                    selectedKind={selectedBindableKind}
                    onBindSelected={handleBindSelectedToField}
                    onInsertSeparator={handleSeparatorInserted}
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

        {/* === 2026-05-26 — FontPickerPanel — Canva-style font browser ===
            Overlays the left sidebar at left:64px (same column as the
            expanded panel) so it temporarily covers whichever tab is
            active. Mounted as a sibling of the aside; positioned with
            `fixed` so it escapes the flex layout and sits at editor
            viewport coordinates. Z-index 30 stacks above the expanded
            panel (z-index default within the aside flow) without
            competing with modal dialogs (z-50 on the overlay backdrop). */}
        <FontPickerPanel
          open={fontPickerOpen}
          onClose={() => setFontPickerOpen(false)}
          value={activeFontFamily}
          options={FONT_OPTIONS}
          onApply={applyFontFromPanel}
          documentFontValues={documentFontValues}
          triggerRef={fontPickerTriggerRef}
        />

        {/* === 2026-05-26 — EffectsPanel — Canva-style text-effect browser ===
            Same overlay slot as FontPickerPanel (left:64px, z-30). Mutually
            exclusive with FontPickerPanel — see openFontPicker /
            openEffectsPanel helpers above which close the other one before
            toggling. */}
        <EffectsPanel
          open={effectsPanelOpen}
          onClose={() => setEffectsPanelOpen(false)}
          canvas={fabricRef.current}
          selectionVersion={layerVersion}
          onCanvasMutated={() => bumpUserLayerVersion()}
          recordHistory={history.record}
        />

        {/* === 2026-05-26 — ColorPickerPanel — Canva-style color picker ===
            Same overlay slot as FontPickerPanel + EffectsPanel
            (left:64px, z-30, 320px wide). Mutually exclusive with both —
            see openFontPicker / openEffectsPanel / openColorPicker helpers
            above. Replaces the legacy in-place popover that used to live
            inside primitives/ColorPicker.tsx. */}
        {colorPickerPanel ? (
          <ColorPickerPanel
            open
            target={colorPickerPanel.target}
            currentValue={colorPickerCurrentValue}
            documentColors={colorPickerDocumentColors}
            photoColors={colorPickerPhotoColors}
            allowTransparent={colorPickerAllowsTransparent}
            onApply={applyColorFromPanel}
            onPreview={previewColorFromPanel}
            onClose={closeColorPicker}
          />
        ) : null}

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
            ref={canvasAreaRef}
            onMouseDown={handleAreaMouseDown}
            className="canvas-bg-pattern relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6"
            style={{
              // 2026-07-24 — pan affordance cursors. overflow switched
              // auto → hidden: panning replaces native scrolling (mixing
              // both fought over the viewport).
              cursor: panActive ? "grabbing" : spaceHeld ? "grab" : undefined,
            }}
          >
            {/* 2026-05-28 — the localStorage autosave "restore?" banner that
                used to sit here was removed. Edits now persist via a debounced
                SERVER autosave (onAutosaveDesign) and are restored silently on
                reopen, so there's no prompt to confuse the user. */}

            {/* 2026-05-26 — the floating Add Layer Toolbar that used to sit
                here was removed. Its four affordances (Text / Rect / Circle /
                Line) plus three new text subtypes (Heading / Subheading /
                Paragraph) now live in the Tools panel's "Add" section in the
                left rail. Keyboard shortcuts (T/R/O/L) still work and route
                through the spawn factories re-exported by ToolsPanel. */}
            {/* 2026-05-26 — unified floating toolbar. One pill above the
                canvas with three groups: type-specific content controls
                (font/color/etc), alignment (6 directions, single+multi),
                and layer actions (forward/back/dupe/transparency/lock/
                delete). Replaces the prior two-stacked pill setup
                (ContextualTopToolbar + SelectionToolbar). */}
            {((selectedEntry && !selectedEntry.locked) ||
              (selection.isMulti && selection.count > 0)) &&
            fabricRef.current ? (
              <div
                className={[
                  "absolute z-10 flex flex-col items-center gap-1",
                  // 2026-07-24 — dock at the bottom when the selection sits
                  // under the top band (see toolbarDock effect above).
                  toolbarDock === "bottom" ? "bottom-6" : "top-6",
                ].join(" ")}
              >
                <FloatingToolbar
                  canvas={fabricRef.current}
                  mode={selectionMode === "none" ? "multi" : selectionMode}
                  selectionVersion={layerVersion}
                  selectionCount={selection.count}
                  selectedEntry={
                    selectedEntry
                      ? {
                          kind: selectedEntry.kind,
                          locked: selectedEntry.locked,
                        }
                      : null
                  }
                  onCanvasMutated={() => bumpUserLayerVersion()}
                  recordHistory={history.record}
                  onAlign={handleAlign}
                  onEnterCropMode={enterCropModeForActive}
                  onActivateResize={activateResizeForActive}
                  onOpenFontPicker={openFontPicker}
                  fontPickerOpen={fontPickerOpen}
                  onOpenEffectsPanel={openEffectsPanel}
                  effectsPanelOpen={effectsPanelOpen}
                  onOpenColorPicker={openColorPicker}
                  colorPickerOpenTarget={colorPickerPanel?.target ?? null}
                  onBringForward={handleBringForward}
                  onSendBackward={handleSendBackward}
                  onDuplicate={() => void handleDuplicateSelection()}
                  onToggleLock={handleToggleLock}
                  onDelete={handleDeleteSelection}
                  onOpacityCommit={history.record}
                />
              </div>
            ) : null}

            {/* Dimension warning — blocks export when template is malformed.
                2026-05-25 — unified to the rose-50/rose-200/rose-800 palette
                shared with the non-blocking error toast below. */}
            {dimensionWarning ? (
              <div className="absolute left-1/2 top-6 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-2 text-sm text-rose-200 shadow-lg shadow-black/40">
                <LAlertTriangle size={16} className="shrink-0" />
                <span>{dimensionWarning}</span>
              </div>
            ) : null}

            {/* 2026-07-29: empty bound-field warning. Non-blocking amber
                strip (same shape as dimensionWarning, amber palette) that
                lists the layers whose listing data is missing: the canvas
                shows their design-time fallback text, but the published
                render drops them, leaving holes the editor never showed.
                Recomputed on every hydration (listing/template change).
                Drops below the dimension warning when both are up.
                2026-08-04 (John): three fixes — (1) dismissible via X (it
                previously had no close affordance and blocked editing);
                (2) shifts BELOW the FloatingToolbar band when the toolbar
                is up and docked top, instead of rendering over it; (3) in
                template-authoring mode the copy is informational: the
                "listing" there is just a sample for visual context, so
                "won't appear on the published image" read as a broken
                template when nothing is wrong. */}
            {emptyBoundLayerNames.length > 0 && !emptyBoundWarningDismissed ? (
              <div
                className={[
                  "absolute left-1/2 z-20 flex max-w-[80%] -translate-x-1/2 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-2 text-sm text-amber-200 shadow-lg shadow-black/40",
                  floatingToolbarDockedTop && dimensionWarning
                    ? "top-48"
                    : floatingToolbarDockedTop
                      ? "top-36"
                      : dimensionWarning
                        ? "top-20"
                        : "top-6",
                ].join(" ")}
              >
                <LAlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {props.templateAuthoring ? (
                    <>
                      No sample data for:{" "}
                      {emptyBoundLayerNames.join(", ")}. These fill in from
                      the real listing when a post is created.
                    </>
                  ) : (
                    <>
                      Won&apos;t appear on the published image (no data):{" "}
                      {emptyBoundLayerNames.join(", ")}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setEmptyBoundWarningDismissed(true)}
                  aria-label="Dismiss warning"
                  className="focus-ring-dark ml-1 mt-0.5 shrink-0 text-amber-300 hover:text-amber-200"
                >
                  <LX size={16} />
                </button>
              </div>
            ) : null}

            {/* Non-blocking error toast.
                2026-05-25 — unified palette with dimensionWarning (rose-*)
                and AlertTriangle icon swapped in for visual parity. */}
            {editorError ? (
              <div className="absolute bottom-6 left-1/2 z-20 max-w-[80%] -translate-x-1/2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200 shadow-2xl shadow-black/60">
                <div className="flex items-start gap-3">
                  <LAlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span className="font-semibold uppercase tracking-wide">
                    {editorError.kind === "export" ? "Export" : "Warning"}
                  </span>
                  <span className="flex-1">{editorError.message}</span>
                  <button
                    type="button"
                    onClick={() => setEditorError(null)}
                    aria-label="Dismiss error"
                    className="focus-ring-dark text-rose-300 hover:text-rose-200"
                  >
                    <LX size={16} />
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
            {/* 2026-06-10: the matboard crop-mode 2x sizing branches and the
                floating Done/Cancel + aspect-preset bar that lived here were
                dead (cropMode could never become non-null) and were deleted
                with the rest of the matboard crop code. */}
            <div
              className="relative bg-white shadow-2xl shadow-black/60"
              style={{
                width: template.width * displayScale * zoom,
                height: template.height * displayScale * zoom,
                // 2026-07-24 — pan offset (see pan state above). Plain
                // translate keeps the flex centering as the origin, so
                // {0,0} is always "centered" and Fit can reset cleanly.
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            >
              {/* why (2026-06-10): the wrapper div is KEYED on the editing
                  identity so every canvas init gets a virgin <canvas> node.
                  Fabric v6 reparents the canvas into its own container div
                  and defers dispose() a frame when a render is queued, so
                  constructing a new Canvas on the old element could hit a
                  still-initialized node, throw, and leave the editor blank
                  until refresh. Keying the WRAPPER (not the canvas itself)
                  matters: React removes the wrapper wholesale, so Fabric's
                  injected container never confuses React's removeChild. */}
              <div
                key={`${template.id}:${listing.id}:${
                  customTemplate?.id ?? ""
                }:${sessionKey ?? ""}`}
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

          {/* === Canvas footer — zoom / background swatch ===
              2026-05-26 — alignment + distribute moved out of the footer
              and into the unified FloatingToolbar (alignment as a permanent
              group; distribute was retired). Footer is now zoom-only +
              background swatch. */}
          <CanvasFooter
            zoom={zoom}
            onZoomIn={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
            onZoomOut={() =>
              setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))
            }
            onZoomFit={() => {
              setZoom(1);
              // 2026-07-24 — Fit means "show me the whole slide again":
              // reset the pan offset along with the zoom.
              setPan({ x: 0, y: 0 });
            }}
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
            backgroundColor={canvasBackgroundColor}
            onOpenBackgroundColorPicker={(v) =>
              openColorPicker("background", v)
            }
            backgroundColorPanelOpen={
              colorPickerPanel?.target === "background"
            }
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
          <div className="flex w-[280px] shrink-0 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-panel)]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                {selectionMode === "none" ? "Layers" : "Properties"}
              </span>
              <button
                type="button"
                onClick={() => setLayersExpanded(false)}
                aria-label="Collapse layers panel"
                title="Collapse layers panel"
                className="focus-ring-dark flex h-6 w-6 items-center justify-center rounded-md text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
              >
                <LChevronsRight size={12} />
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
                {/* why (2026-05-23, Canva-parity text toolbar): when a TEXT
                    layer is selected, the right panel reverts to the layer
                    list. ALL text editing now lives in the floating top
                    toolbar (FloatingToolbar text controls), matching Canva
                    exactly. The right-panel TextPropertiesControls file is
                    intentionally kept on disk as a fallback / future
                    reference but is no longer reachable from the
                    orchestrator. */}
                {selectionMode === "none" || selectionMode === "text" ? (
                  <LayerListPanel
                    entries={layerEntries}
                    selectedLayerId={selection.layerId}
                    onSelect={handleSelectLayer}
                    onToggleVisibility={handleToggleLayerVisibility}
                    onDelete={handleDeleteLayer}
                    onReorder={handleReorderLayers}
                    onHoverEntry={handleHoverEntry}
                    backgroundColor={canvasBackgroundColor}
                    onOpenBackgroundColorPicker={(v) =>
                      openColorPicker("background", v)
                    }
                    backgroundColorPanelOpen={
                      colorPickerPanel?.target === "background"
                    }
                  />
                ) : (
                  <SelectionPropertiesPanel
                    mode={selectionMode}
                    canvas={fabricRef.current}
                    listing={listing}
                    selectionVersion={layerVersion}
                    onCanvasMutated={() => bumpUserLayerVersion()}
                    onClearSelection={handleClearSelection}
                    recordHistory={history.record}
                    onOpenFontPicker={openFontPicker}
                    fontPickerOpen={fontPickerOpen}
                    onOpenEffectsPanel={openEffectsPanel}
                    effectsPanelOpen={effectsPanelOpen}
                    onOpenColorPicker={openColorPicker}
                    colorPickerOpenTarget={colorPickerPanel?.target ?? null}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          // why: collapsed rail — single 48px column with a Layers icon
          // that acts as the expand affordance. 2026-05-25 — added an
          // affordance label below the icon (writing-mode vertical-rl)
          // so the rail still reads as "Layers" when collapsed, no
          // hover required. Matches the labeled-rail pattern in the
          // left sidebar.
          <div className="flex w-12 shrink-0 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-bg)]">
            <button
              type="button"
              onClick={() => setLayersExpanded(true)}
              aria-label="Expand layers panel"
              title="Expand layers panel"
              className="focus-ring-dark group flex h-28 w-full flex-col items-center justify-center gap-1.5 text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
            >
              <LLayers size={18} />
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ writingMode: "vertical-rl" }}
              >
                Layers
              </span>
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
          // 2026-07-29: without this the strip fell back to its default of
          // 10 while the slide PICKER below caps at 9 (hero + 9 = IG's 10
          // total). The "N of max" copy in the strip overstated the budget
          // by one; keep both surfaces on the same number.
          maxSlides={9}
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

      {/* === 2026-05-28 — Bottom action bar ===
          why: relocated the primary Save CTA + Save as Template out of the
          top toolbar so the editor chrome reads top-down "title → canvas →
          act on it." Matches the standard footer pattern (secondary left,
          primary right). Always renders so template-author + Studio modes
          both get the Save affordance; Save as Template only renders when
          the parent wired `onSaveAsTemplate`. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--studio-border)] bg-[var(--studio-bg)] px-4 py-3">
        <div className="flex items-center gap-1.5">
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
              className="focus-ring-dark inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--studio-border)] bg-transparent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--studio-hover)] hover:border-gold-400 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LBookmarkPlus size={14} />
              {customTemplate ? "Update template" : "Save as Template"}
            </button>
          ) : null}
          {/* 2026-05-28 — "Apply layout to all slides" (Multi-OH carousels).
              Surfaced only when the parent wired onApplyLayoutToSiblings,
              which itself only fires for multi-OH posts with ≥2 sibling
              slides. Idempotent on the server side, so a misfire is
              harmless. The result pill renders to the right of the button
              for 4s after the action resolves. */}
          {onApplyLayoutToSiblings ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void handleApplyLayoutToSiblings();
                }}
                disabled={
                  effectiveSaving ||
                  applyLayoutPending ||
                  dimensionWarning !== null
                }
                aria-label="Apply this slide's layout to every other slide in the carousel"
                title="Apply this slide's layout to every other slide in the carousel. Each slide keeps its own listing data + hosting agent."
                className="focus-ring-dark inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--studio-border)] bg-transparent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--studio-hover)] hover:border-gold-400 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applyLayoutPending ? (
                  <LLoader2 size={14} className="animate-spin" />
                ) : (
                  <LLayers size={14} />
                )}
                Apply layout to all slides
              </button>
              {applyLayoutResult ? (
                <span
                  role="status"
                  aria-live="polite"
                  className={[
                    "ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium",
                    applyLayoutResult.kind === "ok"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-red-500/15 text-red-300",
                  ].join(" ")}
                >
                  {applyLayoutResult.kind === "ok" ? (
                    <>
                      <LCheck size={12} />
                      Applied to {applyLayoutResult.slideCount} slides
                    </>
                  ) : (
                    <>
                      <LAlertTriangle size={12} />
                      {applyLayoutResult.message}
                    </>
                  )}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {onAutosaveDesign ? (
            // 2026-07-24 (John) — explicit "Save Changes" so a slide's
            // edits are guaranteed saved before switching to another slide
            // (see the runAutosaveNow/unmount-flush comment above). The
            // debounced autosave already covers most cases 1s after the
            // last edit, but switching slides right after a quick edit
            // could previously beat that timer; this button (plus the
            // unmount-flush) closes the gap and gives visible confirmation.
            <button
              type="button"
              onClick={handleManualSave}
              disabled={effectiveSaving || dimensionWarning !== null}
              aria-label="Save changes to this slide"
              title="Save this slide's changes now — do this before switching to another slide"
              className="focus-ring-dark inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--studio-border)] bg-transparent px-3 text-[13px] font-semibold text-[var(--studio-text)] transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {manualSaveState === "saved" ? (
                <>
                  <LCheck size={16} className="text-emerald-400" />
                  Saved
                </>
              ) : (
                <>
                  <LSave size={16} />
                  Save Changes
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExport}
            disabled={effectiveSaving || dimensionWarning !== null}
            className="focus-ring-dark inline-flex h-9 items-center gap-1.5 rounded-md bg-gold-500 px-4 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {effectiveSaving ? (
              <span className="flex items-center gap-1.5">
                <LLoader2 size={16} className="animate-spin" />
                Saving…
              </span>
            ) : (
              <>
                <LSave size={16} />
                {saveLabel ?? "Continue to Final Review"}
                <LArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* === Phase 5 — Carousel slide picker (modal) === */}
      {carousel ? (
        <CarouselSlidePicker
          open={carouselPickerOpen}
          photos={carousel.availableListingPhotos}
          existingSlides={carousel.slides}
          // 2026-07-24 — 9, not 10: the hero publishes as slide 0 on
          // single-listing carousels, so 10 picked slides made 11 images
          // and Instagram (hard cap 10) rejected the whole carousel.
          maxSlides={9}
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

// 2026-05-26 — SelectionToolbar / TransparencyButton / TransparencyIcon /
// IconButton were consolidated into ./panels/FloatingToolbar.tsx as a single
// unified pill (type-specific group + alignment group + layer-actions group).
// The deleted blocks lived here previously.


function LayerKindIcon({ kind }: { kind: CanvasLayer["kind"] }): JSX.Element {
  // why: visual cue in the layer panel so the user can scan kind at a glance.
  // 2026-05-25 — backed by lucide-react. Tiny 14px icons match the panel's
  // row height without adding visual noise.
  switch (kind) {
    case "text":
      return <LType size={14} />;
    case "image":
      return <LImageIcon size={14} />;
    case "shape":
      return <LShapes size={14} />;
    case "group":
      return <LLayers size={14} />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// ===========================================================================
// SECTION 5 — Icons (lucide-react)
// ===========================================================================
//
// 2026-05-25 — Migrated from inline SVG to lucide-react. The dead old icon
// components were removed. Imports live at the top of the file under the
// `L…` alias convention (e.g., `LUndo2`, `LSparkles`) so they don't shadow
// any local symbols. See SECTION 7 below for the small set of bespoke
// canvas-specific glyphs that DON'T have a Lucide equivalent (currently
// just the legacy align icons — pending removal).
// ---------------------------------------------------------------------------

// why: Phase 4 — Smart Resize. Build the menu option list for the current
// (category, variant) tuple, checking the registry to mark each target
// format as available or disabled. Disabled = no canvas template exists
// for the (category, variant, target format) tuple — typically because a
// variant only ships at 2 of 3 formats during an in-progress factory port.
// Keeps the menu honest: we never let the user pick an option that would
// fail in `handleResizePicked`'s `findCanvasTemplate` lookup.
/**
 * Derive the crop frame rect (canvas-space) for an image entering crop mode.
 *
 * 2026-05-29 (Canva-parity P1.1): crop used to bail when the image had no
 * Rect clipPath — AI-designed / older images silently couldn't be cropped.
 * Now, when there's no Rect clip, we synthesize the frame from the image's
 * current DISPLAYED bounds (left/top + natural dims × scale), so ANY image
 * can be cropped. On crop exit a real Rect clipPath is built at the frame.
 */
function deriveCropFrameRect(img: FabricImage): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const clip = img.clipPath;
  if (clip instanceof Rect) {
    return {
      left: (clip as unknown as { left?: number }).left ?? 0,
      top: (clip as unknown as { top?: number }).top ?? 0,
      width: (clip as unknown as { width?: number }).width ?? 0,
      height: (clip as unknown as { height?: number }).height ?? 0,
    };
  }
  const scaleX = img.scaleX ?? 1;
  const scaleY = img.scaleY ?? 1;
  return {
    left: img.left ?? 0,
    top: img.top ?? 0,
    width: (img.width ?? 0) * scaleX,
    height: (img.height ?? 0) * scaleY,
  };
}

function buildResizeMenuOptions(
  category: CanvasTemplateSchema["category"],
  variant: CanvasTemplateSchema["variant"],
  currentFormat: PostFormat,
): readonly ResizeMenuOption[] {
  const allFormats: readonly PostFormat[] = [
    "square_1x1",
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
      className={`focus-ring-dark relative flex h-14 w-full flex-col items-center justify-center gap-0.5 transition-colors ${
        active
          ? "bg-[var(--studio-active)] text-gold-400"
          : "text-[var(--studio-text-muted)] hover:bg-[var(--studio-hover)] hover:text-white"
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
      {/* 2026-05-25 — icons are passed in at their native 22px size
          (Lucide). The scale-150 hack that previously projected the
          14px legacy SVGs up to rail size is gone — callers now pass
          `size={22}` directly to the Lucide component. */}
      <span className="flex items-center justify-center">
        {icon}
      </span>
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CanvasFooter — 40px bottom bar with zoom + slide background
// ---------------------------------------------------------------------------
//
// 2026-05-26 — alignment + distribute clusters retired from the footer.
// Alignment now lives in the unified FloatingToolbar above the canvas;
// distribute was removed entirely. Footer is now centered zoom controls +
// a right-side background swatch, with an empty left slot kept narrow so
// the zoom group reads as visually centered.
// ---------------------------------------------------------------------------

interface CanvasFooterProps {
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
  /**
   * 2026-05-26 — slide-level Background color trigger. Always visible in
   * the right cluster (no selection-gated). Clicking opens the
   * ColorPickerPanel with target="background".
   */
  backgroundColor: string;
  onOpenBackgroundColorPicker: (currentValue: string) => void;
  backgroundColorPanelOpen: boolean;
}

/**
 * Canvas footer — zoom controls + background swatch. Renders below the
 * canvas area, above the carousel strip. 40px tall, top border.
 */
function CanvasFooter(props: CanvasFooterProps): JSX.Element {
  const zoomPct = Math.round(props.zoom * 100);
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-[var(--studio-border)] bg-[var(--studio-bg)] px-3">
      {/* why: empty left slot balances the right-side background-swatch
          cluster so the zoom group in the middle reads as visually
          centered. Width matches the right cluster (`w-20`). */}
      <div className="w-20" aria-hidden="true" />

      {/* === Center cluster — zoom controls (Canva-style slider) ===
          Layout: [-] [slider track] [+] 100% Fit
          The slider is continuous (step 0.05) for smooth dragging;
          the +/- buttons stay as discrete 10% jumps so users with
          keyboard/click muscle memory still get a predictable step. */}
      <div className="flex items-center gap-2">
        <FooterIconButton label="Zoom out" onClick={props.onZoomOut}>
          <LZoomOut size={14} />
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
          className="cwk-zoom-slider h-1 w-[120px] cursor-pointer appearance-none rounded-full bg-[var(--studio-border)] accent-gold-500"
        />
        <FooterIconButton label="Zoom in" onClick={props.onZoomIn}>
          <LZoomIn size={14} />
        </FooterIconButton>
        <span className="min-w-[36px] text-center font-mono text-[11px] tabular-nums text-[var(--studio-text-muted)]">
          {zoomPct}%
        </span>
        <span className="mx-0.5 h-4 w-px bg-[var(--studio-border)]" />
        <Tooltip label="Fit to viewport" placement="top">
          <button
            type="button"
            onClick={props.onZoomFit}
            title="Fit to viewport"
            className="focus-ring-dark inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-white transition-colors hover:bg-[var(--studio-hover)]"
          >
            <LMaximize2 size={12} />
            Fit
          </button>
        </Tooltip>
      </div>

      {/* === Right cluster — slide-level Background color trigger ===
          2026-05-26 — added a tiny Background swatch button so the user can
          edit canvas.backgroundColor without having to deselect every
          layer first. Click → opens ColorPickerPanel with target="background".
          Visible regardless of selection. */}
      <div className="flex w-20 items-center justify-end gap-0.5">
        <Tooltip label="Slide background color" placement="top">
          <button
            type="button"
            onClick={() =>
              props.onOpenBackgroundColorPicker(props.backgroundColor)
            }
            className="focus-ring-dark inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-white transition-colors hover:bg-[var(--studio-hover)]"
            aria-haspopup="dialog"
            aria-expanded={props.backgroundColorPanelOpen}
            aria-label="Slide background color"
            title="Slide background color"
          >
            <span
              className={`h-4 w-4 rounded border ${
                props.backgroundColorPanelOpen
                  ? "border-transparent ring-2 ring-gold-500"
                  : "border-[var(--studio-border)]"
              }`}
              style={{
                background:
                  props.backgroundColor === "transparent" ||
                  props.backgroundColor === ""
                    ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 6px 6px"
                    : props.backgroundColor,
              }}
              aria-hidden="true"
            />
            <span className="hidden md:inline">BG</span>
          </button>
        </Tooltip>
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
  // why: footer sits at the BOTTOM of the canvas area — pill pops UP
  // so it doesn't get clipped by the bottom of the editor chrome.
  // 2026-05-25: disabled text darkened from neutral-300 → neutral-400 +
  // cursor-not-allowed for legibility per the cleanup spec.
  return (
    <Tooltip label={props.label} placement="top">
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props.label}
        title={props.label}
        className="focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:text-[var(--studio-text-faint)] disabled:hover:bg-transparent"
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// SECTION 7 — (formerly Phase A.4 inline icons; migrated to lucide-react
// 2026-05-25). All icons are imported at the top of the file with the
// `L…` alias convention (e.g., LUndo2, LFileText). No bespoke SVG defs
// remain in this file.
// ---------------------------------------------------------------------------
