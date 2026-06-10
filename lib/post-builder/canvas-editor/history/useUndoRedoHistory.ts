"use client";

/**
 * useUndoRedoHistory — Phase 2 history hook for the canvas editor.
 * ----------------------------------------------------------------
 *
 * Owns the auto-snapshot machinery for undo/redo. Each entry is a Fabric
 * `toJSON` payload stringified — capturing the full canvas state including
 * our custom `data` metadata (so layer ids survive the round-trip).
 *
 * Lifecycle (orchestrator's responsibility):
 *   1. Mount: hook initialises an empty stack, returns canUndo=false / canRedo=false.
 *      The hook listens to canvas events but treats them as "baseline-only" —
 *      every event updates an internal `pendingBaseline` snapshot, no entry
 *      pushed yet. This is the gate that prevents the initial template
 *      hydration from spamming history with one entry per object:added.
 *   2. Orchestrator hydrates the template into the canvas.
 *   3. Orchestrator calls `history.start()` once hydration is complete.
 *      `start()` flips the `isStartedRef` flag, pushes the current baseline
 *      as the FIRST undo target, and from this point on each debounced
 *      event-burst becomes a history entry.
 *   4. User interacts → canvas events fire → debounced snapshot pushes a new
 *      entry every 500ms of inactivity, capped at 50 entries (FIFO eviction).
 *   5. User hits Cmd+Z → `undo()` pops the current state, pushes it to redo,
 *      and applies the previous snapshot.
 *
 * Why a debounce: continuous mutations (dragging, scaling, scrubbing a slider)
 * fire dozens of `object:modified` events per second. Without coalescing, the
 * 50-entry stack would fill up after one drag. 500ms is the empirical sweet
 * spot — long enough to bundle a single user gesture into one entry, short
 * enough that the user doesn't feel "the undo button is laggy".
 *
 * Why a single isReplaying flag rather than detaching listeners during
 * undo/redo: detaching/reattaching tears Fabric's internal observer arrays
 * during a frame, which can cause race conditions when `loadFromJSON`
 * re-emits `object:added` for each restored layer. A simple flag is more
 * robust.
 */

import { type Canvas } from "fabric";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { type UndoRedoHistory } from "../contracts";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Maximum entries in the undo stack. Older entries are dropped FIFO when
 * exceeded. 50 is a balance — enough to cover several minutes of typical
 * editing, small enough that the memory footprint (50 × ~50KB JSON each ≈
 * 2.5MB) stays trivial.
 */
const MAX_STACK = 50;

/**
 * Debounce window in ms. Tuned by feel — drag events fire at ~60fps, so 500ms
 * is well past any continuous-motion threshold.
 */
const DEBOUNCE_MS = 500;

/**
 * Properties to include in `canvas.toJSON()`. Fabric strips unknown custom
 * properties by default — passing `data` here ensures our FabricLayerData
 * metadata (layerId, layerKind, displayName) round-trips through undo/redo.
 */
const SERIALIZED_PROPS = ["data"] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Internal mutable state kept in refs to avoid causing renders. The reactive
 * surface (canUndo / canRedo) is reflected via `useState`, updated in
 * `syncReactive` after every push/pop.
 */
interface HistoryStacks {
  /** Snapshots strictly behind the current state. Newest at top. */
  undoStack: string[];
  /** Snapshots strictly ahead of the current state. Newest at top. */
  redoStack: string[];
  /** The most recent stable state — used as "the thing redo brings back" when undoing. */
  current: string | null;
}

export function useUndoRedoHistory(
  canvasRef: RefObject<Canvas | null>,
): UndoRedoHistory {
  // why: refs hold the actual stacks. Mutating refs doesn't trigger renders;
  // we reflect the boolean derived state via setState calls in `syncReactive`.
  const stacksRef = useRef<HistoryStacks>({
    undoStack: [],
    redoStack: [],
    current: null,
  });
  // why: track started-state via ref so the event listeners (which capture
  // state via closure) always read the latest value, not a stale snapshot.
  const isStartedRef = useRef<boolean>(false);
  // why: during loadFromJSON, Fabric re-emits object:added etc. for each
  // restored layer. We DON'T want those to push new history entries.
  const isReplayingRef = useRef<boolean>(false);
  // why: pause recording during multi-step canvas surgery (crop mode) so the
  // intermediate states (image clipPath removed, overlay rects added) don't
  // pollute the undo stack. Toggled via suspend()/resume().
  const isSuspendedRef = useRef<boolean>(false);
  // why: keep the latest pre-start snapshot so `start()` has something to
  // push as the baseline. Updated by event handlers while not started.
  const pendingBaselineRef = useRef<string | null>(null);
  // why: debounce timer handle, cleared on every fresh event so a burst
  // collapses into a single snapshot.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  /**
   * Reflect ref-state back into React state so consumers re-render when
   * stack availability changes.
   */
  const syncReactive = useCallback((): void => {
    setCanUndo(stacksRef.current.undoStack.length > 0);
    setCanRedo(stacksRef.current.redoStack.length > 0);
  }, []);

  /**
   * Capture the canvas's full state as a JSON string. Returns null when the
   * canvas isn't ready yet — caller should no-op.
   */
  const captureSnapshot = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // why: Fabric v6's `toJSON()` typings take no args, but it delegates to
    // `toObject()` which DOES accept a propertiesToInclude array. Calling
    // `toObject([...])` directly is the supported way to get custom props
    // (our `data` metadata) into the serialized payload. Without this, the
    // round-trip would strip layer ids and undo would orphan layer-panel
    // selection state.
    const json = canvas.toObject(SERIALIZED_PROPS as unknown as string[]);
    return JSON.stringify(json);
  }, [canvasRef]);

  /**
   * Push a snapshot into the undo stack with FIFO cap. Wipes the redo stack
   * (any new branch invalidates redos). No-ops when the snapshot is identical
   * to the current state — prevents duplicate entries from coalesced events
   * that produced no net change.
   */
  const pushSnapshot = useCallback(
    (snapshot: string): void => {
      const stacks = stacksRef.current;
      if (stacks.current === snapshot) return;
      // why: when current exists, it becomes the new "undo target" — that's
      // what we walk back to. The snapshot becomes the new current.
      if (stacks.current !== null) {
        stacks.undoStack.push(stacks.current);
        if (stacks.undoStack.length > MAX_STACK) {
          stacks.undoStack.shift(); // FIFO eviction
        }
      }
      stacks.current = snapshot;
      // why: any new edit invalidates the "forward" history. This is the
      // standard undo/redo semantics — like every code editor and browser.
      stacks.redoStack = [];
      syncReactive();
    },
    [syncReactive],
  );

  /**
   * Manual snapshot trigger — used by property controls that mutate Fabric
   * without firing the events we listen for (e.g., a select-dropdown for
   * fontFamily). Flushes any pending debounced snapshot first so we don't
   * lose the intermediate state.
   */
  const record = useCallback((): void => {
    if (!isStartedRef.current) return;
    if (isReplayingRef.current) return;
    if (isSuspendedRef.current) return;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const snap = captureSnapshot();
    if (snap !== null) pushSnapshot(snap);
  }, [captureSnapshot, pushSnapshot]);

  /**
   * Start capturing. Pushes the current (post-hydration) state as the first
   * baseline so the very first user edit can be undone back to "nothing
   * changed". Idempotent.
   */
  const start = useCallback((): void => {
    if (isStartedRef.current) return;
    const baseline = pendingBaselineRef.current ?? captureSnapshot();
    if (baseline !== null) {
      // why: the baseline becomes `current`. The undoStack stays empty until
      // the first real edit — undo from this state correctly no-ops.
      stacksRef.current.current = baseline;
    }
    isStartedRef.current = true;
    syncReactive();
  }, [captureSnapshot, syncReactive]);

  /**
   * Hard-reset the history to its pristine pre-start state. The orchestrator
   * calls this whenever it rebuilds the Fabric canvas (template swap, resize,
   * slide switch). Without it, isStartedRef and the stacks survive the canvas
   * re-init (refs outlive the canvas), so start() no-ops on the new canvas
   * and the first Cmd+Z replays the PREVIOUS template's snapshot onto the
   * fresh one. Clearing everything guarantees each canvas starts with empty
   * history and start() captures a fresh baseline.
   */
  const reset = useCallback((): void => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    stacksRef.current = { undoStack: [], redoStack: [], current: null };
    pendingBaselineRef.current = null;
    isStartedRef.current = false;
    isSuspendedRef.current = false;
    syncReactive();
  }, [syncReactive]);

  /**
   * Replay a snapshot onto the canvas. Sets `isReplayingRef` so the events
   * Fabric fires during loadFromJSON don't recurse into the history.
   *
   * Fabric v6 loadFromJSON returns a Promise — we await it then trigger a
   * render. Errors are caught and logged; a failed restore leaves the canvas
   * in its current state rather than throwing into React.
   */
  const replay = useCallback(
    async (snapshot: string): Promise<void> => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      isReplayingRef.current = true;
      try {
        // why: pass the stringified snapshot directly — Fabric v6's
        // loadFromJSON accepts `string | Record<string, any>`. Passing the
        // string lets Fabric handle the parse internally and avoids us
        // narrowing the parsed shape.
        await canvas.loadFromJSON(snapshot);
        canvas.requestRenderAll();
      } catch (err) {
        // why: swallow + dev-warn. A failed undo is recoverable (canvas
        // stays where it was); we don't want to take down the editor.
        if (
          typeof process !== "undefined" &&
          process.env?.NODE_ENV !== "production"
        ) {
          // eslint-disable-next-line no-console
          console.warn("[useUndoRedoHistory] replay failed", err);
        }
      } finally {
        // why: clear the flag on next microtask so any trailing events from
        // loadFromJSON have already been processed by our handlers (which
        // currently no-op on isReplayingRef=true).
        isReplayingRef.current = false;
      }
    },
    [canvasRef],
  );

  const undo = useCallback((): void => {
    const stacks = stacksRef.current;
    if (stacks.undoStack.length === 0) return;
    // why: flush any pending debounced snapshot. Without this, a user who
    // edits then immediately hits Cmd+Z would skip a step because the
    // current state hasn't been pushed yet.
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      const snap = captureSnapshot();
      if (snap !== null && snap !== stacks.current) {
        // why: push WITHOUT clearing the redo stack — this is a flush, not
        // a new branch.
        if (stacks.current !== null) {
          stacks.undoStack.push(stacks.current);
          if (stacks.undoStack.length > MAX_STACK) stacks.undoStack.shift();
        }
        stacks.current = snap;
      }
    }
    const previous = stacks.undoStack.pop();
    if (previous === undefined) return;
    if (stacks.current !== null) {
      stacks.redoStack.push(stacks.current);
      if (stacks.redoStack.length > MAX_STACK) stacks.redoStack.shift();
    }
    stacks.current = previous;
    syncReactive();
    void replay(previous);
  }, [captureSnapshot, replay, syncReactive]);

  const redo = useCallback((): void => {
    const stacks = stacksRef.current;
    if (stacks.redoStack.length === 0) return;
    const next = stacks.redoStack.pop();
    if (next === undefined) return;
    if (stacks.current !== null) {
      stacks.undoStack.push(stacks.current);
      if (stacks.undoStack.length > MAX_STACK) stacks.undoStack.shift();
    }
    stacks.current = next;
    syncReactive();
    void replay(next);
  }, [replay, syncReactive]);

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /**
     * Debounced event handler. Coalesces a burst of mutations into one
     * snapshot. Before `start()`, snapshots are stored as `pendingBaseline`
     * (so `start()` has the freshest state to publish as the first entry)
     * but NOT pushed onto the stack.
     */
    const onMutation = (): void => {
      if (isReplayingRef.current) return;
      if (isSuspendedRef.current) return;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const snap = captureSnapshot();
        if (snap === null) return;
        if (!isStartedRef.current) {
          // why: pre-start, just track the latest state so start() can
          // publish it. No stack push.
          pendingBaselineRef.current = snap;
          return;
        }
        pushSnapshot(snap);
      }, DEBOUNCE_MS);
    };

    canvas.on("object:modified", onMutation);
    canvas.on("object:added", onMutation);
    canvas.on("object:removed", onMutation);
    // why: path:created fires when a free-draw stroke completes (used by the
    // future pen tool — not Phase 2). Wiring it now so it's covered the day
    // the pen tool ships, without us having to remember to add it.
    canvas.on("path:created", onMutation);

    return () => {
      // why: explicit named removal. canvas.off() with no args removes ALL
      // listeners, which would clobber CanvasEditor's own selection events.
      canvas.off("object:modified", onMutation);
      canvas.off("object:added", onMutation);
      canvas.off("object:removed", onMutation);
      canvas.off("path:created", onMutation);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    // why: canvasRef.current is captured at effect-mount; the orchestrator
    // re-mounts the editor (and therefore the hook) whenever it recreates
    // the Fabric Canvas, so we don't need to track the canvas identity in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current, captureSnapshot, pushSnapshot]);

  // why: pause/resume auto-snapshot during crop mode. suspend() also drops any
  // pending debounced snapshot so a pre-crop tick doesn't land mid-crop.
  const suspend = useCallback((): void => {
    isSuspendedRef.current = true;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);
  const resume = useCallback((): void => {
    isSuspendedRef.current = false;
  }, []);

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    record,
    start,
    reset,
    suspend,
    resume,
  };
}

export default useUndoRedoHistory;
