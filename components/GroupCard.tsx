import clsx from "clsx";
import Link from "next/link";
import type { PlatformPosting, PostGroup } from "@/lib/types/group";
import type { Platform } from "@/lib/types/post";
import AiInsightStrip from "./AiInsightStrip";
import GroupCardActions from "./GroupCardActions";
import GroupCardMergeButton from "./GroupCardMergeButton";
import GroupCardSidebar, {
  type AudienceOfficeOption,
} from "./GroupCardSidebar";
import MlsNumberInline from "./MlsNumberInline";
import PlatformMetricCell from "./PlatformMetricCell";

/**
 * Pick the "primary" posting for the card-level click target. Preference order:
 * Instagram → Facebook → TikTok, falling back to first by array order. This
 * gives a stable representative when a multi-platform group is clicked from
 * blank space; per-platform tiles still link to their own postings.
 */
function pickPrimaryPosting(
  postings: PlatformPosting[],
): PlatformPosting | undefined {
  if (postings.length === 0) return undefined;
  const order: Platform[] = ["instagram", "facebook", "tiktok"];
  for (const p of order) {
    const hit = postings.find((x) => x.platform === p);
    if (hit) return hit;
  }
  return postings[0];
}

interface GroupCardProps {
  group: PostGroup;
  /** Office options for the audience scope dropdown in the right rail. */
  offices: AudienceOfficeOption[];
  /** When true, the right-rail housekeeping controls are interactive. */
  isAdmin: boolean;
}

/**
 * Wide horizontal card for the operational homepage.
 *
 * Layout (md+):
 *   - 160px hero on the left (clickable, opens InlineVideoModal)
 *   - Center column: date · caption · agent/category chips · 4 metric tiles · AI insight
 *   - 288px right rail: Linkage (multi-MLS + property chips + owner reports),
 *     Attribution (audience scope), Status (tracking pill + promote)
 *
 * Mobile: hero, body, rail stack vertically.
 */
export default function GroupCard({
  group,
  offices,
  isAdmin,
}: GroupCardProps) {
  const fbPostings = group.postings.filter((p) => p.platform === "facebook");
  const igPostings = group.postings.filter((p) => p.platform === "instagram");
  const ttPostings = group.postings.filter((p) => p.platform === "tiktok");
  const isVideo = group.postings.some((p) => p.is_video);

  const hasProperty = !!group.property;
  const reportEligible = hasProperty && group.days_old >= 7;

  // Date display: "Apr 21 · Tuesday"
  const dateLabel = formatDateLabel(group.posted_date);

  // Merge controls: only relevant for real groups (synthetic singletons use a
  // 'solo-{post_id}' id) AND when at least one platform isn't already covered.
  const isRealGroup = !group.id.startsWith("solo-");
  const distinctPlatforms = new Set(group.postings.map((p) => p.platform));
  const canMergeMore = distinctPlatforms.size < 3;
  const showMergeButton = isRealGroup && canMergeMore;

  // Primary posting for the card-level click target. The drawer overlay opens
  // /posts/[that-post-id] when the user clicks blank space on the card body.
  // Per-platform tiles below have their own click targets.
  const primaryPosting = pickPrimaryPosting(group.postings);

  return (
    <article
      className={clsx(
        "relative group rounded-xl border border-neutral-200 bg-white shadow-card",
        "hover:border-gold-200 hover:shadow-card-hover transition-all",
      )}
    >
      {/* Stretched link layer — covers the whole card. Interactive children
          re-enable pointer events with pointer-events-auto. */}
      {primaryPosting ? (
        <Link
          href={`/posts/${primaryPosting.post_id}`}
          className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
          aria-label="Open post detail"
        />
      ) : null}

      <div className="relative pointer-events-none flex flex-col md:flex-row gap-4 p-4">
        {/* Hero (client) — pointer-events-auto so the InlineVideoModal trigger
            fires instead of the wrapping stretched link. */}
        <GroupCardActions
          postings={group.postings}
          thumbnailUrl={group.representative_thumbnail}
          caption={group.representative_caption}
          isVideo={isVideo}
          className="pointer-events-auto"
        />

        {/* Center column: caption + chips + metrics + AI insight */}
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
                {/* MLS inline-edit only when no property linked yet — once
                    linked, the right rail Linkage block owns property edits. */}
                {primaryPosting && group.properties.length === 0 ? (
                  <MlsNumberInline
                    postId={primaryPosting.post_id}
                    currentMls={group.mls_number_parsed ?? null}
                    isLinked={false}
                    compact
                    size="sm"
                  />
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

            <div className="flex flex-col items-end gap-1 shrink-0 pointer-events-auto">
              {group.is_locked ? (
                <span
                  className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
                  title="This group was manually merged and is locked from the auto-grouper."
                >
                  Manual
                </span>
              ) : null}
              {showMergeButton ? (
                <GroupCardMergeButton groupId={group.id} />
              ) : null}
            </div>
          </div>

          {/* Metrics row: FB | IG | TT | Total. Each platform tile that has
              actual postings is its own click target → that platform's post
              detail. Empty tiles + the Total tile remain inert and let the
              wrapping card link fire. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PlatformMetricLink platform="facebook" postings={fbPostings} />
            <PlatformMetricLink platform="instagram" postings={igPostings} />
            <PlatformMetricLink platform="tiktok" postings={ttPostings} />
            <PlatformMetricCell
              platform="total"
              totalReach={group.total_reach}
              totalEngagements={group.total_engagements}
              engagementRate={group.engagement_rate}
            />
          </div>

          {/* AI insight strip — live coaching from Opus 4.6, scoped to the
              office market profile + cross-platform siblings + agent/office
              baselines. The strip handles its own loading skeleton + 30-min
              client cache, and silently hides if Anthropic isn't configured. */}
          {primaryPosting ? (
            <AiInsightStrip
              postId={primaryPosting.post_id}
              insight={group.ai_insight}
            />
          ) : (
            <AiInsightStrip insight={group.ai_insight} />
          )}
        </div>

        {/* Right rail — housekeeping (multi-MLS, audience scope, status) */}
        <GroupCardSidebar
          group={group}
          offices={offices}
          isAdmin={isAdmin}
          variant="card"
        />
      </div>
    </article>
  );
}

/**
 * PlatformMetricCell wrapped in a Link when there are postings on that
 * platform. Empty platforms render the cell directly so the wrapping card
 * link can take over. We use stopPropagation so the link goes to *this*
 * platform's post detail, not the card's primary posting.
 */
function PlatformMetricLink({
  platform,
  postings,
}: {
  platform: Platform;
  postings: PlatformPosting[];
}) {
  if (postings.length === 0) {
    return <PlatformMetricCell platform={platform} postings={postings} />;
  }
  // Use the first posting on this platform as the click target. In the
  // overwhelmingly-common single-posting-per-platform case, that's exactly
  // right.
  //
  // No onClick / stopPropagation here — GroupCard is a server component and
  // can't pass function props to <Link> (a client component). It's also
  // unnecessary: the outer stretched <Link> is a SIBLING of the content
  // wrapper, not an ancestor, so clicks on this inner Link don't bubble to
  // it. pointer-events-auto on this element is what wins the hit test against
  // the outer link's pointer-events-none subtree.
  const target = postings[0];
  return (
    <Link
      href={`/posts/${target.post_id}`}
      className="pointer-events-auto block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40 hover:opacity-90 transition"
      aria-label={`Open ${platform} post detail`}
    >
      <PlatformMetricCell platform={platform} postings={postings} />
    </Link>
  );
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
