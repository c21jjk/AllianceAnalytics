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

import { ChevronDown, Sparkles } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";

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
  /**
   * Forwarded to <CanvasEditor carousel>. When present, the editor renders
   * the carousel strip + picker + preview surfaces for managing supporting
   * photos on IG/FB carousel posts.
   */
  carousel?: CanvasEditorProps["carousel"];
  /**
   * Forwarded to <CanvasEditor onMakeReel>. When provided, the editor
   * renders a "+ Reel" affordance in its header so the user can pivot from
   * still-image Studio to Reel Studio for the same listing.
   */
  onMakeReel?: CanvasEditorProps["onMakeReel"];
  /**
   * 2026-05-17 — admin-only brand library management. Forwarded straight
   * through to <CanvasEditor>. See its prop docs.
   */
  isAdmin?: CanvasEditorProps["isAdmin"];
  onUploadBrandAsset?: CanvasEditorProps["onUploadBrandAsset"];
  onArchiveBrandAsset?: CanvasEditorProps["onArchiveBrandAsset"];
  /**
   * 2026-05-17 — Custom Templates. Pass through to enable the "Save as
   * Template" header button + SaveAsTemplateModal flow. See
   * CanvasEditorProps for the full contract.
   */
  onSaveAsTemplate?: CanvasEditorProps["onSaveAsTemplate"];
  customTemplate?: CanvasEditorProps["customTemplate"];
  /**
   * 2026-05-24 — Studio edit round-trip. Forwarded verbatim to the
   * underlying CanvasEditor. When set, the editor hydrates from
   * `canvas.loadFromJSON()` against this snapshot instead of building
   * from the factory schema, restoring the user's prior edits. See
   * CanvasEditorProps.initialFabricJson for the full contract.
   */
  initialFabricJson?: CanvasEditorProps["initialFabricJson"];
  /**
   * Phase 2 AI Design provenance. When non-null, the overlay renders a
   * floating "✨ Designed by Claude" badge in the top-left + a small
   * "Revert to template default" link. Clicking Revert pops a
   * one-decision confirmation modal; on confirm, `onRevert` runs.
   *
   * The badge is rendered by the overlay shell rather than threaded
   * into <CanvasEditor> to avoid expanding CanvasEditor's prop surface
   * for a single Phase 2 affordance.
   */
  aiDesignBadge?: AiDesignBadgeProps | null;
}

export interface AiDesignBadgeProps {
  /** Closed-enum DesignMood — surfaces as a tooltip on the badge. */
  mood: string;
  /** When false, the badge gets a small "(revised)" tag so the user
   *  knows Pass 4 critique modified the layout. Informational only. */
  critiquePassed: boolean;
  /**
   * Fires AFTER the user confirms the revert modal. Caller is
   * responsible for the actual server call + closing/re-opening Studio.
   * Returns a promise so the modal's button can show a loading state.
   */
  onRevert: () => Promise<void>;
}

export default function CanvasEditorOverlay(
  props: CanvasEditorOverlayProps,
): JSX.Element | null {
  // why: track the backdrop element so we can distinguish a click on the
  // backdrop (close) from a click that bubbled up from inside the editor
  // (don't close). Without this, clicking inside the canvas would close.
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Phase 2 AI Design — local state for the Revert confirmation modal.
  // Kept inside the overlay (not lifted to the parent) because the modal
  // is purely UI scaffolding around the parent's `onRevert` callback.
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  // 2026-05-25 — consolidated badge: single pill with a popover menu that
  // contains "Revert to template default" instead of two separate floating
  // chips. badgeMenuRef catches outside-clicks to close the popover.
  const [badgeMenuOpen, setBadgeMenuOpen] = useState(false);
  const badgeMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!badgeMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!badgeMenuRef.current) return;
      if (badgeMenuRef.current.contains(e.target as Node)) return;
      setBadgeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setBadgeMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [badgeMenuOpen]);

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
        data-theme="dark"
        className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/80"
      >
        <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] px-6 py-4 text-sm text-white shadow-elevated">
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
      data-theme="dark"
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-neutral-900/80 backdrop-blur-sm animate-fade-in-up text-[var(--studio-text)]"
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
          carousel={props.carousel}
          onMakeReel={props.onMakeReel}
          isAdmin={props.isAdmin}
          onUploadBrandAsset={props.onUploadBrandAsset}
          onArchiveBrandAsset={props.onArchiveBrandAsset}
          onSaveAsTemplate={props.onSaveAsTemplate}
          customTemplate={props.customTemplate}
          initialFabricJson={props.initialFabricJson}
        />
      </div>

      {/* Phase 2 AI Design — single consolidated pill at top-left (2026-05-25).
          Was two separate chips (badge + Revert link) — now one pill with
          a chevron-trigger that opens a small menu containing "Revert to
          template default". Same Revert confirm modal flow; only the launcher
          changed. Sits above the editor in z-order so the canvas chrome
          doesn't cover it, but pointer-events on the children only so the
          rest of the modal stays clickable. */}
      {props.aiDesignBadge ? (
        <div
          ref={badgeMenuRef}
          className="pointer-events-none fixed left-4 top-4 z-[60]"
        >
          <button
            type="button"
            onClick={() => setBadgeMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={badgeMenuOpen}
            title={`Mood: ${props.aiDesignBadge.mood.replace(/_/g, " ")}${
              props.aiDesignBadge.critiquePassed ? "" : " · critique revised the layout"
            }`}
            className="focus-ring pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-gold-500 bg-white/95 px-3 py-1.5 text-xs font-semibold text-gold-900 shadow-elevated transition-colors hover:bg-gold-50"
          >
            <Sparkles size={14} />
            <span>Designed by Claude</span>
            {!props.aiDesignBadge.critiquePassed ? (
              <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-medium text-gold-800">
                revised
              </span>
            ) : null}
            <ChevronDown size={14} aria-hidden />
          </button>
          {badgeMenuOpen ? (
            <div
              role="menu"
              className="pointer-events-auto absolute left-0 top-full mt-1 min-w-[220px] rounded-lg border border-[var(--studio-border)] bg-[var(--studio-popover)] py-1 shadow-xl shadow-black/60"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setBadgeMenuOpen(false);
                  setRevertConfirmOpen(true);
                }}
                className="focus-ring-dark block w-full px-3 py-2 text-left text-xs font-medium text-white hover:bg-[var(--studio-hover)]"
              >
                Revert to template default
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Phase 2 AI Design — Revert confirmation modal. One-decision
          screen per ADHD design memory. Lives inside the overlay so its
          stacking context inherits the existing z-[50] backdrop. */}
      {revertConfirmOpen && props.aiDesignBadge ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/60"
          onMouseDown={(e) => {
            // Backdrop click closes the confirm only if not in-flight.
            if (e.target === e.currentTarget && !reverting) {
              setRevertConfirmOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] p-6 shadow-2xl shadow-black/60 text-white">
            <h2 className="text-base font-semibold text-white">
              Revert to template default?
            </h2>
            <p className="mt-2 text-sm text-[var(--studio-text-muted)]">
              This drops the Claude design and reloads the factory template the
              next time you open Studio for this post. The current AI-designed
              image stays in your library until you save a fresh render.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevertConfirmOpen(false)}
                disabled={reverting}
                className="focus-ring-dark rounded-lg border border-[var(--studio-border)] bg-transparent px-4 py-2 text-sm font-medium text-white hover:bg-[var(--studio-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!props.aiDesignBadge) return;
                  setReverting(true);
                  try {
                    await props.aiDesignBadge.onRevert();
                    // why: parent's onRevert is expected to close Studio
                    // and clear aiDesign. We close the confirm regardless
                    // so a no-op parent doesn't strand the modal open.
                    setRevertConfirmOpen(false);
                  } finally {
                    setReverting(false);
                  }
                }}
                disabled={reverting}
                className="focus-ring-dark rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white hover:bg-gold-600 disabled:opacity-50"
              >
                {reverting ? "Reverting…" : "Revert"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
