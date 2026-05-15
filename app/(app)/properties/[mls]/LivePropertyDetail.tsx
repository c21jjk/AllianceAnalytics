import Link from "next/link";
import type { PropertyDetail } from "@/lib/data/properties-db";
import {
  formatCurrency,
  formatCompactNumber,
  formatRelativeTime,
} from "@/lib/format";
import GenerateReportButton from "@/components/GenerateReportButton";
import SendToAgentButton from "@/components/SendToAgentButton";
import ReportActionBar from "@/components/ReportActionBar";
import OwnerReportRecipientsPanel from "@/components/OwnerReportRecipientsPanel";
import OwnerStoryAdminCard from "@/components/OwnerStoryAdminCard";
import NullAgentEmailWarning from "@/components/NullAgentEmailWarning";
import CreatedPostsStrip from "@/components/CreatedPostsStrip";
import { fetchExistingOwnerReportForProperty } from "@/lib/data/owner-reports-db";
import {
  fetchOwnerStoryViewStats,
  getOrCreateStoryTokenForProperty,
} from "@/lib/data/owner-story-db";
import {
  getOpenHousesForProperty,
  type UpcomingOpenHouse,
} from "@/lib/data/open-houses";
import { fetchCreatedPostsByMls } from "@/lib/data/created-posts-db";

interface LivePropertyDetailProps {
  property: PropertyDetail;
}

/**
 * Simplified property detail view rendered when the MLS exists in the live
 * `properties` table (RETS-synced) but no fixture-style report has been
 * generated yet. Shows hero photo, key facts, agent + office, and a grid of
 * the linked posts. The fuller report-style view (PropertyReportHero,
 * PropertyKpiRollup, AudienceReachRollup) remains available via the
 * legacy fixture path on the parent page for demo/seed listings.
 *
 * The Owner Report panel surfaces the existing share link when one exists
 * and otherwise lets the admin generate it via `generateReportAction`.
 */
export default async function LivePropertyDetail({
  property,
}: LivePropertyDetailProps) {
  const cityState = [property.city, property.state]
    .filter(Boolean)
    .join(", ");
  const bathTotal =
    (property.bathrooms_full ?? 0) + 0.5 * (property.bathrooms_half ?? 0);

  // Compute newest post age in days from the linked posts. The action enforces
  // the same gate server-side; this just keeps the button copy accurate.
  const NOW = Date.now();
  const newestPostMs = property.posts.reduce<number>((max, p) => {
    if (!p.posted_at) return max;
    const ts = new Date(p.posted_at).getTime();
    return Number.isFinite(ts) && ts > max ? ts : max;
  }, 0);
  const newestPostAgeDays =
    newestPostMs > 0
      ? Math.floor((NOW - newestPostMs) / 86_400_000)
      : null;

  // Ensure this property has an owner-story token before we read the report
  // row. After the one-time backfill every existing property already has
  // one; this guards new properties created outside the RETS sync path.
  // Idempotent — at most one extra round-trip when the row is missing.
  let existingReport = await fetchExistingOwnerReportForProperty(property.id);
  if (!existingReport) {
    await getOrCreateStoryTokenForProperty(property.id);
    existingReport = await fetchExistingOwnerReportForProperty(property.id);
  }
  const storyViewStats = existingReport
    ? await fetchOwnerStoryViewStats(existingReport.report_id)
    : null;
  const openHouses = await getOpenHousesForProperty(property.id);
  // why: per-listing Created Posts strip — pulls every generated_posts row
  // saved for this MLS, drafts + posted alike, so Larissa can resume editing
  // anything she started without leaving the property detail page.
  const createdPosts = await fetchCreatedPostsByMls(property.mls_number);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-800">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/properties" className="hover:text-neutral-800">
          Listings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 truncate max-w-md">
          {property.address ?? property.mls_number}
        </span>
      </div>

      {/* Hero — compact side-by-side. Photo capped at ~40% width on desktop
          so the listing info (address, agent, facts) gets the visual weight
          it deserves. Stacks on mobile. */}
      <section className="rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-card">
        <div className="grid md:grid-cols-[minmax(0,_5fr)_minmax(0,_7fr)]">
          <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[280px] bg-neutral-100">
            {property.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={property.hero_image_url}
                alt={property.address ?? "Listing"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-neutral-400 text-sm">
                No hero photo on file
              </div>
            )}
          </div>
          <div className="p-5 md:p-7 flex flex-col justify-center min-w-0">
            <h1 className="text-3xl md:text-4xl font-semibold text-neutral-900 leading-tight tracking-tight">
              {property.address ?? "Unknown address"}
            </h1>
            {cityState ? (
              <p className="text-base text-neutral-600 mt-1">
                {cityState}
                {property.zip ? ` ${property.zip}` : ""}
              </p>
            ) : null}

            <div className="mt-4 flex items-center gap-2 flex-wrap text-sm text-neutral-700">
              {property.list_price !== null ? (
                <span className="inline-flex items-center rounded-md bg-gold-50 ring-1 ring-gold-200 px-3 py-1 font-semibold text-gold-800 tabular-nums">
                  {formatCurrency(property.list_price)}
                </span>
              ) : null}
              {property.bedrooms !== null ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2.5 py-1">
                  {property.bedrooms} bed
                </span>
              ) : null}
              {bathTotal > 0 ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2.5 py-1">
                  {bathTotal} bath
                </span>
              ) : null}
              {property.property_type ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2.5 py-1">
                  {property.property_type}
                </span>
              ) : null}
              {property.dom_days !== null ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2.5 py-1">
                  DOM {property.dom_days}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2.5 py-1 font-mono text-xs">
                #{property.mls_number}
              </span>
            </div>

            {property.agent_name ? (
              <div className="mt-4 pt-4 border-t border-neutral-100">
                <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  Listed by
                </div>
                <div className="mt-1 text-base font-semibold text-neutral-900">
                  {property.agent_name}
                </div>
                {property.listing_office_name ? (
                  <div className="text-sm text-neutral-600">
                    {property.listing_office_name}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Owner Story page — PRIMARY owner-facing surface (Phase 4 promotion).
          Sits directly under the hero so Larissa never has to scroll past
          internal stats to find the link she shares with sellers. */}
      {existingReport ? (
        <OwnerStoryAdminCard
          reportId={existingReport.report_id}
          mls={property.mls_number}
          storyUrlPath={existingReport.story_url_path}
          initialPersonalNote={existingReport.personal_note}
          viewStats={storyViewStats}
          agentName={property.agent_name}
          agentEmail={property.agent_email}
          propertyAddress={property.address}
        />
      ) : null}

      {/* Null-agent-email warning — Phase 5. Renders only when the listing
          is missing the email needed to ping the agent on publish. Inline
          so Larissa can fix it without leaving the page. */}
      {property.agent_email === null ? (
        <NullAgentEmailWarning
          mls={property.mls_number}
          agentName={property.agent_name}
        />
      ) : null}

      {/* Open Houses for this listing — render only when scheduled. */}
      {openHouses.length > 0 ? (
        <PropertyOpenHousesSection openHouses={openHouses} />
      ) : null}

      {/* Created Posts for this listing (drafts + already-posted Studio saves).
          Renders only when there's at least one — the empty state lives
          inline in the strip itself so we don't double up the prompt. */}
      {createdPosts.length > 0 ? (
        <CreatedPostsStrip initialPosts={createdPosts} hideWhenEmpty />
      ) : null}

      {/* Quick stats — only meaningful when there are posts */}
      {property.post_count > 0 ? (
        <section className="grid grid-cols-3 gap-3">
          <StatTile label="Posts" value={String(property.post_count)} />
          <StatTile
            label="Total reach"
            value={formatCompactNumber(property.total_reach)}
          />
          <StatTile
            label="Engagements"
            value={formatCompactNumber(property.total_engagements)}
          />
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-6 text-center text-sm text-neutral-500">
          No social posts linked to this listing yet. Once a post including{" "}
          <span className="font-mono text-neutral-700">
            #{property.mls_number}
          </span>{" "}
          syncs, it&rsquo;ll appear here automatically.
        </section>
      )}

      {/* Recipients + cadence — only after a report exists */}
      {existingReport ? (
        <OwnerReportRecipientsPanel
          reportId={existingReport.report_id}
          mls={property.mls_number}
          initialCadence={existingReport.cadence}
          initialNextSendAt={existingReport.next_send_at}
          initialRecipients={existingReport.recipients}
        />
      ) : null}

      {/* Legacy Compass-style Owner Report — DEMOTED (Phase 4). Was the
          dominant card pre-Phase 4; now a small footnote-style block. The
          /r/[token] route still works for anyone holding an old link and
          remains the PDF source until Phase 5 adds a print mode to the
          story page. Hidden entirely for properties that have never had a
          formal report generated, since the empty-state CTA only adds
          noise now that the story is the canonical surface. */}
      {existingReport && existingReport.generated_at ? (
        <LegacyCompassReportFootnote
          existingReport={existingReport}
          property={property}
          newestPostAgeDays={newestPostAgeDays}
        />
      ) : null}

      {/* Linked posts grid */}
      {property.posts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Posts for this listing
            </h2>
            <p className="text-sm text-neutral-500">
              {property.posts.length}{" "}
              {property.posts.length === 1 ? "post" : "posts"} linked across{" "}
              {countPlatforms(property)}{" "}
              {countPlatforms(property) === 1 ? "platform" : "platforms"}.
              Click any post to open detail.
            </p>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {property.posts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="block rounded-lg border border-neutral-200 bg-white shadow-card hover:border-gold-200 hover:shadow-card-hover transition overflow-hidden"
                >
                  {/* Per-platform colored header strip — high-contrast so
                      the platform is identifiable at a glance, even when the
                      thumbnail is busy. Compact size so all three platforms
                      fit on one row at lg+. */}
                  <PostPlatformHeader platform={post.platform} />

                  <div className="aspect-square bg-neutral-100 relative">
                    {post.thumbnail_url ? (
                      <>
                        {/* Blurred backdrop preserves portrait reels and
                            flyers without cropping their headlines. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.thumbnail_url}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-55 text-transparent"
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.thumbnail_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain text-transparent"
                        />
                      </>
                    ) : null}
                  </div>

                  <div className="p-2.5 space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                      {post.posted_at
                        ? new Date(post.posted_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )
                        : "Date unknown"}
                    </p>
                    <p className="text-xs text-neutral-800 line-clamp-2 leading-snug">
                      {post.caption ?? (
                        <span className="text-neutral-400 italic">
                          No caption
                        </span>
                      )}
                    </p>
                    <div className="pt-0.5 flex items-center justify-between text-[11px] text-neutral-600 tabular-nums">
                      <span>
                        <span className="font-semibold text-neutral-900">
                          {formatCompactNumber(post.reach)}
                        </span>{" "}
                        reach
                      </span>
                      <span>
                        <span className="font-semibold text-neutral-900">
                          {formatCompactNumber(post.total_engagements)}
                        </span>{" "}
                        eng
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Public remarks (MLS description) */}
      {property.public_remarks ? (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-2">
            MLS description
          </h2>
          <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
            {property.public_remarks}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Full-width colored header strip that crowns each post card with its
 * platform brand color + label. Matches the platform brand colors used by
 * PlatformBadge so users build muscle memory: blue = Facebook, gradient =
 * Instagram, black = TikTok. Keeps platform identification glance-able.
 */
function PostPlatformHeader({
  platform,
}: {
  platform: "facebook" | "instagram" | "tiktok";
}) {
  if (platform === "facebook") {
    return (
      <div className="bg-[#1877F2] text-white px-2.5 py-1.5 flex items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5 shrink-0"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M13.5 21v-7.4h2.5l.4-2.9h-2.9V8.9c0-.84.23-1.4 1.43-1.4H16.5V4.94c-.27-.04-1.18-.11-2.24-.11-2.22 0-3.74 1.36-3.74 3.85v2.12H8v2.9h2.52V21h2.98z" />
        </svg>
        <span className="text-xs font-semibold tracking-tight">Facebook</span>
      </div>
    );
  }
  if (platform === "instagram") {
    return (
      <div className="bg-gradient-to-r from-[#FEDA77] via-[#F58529] to-[#DD2A7B] text-white px-2.5 py-1.5 flex items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="5"
            stroke="currentColor"
            strokeWidth={1.8}
          />
          <circle
            cx="12"
            cy="12"
            r="3.6"
            stroke="currentColor"
            strokeWidth={1.8}
          />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
        </svg>
        <span className="text-xs font-semibold tracking-tight">Instagram</span>
      </div>
    );
  }
  return (
    <div className="bg-neutral-900 text-white px-2.5 py-1.5 flex items-center gap-1.5">
      <svg
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 shrink-0"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M16.5 3a5.5 5.5 0 005 4.5v3.05a8.7 8.7 0 01-5-1.6v6.6a6 6 0 11-6-6c.34 0 .67.03 1 .09v3.18a2.85 2.85 0 102 2.73V3h3z" />
      </svg>
      <span className="text-xs font-semibold tracking-tight">TikTok</span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-xl font-semibold text-neutral-900 tabular-nums leading-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

function countPlatforms(property: PropertyDetail): number {
  const set = new Set(property.posts.map((p) => p.platform));
  return set.size;
}

/**
 * Small section showing the upcoming open houses scheduled for this
 * listing. Compact one-row-per-OH layout. Rendered only when there's at
 * least one OH on file.
 */
function PropertyOpenHousesSection({
  openHouses,
}: {
  openHouses: UpcomingOpenHouse[];
}) {
  return (
    <section className="rounded-2xl border border-sky-200/70 bg-sky-50/30 p-4 md:p-5 shadow-card">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
          Scheduled Open Houses
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-900">
          {openHouses.length} upcoming
          <span className="text-neutral-400 font-normal">
            {" "}· next 90 days
          </span>
        </h2>
      </header>
      <ul className="mt-3 divide-y divide-sky-200/60">
        {openHouses.map((oh) => {
          const start = new Date(oh.start_at);
          const end = oh.end_at ? new Date(oh.end_at) : null;
          const validStart = !Number.isNaN(start.getTime());
          // Always render in Alliance's Eastern TZ — without explicit
          // timeZone, Next.js SSR (UTC) and client (local) produce different
          // strings, and the SSR'd UTC version sticks for the user.
          const ALLIANCE_TZ = "America/New_York";
          const weekday = validStart
            ? start.toLocaleDateString("en-US", {
                weekday: "long",
                timeZone: ALLIANCE_TZ,
              })
            : "—";
          const dateLine = validStart
            ? start.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                timeZone: ALLIANCE_TZ,
              })
            : "—";
          const startTime = validStart
            ? start
                .toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                  timeZone: ALLIANCE_TZ,
                })
                .replace(/:00 /, " ")
            : "—";
          const endTime =
            end && !Number.isNaN(end.getTime())
              ? end
                  .toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                    timeZone: ALLIANCE_TZ,
                  })
                  .replace(/:00 /, " ")
              : null;
          return (
            <li key={oh.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <div className="font-semibold text-neutral-900 text-sm">
                  {weekday}, {dateLine}
                </div>
                <div className="text-sm font-medium text-sky-700 tabular-nums">
                  {startTime}
                  {endTime ? ` – ${endTime}` : ""}
                </div>
              </div>
              {oh.comments ? (
                <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
                  {oh.comments}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Owner Report card — two states                                     */
/*                                                                    */
/* Empty: hero CTA that dominates the page. One action, oversized.    */
/* Generated: compact summary header + action bar + quiet regenerate. */
/* ------------------------------------------------------------------ */

/**
 * Demoted (Phase 4) Compass-style report block — replaces the dominant
 * gold hero card. Surfaces enough to let Larissa still generate the
 * Compass snapshot when a seller specifically asks for a PDF, but stays
 * out of the way otherwise. Renders only when a formal report has been
 * generated (existingReport.generated_at is non-null).
 *
 * Long-term (Phase 5+): adds a print mode to the Owner Story page and
 * deletes this block entirely.
 */
function LegacyCompassReportFootnote({
  existingReport,
  property,
  newestPostAgeDays,
}: {
  existingReport: NonNullable<
    Awaited<ReturnType<typeof fetchExistingOwnerReportForProperty>>
  >;
  property: PropertyDetail;
  newestPostAgeDays: number | null;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Legacy report (PDF source)
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-neutral-900">
            Compass-style snapshot
          </h3>
          <p className="mt-1 text-xs text-neutral-600 leading-relaxed max-w-prose">
            The older one-page seller report — kept available for download as
            a PDF. Snapshot generated{" "}
            <span className="font-medium text-neutral-800">
              {existingReport.generated_at
                ? formatRelativeTime(existingReport.generated_at)
                : "recently"}
            </span>
            . Most sellers should be sent the Owner Story page above instead.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={existingReport.share_url_path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md ring-1 ring-neutral-300 bg-white text-neutral-800 text-xs font-medium px-3 py-1.5 hover:ring-neutral-400 transition-colors"
          >
            View
          </a>
          <a
            href={existingReport.pdf_url_path}
            className="inline-flex items-center rounded-md ring-1 ring-neutral-300 bg-white text-neutral-800 text-xs font-medium px-3 py-1.5 hover:ring-neutral-400 transition-colors"
          >
            Download PDF
          </a>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center justify-end">
        <GenerateReportButton
          mls={property.mls_number}
          newestPostAgeDays={newestPostAgeDays}
          label="Regenerate snapshot"
        />
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OwnerReportCardEmpty({
  property,
  newestPostAgeDays,
}: {
  property: PropertyDetail;
  newestPostAgeDays: number | null;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gold-50 via-white to-gold-50/60 ring-1 ring-gold-200 shadow-card p-8 md:p-12">
      <div
        aria-hidden="true"
        className="absolute top-0 left-8 right-8 h-0.5 rounded-full bg-gradient-to-r from-gold-300/0 via-gold-500/80 to-gold-300/0"
      />
      <div className="max-w-2xl">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700">
          Seller Report — not yet generated
        </div>
        <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-neutral-900 leading-tight">
          Generate this listing&rsquo;s Seller Report
        </h2>
        <p className="mt-3 text-base text-neutral-600 leading-relaxed">
          Bundle the social media activity for{" "}
          <span className="font-medium text-neutral-800">
            {property.address ?? `MLS #${property.mls_number}`}
          </span>{" "}
          into a branded marketing summary your seller can view in a browser
          or download as a PDF. Includes total reach, per-platform breakdown,
          and every post run for this listing.
        </p>
        <div className="mt-7">
          <GenerateReportButton
            mls={property.mls_number}
            newestPostAgeDays={newestPostAgeDays}
            size="hero"
          />
        </div>
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OwnerReportCardGenerated({
  property,
  existingReport,
  newestPostAgeDays,
}: {
  property: PropertyDetail;
  existingReport: NonNullable<
    Awaited<ReturnType<typeof fetchExistingOwnerReportForProperty>>
  >;
  newestPostAgeDays: number | null;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gold-50 via-white to-gold-50/60 ring-1 ring-gold-200 shadow-card p-6 md:p-7">
      <div
        aria-hidden="true"
        className="absolute top-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-gold-300/0 via-gold-500/70 to-gold-300/0"
      />
      {/* Header — generated timestamp + status */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-700">
            Seller Report — live
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight text-neutral-900">
            Owner Report
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
            <span>
              Generated{" "}
              <span className="text-neutral-800 font-medium">
                {existingReport.generated_at
                  ? formatRelativeTime(existingReport.generated_at)
                  : "just now"}
              </span>
            </span>
            {existingReport.is_locked ? (
              <span className="inline-flex items-center rounded-md bg-white/80 ring-1 ring-gold-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                Locked snapshot
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Share link row */}
      <div className="mt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg bg-white/70 ring-1 ring-gold-200/70 px-4 py-3">
        <div className="text-sm text-neutral-700 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-700">
            Shareable link
          </span>
          <code className="block md:inline-block md:ml-2 mt-1 md:mt-0 px-2 py-1 text-xs bg-gold-100/60 text-neutral-800 rounded break-all">
            /r/{existingReport.report_token}
          </code>
        </div>
        <ReportActionBar shareToken={existingReport.report_token} />
      </div>

      {/* Footer row — quiet Regenerate + Send to agent */}
      <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-end gap-3 pt-3 border-t border-gold-200/60">
        <GenerateReportButton
          mls={property.mls_number}
          newestPostAgeDays={newestPostAgeDays}
          label="Regenerate"
        />
        <SendToAgentButton
          propertyAddress={property.address ?? property.mls_number}
          storyUrl={existingReport.story_url_path}
          variant="quiet"
          disabled={false}
        />
      </div>
    </section>
  );
}
