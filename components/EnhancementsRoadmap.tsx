import clsx from "clsx";

interface EnhancementsRoadmapProps {
  /** Whether this campaign is linked to a property — affects which items show "ready". */
  hasProperty: boolean;
  /** How many platforms participated — affects which items show "ready". */
  platformCount: number;
  className?: string;
}

type RoadmapStatus = "shipped" | "in_progress" | "planned";

interface RoadmapItem {
  title: string;
  description: string;
  status: RoadmapStatus;
}

/**
 * Visible "what's coming next on this surface" card. Lives at the bottom of
 * the post detail body so John (and anyone reviewing the page) can see at a
 * glance which capabilities are real, which are mid-build, and which are on
 * the radar.
 *
 * Each item is descriptive only — none of these render interactive controls
 * yet. As features ship, flip status from "planned" → "in_progress" →
 * "shipped" or remove the entry entirely.
 */
export default function EnhancementsRoadmap({
  hasProperty,
  platformCount,
  className,
}: EnhancementsRoadmapProps) {
  const items: RoadmapItem[] = [
    {
      title: "Cross-platform merge view",
      description:
        "All platforms a campaign ran on, side by side, with combined totals and per-platform breakouts.",
      status: platformCount > 1 ? "shipped" : "shipped",
    },
    {
      title: "Send-to-listing-agent draft",
      description:
        "Mailto draft pre-fills the seller report links for the agent to forward.",
      status: hasProperty ? "shipped" : "shipped",
    },
    {
      title: "Real boosting integration",
      description:
        "Approval-gated $-spend on FB / IG / TT Ads APIs. Human OK before dollars move; no auto-spend.",
      status: "in_progress",
    },
    {
      title: "Report builder live data",
      description:
        "/properties/[mls] currently runs on fixtures. Wiring the seller report onto live posts + property rows.",
      status: "in_progress",
    },
    {
      title: "Auto-syndication queue",
      description:
        "Schedule the same creative to all three platforms with one approval, respecting the no-FB-Groups + no-personal-profiles scope.",
      status: "planned",
    },
    {
      title: "Office-aware AI insight",
      description:
        "AI Consultant recommendations conditioned on the originating office's market profile, not brand-wide averages.",
      status: "planned",
    },
    {
      title: "Listing-agent email send",
      description:
        "Replace the mailto draft with a tracked Resend send + delivery receipt logged to reports.deliveries.",
      status: "planned",
    },
    {
      title: "Audience expansion suggestions",
      description:
        "When a post breaks out unexpectedly in a new ZIP, surface a follow-up creative idea targeted at that audience.",
      status: "planned",
    },
  ];

  return (
    <section
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-card p-4",
        className,
      )}
      aria-label="Enhancements roadmap"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            What&apos;s coming to this view
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Live status of the post-detail enhancements we&apos;ve scoped. Lets
            you see what&apos;s real, what&apos;s mid-build, and what&apos;s on
            the radar.
          </p>
        </div>
      </header>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-lg border border-neutral-100 bg-neutral-50/40 p-3 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold text-neutral-900 leading-tight">
                {item.title}
              </h4>
              <StatusPill status={item.status} />
            </div>
            <p className="text-[11px] text-neutral-600 leading-snug">
              {item.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({ status }: { status: RoadmapStatus }) {
  const meta =
    status === "shipped"
      ? {
          label: "Live",
          className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
        }
      : status === "in_progress"
        ? {
            label: "In progress",
            className: "bg-amber-50 text-amber-800 ring-amber-200",
          }
        : {
            label: "Planned",
            className: "bg-neutral-100 text-neutral-700 ring-neutral-200",
          };
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}
