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
  type OwnerStoryBrandLogos,
} from "@/lib/data/brand-logos";
import {
  formatCompactNumber,
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "@/lib/format";
import ShareLinkButton from "./ShareLinkButton";

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
  const [data, brandLogos] = await Promise.all([
    fetchOwnerStoryByToken(token),
    fetchOwnerStoryBrandLogos(),
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

  return <OwnerStoryView data={data} brandLogos={brandLogos} />;
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
}: {
  data: OwnerStoryData;
  brandLogos: OwnerStoryBrandLogos;
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
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "32px 24px 0",
        }}
      >
        <BrandHeader
          reportUpdatedLabel={reportUpdatedLabel}
          wordmarkUrl={brandLogos.wordmark_url}
        />
        <PropertyHero listing={listing} />
        <MarketingSnapshot
          totals={totals}
          topPostReach={featuredPost?.reach ?? 0}
          campaignStartLabel={campaignStartLabel}
        />
        <WhatThisMeansAndFeatured
          totals={totals}
          topPostReach={featuredPost?.reach ?? 0}
          featured={featuredPost}
        />
        <PlatformPerformance stats={platformStats} />
        <AllianceAdvantage
          yearReach={company.window_365d.reach}
          activeListings={company.active_listings}
          sealUrl={brandLogos.seal_url}
        />
        <CampaignActivity recent={recentByPlatform} />
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
}: {
  reportUpdatedLabel: string;
  wordmarkUrl: string | null;
}) {
  return (
    <header style={{ position: "relative", padding: "16px 0 32px" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -20,
          top: -10,
          fontSize: 220,
          lineHeight: 1,
          fontWeight: 700,
          color: GOLD,
          opacity: 0.08,
          pointerEvents: "none",
          letterSpacing: "-0.04em",
          userSelect: "none",
        }}
      >
        21
      </div>
      {wordmarkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={wordmarkUrl}
          alt="Century 21 Alliance"
          style={{ display: "block", height: 22, width: "auto" }}
        />
      ) : (
        <div
          style={{
            fontSize: 13,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: GOLD,
          }}
        >
          Century 21<sup style={{ fontSize: 8 }}>®</sup>{" "}
          <span style={{ fontWeight: 500, color: INK_SOFT }}>Alliance</span>
        </div>
      )}
      <h1
        style={{
          marginTop: 14,
          fontSize: "clamp(36px, 6vw, 54px)",
          lineHeight: 1.04,
          letterSpacing: "-0.025em",
          fontWeight: 700,
          color: INK,
        }}
      >
        Your Listing
        <br />
        Marketing Report
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
          gap: 0,
        }}
      >
        <div
          style={{
            backgroundColor: "#eeeeee",
            minHeight: 280,
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
        <div style={{ padding: "28px 28px 24px" }}>
          <div
            style={{
              fontSize: 22,
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
            style={{
              marginTop: 20,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 16,
        }}
      >
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
 *  Section: What This Means + Featured Post                                *
 * ----------------------------------------------------------------------- */

function WhatThisMeansAndFeatured({
  totals,
  topPostReach,
  featured,
}: {
  totals: OwnerStoryData["totals"];
  topPostReach: number;
  featured: OwnerStoryPost | null;
}) {
  const summary = buildSummaryParagraph(totals, topPostReach);
  return (
    <section
      style={{
        marginBottom: 24,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 16,
      }}
    >
      <Card style={{ padding: 22 }}>
        <h3 style={sectionTitleStyle}>What This Means</h3>
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.6,
            color: INK_SOFT,
          }}
        >
          {summary}
        </p>
      </Card>

      <Card style={{ padding: 22 }}>
        <h3 style={sectionTitleStyle}>Featured Post</h3>
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "120px minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <FeaturedThumb post={featured} />
          <div>
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
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              ★ Top Performer
            </span>
            {featured ? (
              <>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    color: INK,
                  }}
                >
                  {PLATFORM_LABEL[featured.platform]}
                  {featured.posted_at ? (
                    <span
                      style={{
                        marginLeft: 10,
                        color: INK_MUTED,
                        fontSize: 12,
                        fontWeight: 500,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <CalendarGlyph /> {formatShortDate(featured.posted_at)}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    gap: 28,
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
                      {formatCompactNumber(featured.reach)}
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
                      {formatNumber(featured.engagements)}
                    </div>
                    <div
                      style={{ fontSize: 11, color: INK_MUTED, marginTop: 4 }}
                    >
                      engagements
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 12, fontSize: 13, color: INK_MUTED }}>
                Your campaign&apos;s top-performing post will appear here once
                content lands across Facebook, Instagram, and TikTok.
              </div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

function FeaturedThumb({ post }: { post: OwnerStoryPost | null }) {
  if (!post || !post.thumbnail_url) {
    return (
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 8,
          backgroundColor: "#eeeeee",
        }}
        aria-hidden
      />
    );
  }
  return (
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: 8,
        background: `url(${post.thumbnail_url}) center/cover`,
      }}
      role="img"
      aria-label={`${PLATFORM_LABEL[post.platform]} top post thumbnail`}
    />
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
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
  activeListings,
  sealUrl,
}: {
  yearReach: number;
  activeListings: number;
  sealUrl: string | null;
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
          The Alliance Advantage
        </h3>
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) auto minmax(0, 1.6fr)",
            gap: 24,
            alignItems: "center",
          }}
        >
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
                maxWidth: 200,
              }}
            >
              People reached across active listings in the last year
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: GOLD,
                lineHeight: 1,
              }}
            >
              {formatNumber(activeListings)}
            </div>
            <div
              style={{
                fontSize: 12,
                color: INK_SOFT,
                textAlign: "center",
                maxWidth: 140,
                lineHeight: 1.3,
              }}
            >
              Listings currently being marketed
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {sealUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sealUrl}
                alt="Century 21 Alliance Seal"
                style={{
                  width: 92,
                  height: 92,
                  objectFit: "contain",
                  flexShrink: 0,
                }}
              />
            ) : (
              <C21ShieldGlyph />
            )}
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: INK_SOFT,
                lineHeight: 1.55,
              }}
            >
              Your listing is part of a broader marketing system built to
              create visibility, track performance, and keep sellers informed.
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}

/* ----------------------------------------------------------------------- *
 *  Section: Campaign Activity                                              *
 * ----------------------------------------------------------------------- */

function CampaignActivity({
  recent,
}: {
  recent: Record<Platform, OwnerStoryPost | null>;
}) {
  const order: Platform[] = ["facebook", "tiktok", "instagram"];
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeader title="Campaign Activity" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        {order.map((p) => (
          <CampaignActivityCard key={p} platform={p} post={recent[p]} />
        ))}
      </div>
    </section>
  );
}

function CampaignActivityCard({
  platform,
  post,
}: {
  platform: Platform;
  post: OwnerStoryPost | null;
}) {
  return (
    <Card style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlatformGlyph platform={platform} size={20} />
          <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>
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

      {post ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "64px minmax(0, 1fr)",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 8,
              backgroundColor: "#eeeeee",
              background: post.thumbnail_url
                ? `url(${post.thumbnail_url}) center/cover`
                : undefined,
            }}
            aria-hidden
          />
          <div style={{ fontSize: 13, color: INK_SOFT, lineHeight: 1.6 }}>
            <div>
              <strong style={{ color: INK }}>
                {formatNumber(post.reach)}
              </strong>{" "}
              reached
            </div>
            <div>
              <strong style={{ color: INK }}>
                {formatNumber(post.engagements)}
              </strong>{" "}
              engagements
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: INK_MUTED }}>
          No {PLATFORM_LABEL[platform]} activity yet.
        </div>
      )}
    </Card>
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
        style={{
          padding: 22,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) auto",
          gap: 20,
          alignItems: "center",
        }}
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
      style={{
        marginTop: 40,
        backgroundColor: FOOTER_BG,
        color: "#FFFFFF",
        padding: "18px 24px",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 18,
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
        <span style={{ flex: 1 }} />
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
  children,
}: {
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
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
