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

import type { Canvas, FabricObject } from "fabric";

import type { CanvasLayer, MLSListingPayload } from "./types";

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
}

// ===========================================================================
// Agent B — AddLayerToolbar
// ===========================================================================

/**
 * Which kind of layer to add. The toolbar exposes 4 buttons.
 */
export type AddLayerKind = "text" | "rect" | "circle" | "line";

export interface AddLayerToolbarProps {
  /** Fabric canvas — toolbar adds new objects directly via `canvas.add(...)`. */
  canvas: Canvas | null;
  /** Listing payload — for context (e.g., choose a placeholder bound field). May be unused in Phase 2. */
  listing: MLSListingPayload | null;
  /** Fired after a layer is added — orchestrator bumps layerVersion + selects the new layer. */
  onLayerAdded: (newFabricObject: FabricObject) => void;
  /** Optional: snapshot history after add. */
  recordHistory?: () => void;
}

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
