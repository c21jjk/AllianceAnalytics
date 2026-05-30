/**
 * 5-slot portal metrics strip rendered in three sizes.
 *
 *   variant="compact" — Post cards. Two-line, tiny.
 *   variant="card"    — Main property cards. Five mini-tiles with views.
 *   variant="story"   — Owner Story. Larger lockups, full view counts.
 *
 * Slots: Zillow / Realtor.com / Trulia / CIH / Other Portals.
 *
 * Views only. ListTrac reports saves/inquiries/shares so sparsely for this
 * org (~20 saves ever vs. 117k+ views) that surfacing them would just be a
 * column of zeros — so the strip shows views and nothing else (2026-05-29).
 */
import clsx from "clsx";
import type { PortalStrip, PortalStripSlot } from "@/lib/data/portal-metrics-db";
import PortalMark from "./PortalMark";
import { formatCompactNumber } from "@/lib/format";

interface PortalMetricsStripProps {
  strip: PortalStrip;
  variant: "compact" | "card" | "story";
  /** Optional caption rendered above the strip. */
  caption?: string;
  className?: string;
}

export default function PortalMetricsStrip({
  strip,
  variant,
  caption,
  className,
}: PortalMetricsStripProps) {
  if (variant === "compact") return <CompactStrip strip={strip} caption={caption} className={className} />;
  if (variant === "card") return <CardStrip strip={strip} caption={caption} className={className} />;
  return <StoryStrip strip={strip} caption={caption} className={className} />;
}

// ---------------------------------------------------------------------------
// Compact — for Post cards (PostThumbnailGrid)
// ---------------------------------------------------------------------------
function CompactStrip({
  strip,
  caption,
  className,
}: {
  strip: PortalStrip;
  caption?: string;
  className?: string;
}) {
  if (!strip.has_data) return null;
  return (
    <div className={clsx("space-y-1", className)}>
      {caption ? (
        <p className="text-[9px] uppercase tracking-wider text-neutral-500">
          {caption}
        </p>
      ) : null}
      <ul className="flex items-center justify-between gap-1.5">
        {strip.slots.map((slot) => (
          <li
            key={slot.key}
            className="flex flex-col items-center gap-0.5 min-w-0 flex-1"
            title={slotTooltip(slot)}
          >
            <PortalMark portal={slot.key} size="xs" />
            <span
              className={clsx(
                "text-[10px] tabular-nums leading-none",
                slot.views > 0
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-400",
              )}
            >
              {slot.views > 0 ? formatCompactNumber(slot.views) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card — for Main Property Cards (/properties list)
// ---------------------------------------------------------------------------
function CardStrip({
  strip,
  caption,
  className,
}: {
  strip: PortalStrip;
  caption?: string;
  className?: string;
}) {
  if (!strip.has_data) {
    return (
      <div
        className={clsx(
          "rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2 text-[11px] text-neutral-500",
          className,
        )}
      >
        Portal traffic data not available yet
      </div>
    );
  }

  return (
    <div className={clsx("space-y-1.5", className)}>
      {caption ? (
        <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
          {caption}
        </p>
      ) : null}
      <ul className="grid grid-cols-5 gap-1.5">
        {strip.slots.map((slot) => (
          <li
            key={slot.key}
            className="rounded-md border border-neutral-200 bg-white px-1.5 py-1.5 flex flex-col items-center gap-1 min-w-0"
            title={slotTooltip(slot)}
          >
            <PortalMark portal={slot.key} size="xs" />
            <div className="flex flex-col items-center leading-tight">
              <span
                className={clsx(
                  "text-xs tabular-nums",
                  slot.views > 0
                    ? "font-bold text-neutral-900"
                    : "text-neutral-400 font-medium",
                )}
              >
                {slot.views > 0 ? formatCompactNumber(slot.views) : "—"}
              </span>
              <span className="text-[9px] text-neutral-500 uppercase tracking-wide">
                views
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story — for Owner Story (seller-facing /home/[token])
// ---------------------------------------------------------------------------
function StoryStrip({
  strip,
  caption,
  className,
}: {
  strip: PortalStrip;
  caption?: string;
  className?: string;
}) {
  if (!strip.has_data) {
    return (
      <div
        className={clsx(
          "rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/60 px-5 py-6 text-center text-sm text-neutral-600",
          className,
        )}
      >
        Portal traffic data is still syncing — check back tomorrow.
      </div>
    );
  }

  return (
    <div className={clsx("space-y-3", className)}>
      {caption ? (
        <p className="text-sm text-neutral-600 leading-relaxed">{caption}</p>
      ) : null}
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {strip.slots.map((slot) => (
          <li
            key={slot.key}
            className="rounded-2xl border border-neutral-200 bg-white shadow-card p-4 flex flex-col items-center gap-3 min-w-0"
          >
            <PortalMark portal={slot.key} size="md" />
            <div className="flex flex-col items-center text-center">
              <span
                className={clsx(
                  "text-3xl font-bold tabular-nums leading-tight",
                  slot.views > 0 ? "text-neutral-900" : "text-neutral-300",
                )}
              >
                {slot.views > 0 ? slot.views.toLocaleString() : "—"}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-neutral-500 mt-1">
                {slot.views === 1 ? "view" : "views"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function slotTooltip(slot: PortalStripSlot): string {
  if (slot.views === 0) {
    return `${slot.display_name}: no portal traffic in this window.`;
  }
  return `${slot.display_name}: ${slot.views.toLocaleString()} view${slot.views === 1 ? "" : "s"}`;
}
