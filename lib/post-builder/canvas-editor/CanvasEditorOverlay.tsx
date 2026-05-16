"use client";

/**
 * CanvasEditorOverlay — fullscreen modal shell that wraps <CanvasEditor />.
 * --------------------------------------------------------------------------
 *
 * This is the embed layer Larissa actually sees. The Post Builder page renders
 * the overlay when the user clicks "Edit in Studio" on a selected variant.
 *
 * Design rules (from project memory — ADHD-friendly UX):
 *   • Full-screen overlay, not a sidebar drawer. The editor needs the whole
 *     viewport — a sidebar at 1080px-wide canvas leaves no room for the layer
 *     panel. Memory: "Post Editor opens as a large overlay, not inline".
 *   • One decision per screen — while the overlay is open, the underlying Post
 *     Builder is fully covered so the user isn't tempted to context-switch.
 *   • ESC closes (standard modal contract) but ONLY when no canvas text input
 *     is currently being edited — Fabric's IText editing also listens to ESC
 *     to exit text mode. We let Fabric win that.
 *   • Body scroll-lock while open so the page underneath doesn't drift.
 *
 * Why a separate file from CanvasEditor:
 *   The editor itself is reusable in non-modal contexts (e.g., a full-page
 *   route for template authoring in a later phase). Keeping the shell separate
 *   means the same editor component renders identically in either context.
 */

import { type JSX, useEffect, useRef } from "react";

import CanvasEditor from "./CanvasEditor";
import type {
  CanvasEditorProps,
  CanvasExportResult,
  CanvasTemplateSchema,
  MLSListingPayload,
} from "./types";

export interface CanvasEditorOverlayProps {
  /** Controls visibility. When false, the modal is fully unmounted. */
  open: boolean;
  /** Called when the user requests close via ESC, backdrop click, or the X. */
  onClose: () => void;
  /** Template + listing pair to load into the editor. May be null while open=false. */
  template: CanvasTemplateSchema | null;
  listing: MLSListingPayload | null;
  /** Forwarded to <CanvasEditor onSave>. */
  onSave: CanvasEditorProps["onSave"];
  /** Forwarded to <CanvasEditor saveLabel> — defaults to "Save Post". */
  saveLabel?: string;
  /** Forwarded to <CanvasEditor isSaving>. */
  isSaving?: boolean;
  /**
   * Forwarded to <CanvasEditor onTemplateSwitched>. Fires when the user
   * swaps templates inside Studio (Phase 4) so the parent's post-type /
   * variant / format state can track the canvas.
   */
  onTemplateSwitched?: CanvasEditorProps["onTemplateSwitched"];
  /**
   * Forwarded to <CanvasEditor onResize>. Fires when the user picks a new
   * format via the Resize menu so the parent can sync its format state and
   * treat the next Save as a SIBLING-row insert rather than an in-place
   * update to the current row.
   */
  onResize?: CanvasEditorProps["onResize"];
}

export default function CanvasEditorOverlay(
  props: CanvasEditorOverlayProps,
): JSX.Element | null {
  // why: track the backdrop element so we can distinguish a click on the
  // backdrop (close) from a click that bubbled up from inside the editor
  // (don't close). Without this, clicking inside the canvas would close.
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Body scroll lock — restore on close/unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!props.open) return;
    // why: capture the current overflow so we restore the EXACT prior value
    // rather than blindly setting to "auto". Some pages may have explicitly
    // set overflow: hidden for their own reasons.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.open]);

  // -------------------------------------------------------------------------
  // ESC to close — but only when no Fabric text-edit is active
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // why: if the user is editing text inside the canvas (Textbox.isEditing),
      // ESC should exit text-edit mode (Fabric handles that), not close the
      // overlay. We detect that by checking the active element — Fabric's
      // editing textarea is a hidden textarea injected at body level. When
      // that textarea is focused, document.activeElement is it.
      const active = document.activeElement;
      const inFabricTextEdit =
        active instanceof HTMLTextAreaElement &&
        // why: Fabric's hidden editing textarea has no id/class we can hook
        // onto reliably across versions. The behavioral signal is "is it a
        // textarea whose parent isn't a real form?" — close enough.
        !active.closest("form");
      if (inFabricTextEdit) return;
      // why: also bail if focus is in any other real form input — the user
      // might be typing in a future toolbar field and expect ESC to clear it,
      // not nuke the modal.
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return;
      }
      e.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, props]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  // why: unmount entirely when closed so the canvas dispose path runs and we
  // don't pay the Fabric memory cost while idle. The contained <CanvasEditor>
  // re-initializes from scratch each time the overlay re-opens — that's a
  // ~50ms hit but worth it for cleanliness.
  if (!props.open) return null;

  // why: don't render the editor without both inputs. Caller is supposed to
  // ensure both are non-null when opening, but defending against a null avoids
  // a runtime crash if the parent's state is out of sync mid-transition.
  if (!props.template || !props.listing) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/80"
      >
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-4 text-sm text-neutral-700 shadow-elevated">
          Loading editor…
        </div>
      </div>
    );
  }

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${props.template.name}`}
      onMouseDown={(e) => {
        // why: only close when the mousedown originated ON the backdrop —
        // not when it bubbled up from inside. We check target vs backdropRef.
        // Using mousedown (not click) avoids a class of bugs where the user
        // drags from inside-canvas to outside and releases on the backdrop.
        if (e.target === backdropRef.current) {
          props.onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-neutral-900/80 backdrop-blur-sm animate-fade-in-up"
    >
      {/* why: clicking inside this inner div should NEVER close — stopPropagation
          on mousedown prevents the bubble from reaching the backdrop handler. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full"
      >
        <CanvasEditor
          template={props.template}
          listing={props.listing}
          onSave={props.onSave}
          onClose={props.onClose}
          saveLabel={props.saveLabel}
          isSaving={props.isSaving}
          onTemplateSwitched={props.onTemplateSwitched}
          onResize={props.onResize}
        />
      </div>
    </div>
  );
}

/**
 * Convenience re-export so consumers can import the result type alongside
 * the overlay component from a single module:
 *
 *   import CanvasEditorOverlay, { type CanvasExportResult } from "@/lib/post-builder/canvas-editor/CanvasEditorOverlay";
 */
export type { CanvasExportResult };
