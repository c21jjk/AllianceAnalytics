/**
 * keyboard-shortcuts — Phase 2 keyboard helpers (pure functions, no hooks).
 * --------------------------------------------------------------------------
 *
 * This module exposes a single dispatcher, `handlePhase2KeyDown`, that the
 * orchestrator (CanvasEditor.tsx) calls from inside its existing keydown
 * `useEffect`. The dispatcher returns `true` when it consumed the event so
 * the caller can:
 *   • call `e.preventDefault()` to suppress browser defaults (Cmd+Z scrolling, etc.)
 *   • short-circuit before falling through to Phase 1 shortcuts (Delete, Cmd+D)
 *
 * Why pure functions over a hook:
 *   The orchestrator already owns the keydown listener (it handles Delete and
 *   Cmd+D). Mounting another `useEffect` from this module would race against
 *   the existing one and add ordering ambiguity. A pure dispatcher keeps the
 *   listener-count at one, with deterministic precedence: Phase 2 first,
 *   Phase 1 fallback.
 *
 * Why a discriminated return rather than mutating ctx:
 *   `boolean` is the smallest possible contract — caller decides what
 *   "handled" means in their flow. Mutating ctx would couple this module to
 *   the orchestrator's render strategy.
 */

import { type Canvas, type FabricObject } from "fabric";

import { type UndoRedoHistory } from "../contracts";
import type { ToolMode } from "../panels/ToolsPanel";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Nudge distance for an unmodified arrow key, in canvas pixels. */
const NUDGE_PX = 1;

/**
 * Nudge distance with Shift held. 10× the base nudge — same convention as
 * Figma / Sketch / Photoshop, which all use 10px Shift+Arrow.
 */
const NUDGE_PX_SHIFT = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KeyboardShortcutContext {
  /** Fabric canvas instance. Null-safe — the dispatcher returns false when null. */
  canvas: Canvas | null;
  /** The undo/redo history from useUndoRedoHistory. */
  history: UndoRedoHistory;
  /**
   * Optional callback to refresh whatever the orchestrator tracks for
   * "canvas mutated" (e.g., bumping layerVersion so the layer panel
   * re-renders). Called after nudge moves.
   */
  onCanvasMutated?: () => void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * True when the keystroke originated from a real text input on the page —
 * the layer-panel rename field, a property-panel number input, etc. We must
 * never hijack those events.
 */
function isTypingInPageInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * True when Fabric's IText is in inline-edit mode (user double-clicked into
 * a Textbox). Arrow keys belong to the cursor inside the textbox, not to us.
 */
function isFabricEditingText(
  active: FabricObject | null | undefined,
): boolean {
  if (!active) return false;
  // why: Fabric typings don't expose `isEditing` on the base FabricObject —
  // it's only on IText / Textbox subclasses. Narrow through unknown.
  const editFlag = (active as unknown as { isEditing?: unknown }).isEditing;
  return editFlag === true;
}

/**
 * Apply a delta to the active object's position. Handles single-object and
 * ActiveSelection (multi-select) cases uniformly — Fabric's `setX`/`setY`
 * (or `left`/`top` set + setCoords) works on both.
 */
function nudgeActive(
  canvas: Canvas,
  dx: number,
  dy: number,
): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  // why: read current position via getters because Fabric occasionally
  // initialises `left`/`top` as undefined on freshly-cloned objects.
  const left = active.left ?? 0;
  const top = active.top ?? 0;
  active.set({ left: left + dx, top: top + dy });
  // why: setCoords recalculates the object's bounding box so subsequent
  // selection / collision tests use the new position. Without this, the
  // selection-rect renders at the OLD position until the next mouse event.
  active.setCoords();
  canvas.requestRenderAll();
  return true;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a keyboard event. Returns true when the event was consumed (caller
 * should call e.preventDefault and skip further handlers). Returns false
 * otherwise so the caller can chain to its own shortcuts.
 *
 * Recognized:
 *   • Cmd/Ctrl+Z         → history.undo()
 *   • Cmd/Ctrl+Shift+Z   → history.redo()
 *   • Arrow keys         → nudge active object by 1px (10px with Shift)
 *
 * Bails (returns false) when:
 *   • canvas is null
 *   • focus is in a page input/textarea/contenteditable
 *   • a Fabric Textbox is in inline-edit mode
 */
export function handlePhase2KeyDown(
  e: KeyboardEvent,
  ctx: KeyboardShortcutContext,
): boolean {
  const { canvas, history, onCanvasMutated } = ctx;
  if (!canvas) return false;

  // why: bail BEFORE any modifier checks. Cmd+Z inside a rename input should
  // undo the input's text, not our canvas history.
  if (isTypingInPageInput(e.target)) return false;
  if (isFabricEditingText(canvas.getActiveObject())) return false;

  const isMod = e.metaKey || e.ctrlKey;
  const key = e.key;
  // why: normalize "z"/"Z" — Shift toggles capitalization on macOS Chrome.
  const keyLower = key.toLowerCase();

  // -------------------------------------------------------------------------
  // Undo / Redo
  // -------------------------------------------------------------------------
  if (isMod && keyLower === "z") {
    if (e.shiftKey) {
      history.redo();
    } else {
      history.undo();
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Arrow-key nudging
  // -------------------------------------------------------------------------
  // why: skip arrow nudge when a modifier is held — Cmd+Arrow is a browser
  // shortcut (back/forward navigation) and we shouldn't intercept it.
  if (!isMod) {
    const step = e.shiftKey ? NUDGE_PX_SHIFT : NUDGE_PX;
    let dx = 0;
    let dy = 0;
    switch (key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      default:
        return false;
    }
    const moved = nudgeActive(canvas, dx, dy);
    if (moved) {
      onCanvasMutated?.();
      return true;
    }
    // why: arrow with nothing selected = ignore, allow page-level shortcuts
    // (e.g., scroll) to take over.
    return false;
  }

  return false;
}

// ===========================================================================
// Tools-panel keyboard shortcuts (2026-05-23)
// ===========================================================================
//
// Companion dispatcher for the Canva-parity Tools panel. Handles letter keys
// for tool/shape/text spawning + Escape for exiting Draw mode. Kept separate
// from handlePhase2KeyDown because:
//   • Different bail rules — Tools shortcuts only fire when no modifier is
//     held (R alone, not Cmd+R which is the browser's reload).
//   • The orchestrator wires DIFFERENT callbacks per key, so a fan-out
//     context struct keeps the dispatcher's signature flat instead of one
//     giant boolean-returning method per key.
//   • Lets the Tools-panel feature be ripped out cleanly later if needed
//     without touching the Phase 2 undo/redo + nudge contract.
//
// Recognized bindings:
//   • Escape → exit Draw mode (no-op when already in Select)
//   • P      → enter Draw mode (Pen sub-tool; sub-tool defaults to last used)
//   • E      → enter Draw mode + Eraser sub-tool [Phase 2 — currently the
//              shortcut just enters Draw; ToolsPanel picks the sub-tool]
//   • R      → spawn rectangle at canvas center
//   • O      → spawn circle
//   • L      → spawn straight line
//   • T      → spawn paragraph text
// ---------------------------------------------------------------------------

export interface ToolsKeyContext {
  canvas: Canvas | null;
  /** Current ToolMode. Used so Esc no-ops when already in Select. */
  toolMode: ToolMode;
  /** Set the ToolMode. Used by Esc (→ select) and P (→ draw). */
  setToolMode: (next: ToolMode) => void;
  /** Spawn callbacks — orchestrator wires them to the same factories the
   *  AddLayerToolbar and ToolsPanel buttons use. Each callback is responsible
   *  for adding the object to the canvas, selecting it, and recording history. */
  onSpawnRect: () => void;
  onSpawnCircle: () => void;
  onSpawnLine: () => void;
  onSpawnText: () => void;
}

/**
 * Handle a Tools-panel keyboard event. Returns true when consumed (so the
 * caller can preventDefault). Bails (returns false) on the same conditions
 * as handlePhase2KeyDown — no canvas, focus in a page input, Fabric in
 * inline text-edit mode.
 *
 * Also bails when ANY modifier (Cmd/Ctrl/Alt) is held — letter-key
 * shortcuts must never compete with browser/OS shortcuts like Cmd+R.
 */
export function handleToolsKeyDown(
  e: KeyboardEvent,
  ctx: ToolsKeyContext,
): boolean {
  const { canvas, toolMode, setToolMode } = ctx;
  if (!canvas) return false;
  if (isTypingInPageInput(e.target)) return false;
  if (isFabricEditingText(canvas.getActiveObject())) return false;

  // Escape — handled regardless of modifiers so users with sticky-keys
  // habits still get the expected exit-draw behavior.
  if (e.key === "Escape") {
    if (toolMode === "draw") {
      setToolMode("select");
      return true;
    }
    return false;
  }

  // why: letter shortcuts never fire with a modifier — Cmd+R is reload,
  // Cmd+T is new tab, etc. We must not intercept those.
  if (e.metaKey || e.ctrlKey || e.altKey) return false;

  switch (e.key.toLowerCase()) {
    case "p":
      setToolMode("draw");
      return true;
    case "e":
      // why: Phase 1 — pressing E just enters Draw mode (the ToolsPanel
      // already remembers the user's last brush, so if they were on
      // Eraser before, they come back to Eraser). Phase 2 will pipe a
      // setBrush callback through so E directly selects the eraser
      // brush regardless of prior state.
      setToolMode("draw");
      return true;
    case "r":
      ctx.onSpawnRect();
      return true;
    case "o":
      ctx.onSpawnCircle();
      return true;
    case "l":
      ctx.onSpawnLine();
      return true;
    case "t":
      ctx.onSpawnText();
      return true;
    default:
      return false;
  }
}
