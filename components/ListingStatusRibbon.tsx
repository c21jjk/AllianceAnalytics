import clsx from "clsx";
import type { ListingPromotionStatus } from "@/lib/data/listings-needing-posts";

interface ListingStatusRibbonProps {
  status: ListingPromotionStatus;
  /** Visual size variant — "sm" for the 48x48 dashboard thumb, "md" for the 16:9 hero photo. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Diagonal corner ribbon overlaid on a listing's hero image. Visible from
 * across the room — designed for ADHD-friendly "scan the dashboard" mode.
 *
 *   POSTED       → Gold ribbon (Relentless Gold #C9A84C)
 *   DISMISSED    → Dark grey ribbon (Obsessed Grey #252526) at lower opacity
 *   needs_post   → Renders nothing (clean photo, drawing the eye by absence)
 *
 * Sized variants:
 *   "sm"   compact pill on the 48x48 thumbnail in the dashboard listing rows
 *   "md"   full diagonal ribbon stretching across the hero on /properties cards
 */
export default function ListingStatusRibbon({
  status,
  size = "md",
  className,
}: ListingStatusRibbonProps) {
  if (status === "needs_post") return null;

  const isPosted = status === "posted";
  const label = isPosted ? "POSTED ✓" : "DISMISSED";

  if (size === "sm") {
    // Compact pill rendered as a horizontal banner near the bottom of the thumb.
    return (
      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 text-center text-[8px] font-bold uppercase tracking-wide leading-tight py-0.5 backdrop-blur-[1px]",
          isPosted
            ? "bg-gold-500/85 text-white"
            : "bg-neutral-900/80 text-white",
          className,
        )}
        aria-label={`Listing status: ${label}`}
      >
        {label}
      </div>
    );
  }

  // "md" — diagonal ribbon stretching across the upper-right of the hero.
  return (
    <div
      className={clsx(
        "absolute top-0 right-0 z-10 pointer-events-none overflow-hidden w-32 h-32",
        className,
      )}
      aria-label={`Listing status: ${label}`}
    >
      <div
        className={clsx(
          "absolute text-center text-xs font-bold uppercase tracking-wider text-white shadow-lg",
          "py-1.5 left-[-30px] top-[26px] w-[170px] rotate-45",
          isPosted ? "bg-gold-500" : "bg-neutral-900/90",
        )}
      >
        {label}
      </div>
    </div>
  );
}
