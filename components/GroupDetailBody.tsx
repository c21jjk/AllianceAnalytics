import {
  formatCompactNumber,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
} from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
import PropertyChip from "@/components/PropertyChip";
import MetricSparkline from "@/components/MetricSparkline";
import AiInsightStrip from "@/components/AiInsightStrip";
import PropertyClassifyPanel from "@/components/PropertyClassifyPanel";
import AttachListingCta from "@/components/AttachListingCta";
import GenerateReportButton from "@/components/GenerateReportButton";
import SendToAgentButton from "@/components/SendToAgentButton";
import BoostPlatformPlaceholder from "@/components/BoostPlatformPlaceholder";
import EnhancementsRoadmap from "@/components/EnhancementsRoadmap";
import type { Post, PostAudience, Platform } from "@/lib/types/post";
import type { PostGroup, PlatformPosting } from "@/lib/types/group";

interface GroupDetailBodyProps {
  group: PostGroup;
  /** Member posts hydrated as full Post objects (audience, daily, video metrics). */
  posts: Post[];
  offices: Array<{ id: string; short_code: string; name: string }>;
  initialOfficeId: string | null;
  /** Listing-agent contact for the linked property (or null when unlinked). */
  listingAgent: { name: string | null; email: string | null } | null;
  /** Combined daily reach across platforms, ascending date order. */
  combinedDaily: Array<{ date: string; reach: number; engagements: number }>;
  /** First non-empty audience block from any member post, or null. */
  combinedAudience: PostAudience | null;
  /** Optional id of the post the user clicked into; used for live AI insight calls. */
  primaryPostId?: string;
}

const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "tiktok"];

/**
 * Group-aware post detail body.
 *
 * Renders the merged campaign — every platform that participated, plus
 * combined totals, AI insight, listing-agent CTA, report-builder CTA, and
 * placeholder cards for in-flight enhancements (boost integration, follow-up
 * automation, audience expansion). Used by both the drawer overlay and the
 * standalone /posts/[id] route so the UI is identical either way.
 */
export default function GroupDetailBody({
  group,
  posts,
  offices,
  initialOfficeId,
  listingAgent,
  combinedDaily,
  combinedAudience,
  primaryPostId,
}: GroupDetailBodyProps) {
  // Index member posts by post_id for the per-platform blocks.
  const postById = new Map<string, Post>(posts.map((p) => [p.id, p]));
  const orderedPostings = group.postings.slice().sort((a, b) => {
    return PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform);
  });

  const hasProperty = Boolean(group.property);
  const newestAgeDays = group.days_old;
  const reportEligible = hasProperty && newestAgeDays >= 7;

  // Caption / hashtags drawn from the most caption-rich member.
  const captionSource =
    posts.find((p) => p.caption && p.caption.length > 0) ?? posts[0];
  const caption = group.representative_caption || captionSource?.caption || "";
  const hashtags = captionSource?.hashtags ?? [];

  // Combined totals.
  const totalReach = group.total_reach;
  const totalEngagements = group.total_engagements;
  const engagementRate = group.engagement_rate;
  const totalImpressions = posts.reduce(
    (s, p) => s + (p.metrics.impressions ?? 0),
    0,
  );
  const totalPlays = posts.reduce((s, p) => s + (p.metrics.plays ?? 0), 0);
  const totalLikes = posts.reduce((s, p) => s + p.metrics.likes, 0);
  const totalComments = posts.reduce((s, p) => s + p.metrics.comments, 0);
  const totalShares = posts.reduce((s, p) => s + p.metrics.shares, 0);
  const totalSaves = posts.reduce((s, p) => s + p.metrics.saves, 0);

  // Pick a primary post id for the live AI insight strip — prefer the post the
  // user clicked into, otherwise the first hydrated post.
  const liveInsightPostId = primaryPostId ?? posts[0]?.id;

  return (
    <div className="px-5 py-5 space-y-5">
      {/* ATTACH CTA ---------------------------------------------------------- */}
      {!hasProperty && liveInsightPostId ? <AttachListingCta /> : null}

      {/* CAMPAIGN HEADER ----------------------------------------------------- */}
      <article className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="relative aspect-square bg-neutral-100">
            {group.representative_thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={group.representative_thumbnail}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
            {/* Stack of platform glyphs in the corner — shows the merge. */}
            <div className="absolute top-2 left-2 flex -space-x-1">
              {orderedPostings.map((p) => (
                <PlatformBadge
                  key={p.platform}
                  platform={p.platform}
                  size="sm"
                  className="ring-2 ring-white"
                />
              ))}
            </div>
          </div>

          <div className="p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-neutral-500">
                {formatShortDate(group.posted_date)} ·{" "}
                {formatRelativeTime(`${group.posted_date}T12:00:00Z`)}
              </span>
              {orderedPostings.map((p) => (
                <PlatformBadge
                  key={p.platform}
                  platform={p.platform}
                  size="sm"
                  showLabel
                />
              ))}
              {group.is_locked ? (
                <span
                  className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
                  title="This campaign was manually merged and is locked from the auto-grouper."
                >
                  Manual merge
                </span>
              ) : orderedPostings.length > 1 ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                  Auto-merged
                </span>
              ) : null}
            </div>

            {/* MLS chip removed — the right-rail Property block now owns MLS
                add/edit. We keep the property + agent + category badges here
                because they're useful at-a-glance summary info. */}
            {group.property || group.agent_name || group.category ? (
              <div className="flex items-center gap-2 flex-wrap">
                {group.property ? (
                  <PropertyChip property={group.property} />
                ) : null}
                {group.agent_name ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700">
                    <PersonIcon />
                    {group.agent_name}
                  </span>
                ) : null}
                {group.category ? (
                  <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 capitalize">
                    {group.category.replace("_", " ")}
                  </span>
                ) : null}
              </div>
            ) : null}

            {caption ? (
              <p className="text-sm text-neutral-900 leading-relaxed whitespace-pre-line">
                {caption}
              </p>
            ) : null}

            {hashtags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {hashtags.slice(0, 12).map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600"
                  >
                    {h}
                  </span>
                ))}
                {hashtags.length > 12 ? (
                  <span className="text-[11px] text-neutral-400 self-center">
                    +{hashtags.length - 12}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </article>

      {/* PER-PLATFORM CARDS -------------------------------------------------- */}
      <section
        className="space-y-3"
        aria-label={`Performance across ${orderedPostings.length} platform${orderedPostings.length === 1 ? "" : "s"}`}
      >
        <header className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">
            Per-platform performance
          </h3>
          <span className="text-[11px] text-neutral-500 uppercase tracking-wide">
            {orderedPostings.length} platform
            {orderedPostings.length === 1 ? "" : "s"}
          </span>
        </header>
        {orderedPostings.map((posting) => (
          <PerPlatformCard
            key={posting.post_id}
            posting={posting}
            post={postById.get(posting.post_id)}
          />
        ))}
      </section>

      {/* COMBINED TOTALS ----------------------------------------------------- */}
      <section
        className="rounded-xl border border-neutral-200 bg-white shadow-card p-4"
        aria-label="Combined campaign metrics"
      >
        <header className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Campaign totals
          </h3>
          <span className="text-[11px] text-neutral-500 uppercase tracking-wide">
            Combined across platforms
          </span>
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <BigStat label="Reach" value={formatNumber(totalReach)} />
          <BigStat
            label="Engagements"
            value={formatNumber(totalEngagements)}
          />
          <BigStat label="ER" value={formatPercent(engagementRate, 1)} />
          <BigStat
            label={totalPlays > 0 ? "Plays" : "Impressions"}
            value={formatNumber(totalPlays > 0 ? totalPlays : totalImpressions)}
          />
          <BigStat label="Likes" value={formatNumber(totalLikes)} />
          <BigStat label="Comments" value={formatNumber(totalComments)} />
          <BigStat label="Shares" value={formatNumber(totalShares)} />
          <BigStat label="Saves" value={formatNumber(totalSaves)} />
        </div>

        {combinedDaily.length > 1 ? (
          <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Combined reach over the {combinedDaily.length} days following posting
              </div>
              <div className="text-xs text-neutral-500">
                Peak:{" "}
                <span className="font-medium text-neutral-900 tabular-nums">
                  {formatCompactNumber(
                    Math.max(...combinedDaily.map((d) => d.reach)),
                  )}
                </span>
              </div>
            </div>
            <MetricSparkline
              values={combinedDaily.map((d) => d.reach)}
              width={680}
              height={72}
              className="w-full h-auto"
            />
          </div>
        ) : null}
      </section>

      {/* LIVE AI INSIGHT ----------------------------------------------------- */}
      {liveInsightPostId ? (
        <AiInsightStrip postId={liveInsightPostId} />
      ) : (
        <AiInsightStrip insight={group.ai_insight} />
      )}

      {/* ACTIONS ROW (REPORT + AGENT) ---------------------------------------- */}
      <section
        className="rounded-xl border border-neutral-200 bg-white shadow-card p-4"
        aria-label="Report actions"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">
              Seller report
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              {hasProperty
                ? reportEligible
                  ? `Linked to ${group.property?.address ?? "property"}. Generate a fresh report and forward it to the listing agent.`
                  : `Linked to ${group.property?.address ?? "property"}. Posts must be at least 7 days old before a report can be generated.`
                : "Link this campaign to a property (via MLS#) to enable seller report generation."}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {hasProperty && group.property ? (
              <GenerateReportButton
                mls={group.property.mls}
                newestPostAgeDays={newestAgeDays}
              />
            ) : (
              <button
                type="button"
                disabled
                title="Link a property first."
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 text-neutral-400 px-3 py-1.5 text-xs font-medium cursor-not-allowed"
              >
                Generate seller report
              </button>
            )}
            <SendToAgentButton
              propertyAddress={group.property?.address ?? "this listing"}
              agentEmail={listingAgent?.email}
              agentName={listingAgent?.name}
              flyerUrl={
                group.property
                  ? `/properties/${encodeURIComponent(group.property.mls)}`
                  : ""
              }
              pdfUrl={
                group.property
                  ? `/properties/${encodeURIComponent(group.property.mls)}`
                  : ""
              }
              disabled={!hasProperty}
            />
          </div>
        </div>
        {hasProperty && listingAgent ? (
          <p className="mt-2 text-[11px] text-neutral-500">
            Listing agent on file:{" "}
            <span className="text-neutral-700 font-medium">
              {listingAgent.name ?? "(name unknown)"}
            </span>
            {listingAgent.email ? (
              <>
                {" "}
                · <span className="font-mono">{listingAgent.email}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {/* CLASSIFY PANEL ------------------------------------------------------ */}
      {liveInsightPostId ? (
        <div id="classify-panel" className="scroll-mt-20">
          <PropertyClassifyPanel
            postId={liveInsightPostId}
            groupId={group.id.startsWith("solo-") ? null : group.id}
            initialProperty={group.property}
            initialCategory={group.category}
            initialLinkMethod={group.link_method}
            initialAgentName={group.agent_name}
            offices={offices}
            initialAudienceScope={group.audience_scope ?? null}
          />
        </div>
      ) : null}

      {/* AUDIENCE BREAKDOWN -------------------------------------------------- */}
      {combinedAudience ? (
        <section
          className="rounded-xl border border-neutral-200 bg-white shadow-card p-4"
          aria-label="Audience breakdown"
        >
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">
            Who saw this campaign
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <AudienceBlock
              title="Top locations"
              slices={combinedAudience.top_locations}
            />
            <AudienceBlock title="Age" slices={combinedAudience.age_buckets} />
            <AudienceBlock
              title="Gender"
              slices={combinedAudience.gender_split}
            />
          </div>
        </section>
      ) : null}

      {/* BOOST PLACEHOLDERS -------------------------------------------------- */}
      <section
        className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 p-4"
        aria-label="Paid boosting (coming soon)"
      >
        <header className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Paid boosting
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Approval-gated. No auto-spend — every boost requires a human OK
              before dollars move.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-amber-50 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Coming soon
          </span>
        </header>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(["facebook", "instagram", "tiktok"] as Platform[]).map((p) => {
            const has = orderedPostings.find((x) => x.platform === p);
            return (
              <BoostPlatformPlaceholder
                key={p}
                platform={p}
                hasPosting={Boolean(has)}
                currentReach={has?.reach ?? 0}
              />
            );
          })}
        </div>
      </section>

      {/* ENHANCEMENTS ROADMAP ----------------------------------------------- */}
      <EnhancementsRoadmap
        hasProperty={hasProperty}
        platformCount={orderedPostings.length}
      />
    </div>
  );
}

/**
 * One card per platform posting. Shows the platform thumbnail, posting-level
 * permalink, posting-level reach/engagements/ER, and an "Open on [platform]"
 * CTA — so a merged IG+TT campaign no longer hides one platform's data.
 */
function PerPlatformCard({
  posting,
  post,
}: {
  posting: PlatformPosting;
  post: Post | undefined;
}) {
  const reachLabel = posting.platform === "tiktok" ? "Plays" : "Reach";
  const er =
    posting.reach > 0 ? posting.engagements / posting.reach : 0;

  return (
    <article className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
      <div className="grid grid-cols-[120px_minmax(0,1fr)] sm:grid-cols-[140px_minmax(0,1fr)]">
        <div className="relative aspect-square bg-neutral-100">
          {posting.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={posting.thumbnail_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : null}
          <span className="absolute top-1.5 left-1.5">
            <PlatformBadge platform={posting.platform} size="sm" />
          </span>
          {posting.is_video ? (
            <span className="absolute bottom-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/60 text-white">
              <svg
                viewBox="0 0 24 24"
                className="w-3 h-3"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          ) : null}
        </div>
        <div className="p-3 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <PlatformBadge platform={posting.platform} size="sm" showLabel />
            {post ? (
              <span className="text-[11px] text-neutral-500">
                {formatShortDate(post.posted_at)}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-x-3 gap-y-1">
            <SmallStat
              label={reachLabel}
              value={formatCompactNumber(posting.reach)}
            />
            <SmallStat
              label="Engagements"
              value={formatCompactNumber(posting.engagements)}
            />
            <SmallStat label="ER" value={formatPercent(er, 1)} />
          </div>

          {post ? (
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 pt-1 border-t border-neutral-100">
              <SmallStat label="Likes" value={formatNumber(post.metrics.likes)} />
              <SmallStat
                label="Comments"
                value={formatNumber(post.metrics.comments)}
              />
              <SmallStat
                label="Shares"
                value={formatNumber(post.metrics.shares)}
              />
              <SmallStat label="Saves" value={formatNumber(post.metrics.saves)} />
            </div>
          ) : null}

          {posting.permalink ? (
            <div className="mt-1">
              <a
                href={posting.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-700 hover:text-neutral-900"
              >
                Open on {platformLabel(posting.platform)}
                <ExternalIcon />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 leading-tight">
        {value}
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums text-neutral-900 leading-tight">
        {value}
      </div>
    </div>
  );
}

function AudienceBlock({
  title,
  slices,
}: {
  title: string;
  slices: { label: string; share: number }[];
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <ul className="mt-1.5 space-y-1">
        {slices.map((s) => (
          <li key={s.label} className="text-xs">
            <div className="flex justify-between text-neutral-700 mb-0.5">
              <span className="truncate pr-2">{s.label}</span>
              <span className="tabular-nums text-neutral-500">
                {formatPercent(s.share, 0)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full bg-gold-500"
                style={{ width: `${Math.min(100, s.share * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M4 20c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
