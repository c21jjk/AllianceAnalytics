import { cache } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Barlow } from "next/font/google";
import {
  fetchOwnerStoryByToken,
  logOwnerStoryView,
  type OwnerStoryData,
  type OwnerStoryPost,
  type Platform,
} from "@/lib/data/owner-story-db";
import {
  fetchOwnerStoryBrandLogos,
  fetchAllianceVitals,
  type OwnerStoryBrandLogos,
  type AllianceVitals,
} from "@/lib/data/brand-logos";
import {
  fetchPortalStrip,
  type PortalStrip,
} from "@/lib/data/portal-metrics-db";
import PortalMetricsStrip from "@/components/portal-metrics/PortalMetricsStrip";
import {
  formatCompactNumber,
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "@/lib/format";
import ShareLinkButton from "./ShareLinkButton";
import SharePostButton from "./SharePostButton";

/**
 * Owner Story (Phase 8 design — locked 2026-05-19).
 *
 * Public, seller-facing "Your Listing Marketing Report" page at /home/[token].
 * The token IS the access control; anyone with the link can view. Replaces the
 * earlier 1,748-line story-format chapter design — this is a marketing-grade
 * single-page report from the new C21 Alliance brand vision.
 *
 * Top-to-bottom sections (match the brand mockup exactly):
 *   1. Brand header band with gold "21" watermark
 *   2. Property hero card — image, address, beds/baths/type/price, agent
 *   3. Marketing Snapshot — 4 gold-circle stat tiles + "Campaign started"
 *   4. What This Means + Featured Post (2-col)
 *   5. Platform Performance — 3 cards (Facebook, TikTok, Instagram)
 *   6. The Alliance Advantage — gold-tinted full-width card
 *   7. Campaign Activity — most-recent post per platform
 *   8. What Happens Next + Share CTA
 *   9. Black agent footer
 *
 * All numbers are wired to real data from `OwnerStoryData`. Agent headshot
 * comes from brand_assets.kind='agent_headshot' (already resolved by name
 * match in lib/data/owner-story-db.ts). Phone / email render only when
 * populated; the agent_name is the only hard requirement.
 */

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-barlow",
});

export const dynamic = "force-dynamic";

const GOLD = "#C9A84C";
const GOLD_SOFT_BG = "#FBF7EE";
const GOLD_BORDER = "#E0C271";
const INK = "#252526";
const INK_SOFT = "#52525B";
const INK_MUTED = "#9A9A9C";
const RULE = "#ECECEC";
const PAGE_BG = "#FAFAF7";
const CARD_BG = "#FFFFFF";
const FOOTER_BG = "#1A1A1B";

const FONT_STACK = "'Barlow', system-ui, sans-serif";

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

interface PageProps {
  params: Promise<{ token: string }>;
}

// why: cache() dedupes the story lookup between generateMetadata and the page
// body within a single request — one DB round-trip per view instead of two.
const getStory = cache((token: string) => fetchOwnerStoryByToken(token));

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const data = await getStory(token);
  if (data?.listing.address) {
    return {
      title: `${data.listing.address} — Century 21 Alliance`,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: "Your Home — Century 21 Alliance",
    robots: { index: false, follow: false },
  };
}

export default async function OwnerStoryPage({ params }: PageProps) {
  const { token } = await params;
  const [data, brandLogos, vitals] = await Promise.all([
    getStory(token),
    fetchOwnerStoryBrandLogos(),
    fetchAllianceVitals(),
  ]);
  if (!data) notFound();

  // Fire-and-forget view log. Header lookup outside this block.
  try {
    const hdrs = await headers();
    void logOwnerStoryView(
      data.report_id,
      hdrs.get("user-agent"),
      hdrs.get("referer"),
    );
  } catch {
    // headers() can throw outside a request scope — never block render.
  }

  // Portal traffic strip — Zillow/Realtor/Trulia/Redfin/CIH. Window =
  // since listing_date so the seller-facing number is cumulative lifetime
  // exposure, not a rolling slice. Non-fatal on error so the rest of the
  // story still renders.
  let portalStrip: PortalStrip | null = null;
  if (
    data.listing.source_mls === "cmc" ||
    data.listing.source_mls === "sjsr"
  ) {
    try {
      portalStrip = await fetchPortalStrip(
        data.listing.mls_number,
        data.listing.source_mls,
        { since: data.listing.listing_date ?? undefined },
      );
    } catch (e) {
      console.warn("owner-story portal strip fetch failed:", (e as Error).message);
    }
  }

  return (
    <OwnerStoryView
      data={data}
      brandLogos={brandLogos}
      vitals={vitals}
      portalStrip={portalStrip}
    />
  );
}

/* ----------------------------------------------------------------------- *
 *  Derived helpers                                                         *
 * ----------------------------------------------------------------------- */

interface PlatformStat {
  platform: Platform;
  reach: number;
  engagements: number;
  posts: number;
  /** Posts whose platform doesn't report reach at all (static FB posts —
   *  Meta removed photo/carousel reach from the API, verified 2026-07-17).
   *  Drives "Not reported by FB" rendering instead of a misleading 0. */
  unreported: number;
}

function computePlatformStats(posts: OwnerStoryPost[]): PlatformStat[] {
  const platforms: Platform[] = ["facebook", "tiktok", "instagram"];
  const buckets: Record<Platform, PlatformStat> = {
    facebook: { platform: "facebook", reach: 0, engagements: 0, posts: 0, unreported: 0 },
    instagram: { platform: "instagram", reach: 0, engagements: 0, posts: 0, unreported: 0 },
    tiktok: { platform: "tiktok", reach: 0, engagements: 0, posts: 0, unreported: 0 },
  };
  for (const p of posts) {
    const cell = buckets[p.platform];
    if (!cell) continue;
    cell.reach += p.reach;
    cell.engagements += p.engagements;
    cell.posts += 1;
    if (!p.reach_reported) cell.unreported += 1;
  }
  return platforms.map((p) => buckets[p]);
}

/**
 * Bucket posts by `group_id` (campaign), then return them as
 * `CampaignSummary[]` sorted newest-first. Posts with no group_id are
 * treated as singleton campaigns so they still surface in the timeline.
 *
 * Each campaign exposes:
 *   - Representative thumbnail + caption (first non-empty, prefer the
 *     post with the highest reach so the seller sees the strongest visual)
 *   - Per-platform variants in stable FB → IG → TT order
 *   - Anchored date = earliest post in the group (when the campaign launched)
 *   - Merged reach = sum across the group's platforms
 */
export interface CampaignVariant {
  platform: Platform;
  permalink: string | null;
  reach: number;
  /** False when the platform doesn't report reach for this post (static FB
   *  posts). Rendered as "reach not reported by FB" instead of "0 reach". */
  reach_reported: boolean;
  engagements: number;
  posted_at: string | null;
}

export interface CampaignSummary {
  key: string;
  anchored_at: string | null;
  representative_caption: string;
  representative_thumbnail_url: string | null;
  merged_reach: number;
  /** False when NO variant in the campaign reports reach (e.g. an FB-only
   *  static post) — the merged number would be a fake 0, so render
   *  "Not reported by FB" instead. */
  reach_reported: boolean;
  variants: CampaignVariant[];
}

function groupByCampaign(posts: OwnerStoryPost[]): CampaignSummary[] {
  const buckets = new Map<string, OwnerStoryPost[]>();
  for (const p of posts) {
    const key = p.group_id ? `group:${p.group_id}` : `post:${p.id}`;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }

  const summaries: CampaignSummary[] = [];
  for (const [key, group] of buckets) {
    if (group.length === 0) continue;

    // Anchored date = earliest post (when this campaign launched).
    let earliest: number | null = null;
    let anchoredIso: string | null = null;
    for (const p of group) {
      if (!p.posted_at) continue;
      const t = Date.parse(p.posted_at);
      if (!Number.isFinite(t)) continue;
      if (earliest === null || t < earliest) {
        earliest = t;
        anchoredIso = p.posted_at;
      }
    }

    // Representative thumbnail + caption — prefer the highest-reach post in
    // the group (its content is the strongest visual / hook).
    const byReachDesc = [...group].sort((a, b) => b.reach - a.reach);
    const rep =
      byReachDesc.find((p) => p.thumbnail_url) ??
      byReachDesc.find((p) => p.caption.trim().length > 0) ??
      byReachDesc[0];

    // Per-platform variants — keep one per platform (the highest-reach one
    // when there are multiples on the same platform within the group).
    const byPlatform = new Map<Platform, OwnerStoryPost>();
    for (const p of group) {
      const existing = byPlatform.get(p.platform);
      if (!existing || p.reach > existing.reach) {
        byPlatform.set(p.platform, p);
      }
    }
    const order: Platform[] = ["facebook", "instagram", "tiktok"];
    const variants: CampaignVariant[] = [];
    for (const platform of order) {
      const post = byPlatform.get(platform);
      if (!post) continue;
      variants.push({
        platform,
        permalink: post.permalink,
        reach: post.reach,
        reach_reported: post.reach_reported,
        engagements: post.engagements,
        posted_at: post.posted_at,
      });
    }

    const merged_reach = variants.reduce((sum, v) => sum + v.reach, 0);

    summaries.push({
      key,
      anchored_at: anchoredIso,
      representative_caption: rep.caption,
      representative_thumbnail_url: rep.thumbnail_url,
      merged_reach,
      reach_reported: variants.some((v) => v.reach_reported),
      variants,
    });
  }

  // Newest-first.
  summaries.sort((a, b) => {
    const ta = a.anchored_at ? Date.parse(a.anchored_at) : 0;
    const tb = b.anchored_at ? Date.parse(b.anchored_at) : 0;
    return tb - ta;
  });
  return summaries;
}

function describeBaths(full: number | null, half: number | null): string {
  const f = full ?? 0;
  const h = half ?? 0;
  if (f === 0 && h === 0) return "—";
  if (h === 0) return `${f}`;
  return `${f}.${h}`;
}

function officeShortName(_raw: string | null): string {
  // The MLS listing_office_name carries an internal office code suffix
  // (e.g. "-o1o4j") rather than a human-readable office location, so we always
  // show the clean brokerage name on the seller-facing report.
  return "Century 21 Alliance";
}

function initialsOf(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase() || "—";
}

/* ----------------------------------------------------------------------- *
 *  Root view                                                               *
 * ----------------------------------------------------------------------- */

function OwnerStoryView({
  data,
  brandLogos,
  vitals,
  portalStrip,
}: {
  data: OwnerStoryData;
  brandLogos: OwnerStoryBrandLogos;
  vitals: AllianceVitals;
  /** 5-slot portal-traffic strip; null when not available for this listing. */
  portalStrip: PortalStrip | null;
}) {
  const { listing, posts, highlights, totals, company } = data;
  const featuredPost = highlights[0] ?? posts[0] ?? null;
  const platformStats = computePlatformStats(posts);
  const campaigns = groupByCampaign(posts);
  // The campaign with the highest merged reach gets the ★ Top Performer pill.
  let topCampaignKey: string | null = null;
  let topCampaignReach = -1;
  for (const c of campaigns) {
    if (c.merged_reach > topCampaignReach) {
      topCampaignReach = c.merged_reach;
      topCampaignKey = c.key;
    }
  }

  const campaignStartLabel = data.first_post_at
    ? formatShortDate(data.first_post_at)
    : null;
  const reportUpdatedLabel = formatShortDate(new Date().toISOString());

  return (
    <div
      className={barlow.variable}
      style={{
        fontFamily: FONT_STACK,
        backgroundColor: PAGE_BG,
        color: INK,
        minHeight: "100vh",
        fontWeight: 400,
      }}
    >
      <main
        className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8"
        style={{
          maxWidth: 960,
          margin: "0 auto",
        }}
      >
        <BrandHeader
          reportUpdatedLabel={reportUpdatedLabel}
          wordmarkUrl={brandLogos.wordmark_url}
          sealCroppedUrl={brandLogos.seal_cropped_url}
        />
        <PropertyHero listing={listing} />
        <MarketingSnapshot
          totals={totals}
          topPostReach={featuredPost?.reach ?? 0}
          campaignStartLabel={campaignStartLabel}
        />
        {portalStrip ? (
          <PortalReachSection
            strip={portalStrip}
            listingDateLabel={
              listing.listing_date
                ? formatShortDate(listing.listing_date)
                : null
            }
          />
        ) : null}
        <HelpSpreadTheWord
          campaigns={campaigns}
          topCampaignKey={topCampaignKey}
          listingAddress={listing.address}
        />
        <WhatThisMeans
          totals={totals}
          topPostReach={featuredPost?.reach ?? 0}
        />
        <PlatformPerformance stats={platformStats} />
        <AllianceAdvantage
          yearReach={company.window_365d.reach}
          activeAgents={vitals.active_agents}
          activeOffices={vitals.active_offices}
          sealUrl={brandLogos.seal_full_url}
        />
        <WhatHappensNext token={data.token} address={listing.address} />
      </main>
      <AgentFooter listing={data.listing} />
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Brand header                                                   *
 * ----------------------------------------------------------------------- */

function BrandHeader({
  reportUpdatedLabel,
  wordmarkUrl,
  sealCroppedUrl,
}: {
  reportUpdatedLabel: string;
  wordmarkUrl: string | null;
  sealCroppedUrl: string | null;
}) {
  return (
    <header style={{ padding: "0 0 32px" }}>
      {/* Cream brand band — visually unifies the wordmark + cropped seal
          and separates them from the headline below. Both logos sit inside
          this band; the seal renders at near-full opacity so the gold tone
          reads properly against the cream backdrop. */}
      <div
        className="px-4 py-4 sm:px-7 sm:py-5 gap-3 sm:gap-5"
        style={{
          position: "relative",
          backgroundColor: GOLD_SOFT_BG,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          overflow: "hidden",
          border: `1px solid ${GOLD_BORDER}`,
        }}
      >
        {wordmarkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={wordmarkUrl}
            alt="Century 21 Alliance"
            className="h-10 sm:h-16"
            style={{
              display: "block",
              width: "auto",
              flexShrink: 1,
              minWidth: 0,
              maxWidth: "70%",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 22,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: GOLD,
              zIndex: 1,
            }}
          >
            Century 21<sup style={{ fontSize: 11 }}>®</sup>{" "}
            <span style={{ fontWeight: 500, color: INK_SOFT }}>Alliance</span>
          </div>
        )}
        {sealCroppedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sealCroppedUrl}
            alt=""
            aria-hidden
            className="h-14 sm:h-24"
            style={{
              width: "auto",
              objectFit: "contain",
              opacity: 0.85,
              flexShrink: 0,
              userSelect: "none",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : null}
      </div>

      {/* Headline lives BELOW the brand band on the regular page bg. */}
      <h1
        style={{
          marginTop: 24,
          fontSize: "clamp(28px, 7vw, 54px)",
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          fontWeight: 700,
          color: INK,
        }}
      >
        Your Social Media Report
      </h1>
      <div style={{ marginTop: 10, fontSize: 15, color: INK_SOFT }}>
        Weekly social media update for your home
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: INK_MUTED,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 500,
        }}
      >
        <CalendarGlyph />
        Report updated {reportUpdatedLabel}
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Property hero                                                  *
 * ----------------------------------------------------------------------- */

function PropertyHero({ listing }: { listing: OwnerStoryData["listing"] }) {
  const baths = describeBaths(listing.bathrooms_full, listing.bathrooms_half);
  const placeLine = [listing.city, listing.state, listing.zip]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+,/g, ",")
    .trim();

  return (
    <Card style={{ marginBottom: 24, overflow: "hidden", padding: 0 }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        <div
          className="min-h-[220px] sm:min-h-[280px]"
          style={{
            backgroundColor: "#eeeeee",
            backgroundImage: listing.hero_image_url
              ? `url(${listing.hero_image_url})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          role={listing.hero_image_url ? "img" : undefined}
          aria-label={
            listing.hero_image_url
              ? `${listing.address ?? "Listing"} hero photo`
              : undefined
          }
        />
        <div className="p-5 sm:p-7">
          <div
            className="text-xl sm:text-[22px]"
            style={{
              fontWeight: 600,
              lineHeight: 1.15,
              color: INK,
            }}
          >
            {listing.address ?? "—"}
          </div>
          {placeLine ? (
            <div style={{ marginTop: 4, fontSize: 14, color: INK_SOFT }}>
              {placeLine}
            </div>
          ) : null}

          <div
            className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
            style={{
              borderTop: `1px solid ${RULE}`,
              borderBottom: `1px solid ${RULE}`,
              padding: "16px 0",
            }}
          >
            <PropertyStatCell
              icon={<BedGlyph />}
              label={`${listing.bedrooms ?? "—"} Beds`}
            />
            <PropertyStatCell icon={<BathGlyph />} label={`${baths} Baths`} />
            <PropertyStatCell
              icon={<HomeGlyph />}
              label={listing.property_type ?? "Home"}
            />
            <PropertyStatCell
              icon={<TagGlyph />}
              label={
                listing.list_price != null
                  ? `Listed at ${formatCurrency(listing.list_price)}`
                  : "—"
              }
            />
          </div>

          <div
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <AgentAvatar
              url={listing.agent_headshot_url}
              name={listing.agent_name}
              size={92}
            />
            <div>
              <div style={{ fontSize: 13, color: INK_SOFT }}>Your agent,</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: INK,
                  lineHeight: 1.15,
                  marginTop: 2,
                }}
              >
                {listing.agent_name ?? "Century 21 Alliance"}
              </div>
              <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 4 }}>
                {officeShortName(listing.listing_office_name)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PropertyStatCell({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: GOLD }}>{icon}</span>
      <span
        style={{
          fontSize: 13,
          color: INK,
          fontWeight: 500,
          lineHeight: 1.25,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function AgentAvatar({
  url,
  name,
  size = 56,
}: {
  url: string | null;
  name: string | null;
  size?: number;
}) {
  if (url) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `url(${url}) center/cover`,
          flexShrink: 0,
          border: `2px solid ${GOLD_BORDER}`,
          boxShadow: "0 2px 8px rgba(24,24,27,0.10)",
        }}
        role="img"
        aria-label={name ? `${name} headshot` : "Agent headshot"}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: GOLD_SOFT_BG,
        color: GOLD,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.32),
        flexShrink: 0,
        border: `2px solid ${GOLD_BORDER}`,
        boxShadow: "0 2px 8px rgba(24,24,27,0.10)",
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Marketing Snapshot                                             *
 * ----------------------------------------------------------------------- */

function MarketingSnapshot({
  totals,
  topPostReach,
  campaignStartLabel,
}: {
  totals: OwnerStoryData["totals"];
  topPostReach: number;
  campaignStartLabel: string | null;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeader
        title="Marketing Snapshot"
        rightSlot={
          campaignStartLabel ? (
            <span
              style={{
                fontSize: 12,
                color: INK_MUTED,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <CalendarGlyph /> Campaign started {campaignStartLabel}
            </span>
          ) : null
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          icon={<PeopleGlyph />}
          value={formatCompactNumber(totals.reach)}
          label="People Reached"
        />
        <StatTile
          icon={<PencilGlyph />}
          value={formatNumber(totals.post_count)}
          label="Posts Published"
        />
        <StatTile
          icon={<TrendGlyph />}
          value={formatCompactNumber(topPostReach)}
          label="Top Post Reach"
        />
      </div>
    </section>
  );
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            backgroundColor: GOLD,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        {/* minWidth:0 lets this flex child shrink below its content width so a
            long label wraps inside the card instead of overflowing on narrow
            mobile columns. */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: INK,
              lineHeight: 1,
            }}
          >
            {value}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: INK_SOFT,
              fontWeight: 500,
              overflowWrap: "break-word",
              wordBreak: "break-word",
            }}
          >
            {label}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Help Spread the Word                                           *
 *                                                                          *
 *  Combines Larissa's "ask the seller to share" message with the three     *
 *  per-platform post cards (FB / TT / IG). Each card has a clickable       *
 *  thumbnail that opens the actual social post in a new tab + a Share      *
 *  chip that fires the native share sheet (or copies to clipboard).        *
 *  Position: between Marketing Snapshot and What This Means, so the        *
 *  seller sees the topline numbers, then is prompted to amplify.           *
 * ----------------------------------------------------------------------- */

/* ----------------------------------------------------------------------- *
 *  Section: Where buyers are seeing your home (Portal traffic)             *
 *                                                                          *
 *  Sits between Marketing Snapshot and Help Spread the Word. Shows the     *
 *  5 portal lockups (Zillow / Realtor / Trulia / Redfin / CIH) with        *
 *  lifetime view counts since the listing went live. Hidden when no       *
 *  ListTrac data exists for this listing (the strip component renders its  *
 *  own empty state).                                                       *
 * ----------------------------------------------------------------------- */

function PortalReachSection({
  strip,
  listingDateLabel,
}: {
  strip: PortalStrip;
  listingDateLabel: string | null;
}) {
  const totalViews = strip.total_views;
  const headlineCopy = totalViews > 0
    ? `Your home has been viewed ${totalViews.toLocaleString()} times across real-estate sites${listingDateLabel ? ` since you listed on ${listingDateLabel}` : ""}.`
    : "Portal traffic is still catching up.";

  return (
    <section style={{ marginTop: 28 }}>
      <SectionHeader title="Where buyers are seeing your home" />
      <p
        style={{
          fontSize: 14,
          color: INK_SOFT,
          lineHeight: 1.55,
          margin: "0 0 14px",
        }}
      >
        {headlineCopy}
      </p>
      <PortalMetricsStrip strip={strip} variant="story" />
    </section>
  );
}

function HelpSpreadTheWord({
  campaigns,
  topCampaignKey,
  listingAddress,
}: {
  campaigns: CampaignSummary[];
  topCampaignKey: string | null;
  listingAddress: string | null;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <Card
        style={{
          padding: "28px",
          backgroundColor: GOLD_SOFT_BG,
          border: `1px solid ${GOLD_BORDER}`,
        }}
      >
        <h3 style={{ ...sectionTitleStyle, margin: 0 }}>
          Help Spread the Word
        </h3>
        <p
          className="text-base sm:text-lg"
          style={{
            margin: "14px 0 0 0",
            lineHeight: 1.55,
            color: INK,
            fontWeight: 500,
            maxWidth: 760,
          }}
        >
          To help maximize exposure even further, we encourage you to share
          your home&apos;s posts with friends, family, and on your own social
          media pages. Every share, comment, and interaction helps increase
          visibility and reach more potential buyers.
        </p>

        {campaigns.length === 0 ? (
          <div
            style={{
              marginTop: 20,
              padding: "20px",
              border: `1px dashed ${GOLD_BORDER}`,
              borderRadius: 10,
              backgroundColor: "#fff",
              textAlign: "center",
              fontSize: 13,
              color: INK_SOFT,
            }}
          >
            Your home&apos;s social campaign is launching soon — posts will
            appear here as they go live.
          </div>
        ) : (
          <CampaignTimeline
            campaigns={campaigns}
            topCampaignKey={topCampaignKey}
            listingAddress={listingAddress}
          />
        )}
      </Card>
    </section>
  );
}

/**
 * Vertical campaign timeline. Each campaign is a card with a gold dot anchor
 * on the left and a continuous gold rail behind the dots. On mobile (<640
 * px) the rail collapses — the date becomes a small chip above each card
 * and the card stretches edge-to-edge.
 */
function CampaignTimeline({
  campaigns,
  topCampaignKey,
  listingAddress,
}: {
  campaigns: CampaignSummary[];
  topCampaignKey: string | null;
  listingAddress: string | null;
}) {
  return (
    <div
      className="mt-6 relative"
      style={{ paddingLeft: 0 }}
    >
      {/* Vertical rail — desktop only. Hidden on mobile via Tailwind. */}
      <div
        aria-hidden
        className="hidden sm:block absolute"
        style={{
          left: 119,
          top: 10,
          bottom: 10,
          width: 1,
          backgroundColor: GOLD_BORDER,
        }}
      />
      <div className="flex flex-col gap-6">
        {campaigns.map((c) => (
          <CampaignTimelineRow
            key={c.key}
            campaign={c}
            isTopPerformer={c.key === topCampaignKey && c.merged_reach > 0}
            listingAddress={listingAddress}
          />
        ))}
      </div>
    </div>
  );
}

function CampaignTimelineRow({
  campaign,
  isTopPerformer,
  listingAddress,
}: {
  campaign: CampaignSummary;
  isTopPerformer: boolean;
  listingAddress: string | null;
}) {
  const dateLabel = campaign.anchored_at
    ? formatShortDate(campaign.anchored_at)
    : "Pending";
  const yearLabel = campaign.anchored_at
    ? new Date(campaign.anchored_at).getFullYear()
    : "";

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-0 relative">
      {/* Desktop date column + dot */}
      <div className="hidden sm:flex sm:items-center sm:flex-shrink-0" style={{ width: 140 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            width: 100,
            paddingRight: 8,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.1,
            }}
          >
            {dateLabel}
          </div>
          {yearLabel ? (
            <div
              style={{
                fontSize: 11,
                color: INK_MUTED,
                fontWeight: 500,
                marginTop: 2,
              }}
            >
              {yearLabel}
            </div>
          ) : null}
        </div>
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: GOLD,
            border: `2px solid ${GOLD_SOFT_BG}`,
            boxShadow: `0 0 0 1px ${GOLD_BORDER}`,
            display: "inline-block",
            position: "relative",
            zIndex: 1,
          }}
        />
      </div>

      {/* Mobile date chip — sits ABOVE the card */}
      <div className="sm:hidden">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            backgroundColor: GOLD,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          <CalendarGlyph /> {dateLabel}
          {yearLabel ? `, ${yearLabel}` : ""}
        </span>
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 sm:pl-5">
        <CampaignCard
          campaign={campaign}
          isTopPerformer={isTopPerformer}
          listingAddress={listingAddress}
        />
      </div>
    </div>
  );
}

function CampaignCard({
  campaign,
  isTopPerformer,
  listingAddress,
}: {
  campaign: CampaignSummary;
  isTopPerformer: boolean;
  listingAddress: string | null;
}) {
  const captionSnippet = truncate(campaign.representative_caption, 160);
  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: `1px solid ${RULE}`,
        borderRadius: 12,
        padding: 16,
        boxShadow:
          "0 1px 2px rgba(24,24,27,0.04), 0 1px 3px rgba(24,24,27,0.06)",
      }}
    >
      {isTopPerformer ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            backgroundColor: GOLD,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          ★ Top Performer
        </span>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] gap-3 sm:gap-4 items-start">
        <CampaignThumb
          url={campaign.representative_thumbnail_url}
          alt={captionSnippet || "Campaign thumbnail"}
        />
        <div className="min-w-0">
          <div style={{
            fontSize: 11,
            color: INK_MUTED,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Merged reach
          </div>
          {campaign.reach_reported ? (
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              color: INK,
              lineHeight: 1,
              marginTop: 2,
            }}>
              {formatNumber(campaign.merged_reach)}
            </div>
          ) : (
            // No variant reports reach (static FB post) — a "0" here would
            // read as a failed post when it's a Meta reporting limitation.
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: INK_MUTED,
              lineHeight: 1.2,
              marginTop: 4,
            }}>
              Not reported by FB
            </div>
          )}
          {captionSnippet ? (
            <p style={{
              margin: "10px 0 0 0",
              fontSize: 13,
              color: INK_SOFT,
              lineHeight: 1.5,
            }}>
              {captionSnippet}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {campaign.variants.map((v) => (
          <CampaignPlatformRow
            key={v.platform}
            variant={v}
            listingAddress={listingAddress}
          />
        ))}
      </div>
    </div>
  );
}

function CampaignThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div
        className="w-full sm:w-[120px] aspect-square rounded-lg"
        style={{ backgroundColor: "#eeeeee" }}
        aria-hidden
      />
    );
  }
  return (
    <div
      className="w-full sm:w-[120px] aspect-square rounded-lg"
      style={{ background: `url(${url}) center/cover`, backgroundColor: "#eeeeee" }}
      role="img"
      aria-label={alt}
    />
  );
}

function CampaignPlatformRow({
  variant,
  listingAddress,
}: {
  variant: CampaignVariant;
  listingAddress: string | null;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        backgroundColor: "#fafafa",
        border: `1px solid ${RULE}`,
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <PlatformGlyph platform={variant.platform} size={20} />
        <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {PLATFORM_LABEL[variant.platform]}
        </span>
        <span style={{ fontSize: 12, color: INK_MUTED, marginLeft: 8 }}>
          {variant.reach_reported
            ? `${formatNumber(variant.reach)} reach`
            : "reach not reported by FB"}
        </span>
        <span style={{ fontSize: 12, color: INK_MUTED }}>
          · {formatNumber(variant.engagements)} engagements
        </span>
      </div>
      {variant.permalink ? (
        <div className="flex gap-2 flex-shrink-0">
          <a
            href={variant.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${RULE}`,
              backgroundColor: "#fff",
              color: INK,
              fontWeight: 600,
              fontSize: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            View post →
          </a>
          <SharePostButton
            url={variant.permalink}
            platformLabel={PLATFORM_LABEL[variant.platform]}
            address={listingAddress}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${GOLD_BORDER}`,
              backgroundColor: GOLD,
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: FONT_STACK,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

/* ----------------------------------------------------------------------- *
 *  Section: What This Means (standalone, full-width)                       *
 * ----------------------------------------------------------------------- */

function WhatThisMeans({
  totals,
  topPostReach,
}: {
  totals: OwnerStoryData["totals"];
  topPostReach: number;
}) {
  const summary = buildSummaryParagraph(totals, topPostReach);
  return (
    <section style={{ marginBottom: 24 }}>
      <Card style={{ padding: 22 }}>
        <h3 style={sectionTitleStyle}>What This Means</h3>
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.6,
            color: INK_SOFT,
            maxWidth: 760,
          }}
        >
          {summary}
        </p>
      </Card>
    </section>
  );
}

function buildSummaryParagraph(
  totals: OwnerStoryData["totals"],
  topReach: number,
): string {
  if (totals.post_count === 0) {
    return "Your home is queued up for the Alliance social media campaign. Reach and engagement stats will appear here as soon as Facebook, Instagram, and TikTok posts go live.";
  }
  const reachLabel = formatNumber(totals.reach);
  const topLabel = formatNumber(topReach);
  return `Your home is gaining meaningful visibility across Facebook, Instagram, and TikTok. Since launch, the campaign has reached ${reachLabel} people. The strongest post reached ${topLabel} people, showing solid exposure beyond standard MLS visibility.`;
}

/* ----------------------------------------------------------------------- *
 *  Section: Platform Performance                                           *
 * ----------------------------------------------------------------------- */

function PlatformPerformance({ stats }: { stats: PlatformStat[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeader title="Platform Performance" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {stats.map((s) => (
          <Card key={s.platform} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PlatformGlyph platform={s.platform} />
              <span
                style={{ fontSize: 15, fontWeight: 600, color: INK }}
              >
                {PLATFORM_LABEL[s.platform]}
              </span>
            </div>
            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                {s.reach === 0 && s.unreported > 0 ? (
                  // Every reach-bearing signal on this platform is unreported
                  // (static FB posts — Meta removed photo/carousel reach).
                  // "0" would read as a dead platform; say what's true.
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: INK_MUTED,
                      lineHeight: 1.25,
                    }}
                  >
                    Not reported
                    <br />
                    by FB
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: INK,
                        lineHeight: 1,
                      }}
                    >
                      {formatNumber(s.reach)}
                    </div>
                    <div
                      style={{ fontSize: 11, color: INK_MUTED, marginTop: 4 }}
                    >
                      {s.unreported > 0 ? "reach · video posts" : "reach"}
                    </div>
                  </>
                )}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: INK,
                    lineHeight: 1,
                  }}
                >
                  {formatNumber(s.engagements)}
                </div>
                <div
                  style={{ fontSize: 11, color: INK_MUTED, marginTop: 4 }}
                >
                  engagements
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: The Alliance Advantage                                         *
 * ----------------------------------------------------------------------- */

function AllianceAdvantage({
  yearReach,
  activeAgents,
  activeOffices,
  sealUrl,
}: {
  yearReach: number;
  activeAgents: number;
  activeOffices: number;
  sealUrl: string | null;
}) {
  // Embed office count in the tagline when we have a real number; otherwise
  // fall back to the generic copy. Keeps the section honest if the office
  // count query ever returns 0.
  const taglinePrefix =
    activeOffices > 0
      ? `Your listing is part of a broader marketing system across ${activeOffices} South Jersey offices`
      : "Your listing is part of a broader marketing system";
  return (
    <section style={{ marginBottom: 24 }}>
      <Card
        className="p-5 sm:p-7"
        style={{
          backgroundColor: GOLD_SOFT_BG,
          border: `1px solid ${GOLD_BORDER}`,
        }}
      >
        <h3 style={{ ...sectionTitleStyle, margin: 0 }}>
          The Alliance Advantage
        </h3>
        <div
          className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1.1fr_1.6fr] gap-5 sm:gap-6 items-center"
        >
          {/* Reach (kept) */}
          <div>
            <div
              style={{
                fontSize: 38,
                fontWeight: 700,
                color: GOLD,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {formatCompactNumber(yearReach)}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: INK_SOFT,
                maxWidth: 220,
                lineHeight: 1.45,
              }}
            >
              People reached across active listings in the last year
            </div>
          </div>

          {/* Agents (replaces the prior "listings being marketed" stat) */}
          <div>
            <div
              style={{
                fontSize: 38,
                fontWeight: 700,
                color: GOLD,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {formatNumber(activeAgents)}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: INK_SOFT,
                maxWidth: 240,
                lineHeight: 1.45,
              }}
            >
              Professional real estate agents working to market and sell your
              property
            </div>
          </div>

          {/* Seal + tagline — stacks seal above tagline on mobile. */}
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-3 sm:gap-5">
            {sealUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sealUrl}
                alt="Century 21 Alliance Seal"
                className="w-24 h-24 sm:w-[110px] sm:h-[110px]"
                style={{
                  objectFit: "contain",
                  flexShrink: 0,
                }}
              />
            ) : (
              <C21ShieldGlyph />
            )}
            <p
              className="text-center sm:text-left"
              style={{
                margin: 0,
                fontSize: 13,
                color: INK_SOFT,
                lineHeight: 1.55,
              }}
            >
              {taglinePrefix} — built to create visibility, track performance,
              and keep sellers informed.
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: What Happens Next                                              *
 * ----------------------------------------------------------------------- */

function WhatHappensNext({
  address,
}: {
  token: string;
  address: string | null;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <Card
        className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-[1.4fr_auto] gap-4 sm:gap-5 items-start md:items-center"
      >
        <div>
          <h3 style={sectionTitleStyle}>What Happens Next</h3>
          <p
            style={{
              marginTop: 10,
              fontSize: 14,
              color: INK_SOFT,
              lineHeight: 1.55,
            }}
          >
            We&apos;ll continue monitoring performance, publishing new content,
            and updating this report each week so you always have a clear view
            of your listing&apos;s marketing activity.
          </p>
        </div>
        <ShareLinkButton
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 999,
            border: `1px solid ${GOLD_BORDER}`,
            backgroundColor: "#fff",
            color: INK,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: FONT_STACK,
          }}
          address={address}
        />
      </Card>
    </section>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Agent footer                                                   *
 * ----------------------------------------------------------------------- */

function AgentFooter({ listing }: { listing: OwnerStoryData["listing"] }) {
  const name = listing.agent_name ?? "Century 21 Alliance";
  const office = officeShortName(listing.listing_office_name);
  const phone = listing.agent_phone?.trim();
  const email = listing.agent_email?.trim();
  return (
    <footer
      className="px-4 sm:px-6 py-5"
      style={{
        marginTop: 40,
        backgroundColor: FOOTER_BG,
        color: "#FFFFFF",
      }}
    >
      <div
        className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5"
        style={{
          maxWidth: 960,
          margin: "0 auto",
          fontSize: 13,
        }}
      >
        <span
          style={{
            fontSize: 13,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: GOLD,
          }}
        >
          Century 21<sup style={{ fontSize: 7 }}>®</sup>{" "}
          <span style={{ color: "#cfcfcf", fontWeight: 500 }}>Alliance</span>
        </span>
        <span style={{ color: "#cfcfcf" }}>
          <strong style={{ color: "#fff", fontWeight: 600 }}>{name}</strong>
          <span style={{ margin: "0 8px", opacity: 0.5 }}>|</span>
          {office}
        </span>
        <span className="hidden md:block" style={{ flex: 1 }} />
        {phone ? (
          <FooterContact
            icon={<PhoneGlyph />}
            label={phone}
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          />
        ) : null}
        {email ? (
          <FooterContact
            icon={<EnvelopeGlyph />}
            label={email}
            href={`mailto:${email}`}
          />
        ) : null}
        <FooterContact
          icon={<GlobeGlyph />}
          label="c21alliance.com"
          href="https://www.c21alliance.com"
        />
      </div>
    </footer>
  );
}

function FooterContact({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "#fff",
        textDecoration: "none",
        fontWeight: 500,
      }}
    >
      <span style={{ color: GOLD, display: "inline-flex" }}>{icon}</span>
      {label}
    </a>
  );
}

/* ----------------------------------------------------------------------- *
 *  Primitives                                                              *
 * ----------------------------------------------------------------------- */

function Card({
  style,
  className,
  children,
}: {
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: CARD_BG,
        border: `1px solid ${RULE}`,
        borderRadius: 12,
        boxShadow:
          "0 1px 2px rgba(24,24,27,0.04), 0 1px 3px rgba(24,24,27,0.06)",
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  rightSlot,
}: {
  title: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <h2 style={sectionTitleStyle}>{title}</h2>
      {rightSlot}
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  color: INK,
  letterSpacing: "-0.01em",
};

/* ----------------------------------------------------------------------- *
 *  Inline SVG glyphs (kept inline so the report is self-contained)         *
 * ----------------------------------------------------------------------- */

function CalendarGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function BedGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4v16" />
      <path d="M2 8h18a2 2 0 0 1 2 2v10" />
      <circle cx="7" cy="13" r="2" />
      <path d="M10 13h12" />
    </svg>
  );
}
function BathGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
      <path d="M5 12v5a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-5" />
    </svg>
  );
}
function HomeGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function TagGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}
function PeopleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function PencilGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function TrendGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}
function PhoneGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function EnvelopeGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
function GlobeGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function PlatformGlyph({
  platform,
  size = 22,
}: {
  platform: Platform;
  size?: number;
}) {
  if (platform === "facebook") {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: "#1877F2",
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: size * 0.55,
          flexShrink: 0,
        }}
      >
        f
      </span>
    );
  }
  if (platform === "instagram") {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          background:
            "linear-gradient(135deg, #f9ce34 0%, #ee2a7b 50%, #6228d7 100%)",
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: size * 0.55,
          flexShrink: 0,
        }}
      >
        IG
      </span>
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        backgroundColor: "#000",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.45,
        letterSpacing: "-0.05em",
        flexShrink: 0,
      }}
    >
      TT
    </span>
  );
}

function C21ShieldGlyph() {
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 76 76"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path
        d="M38 4 L66 14 V36 C66 52 54 64 38 70 C22 64 10 52 10 36 V14 Z"
        fill="none"
        stroke={GOLD}
        strokeWidth="3"
      />
      <text
        x="38"
        y="46"
        textAnchor="middle"
        fontFamily="Barlow, sans-serif"
        fontWeight="700"
        fontSize="22"
        fill={GOLD}
        letterSpacing="-0.04em"
      >
        21
      </text>
    </svg>
  );
}
