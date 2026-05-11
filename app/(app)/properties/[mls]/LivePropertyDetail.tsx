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
import { fetchExistingOwnerReportForProperty } from "@/lib/data/owner-reports-db";

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

  const existingReport = await fetchExistingOwnerReportForProperty(property.id);

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

      {/* Owner Report — generate + share link */}
      <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-4 md:p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Owner Report
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Branded marketing summary your seller can view in their browser
            or as a PDF.
          </p>
        </div>

        {existingReport ? (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-neutral-500 min-w-0">
              Shareable link:
              <code className="ml-2 px-1.5 py-0.5 text-xs bg-neutral-100 rounded break-all">
                /r/{existingReport.report_token}
              </code>
            </div>
            <ReportActionBar shareToken={existingReport.report_token} />
          </div>
        ) : null}

        {existingReport ? (
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span>
              Generated{" "}
              {existingReport.generated_at
                ? formatRelativeTime(existingReport.generated_at)
                : "just now"}
            </span>
            {existingReport.is_locked ? (
              <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                Locked snapshot — won&rsquo;t refresh on regenerate
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-3 pt-1">
          <GenerateReportButton
            mls={property.mls_number}
            newestPostAgeDays={newestPostAgeDays}
          />
          <SendToAgentButton
            propertyAddress={property.address ?? property.mls_number}
            flyerUrl={existingReport?.flyer_url_path ?? ""}
            pdfUrl={existingReport?.pdf_url_path ?? ""}
            disabled={!existingReport}
          />
        </div>
      </section>

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
                          className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-55"
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.thumbnail_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain"
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
