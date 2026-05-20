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

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const data = await fetchOwnerStoryByToken(token);
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
    fetchOwnerStoryByToken(token),
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

  return (
    <OwnerStoryView data={data} brandLogos={brandLogos} vitals={vitals} />
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
}

function computePlatformStats(posts: OwnerStoryPost[]): PlatformStat[] {
  const platforms: Platform[] = ["facebook", "tiktok", "instagram"];
  const buckets: Record<Platform, PlatformStat> = {
    facebook: { platform: "facebook", reach: 0, engagements: 0, posts: 0 },
    instagram: { platform: "instagram", reach: 0, engagements: 0, posts: 0 },
    tiktok: { platform: "tiktok", reach: 0, engagements: 0, posts: 0 },
  };
  for (const p of posts) {
    const cell = buckets[p.platform];
    if (!cell) continue;
    cell.reach += p.reach;
    cell.engagements += p.engagements;
    cell.posts += 1;
  }
  return platforms.map((p) => buckets[p]);
}

/**
 * Most-recent post per platform. Used for the Campaign Activity row so each
 * platform card shows its latest activity. Falls back to null when a
 * platform has no posts yet.
 */
function mostRecentByPlatform(
  posts: OwnerStoryPost[],
): Record<Platform, OwnerStoryPost | null> {
  const out: Record<Platform, OwnerStoryPost | null> = {
    facebook: null,
    instagram: null,
    tiktok: null,
  };
  const sorted = [...posts].sort((a, b) => {
    const ta = a.posted_at ? Date.parse(a.posted_at) : 0;
    const tb = b.posted_at ? Date.parse(b.posted_at) : 0;
    return tb - ta;
  });
  for (const p of sorted) {
    if (!out[p.platform]) out[p.platform] = p;
  }
  return out;
}

function describeBaths(full: number | null, half: number | null): string {
  const f = full ?? 0;
  const h = half ?? 0;
  if (f === 0 && h === 0) return "—";
  if (h === 0) return `${f}`;
  return `${f}.${h}`;
}

function officeShortName(raw: string | null): string {
  if (!raw) return "Century 21 Alliance";
  const upper = raw.toUpperCase();
  const idx = upper.indexOf("ALLIANCE");
  if (idx < 0) return raw;
  const tail = raw.slice(idx + "alliance".length).trim();
  if (!tail) return "Century 21 Alliance";
  return `Century 21 Alliance — ${titleCase(tail)}`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
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
}: {
  data: OwnerStoryData;
  brandLogos: OwnerStoryBrandLogos;
  vitals: AllianceVitals;
}) {
  const { listing, posts, highlights, totals, company } = data;
  const featuredPost = highlights[0] ?? posts[0] ?? null;
  const platformStats = computePlatformStats(posts);
  const recentByPlatform = mostRecentByPlatform(posts);

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
        <HelpSpreadTheWord
          recent={recentByPlatform}
          topPostId={featuredPost?.id ?? null}
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
          icon={<HeartGlyph />}
          value={formatNumber(totals.engagements)}
          label="Engagements"
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
        <div>
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

function HelpSpreadTheWord({
  recent,
  topPostId,
  listingAddress,
}: {
  recent: Record<Platform, OwnerStoryPost | null>;
  topPostId: string | null;
  listingAddress: string | null;
}) {
  const order: Platform[] = ["facebook", "tiktok", "instagram"];
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
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {order.map((p) => (
            <ShareablePostCard
              key={p}
              platform={p}
              post={recent[p]}
              isTopPerformer={
                recent[p] !== null && recent[p]?.id === topPostId
              }
              listingAddress={listingAddress}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

function ShareablePostCard({
  platform,
  post,
  isTopPerformer,
  listingAddress,
}: {
  platform: Platform;
  post: OwnerStoryPost | null;
  isTopPerformer: boolean;
  listingAddress: string | null;
}) {
  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: `1px solid ${RULE}`,
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow:
          "0 1px 2px rgba(24,24,27,0.04), 0 1px 3px rgba(24,24,27,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlatformGlyph platform={platform} size={20} />
          <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
            {PLATFORM_LABEL[platform]}
          </span>
        </div>
        {post?.posted_at ? (
          <span
            style={{
              fontSize: 11,
              color: INK_MUTED,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CalendarGlyph /> {formatShortDate(post.posted_at)}
          </span>
        ) : null}
      </div>

      {isTopPerformer && post ? (
        <span
          style={{
            alignSelf: "flex-start",
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
          }}
        >
          ★ Top Performer
        </span>
      ) : null}

      <ThumbnailLink post={post} platform={platform} />

      {post ? (
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: INK_SOFT }}>
          <div>
            <strong style={{ color: INK }}>{formatNumber(post.reach)}</strong>{" "}
            reached
          </div>
          <div>
            <strong style={{ color: INK }}>
              {formatNumber(post.engagements)}
            </strong>{" "}
            engagements
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: INK_MUTED }}>
          No {PLATFORM_LABEL[platform]} post yet.
        </div>
      )}

      {post?.permalink ? (
        <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${RULE}`,
              backgroundColor: "#fff",
              color: INK,
              fontWeight: 600,
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            View post →
          </a>
          <SharePostButton
            url={post.permalink}
            platformLabel={PLATFORM_LABEL[platform]}
            address={listingAddress}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${GOLD_BORDER}`,
              backgroundColor: GOLD,
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: FONT_STACK,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ThumbnailLink({
  post,
  platform,
}: {
  post: OwnerStoryPost | null;
  platform: Platform;
}) {
  const placeholder = (
    <div
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 8,
        backgroundColor: "#eeeeee",
      }}
      aria-hidden
    />
  );

  if (!post) return placeholder;

  const tile = (
    <div
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 8,
        background: post.thumbnail_url
          ? `url(${post.thumbnail_url}) center/cover`
          : "#eeeeee",
        cursor: post.permalink ? "pointer" : "default",
      }}
      role={post.thumbnail_url ? "img" : undefined}
      aria-label={
        post.thumbnail_url
          ? `${PLATFORM_LABEL[platform]} post thumbnail — click to view`
          : undefined
      }
    />
  );

  if (post.permalink) {
    return (
      <a
        href={post.permalink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${PLATFORM_LABEL[platform]} post in a new tab`}
        style={{ display: "block" }}
      >
        {tile}
      </a>
    );
  }
  return tile;
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
  const engLabel = formatNumber(totals.engagements);
  const topLabel = formatNumber(topReach);
  return `Your home is gaining meaningful visibility across Facebook, Instagram, and TikTok. Since launch, the campaign has reached ${reachLabel} people and generated ${engLabel} engagements. The strongest post reached ${topLabel} people, showing solid exposure beyond standard MLS visibility.`;
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
                  reach
                </div>
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
function HeartGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21s-7-4.35-9.5-9.27C1 8 3.5 4 7.5 4c2 0 3.5 1 4.5 2.5C13 5 14.5 4 16.5 4c4 0 6.5 4 5 7.73C19 16.65 12 21 12 21z" />
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
