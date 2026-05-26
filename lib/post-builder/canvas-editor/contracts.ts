/**
 * Phase 2 integration contracts — shared interfaces between the 3 parallel agents.
 * ---------------------------------------------------------------------------------
 *
 * This file exists so that Agent A (Selection Properties Panel), Agent B (Add-
 * Layer Toolbar + Undo/Redo), and Agent C (Layer List with drag reorder) can be
 * developed in isolation without seeing each other's implementations.
 *
 * Each agent imports ONLY the interfaces it needs from here. The orchestrator
 * (CanvasEditor.tsx) imports ALL of them and wires the concrete components
 * together. If an agent's component shape needs to change mid-build, the
 * contract here is the single source of truth — update here first, then notify
 * the other agents (or me) of the breaking change.
 *
 * Why a contracts file rather than per-component prop interfaces:
 *   • Single import location for the orchestrator
 *   • Forces the contract to be designed up-front, not discovered mid-coding
 *   • Makes the integration surface explicit and reviewable in one file
 */

import type { Canvas } from "fabric";

import type { Database } from "@/lib/supabase/types";

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  CarouselSlide,
  MLSListingPayload,
  PostFormat,
} from "./types";
import type { Scene, TransitionType } from "../types";

// ===========================================================================
// Phase 5 — Carousel (multi-image post) UI surfaces
// ===========================================================================

/**
 * The strip rendered under the hero canvas in Studio. Shows current slides
 * as thumbnails in left-to-right order, with add/remove/reorder controls.
 * Slide 0 is the hero (the canvas itself, not represented here); slides
 * 1..N are managed by this component. Hides itself on Story 9:16 format
 * unless `enabledOnStory` is set.
 *
 * Visual shape:
 *   ╔══════════════════════════════════════════════════════════════════╗
 *   ║  Carousel · 3 slides · max 10 on IG          [▶ Preview] [+ Add] ║
 *   ║  ┌────┐  ┌────┐  ┌────┐  ┌────┐                                   ║
 *   ║  │ 1  │  │ 2  │  │ 3  │  │ +  │                                   ║
 *   ║  └────┘  └────┘  └────┘  └────┘                                   ║
 *   ╚══════════════════════════════════════════════════════════════════╝
 *
 * Interactions:
 *   • Hover a thumbnail → reveal an X in the upper-right (remove).
 *   • Drag a thumbnail → reorder (HTML5 drag/drop with visual gap indicator).
 *   • Click "+ Add" tile → fires `onAddSlideClick` (parent opens picker).
 *   • Click "▶ Preview" → fires `onPreviewClick` (parent opens preview).
 */
export interface CarouselStripProps {
  /** Slides in display order. */
  slides: readonly CarouselSlide[];
  /** Hero's aspect ratio — drives thumbnail proportions so the strip
   *  matches the post's visual identity at a glance. */
  heroFormat: PostFormat;
  /** Called with the new ordered array after any add/remove/reorder. */
  onSlidesChanged: (slides: readonly CarouselSlide[]) => void;
  /** Fired when the user clicks "+ Add slide" — parent opens the picker. */
  onAddSlideClick: () => void;
  /**
   * Fired when the user clicks "▶ Preview" — parent opens the full-screen
   * preview overlay. The button is disabled when slides.length === 0.
   */
  onPreviewClick: () => void;
  /**
   * Hard cap on slide count (for UI disable + warning copy). Default 10
   * (IG carousel max). Caller can override (e.g., 9 to keep one slot
   * reserved for the hero in mental accounting, or 35 for TikTok-only).
   */
  maxSlides?: number;
  /**
   * Phase 5 — Multi-OH per-slide edit. When provided, each thumbnail
   * surfaces a pencil-icon "Edit" affordance next to the X (hover-revealed).
   * Clicking it fires `onSlideEditClick(index)` so the parent can swap
   * Studio's context to that slide's source template + listing.
   *
   * Omit on consumer flows that don't have a per-slide schema (the
   * Add-photos-to-a-single-listing flow — those slides are raw listing
   * photos, not designed graphics, so there's nothing to edit).
   */
  onSlideEditClick?: (slideIndex: number) => void;
}

/**
 * Modal picker the user opens to ADD slides. Shows the listing's photo
 * gallery as a multi-select grid with order labels (1, 2, 3 …) on selected
 * tiles. Photos already in the carousel are visually marked "Added" and
 * not selectable. Confirm button is labeled with the count ("Add 3 slides").
 *
 * Visual shape:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Add slides from listing photos                       [X]  │
 *   │  Choose up to 7 more (3 of 10 already added)               │
 *   │  ─────────────────────────────────────────────────────────  │
 *   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │
 *   │  │ ✓ 1 │ │     │ │ ✓ 2 │ │ Added│ │     │ │     │  …       │
 *   │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘           │
 *   │                                                             │
 *   │                          [Cancel]  [Add 2 slides ▸]         │
 *   └────────────────────────────────────────────────────────────┘
 */
export interface CarouselSlidePickerProps {
  /** Whether the picker is open. Parent controls visibility. */
  open: boolean;
  /** Listing photos available to add. Source of truth = PostBuilderClient. */
  photos: readonly { url: string; sequence: number }[];
  /**
   * Slides already in the carousel. Used to mark their entries "Added"
   * and gray them out (prevents duplicate slides — which would publish
   * fine but is almost certainly user error).
   */
  existingSlides: readonly CarouselSlide[];
  /**
   * Total cap on slide count across hero + existing + new. Used to
   * disable selection of additional photos once the remaining budget
   * (max - existing) is hit.
   */
  maxSlides: number;
  /** Called with the new slides to ADD (parent appends to existing). */
  onAdd: (newSlides: readonly CarouselSlide[]) => void;
  /** Called when the user dismisses the picker without confirming. */
  onCancel: () => void;
}

/**
 * Full-screen preview overlay that lets the user swipe through the
 * carousel exactly as the audience would on IG. Slide 0 is the hero (the
 * already-rendered design preview); slides 1..N are the listing photos.
 *
 * Visual shape:
 *   ╔══════════════════════════════════════════════════════════════════╗
 *   ║                                                              [X] ║
 *   ║                      ┌─────────────────┐                         ║
 *   ║              [◀]     │                 │     [▶]                 ║
 *   ║                      │   slide image   │                         ║
 *   ║                      │                 │                         ║
 *   ║                      └─────────────────┘                         ║
 *   ║                          • • ◯ • •  (3 of 5)                    ║
 *   ╚══════════════════════════════════════════════════════════════════╝
 */
export interface CarouselPreviewProps {
  /** Whether the overlay is open. Parent controls visibility. */
  open: boolean;
  /**
   * URL of the hero (slide 0) — the rendered design out of Studio. May be
   * null if the user hasn't saved a render yet; the preview falls back to
   * a "Save your design first to preview the full carousel" placeholder.
   */
  heroUrl: string | null;
  /** Slides 1..N. */
  slides: readonly CarouselSlide[];
  /** Hero aspect ratio — drives the preview frame's proportions. */
  heroFormat: PostFormat;
  /** Called when the user closes via ESC, X, or backdrop click. */
  onClose: () => void;
}

// ===========================================================================
// Phase 6 — Reel Studio (native video editor)
// ===========================================================================

/**
 * Horizontal timeline of scene blocks shown at the bottom of Reel Studio.
 * Each block represents a Scene in the VideoComposition; width is
 * proportional to durationMs so the timeline reads as a time scrubber.
 *
 * Visual shape (Day 3 MVP):
 *   ╔══════════════════════════════════════════════════════════════════╗
 *   ║  ┌────┐  ⟿fade⟿  ┌──────┐  ⟿dissolve⟿  ┌────┐  [+ Scene]      ║
 *   ║  │  1 │           │  2   │              │  3 │                   ║
 *   ║  │1.0s│           │1.5s  │              │1.0s│                   ║
 *   ║  └────┘           └──────┘              └────┘                    ║
 *   ╚══════════════════════════════════════════════════════════════════╝
 *
 * Interactions (MVP):
 *   • Click a scene block → select it (its properties appear in the side panel)
 *   • Hover → reveal X to remove
 *   • Drag a block → reorder (HTML5 drag/drop with gap indicator)
 *   • Click "+ Scene" → add a new scene (parent decides what kind)
 *   • Transitions render as small icon-glyphs BETWEEN blocks; click to cycle types
 *
 * Day 4+ adds: precise duration slider on hover, transition-duration on click,
 * a scrub head that drags along the timeline for preview.
 */
export interface TimelineStripProps {
  /** All scenes in playback order. */
  scenes: readonly Scene[];
  /**
   * Which scene block is currently selected (so ScenePropertiesPanel can
   * show that scene's editors). Null when nothing is selected; the strip
   * still renders all blocks, but none are highlighted.
   */
  selectedSceneId: string | null;
  /** Clicked a scene block → parent updates `selectedSceneId`. */
  onSelectScene: (sceneId: string) => void;
  /**
   * Drag-reordered the scenes. The argument is the new array of scene ids
   * in left-to-right order. Parent reconstructs the composition's scenes
   * array by mapping these ids to their full Scene objects.
   */
  onReorderScenes: (newOrder: readonly string[]) => void;
  /**
   * Clicked the "+ Scene" tile. Parent decides what kind of scene to add
   * (typically a photo scene with the next available listing photo, or
   * a design scene with a copy of the current hero template).
   */
  onAddScene: () => void;
  /** Hover-X click on a scene block. */
  onRemoveScene: (sceneId: string) => void;
  /**
   * Clicked a transition glyph between two scenes — cycles the type
   * (cut → fade → dissolve → slide_left → zoom_blur → cut). The argument
   * is the id of the scene whose `transitionIn` should change.
   */
  onCycleTransition: (sceneId: string) => void;
  /**
   * When false (default), the timeline does NOT allow removing the LAST
   * remaining scene (a composition must have ≥1 scene). Set true if the
   * consumer wants to allow empty compositions (e.g., a fresh-start state).
   */
  allowEmpty?: boolean;
  /**
   * Hard cap on scenes (from REEL_CAPS.maxScenes — 8). The "+ Scene" tile
   * is disabled when scenes.length >= maxScenes.
   */
  maxScenes?: number;
}

/**
 * Right-side panel that surfaces the SELECTED scene's editable properties:
 * motion preset (for photo scenes), duration slider, transition-in type +
 * duration. When `scene` is null (nothing selected), renders an empty state.
 *
 * Visual shape (Day 3 MVP):
 *   ┌─────────────────────────────┐
 *   │  Scene properties           │
 *   │  ─────────────────────────  │
 *   │  TYPE   Photo               │
 *   │                              │
 *   │  MOTION                      │
 *   │   ○ Static                   │
 *   │   ● Zoom in                  │
 *   │   ○ Zoom out                 │
 *   │   ○ Pan left                 │
 *   │   ○ Pan right                │
 *   │                              │
 *   │  DURATION                    │
 *   │   ━━━●━━━━━━━━  1.5s         │
 *   │                              │
 *   │  TRANSITION IN               │
 *   │   [Cut][Fade][Diss][Slide]   │
 *   │                              │
 *   │  TRANSITION LENGTH           │
 *   │   ━━●━━━━━━━━━━  0.3s        │
 *   └─────────────────────────────┘
 */
export interface ScenePropertiesPanelProps {
  /** The selected scene, or null. */
  scene: Scene | null;
  /**
   * Patch the scene's fields. The parent merges the patch into the
   * scene's full object, updating the composition's scenes array.
   * Patch shape mirrors Scene's optional fields — any subset can be
   * passed and only those fields are updated.
   */
  onSceneChanged: (
    sceneId: string,
    patch: Partial<{
      durationMs: number;
      transitionIn: TransitionType;
      transitionMs: number;
      /** Motion preset name for photo scenes. Maps to MOTION_PRESETS in types.ts. */
      motionPreset: "static" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right";
    }>,
  ) => void;
}

// ===========================================================================
// Phase 4 — Templates panel (in-editor template switcher)
// ===========================================================================

/**
 * TemplatesPanel — grid of canvas-editor templates the user can swap to mid-edit.
 *
 * Renders inside the editor's left sidebar as a fourth tab alongside Brand /
 * Agents / Photos. Clicking a tile asks the orchestrator to swap the active
 * template. If the user has already made edits to the current template
 * (`hasUnsavedEdits === true`), the panel surfaces a confirmation prompt
 * before firing `onTemplatePicked` — switching templates is a "start over"
 * action and silently discarding the user's work would be hostile.
 *
 * Filtering:
 *   • Default = current format only. Switching aspect ratio mid-edit is
 *     disorienting; we steer the user toward same-format swaps.
 *   • Category filter chip strip — All / Just Listed / Just Sold / Under
 *     Contract / Open House / Price Reduced. Defaults to the listing's
 *     current post type for the obvious "show me more like this" path.
 *   • Optional toggle to surface other formats — exposes the full set when
 *     the user genuinely wants to switch to a different aspect ratio
 *     (e.g., adapting a square design into a story).
 */
export interface TemplatesPanelProps {
  /** All canvas-editor templates known to the registry. */
  templates: readonly CanvasTemplateSchema[];
  /** ID of the template currently loaded in the editor — drives the "Current" badge. */
  currentTemplateId: string;
  /**
   * The active format. The panel filters to this format by default and uses
   * it to compute card aspect ratios for the previews.
   */
  currentFormat: PostFormat;
  /**
   * When true, the user has made edits to the current template (history hook
   * reports `canUndo === true`). The panel uses this to gate template
   * swaps behind a `window.confirm` so the user doesn't lose work.
   */
  hasUnsavedEdits: boolean;
  /**
   * Called after the user has confirmed they want to swap to the chosen
   * template. The orchestrator handles the actual canvas re-init.
   */
  onTemplatePicked: (template: CanvasTemplateSchema) => void;
}

// ===========================================================================
// Phase 3 — Brand assets sidebar (Brand + Agents panels)
// ===========================================================================

/**
 * Row shape from the brand_assets table. Mirrors the Supabase-generated type
 * so panels can pass through query results without re-mapping.
 */
export type BrandAsset = Database["public"]["Tables"]["brand_assets"]["Row"];
export type BrandAssetKind = Database["public"]["Enums"]["brand_asset_kind"];

/**
 * An office option as it appears in the AgentPanel's filter chips.
 */
export interface OfficeOption {
  id: string;
  name: string;
}

/**
 * Result shape passed to the panel's onSync callback. Mirrors the response
 * from syncBrandAssetsAction so the panel can render a short result toast
 * (e.g. "Synced — 3 added, 2 updated") without knowing the action signature.
 */
export interface BrandSyncOutcome {
  ok: boolean;
  /** Already-formatted summary line, e.g. "3 added, 2 updated, 0 errors" or "Sync failed: invoke_failed: …" */
  summary: string;
}

/**
 * Last-sync metadata that the BrandPanel + AgentPanel headers render as a
 * "Synced 12m ago" / "Last sync failed Nm ago" pill. Written by the
 * sync-brand-assets Edge Function on every run (success or failure) into
 * `api_credentials.credentials` for platform='google_drive'; the
 * orchestrator reads it server-side via getBrandSyncStatusAction and passes
 * the result to both panels through these props.
 */
export interface BrandSyncStatus {
  /** ISO timestamp of the most recent sync completion. null if never run. */
  lastSyncedAt: string | null;
  /**
   * The last sync's error message, when it failed. null when the most recent
   * run succeeded. A partial-failure run (errors[] non-empty but ok=true)
   * surfaces the FIRST error string here so users can spot regressions.
   */
  lastSyncError: string | null;
}

/**
 * BrandPanel — grid of C21 logos + co-brand partner logos.
 *
 * Renders inside the editor's left sidebar when the user clicks the Brand
 * tab. Reads from brand_assets where kind IN ('logo','partner_logo').
 * Click a thumbnail → orchestrator drops a new ImageLayer at canvas center.
 */
export interface BrandPanelProps {
  /** All logo + partner_logo rows. Loaded by the parent (CanvasEditor.tsx). */
  assets: readonly BrandAsset[];
  /** True while the parent is initially fetching. */
  isLoading: boolean;
  /** Called when the user clicks a thumbnail. Orchestrator creates the Fabric image. */
  onAssetPicked: (asset: BrandAsset) => void;
  /**
   * Optional manual sync — fires the Drive→Supabase sync Edge Function and
   * re-fetches the assets list. When set, the panel renders a Sync button in
   * its header. Returns a brief outcome the panel surfaces as a toast.
   *
   * @deprecated 2026-05-17 — logos + partner_logos are now manually managed
   * via the Studio sidecar's + Add Asset button. The sync function only
   * touches agent_headshots. Pass `onSync={null}` to suppress the legacy
   * Sync button in the header.
   */
  onSync?: () => Promise<BrandSyncOutcome>;
  /**
   * Most recent sync's metadata. When provided, the panel header surfaces a
   * "Synced 12m ago" pill (success) / "Last sync failed Nm ago" (rose-700,
   * failure) / "Could be out of date" amber hint (older than 24h).
   * Omit on consumers that don't have access to the status row (e.g.
   * brand-asset admin UI); the panel degrades to just the Sync button.
   */
  syncStatus?: BrandSyncStatus;
  /**
   * 2026-05-17 — admin-only controls for manually managing the logo
   * library inside the Studio sidecar.
   *
   *   isAdmin       — when true, the "+ Add Asset" button and per-tile
   *                   "×" remove icons render. When false (non-admin
   *                   author), the panel is read-only (existing
   *                   behavior).
   *   onUploadAsset — server-action wrapper: invokes the upload, then
   *                   the orchestrator re-fetches the asset list so the
   *                   new tile appears.
   *   onArchiveAsset — server-action wrapper for soft-archive.
   */
  isAdmin?: boolean;
  onUploadAsset?: (input: {
    kind: "logo" | "partner_logo";
    label: string;
    logo_category: string | null;
    filename: string;
    content_type: string;
    file_base64: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onArchiveAsset?: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * AgentPanel — grid of agent headshots filtered by office.
 *
 * Default filter = the office of the listing currently being edited (if any).
 * User can switch via filter chips at the top. Reads from brand_assets where
 * kind = 'agent_headshot'.
 */
export interface AgentPanelProps {
  /** All agent_headshot rows. */
  assets: readonly BrandAsset[];
  /** All offices for the filter chips. Order = display order. */
  offices: readonly OfficeOption[];
  /**
   * Office to filter to by default. Typically the office of the active
   * listing. Null = show all offices.
   */
  defaultOfficeId: string | null;
  isLoading: boolean;
  onAssetPicked: (asset: BrandAsset) => void;
  /**
   * Optional manual sync — same shape and semantics as BrandPanel's onSync.
   * Triggering from either panel runs the same Edge Function (the sync walks
   * BOTH the logos folder and the agents folder in one pass).
   */
  onSync?: () => Promise<BrandSyncOutcome>;
  /**
   * Most recent sync's metadata. Same shape + semantics as BrandPanel's
   * syncStatus — see BrandSyncStatus.
   */
  syncStatus?: BrandSyncStatus;
}

/**
 * PhotosPanel — grid of the active listing's photos.
 *
 * Third tab in the left sidebar, alongside Brand + Agents. Replaces the
 * "build a multi-photo template up front" flow that v4/v5 used to serve:
 * if Larissa wants a composite, she opens Studio and drags additional
 * photos onto the canvas one at a time, with full positioning control.
 *
 * The photos come from the same `/api/post-builder/photos?mls=...` endpoint
 * that powers the Post Builder picker — the parent (CanvasEditor.tsx) fetches
 * them on mount once the listing is known. Panel is purely presentational.
 */
export interface ListingPhoto {
  url: string;
  /** Drive/Storage sequence number — used as a stable visual order key. */
  sequence: number;
}

export interface PhotosPanelProps {
  /** All listing photos in original order. The first is the hero. */
  photos: readonly ListingPhoto[];
  /** True while the parent is initially fetching. */
  isLoading: boolean;
  /**
   * Called when the user clicks a thumbnail. Orchestrator creates a new
   * Fabric ImageLayer at canvas center with anonymous CORS.
   */
  onPhotoPicked: (photo: ListingPhoto) => void;
}

// ===========================================================================
// Layer panel entry — shared across SelectionPropertiesPanel and LayerListPanel
// ===========================================================================

/**
 * A row in the layer list. Derived from the Fabric canvas's getObjects()
 * output, with our custom `data` metadata layered on.
 */
export interface LayerListEntry {
  /** Stable schema layer ID. Used as React key and for canvas object lookup. */
  id: string;
  /** Display name shown in the layer panel. Editable in Phase 3 (rename). */
  name: string;
  /** Layer kind — drives the panel icon. */
  kind: CanvasLayer["kind"];
  /** Visibility toggle state. */
  visible: boolean;
  /** Lock state — when true, the object can't be moved/resized/edited. */
  locked: boolean;
}

// ===========================================================================
// Agent C — LayerListPanel
// ===========================================================================

/**
 * The layer list with drag-to-reorder. Rendered on the right side of the
 * editor when nothing is selected. When a layer IS selected, this is hidden
 * and SelectionPropertiesPanel takes over.
 */
export interface LayerListPanelProps {
  entries: LayerListEntry[];
  selectedLayerId: string | null;
  /** Click a row → set Fabric's active object. */
  onSelect: (layerId: string) => void;
  /** Eye icon toggle. */
  onToggleVisibility: (layerId: string) => void;
  /** Trash icon. */
  onDelete: (layerId: string) => void;
  /**
   * Drag-reorder. Called with the new ordered list of layer IDs (top of stack
   * first, matching the panel's visual order). The orchestrator applies this
   * to the Fabric canvas via repeated bringObjectToFront / sendObjectBackwards
   * calls.
   */
  onReorder: (newOrder: string[]) => void;
  /**
   * Phase B.4 — fired on row mouseEnter (with the row's layerId) and
   * mouseLeave (with null). The orchestrator draws a temporary outline
   * around the corresponding Fabric object so Larissa can identify what
   * a row refers to without committing to selecting it.
   *
   * Optional — when omitted, the panel skips the hover-preview wiring.
   */
  onHoverEntry?: (layerId: string | null) => void;
  /**
   * 2026-05-26 — slide-level "Background color" trigger. When provided, the
   * panel renders a small row above the layer list with a swatch button.
   * Clicking opens the ColorPickerPanel with target="background". Optional
   * so older callers / tests that don't wire it still render fine.
   */
  backgroundColor?: string;
  onOpenBackgroundColorPicker?: (currentValue: string) => void;
  backgroundColorPanelOpen?: boolean;
}

// ===========================================================================
// Agent A — SelectionPropertiesPanel
// ===========================================================================

/**
 * Mode discriminator for the panel.
 *   • "text" / "image" / "shape" → controls for that layer kind
 *   • "multi" → minimal stub for now (delete-all + count). Real multi-edit
 *     comes in Phase 3.
 *   • "none" → SHOULDN'T be passed (the orchestrator should be rendering
 *     LayerListPanel instead). Reserved for safety.
 */
export type SelectionMode = "text" | "image" | "shape" | "multi" | "none";

export interface SelectionPropertiesPanelProps {
  mode: SelectionMode;
  /**
   * The Fabric canvas instance. Property controls call canvas methods on
   * this directly — e.g., `canvas.getActiveObject()` to read current values,
   * then `obj.set({ ... })` + `canvas.requestRenderAll()` to write.
   *
   * Why pass the canvas instead of just the selected object: changes need to
   * trigger a re-render AND a layer-version bump (the layer panel name in
   * the bottom-left preview etc.). Passing the canvas lets the panel do both.
   */
  canvas: Canvas | null;
  /**
   * Listing payload — needed by ImagePropertiesControls so the image-swap
   * thumbnail grid can show the listing's photos[] array. Null when the
   * editor was opened without a listing (template-author mode, future).
   */
  listing: MLSListingPayload | null;
  /**
   * Bump-counter from the parent — forces the panel to re-read from Fabric
   * when the parent knows the canvas state has changed (e.g., after an
   * external property mutation). Wire as a useEffect dependency inside the
   * panel. The orchestrator increments this on every layerVersion change.
   */
  selectionVersion: number;
  /**
   * Optional callback to bump the orchestrator's layerVersion. Property
   * controls should call this after mutating Fabric so the layer panel
   * (and any other layerVersion-keyed memos) refresh.
   */
  onCanvasMutated?: () => void;
  /**
   * Callback to clear the selection — used by the panel's "Back to layers"
   * button to drop active selection and let the orchestrator swap back to
   * LayerListPanel.
   */
  onClearSelection: () => void;
  /**
   * Optional: when defined, the panel uses this to snapshot a history entry
   * after non-trivial mutations (font change, color change, etc.). When
   * omitted, mutations are still applied but not added to undo history.
   * Agent B provides this via useUndoRedoHistory.
   */
  recordHistory?: () => void;
  /**
   * 2026-05-26 — opens the unified Canva-style FontPicker left panel.
   * Wired from CanvasEditor to the SAME setFontPickerOpen state the top
   * toolbar uses, so the right-panel font trigger and the top-toolbar
   * font trigger both open the single canonical picker.
   */
  onOpenFontPicker?: () => void;
  /**
   * 2026-05-26 — drives the font trigger's active styling + aria-expanded
   * in the right panel. Mirrors the same prop on ContextualTopToolbar.
   */
  fontPickerOpen?: boolean;
  /**
   * 2026-05-26 — opens the unified Canva-style EffectsPanel left panel.
   * Wired from CanvasEditor to the SAME setEffectsPanelOpen state the top
   * toolbar uses, so both Effects triggers open the single canonical panel.
   */
  onOpenEffectsPanel?: () => void;
  /**
   * 2026-05-26 — drives the Effects trigger's active styling +
   * aria-expanded in the right panel. Mirrors the same prop on
   * ContextualTopToolbar.
   */
  effectsPanelOpen?: boolean;
  /**
   * 2026-05-26 — opens the unified Canva-style ColorPickerPanel. The same
   * callback is shared by every ColorPicker swatch trigger across the
   * editor (text fill, text highlight, shape fill, shape stroke, slide
   * background). The target argument tells the orchestrator which Fabric
   * property to mutate.
   */
  onOpenColorPicker?: (
    target: import("./panels/ColorPickerPanel").ColorTarget,
    currentValue: string,
  ) => void;
  /**
   * 2026-05-26 — drives the active styling on whichever swatch trigger
   * corresponds to the currently-open ColorPickerPanel target.
   */
  colorPickerOpenTarget?:
    | import("./panels/ColorPickerPanel").ColorTarget
    | null;
}

// ===========================================================================
// Agent B — AddLayerToolbar (REMOVED 2026-05-26)
// ===========================================================================
// The floating AddLayerToolbar above the canvas was deleted in favor of an
// always-on "Add" section at the top of the Tools panel (left rail). The
// spawn factories that used to live here (spawnText / spawnRect /
// spawnCircle / spawnLine) are now exported from `panels/ToolsPanel.tsx`.
// `ADD_LAYER_DEFAULTS` below remains in use by both the keyboard shortcut
// path and the ToolsPanel-resident factories.

// ===========================================================================
// Agent B — useUndoRedoHistory hook
// ===========================================================================

/**
 * State + actions returned by the useUndoRedoHistory hook.
 *
 * Usage from the orchestrator:
 *   const history = useUndoRedoHistory(fabricRef);
 *   // hook auto-snapshots on fabric events (debounced 500ms)
 *   // wire to keyboard shortcuts:
 *   if (e.key === "z" && e.metaKey) history.undo();
 *
 * Snapshots are FULL canvas state via Fabric's toJSON(). Memory cost grows
 * with stack size — capped at 50 entries by default (older entries discarded).
 */
export interface UndoRedoHistory {
  /** True when there's at least one entry behind the current state. */
  canUndo: boolean;
  /** True when there's at least one entry ahead of the current state (after an undo). */
  canRedo: boolean;
  /** Walk one step back. No-op when canUndo is false. */
  undo: () => void;
  /** Walk one step forward. No-op when canRedo is false. */
  redo: () => void;
  /**
   * Manually push a history entry. Auto-snapshot covers most cases (fabric
   * `object:modified` etc.), but some mutations don't fire those events
   * (font family change via select dropdown). Property controls should call
   * `record()` after such mutations.
   */
  record: () => void;
  /**
   * Activates the auto-snapshot machinery. Called by the orchestrator AFTER
   * the initial template hydration completes — before that, Fabric emits a
   * burst of `object:added` events that would each create a history entry.
   * `start()` captures the post-hydration baseline as the FIRST undo target
   * and only then begins listening to canvas events.
   *
   * Idempotent — calling `start()` more than once is a no-op.
   *
   * Why on the contract: Agent B's hook owns the auto-snapshot lifecycle, but
   * only the orchestrator knows when "init is done". Exposing `start()` keeps
   * that boundary explicit. Agent A only reads `recordHistory?: () => void`
   * from its props, so adding `start` here does not affect that surface.
   */
  start: () => void;
}

// ===========================================================================
// Phase 2 add-layer defaults — shared so all entry points stay consistent
// ===========================================================================

/**
 * Defaults for new layers added via the toolbar. Centralized here so the
 * toolbar, future right-click "add", and any keyboard shortcut all produce
 * the same starting state.
 *
 * Why these values:
 *   • 200×200 — visible at thumbnail scale, leaves room to drag/resize
 *   • Center-canvas — works at any aspect ratio without spilling out
 *   • Gold-500 fill / Obsessed-grey text — on-brand by default; user can change
 *   • z = 1000 — well above existing template layers so the new object is on top
 */
export const ADD_LAYER_DEFAULTS = {
  textWidth: 400,
  textHeight: 80,
  textContent: "Double-click to edit",
  shapeSize: 200,
  lineLength: 300,
  lineStrokeWidth: 4,
  newLayerZ: 1000,
} as const;
