import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReportPayload } from "@/lib/reports/build";
import { fetchCompanyRollup, type CompanyRollup } from "@/lib/data/company-rollup";
import {
  findDeliveryByToken,
  findReportById,
} from "@/lib/fixtures/reports";
import { findProperty, POSTS } from "@/lib/fixtures/posts";
import PropertyReportHero from "@/components/PropertyReportHero";
import PropertyKpiRollup from "@/components/PropertyKpiRollup";
import PostThumbnailGrid from "@/components/PostThumbnailGrid";
import AudienceReachRollup from "@/components/AudienceReachRollup";
import ReportNarrativeBlock from "@/components/ReportNarrativeBlock";
import PlatformBadge from "@/components/PlatformBadge";
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  formatShortDate,
} from "@/lib/format";
import type { Platform, PropertyRef } from "@/lib/types/post";
import type { PropertyReport } from "@/lib/types/report";
import type { ReportPayload } from "@/lib/reports/build";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface LiveData {
  token: string;
  property_id: string;
  report_id: string;
  recipient_name: string | null;
  property: {
    mls: string;
    address: string;
    list_price: number | null;
    hero_image_url: string | null;
    listing_date: string | null;
    agent_name: string | null;
    agent_email: string | null;
  };
  payload: ReportPayload;
  posts: LivePost[];
  rollup: CompanyRollup;
}

interface LivePost {
  id: string;
  platform: Platform;
  posted_at: string | null;
  caption: string;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  reach: number;
  engagements: number;
}

function readNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asPlatform(v: string): Platform {
  if (v === "facebook" || v === "instagram" || v === "tiktok") return v;
  return "instagram";
}

function platformLabel(p: Platform): string {
  if (p === "facebook") return "Facebook";
  if (p === "instagram") return "Instagram";
  return "TikTok";
}

interface ReportLookup {
  property_id: string;
  report_id: string;
  recipient_name: string | null;
}

/**
 * Mirror of flyer/page.tsx lookup pattern. Resolve the public token to a
 * report row (and the recipient name from the matching delivery row, if any).
 */
async function lookupReport(
  supabase: ReturnType<typeof createAdminClient>,
  token: string,
): Promise<ReportLookup | null> {
  // Try report_token first
  const { data: directReport } = await supabase
    .from("reports")
    .select("id, property_id")
    .eq("report_token", token)
    .maybeSingle();

  if (directReport) {
    // Pick most recent delivery for nameplate if it exists
    const { data: delivery } = await supabase
      .from("report_deliveries")
      .select("recipient_name")
      .eq("report_id", directReport.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      property_id: directReport.property_id,
      report_id: directReport.id,
      recipient_name: delivery?.recipient_name ?? null,
    };
  }

  // Fallback to delivery share_token
  const { data: delivery } = await supabase
    .from("report_deliveries")
    .select("report_id, recipient_name")
    .eq("share_token", token)
    .maybeSingle();

  if (!delivery) return null;

  const { data: indirectReport } = await supabase
    .from("reports")
    .select("id, property_id")
    .eq("id", delivery.report_id)
    .maybeSingle();

  if (!indirectReport) return null;

  return {
    property_id: indirectReport.property_id,
    report_id: indirectReport.id,
    recipient_name: delivery.recipient_name ?? null,
  };
}

async function loadLiveData(token: string): Promise<LiveData | null> {
  const supabase = createAdminClient();
  const lookup = await lookupReport(supabase, token);
  if (!lookup) return null;

  // Property — pull a richer shape than buildReportPayload exposes
  const { data: propRow } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, list_price, hero_image_url, listing_date, agent_name, agent_email",
    )
    .eq("id", lookup.property_id)
    .maybeSingle();

  if (!propRow) return null;

  const addressParts = [propRow.address, propRow.city, propRow.state].filter(
    Boolean,
  );

  // Aggregated payload (kpis, audience, campaigns)
  let payload: ReportPayload;
  try {
    payload = await buildReportPayload(lookup.property_id);
  } catch {
    return null;
  }

  // Chronological flat post feed for the activity log
  const { data: postRows } = await supabase
    .from("posts")
    .select(
      "id, platform, caption, thumbnail_url, media_url, permalink, posted_at, metrics",
    )
    .eq("property_id", lookup.property_id)
    .order("posted_at", { ascending: false });

  const posts: LivePost[] = (postRows ?? []).map((row) => {
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    const reach = readNum(m.reach) || readNum(m.impressions);
    const engagements =
      readNum(m.likes) +
      readNum(m.comments) +
      readNum(m.shares) +
      readNum(m.saves);
    return {
      id: row.id,
      platform: asPlatform(row.platform),
      posted_at: row.posted_at,
      caption: (row.caption ?? "").trim(),
      thumbnail_url: row.thumbnail_url,
      media_url: row.media_url,
      permalink: row.permalink,
      reach,
      engagements,
    };
  });

  const rollup = await fetchCompanyRollup();

  return {
    token,
    property_id: lookup.property_id,
    report_id: lookup.report_id,
    recipient_name: lookup.recipient_name,
    property: {
      mls: propRow.mls_number,
      address: addressParts.join(", "),
      list_price:
        propRow.list_price === null || propRow.list_price === undefined
          ? null
          : Number(propRow.list_price),
      hero_image_url: propRow.hero_image_url ?? null,
      listing_date: propRow.listing_date ?? null,
      agent_name: propRow.agent_name ?? null,
      agent_email: propRow.agent_email ?? null,
    },
    payload,
    posts,
    rollup,
  };
}

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const data = await loadLiveData(token);
  if (data) {
    return {
      title: `Property Marketing Report — ${data.property.address}`,
    };
  }
  return { title: "Property Report — Century 21 Alliance" };
}

export default async function PublicReportPage({ params }: PageProps) {
  const { token } = await params;

  // 1. Try live data (DB-backed)
  const live = await loadLiveData(token);
  if (live) {
    return <LiveReportView data={live} />;
  }

  // 2. Fallback to legacy demo fixture path
  const delivery = findDeliveryByToken(token);
  if (delivery) {
    const report = findReportById(delivery.report_id);
    const property = report ? findProperty(report.mls) : undefined;
    if (report && property) {
      const posts = report.post_ids
        .map((id) => POSTS.find((p) => p.id === id))
        .filter((p): p is (typeof POSTS)[0] => p !== undefined);
      return (
        <FixtureReportView
          recipientName={delivery.recipient_name}
          report={report}
          property={property}
          posts={posts}
        />
      );
    }
  }

  notFound();
}

/* ----------------------------------------------------------------------- *
 *  Live report — DB-backed, seller-facing
 * ----------------------------------------------------------------------- */

function LiveReportView({ data }: { data: LiveData }) {
  const { property, payload, posts, rollup } = data;
  const pdfHref = `/r/${encodeURIComponent(data.token)}/flyer.pdf`;
  const flyerHref = `/r/${encodeURIComponent(data.token)}/flyer`;

  return (
    <div className="min-h-screen bg-neutral-25">
      {/* Floating toolbar — hidden on print */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-neutral-200 print:hidden">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-500 truncate">
            Report for {property.address} · MLS {property.mls}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={flyerHref}
              className="text-xs text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-md hover:bg-neutral-100"
            >
              Flyer view
            </a>
            <a
              href={pdfHref}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-gold-500 hover:bg-gold-600 px-3 py-1.5 rounded-md"
            >
              <DownloadIcon />
              Download PDF
            </a>
          </div>
        </div>
      </div>

      {/* Brand header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/c21-seal.png"
              alt="Century 21 Alliance"
              className="w-10 h-12 object-contain shrink-0"
            />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-neutral-900">
                Century 21 Alliance
              </div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                Property Marketing Report
              </div>
            </div>
          </div>
          {data.recipient_name ? (
            <div className="hidden sm:block text-right">
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                Prepared for
              </div>
              <div className="text-sm font-medium text-neutral-900">
                {data.recipient_name}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-10">
        {/* Property hero */}
        <PropertyHero property={property} />

        {/* KPI rollup */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Your Listing&apos;s Numbers
            </h2>
            <p className="text-sm text-neutral-500">
              Aggregated across every post that ran for your home.
            </p>
          </div>
          <PropertyKpiRollup kpis={payload.kpis} />
        </section>

        {/* Chronological post feed */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Every post we put behind your home
            </h2>
            <p className="text-sm text-neutral-500">
              {posts.length === 0
                ? "Posts attached to your listing will show up here."
                : `${posts.length} ${posts.length === 1 ? "post" : "posts"} across Instagram, Facebook, and TikTok, newest first.`}
            </p>
          </div>
          <PostTimeline posts={posts} />
        </section>

        {/* Alliance marketing engine — the differentiator */}
        <MarketingEngineSection rollup={rollup} />

        {/* Closing / agent contact */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 md:p-8 shadow-card">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Questions about this report?
          </h2>
          <p className="mt-2 text-sm text-neutral-600 leading-relaxed max-w-2xl">
            Reply to the email this report came from, or reach out to your
            Alliance agent directly. We want every seller to see exactly how
            their home is being marketed — no black box.
          </p>
          {property.agent_name ? (
            <div className="mt-4 inline-flex items-center gap-3 rounded-lg border border-gold-200 bg-gold-50/40 px-4 py-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gold-500 text-white text-sm font-semibold">
                {property.agent_name.charAt(0).toUpperCase()}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-medium text-neutral-900">
                  {property.agent_name}
                </div>
                {property.agent_email ? (
                  <a
                    href={`mailto:${property.agent_email}`}
                    className="text-xs text-gold-700 hover:underline"
                  >
                    {property.agent_email}
                  </a>
                ) : (
                  <div className="text-xs text-neutral-500">
                    Your Alliance listing agent
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/alliance-wordmark.png"
            alt="Century 21 Alliance"
            className="mx-auto h-7 md:h-8 w-auto opacity-90"
          />
          <div className="mt-4 text-sm text-neutral-700">
            Prepared by Alliance Social
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Thank you for trusting us with your home.
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Property hero — page-level, full-bleed
 * ----------------------------------------------------------------------- */

function PropertyHero({ property }: { property: LiveData["property"] }) {
  return (
    <section className="rounded-xl overflow-hidden ring-1 ring-neutral-200 shadow-card bg-white">
      <div className="relative w-full aspect-[16/9] sm:aspect-[21/9] bg-neutral-100">
        {property.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={property.hero_image_url}
            alt={`Cover photo for ${property.address}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gold-400 to-gold-600"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/c21-seal.png"
              alt=""
              className="w-32 h-40 object-contain opacity-90"
            />
          </div>
        )}
        {/* Bottom overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-5 md:px-8 py-5 md:py-7">
          <div className="text-[11px] font-medium uppercase tracking-wider text-white/85">
            MLS {property.mls}
          </div>
          <h1 className="mt-1 text-2xl md:text-4xl font-semibold tracking-tight text-white">
            {property.address}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {property.list_price ? (
              <span className="inline-flex items-center rounded-md bg-white/95 px-3 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  List price
                </span>
                <span className="ml-2 text-sm font-semibold text-gold-700">
                  {formatCurrency(property.list_price)}
                </span>
              </span>
            ) : null}
            {property.listing_date ? (
              <span className="inline-flex items-center rounded-md bg-white/80 px-3 py-1.5 text-[11px] text-neutral-700">
                Listed {formatShortDate(property.listing_date)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- *
 *  Vertical timeline of every post
 * ----------------------------------------------------------------------- */

function PostTimeline({ posts }: { posts: LivePost[] }) {
  if (posts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
        <p className="text-sm text-neutral-500">
          No posts attached to this listing yet.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {posts.map((post) => {
        const thumb = post.thumbnail_url || post.media_url || null;
        return (
          <li
            key={post.id}
            className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-3 md:p-4 shadow-card"
          >
            <div className="relative shrink-0 w-24 h-24 md:w-28 md:h-28 rounded-lg overflow-hidden bg-neutral-100">
              {thumb ? (
                <>
                  {/* Blurred backdrop preserves portrait reels and flyers
                      in the seller-facing report — full headline + branding
                      visible instead of being top/bottom-cropped. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-55 text-transparent"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain text-transparent"
                  />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-200 to-neutral-100">
                  <PlatformBadge platform={post.platform} size="md" />
                </div>
              )}
              <div className="absolute top-1 left-1 z-10">
                <PlatformBadge platform={post.platform} size="sm" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-neutral-500 uppercase tracking-wider">
                <span>{platformLabel(post.platform)}</span>
                {post.posted_at ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <time dateTime={post.posted_at}>
                      {formatShortDate(post.posted_at)}
                    </time>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-neutral-900 line-clamp-2 leading-snug">
                {post.caption || (
                  <span className="text-neutral-400 italic">
                    No caption recorded.
                  </span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-neutral-600">
                <span>
                  <strong className="text-neutral-900 font-semibold tabular-nums">
                    {formatCompactNumber(post.reach)}
                  </strong>{" "}
                  reach
                </span>
                <span>
                  <strong className="text-neutral-900 font-semibold tabular-nums">
                    {formatCompactNumber(post.engagements)}
                  </strong>{" "}
                  engagements
                </span>
                {post.permalink ? (
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-gold-700 hover:text-gold-800 hover:underline"
                  >
                    View on {platformLabel(post.platform)}
                    <ExternalIcon />
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------------- *
 *  Alliance Marketing Engine — company-wide differentiator
 * ----------------------------------------------------------------------- */

function MarketingEngineSection({ rollup }: { rollup: CompanyRollup }) {
  const followersTotalLabel = formatCompactNumber(rollup.followers.total);
  const reach30dLabel = formatCompactNumber(rollup.reach_30d);
  const posts30dLabel = formatCompactNumber(rollup.posts_30d);
  const breakdownParts: string[] = [];
  if (rollup.followers.instagram)
    breakdownParts.push(
      `${formatCompactNumber(rollup.followers.instagram)} Instagram`,
    );
  if (rollup.followers.facebook)
    breakdownParts.push(
      `${formatCompactNumber(rollup.followers.facebook)} Facebook`,
    );
  if (rollup.followers.tiktok)
    breakdownParts.push(
      `${formatCompactNumber(rollup.followers.tiktok)} TikTok`,
    );

  return (
    <section className="rounded-xl border border-gold-200 bg-gradient-to-br from-gold-50/60 via-white to-white p-6 md:p-8 shadow-card relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-12 w-48 h-48 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-gold-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/c21-seal.png"
            alt=""
            className="w-5 h-6 object-contain shrink-0"
          />
          The Alliance Marketing Engine
        </div>

        <h2 className="mt-3 text-xl md:text-2xl font-semibold tracking-tight text-neutral-900">
          Your listing isn&apos;t being marketed in a silo.
        </h2>

        <p className="mt-3 max-w-3xl text-sm md:text-[15px] text-neutral-700 leading-relaxed">
          It&apos;s part of a marketing engine reaching{" "}
          <strong className="text-neutral-900">{followersTotalLabel}</strong>{" "}
          followers across Instagram, Facebook, and TikTok, with{" "}
          <strong className="text-neutral-900">{posts30dLabel}</strong> posts
          published in the last 30 days reaching{" "}
          <strong className="text-neutral-900">{reach30dLabel}</strong> people.
          Other firms don&apos;t open the books like this — Alliance does.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <EngineTile
            label="Followers across all platforms"
            value={followersTotalLabel}
            sublabel={
              breakdownParts.length > 0 ? breakdownParts.join(" · ") : undefined
            }
          />
          <EngineTile
            label="Posts in the last 30 days"
            value={posts30dLabel}
            sublabel={`Across ${rollup.active_listings} active Alliance listings`}
          />
          <EngineTile
            label="People reached in the last 30 days"
            value={reach30dLabel}
            sublabel="Unique people, not impressions"
          />
        </div>

        <div className="mt-4 text-[11px] text-neutral-500">
          As of {formatShortDate(rollup.captured_at)} · Numbers update
          automatically as our cron sync runs.
        </div>
      </div>
    </section>
  );
}

function EngineTile({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-lg border border-gold-200/70 bg-white/85 backdrop-blur p-4 flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gold-700">
        {label}
      </span>
      <span className="mt-2 text-2xl md:text-3xl font-semibold tabular-nums text-neutral-900">
        {value}
      </span>
      {sublabel ? (
        <span className="mt-1 text-[11px] text-neutral-500 leading-snug">
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Fixture fallback — preserves legacy demo URLs (rpt_*)
 * ----------------------------------------------------------------------- */

function FixtureReportView({
  recipientName,
  report,
  property,
  posts,
}: {
  recipientName: string;
  report: PropertyReport;
  property: PropertyRef;
  posts: (typeof POSTS)[0][];
}) {
  return (
    <div className="min-h-screen bg-neutral-25">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/c21-seal.png"
              alt="Century 21 Alliance"
              className="w-10 h-12 object-contain shrink-0"
            />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-neutral-900">
                Century 21 Alliance
              </div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                Property Performance Report
              </div>
            </div>
          </div>
          <div className="hidden sm:block text-xs text-neutral-500">
            Prepared for {recipientName}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">
        <PropertyReportHero report={report} property={property} />
        <PropertyKpiRollup kpis={report.kpis} />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Every post we put behind your home
          </h2>
          <PostThumbnailGrid posts={posts} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Who saw your listing
          </h2>
          <AudienceReachRollup audience={report.audience} />
        </section>

        <ReportNarrativeBlock
          reachSummary={report.narrative.reach_summary}
          closing={report.narrative.closing}
        />
      </main>

      <footer className="border-t border-neutral-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/alliance-wordmark.png"
            alt="Century 21 Alliance"
            className="mx-auto h-7 md:h-8 w-auto opacity-90"
          />
          <div className="mt-4 text-sm text-neutral-700">
            Thank you for trusting us with your home.
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Questions? Reply directly to the email this report came from, or
            reach out to your Alliance agent.
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Icons
 * ----------------------------------------------------------------------- */

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
      <path
        d="M12 4v12m0 0l-4-4m4 4l4-4M4 18v2h16v-2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6m0-6L10 14M9 4H4v16h16v-5"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
