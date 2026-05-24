"use client";

/**
 * Tooltip — small dark pill that appears under (or above) any trigger.
 * --------------------------------------------------------------------
 *
 * What it replaces:
 *   The native `title="..."` attribute on icon-only buttons. Native
 *   tooltips have a ~1 second delay, look like system chrome, and on
 *   touch devices behave unpredictably. This primitive renders an
 *   in-editor pill that matches the rest of the Studio's visual
 *   language and appears ~200ms after hover/focus.
 *
 * Why a primitive (not a styled inline `<span class="group-hover:...">`):
 *   • Centralizes the delay logic — every icon button in the editor
 *     should feel the same, including the timing of appearance.
 *   • Keyboard-accessibility is a single place to maintain (focus +
 *     focus-visible behave differently across browsers).
 *   • Lets us flip `placement` between top/bottom per surface without
 *     hand-positioning every callsite.
 *
 * What it does NOT do:
 *   • Doesn't measure / collide-detect — placement is whatever the
 *     caller passes. The 28-32px icon buttons we use in the editor
 *     never sit close enough to the viewport edges for collision to
 *     matter in practice, and adding measurement is a footgun (forces
 *     a layout pass on every hover).
 *   • Doesn't render a portal — uses `absolute` inside the trigger's
 *     positioned wrapper. The editor's stacking contexts are well-behaved
 *     (no overflow:hidden on the layouts in question), so a portal would
 *     be over-engineering.
 *
 * Usage:
 *   <Tooltip label="Undo">
 *     <button onClick={...} aria-label="Undo">↶</button>
 *   </Tooltip>
 *
 * The wrapped child is rendered as-is — Tooltip wraps it in a
 * `<span className="relative inline-flex">` so the absolute pill
 * positions correctly without changing layout flow.
 */

import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";

export interface TooltipProps {
  /** The label shown inside the pill. Keep it short — 1-3 words. */
  label: string;
  /**
   * Where the pill appears relative to the trigger.
   *   • "bottom" (default) — pill renders BELOW the trigger. Works for
   *     buttons at the top of the canvas area (top toolbar, side panels).
   *   • "top" — pill renders ABOVE. Use for buttons at the bottom of
   *     the canvas (footer cluster: zoom, alignment, undo/redo) so the
   *     pill doesn't get clipped by the canvas footer's bottom edge.
   */
  placement?: "top" | "bottom";
  /**
   * Delay in ms before the pill appears. Default 200ms — matches the
   * delay used by VS Code, Figma, and Linear. Fast enough to feel
   * responsive when the user is checking labels, slow enough that a
   * mouse-passing-through doesn't flash tooltips everywhere.
   */
  delayMs?: number;
  /**
   * When true (default), the pill also appears on keyboard focus so
   * keyboard users get the same affordance. Set false for cases where
   * focus appears on an unrelated child (rare).
   */
  showOnFocus?: boolean;
  /**
   * Tailwind classes appended to the wrapper span. The wrapper defaults
   * to `relative inline-flex` (content-sized). Override when the trigger
   * lives in a grid cell or other layout that needs the wrapper to fill
   * its parent — pass `"w-full"` (or the full custom class string) so
   * `aspect-square` / other size-derived rules on the trigger still work.
   */
  wrapperClassName?: string;
  /** The trigger. Rendered as-is. */
  children: ReactNode;
}

const DEFAULT_DELAY_MS = 200;

export default function Tooltip(props: TooltipProps): JSX.Element {
  const {
    label,
    placement = "bottom",
    delayMs = DEFAULT_DELAY_MS,
    showOnFocus = true,
    wrapperClassName,
    children,
  } = props;

  const [visible, setVisible] = useState(false);
  // why: the timeout id is held in a ref (not state) so clearing it on
  // unmount doesn't trigger a re-render. setState in cleanup is a no-op
  // that produces a React warning in dev.
  const showTimer = useRef<number | null>(null);

  // why: cancel any pending show-timer on unmount so a hover that's
  // about to trigger doesn't fire after the trigger has gone away.
  useEffect(() => {
    return () => {
      if (showTimer.current !== null) {
        window.clearTimeout(showTimer.current);
      }
    };
  }, []);

  const scheduleShow = (): void => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      setVisible(true);
      showTimer.current = null;
    }, delayMs);
  };

  const cancelShow = (): void => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setVisible(false);
  };

  // why: a single span wrapper carries all the event handlers. This
  // keeps the API "wrap your trigger" — callers don't have to inject
  // handlers into their own button element.
  return (
    <span
      className={`relative inline-flex ${wrapperClassName ?? ""}`.trim()}
      onMouseEnter={scheduleShow}
      onMouseLeave={cancelShow}
      // why: focusin/out bubble; React's onFocus/onBlur do too. Using
      // these means we catch focus on any descendant (the actual button),
      // not just on the wrapper span.
      onFocus={showOnFocus ? scheduleShow : undefined}
      onBlur={showOnFocus ? cancelShow : undefined}
    >
      {children}
      {visible ? (
        <span
          // why: role="tooltip" + aria-hidden NOT used — the trigger
          // itself owns the accessible name via its own aria-label /
          // title. This pill is purely visual; making it a role=tooltip
          // would cause screen readers to read the label TWICE.
          aria-hidden="true"
          className={[
            // Common visual style — small, dark, rounded, drop-shadow.
            "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2",
            "whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1",
            "text-[11px] font-medium leading-none text-white",
            "shadow-elevated animate-fade-in-up",
            // Placement: top or bottom of the trigger.
            placement === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          ].join(" ")}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
