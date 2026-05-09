import clsx from "clsx";
import Link from "next/link";
import type { PostGroup } from "@/lib/types/group";
import type { Platform } from "@/lib/types/post";
import AiInsightStrip from "./AiInsightStrip";
import GroupCardActions from "./GroupCardActions";
import PlatformMetricCell from "./PlatformMetricCell";
import PropertyChip from "./PropertyChip";

interface GroupCardProps {
  group: PostGroup;
}

/**
 * Wide horizontal card for the operational homepage.
 *
 * Layout:
 *   - 160px hero on the left (clickable, opens InlineVideoModal)
 *   - Right side, top: date · caption · agent/property chips · actions
 *   - Right side, middle: 4-column metrics row (FB / IG / TT / Total)
 *   - Right side, bottom: AI insight strip
 */
export default function GroupCard({ group }: GroupCardProps) {
  const fbPostings = group.postings.filter((p) => p.platform === "facebook");
  const igPostings = group.postings.filter((p) => p.platform === "instagram");
  const ttPostings = group.postings.filter((p) => p.platform === "tiktok");
  const isVideo = group.postings.some((p) => p.is_video);

  const hasProperty = !!group.property;
  const reportEligible = hasProperty && group.days_old >= 7;

  // Date display: "Apr 21 · Tuesday"
  const dateLabel = formatDateLabel(group.posted_date);

  return (
    <article
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-card",
        "hover:border-gold-200 transition-colors",
      )}
    >
      <div className="flex flex-col md:flex-row gap-4 p-4">
        {/* Hero (client) */}
        <GroupCardActions
          postings={group.postings}
          thumbnailUrl={group.representative_thumbnail}
          caption={group.representative_caption}
          isVideo={isVideo}
        />

        {/* Body */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-neutral-500">
                {dateLabel}
              </div>
              <p className="mt-1 text-sm text-neutral-900 leading-snug line-clamp-2">
                {group.representative_caption || (
                  <span className="italic text-neutral-400">No caption</span>
                )}
              </p>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                {group.agent_name ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700">
                    <PersonIcon />
                    {group.agent_name}
                  </span>
                ) : null}
                {group.property ? (
                  <PropertyChip property={group.property} />
                ) : null}
                {group.category ? (
                  <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 capitalize">
                    {group.category}
                  </span>
                ) : null}
                {/* Per-platform pills */}
                {group.postings.map((p) => (
                  <PlatformPill key={p.platform} platform={p.platform} />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!hasProperty ? (
                <Link
                  href={firstPostHref(group)}
                  className="inline-flex items-center gap-1 rounded-md bg-white ring-1 ring-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Link property
                </Link>
              ) : null}
              {reportEligible && group.property ? (
                <Link
                  href={`/properties/${encodeURIComponent(group.property.mls)}`}
                  className="inline-flex items-center gap-1 rounded-md bg-gold-500 hover:bg-gold-600 text-white px-2.5 py-1 text-xs font-medium"
                >
                  Generate report
                  <ArrowUpRight />
                </Link>
              ) : null}
            </div>
          </div>

          {/* Metrics row: FB | IG | TT | Total */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PlatformMetricCell platform="facebook" postings={fbPostings} />
            <PlatformMetricCell platform="instagram" postings={igPostings} />
            <PlatformMetricCell platform="tiktok" postings={ttPostings} />
            <PlatformMetricCell
              platform="total"
              totalReach={group.total_reach}
              totalEngagements={group.total_engagements}
              engagementRate={group.engagement_rate}
            />
          </div>

          {/* AI insight strip */}
          <AiInsightStrip insight={group.ai_insight} />
        </div>
      </div>
    </article>
  );
}

function firstPostHref(group: PostGroup): string {
  const first = group.postings[0];
  if (!first) return "/posts";
  return `/posts/${first.post_id}`;
}

function formatDateLabel(isoDate: string): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.toLocaleDateString(undefined, { day: "numeric" });
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  return `${month} ${day} · ${weekday}`;
}

function PlatformPill({ platform }: { platform: Platform }) {
  const styles =
    platform === "instagram"
      ? "bg-pink-50 text-pink-700 ring-pink-200"
      : platform === "tiktok"
        ? "bg-neutral-900 text-white ring-neutral-900"
        : "bg-blue-50 text-blue-700 ring-blue-200";
  const label =
    platform === "instagram" ? "IG" : platform === "tiktok" ? "TT" : "FB";
  // Tailwind v3 doesn't include pink-50/200 in its default neutral palette
  // for our config; if the gradient doesn't render, the explicit fallbacks
  // here will still degrade to clean ring-1 chips.
  const fallback =
    platform === "instagram"
      ? { backgroundColor: "#fde7f0", color: "#8b1d4d" }
      : undefined;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md ring-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles,
      )}
      style={fallback}
    >
      {label}
    </span>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <circle
        cx="12"
        cy="8"
        r="3.6"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M4 20c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
