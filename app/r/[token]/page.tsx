import { notFound } from "next/navigation";
import { Barlow } from "next/font/google";
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
import PrintLink from "@/components/reports/PrintLink";
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
} from "@/lib/format";
import type { Platform, PropertyRef } from "@/lib/types/post";
import type { PropertyReport } from "@/lib/types/report";
import type { ReportPayload } from "@/lib/reports/build";

// Direction B uses Barlow exclusively at 400/500. Scope to the public report
// pages so we don't disturb the rest of the app (Inter remains the default).
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-barlow",
});

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
 *  Direction B — "Compass / Minimal Modern" (LOCKED design)
 *
 *  Strict rules baked in:
 *   - Barlow only, weights 400/500
 *   - Gold (#C9A84C) used in exactly 4 places per page:
 *       1) "Download PDF" link in the top action bar
 *       2) 1px gold rule between Performance and Marketing
 *       3) the word "does" in the Alliance closing line
 *       4) tiny C21 seal mark in the footer at 60% opacity
 *   - No card boxes around posts; editorial post feed with hairlines
 *   - Single break band (#fafafa) for the Alliance section
 * ----------------------------------------------------------------------- */

const GOLD = "#C9A84C";
const FONT_STACK = "'Barlow', system-ui, sans-serif";
const EYEBROW_STYLE: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  fontWeight: 500,
  color: "#737373",
};
const LINK_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 500,
};

function LiveReportView({ data }: { data: LiveData }) {
  const { property, payload, posts, rollup, recipient_name } = data;
  const pdfHref = `/r/${encodeURIComponent(data.token)}/flyer.pdf`;

  const totalReach = payload.kpis.total_reach;
  const totalEngagements = payload.kpis.total_engagements;
  const postCount = payload.kpis.post_count || posts.length;
  const audienceTotal = rollup.followers.total;
  const agentFirstName = property.agent_name?.split(" ")[0] ?? "your agent";
  const officeName = officeFromEmail(property.agent_email);

  return (
    <div
      className={barlow.variable}
      style={{
        fontFamily: FONT_STACK,
        backgroundColor: "#ffffff",
        color: "#171717",
        minHeight: "100vh",
        fontWeight: 400,
      }}
    >
      {/* 1. Top action bar */}
      <div
        className="print:hidden"
        style={{
          padding: "22px 36px",
          borderBottom: "1px solid #f4f4f4",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <span style={EYEBROW_STYLE}>Marketing Report</span>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <PrintLink />
          <a
            href={pdfHref}
            style={{
              ...LINK_LABEL_STYLE,
              color: GOLD,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <DownloadGlyph />
            Download PDF
          </a>
        </div>
      </div>

      <main>
        {/* 2. Property identity */}
        <section style={{ padding: "80px 36px 24px" }}>
          {recipient_name ? (
            <div style={EYEBROW_STYLE}>Prepared for {recipient_name}</div>
          ) : (
            <div style={EYEBROW_STYLE}>Prepared for the owner</div>
          )}

          <h1
            style={{
              marginTop: 18,
              fontSize: "clamp(30px, 6vw, 44px)",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              fontWeight: 500,
              color: "#171717",
            }}
          >
            {firstLineOfAddress(property.address)}
          </h1>
          {secondLineOfAddress(property.address) ? (
            <div
              style={{
                marginTop: 8,
                fontSize: "clamp(20px, 4vw, 28px)",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                fontWeight: 400,
                color: "#737373",
              }}
            >
              {secondLineOfAddress(property.address)}
            </div>
          ) : null}

          {/* Stat row */}
          <div
            style={{
              marginTop: 36,
              display: "flex",
              flexWrap: "wrap",
              gap: "28px 56px",
            }}
          >
            <PropertyStat
              label="List Price"
              value={
                property.list_price
                  ? formatCurrency(property.list_price)
                  : "—"
              }
            />
            <PropertyStat label="MLS" value={property.mls} />
            <PropertyStat
              label="Listed"
              value={
                property.listing_date
                  ? formatShortDate(property.listing_date)
                  : "—"
              }
            />
          </div>
        </section>

        {/* 3. Property photo — full bleed */}
        <section style={{ padding: "0 0 48px" }}>
          <div
            style={{
              width: "100%",
              backgroundColor: "#f4f4f4",
              overflow: "hidden",
            }}
            className="h-[240px] md:h-[360px]"
          >
            {property.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={property.hero_image_url}
                alt={`Cover photo for ${property.address}`}
                className="text-transparent"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ) : (
              <div
                aria-hidden="true"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#a3a3a3",
                  fontSize: 13,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                No cover photo on file
              </div>
            )}
          </div>
        </section>

        {/* 4. Performance */}
        <section style={{ padding: "64px 36px" }}>
          <div style={EYEBROW_STYLE}>Performance</div>

          <div
            style={{
              marginTop: 28,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "0 28px",
            }}
          >
            <div
              style={{
                fontSize: "clamp(64px, 14vw, 96px)",
                lineHeight: 0.95,
                letterSpacing: "-0.04em",
                fontWeight: 500,
                color: "#171717",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCompactNumber(totalReach)}
            </div>
            <div
              style={{
                fontSize: 22,
                lineHeight: 1.2,
                color: "#737373",
                fontWeight: 400,
                letterSpacing: "-0.01em",
              }}
            >
              people reached
            </div>
          </div>

          <p
            style={{
              marginTop: 32,
              maxWidth: 520,
              fontSize: 18,
              lineHeight: 1.6,
              color: "#404040",
              fontWeight: 400,
            }}
          >
            We published{" "}
            <span style={{ color: "#171717", fontWeight: 500 }}>
              {formatCompactNumber(postCount)}{" "}
              {postCount === 1 ? "post" : "posts"}
            </span>{" "}
            behind your home, generating{" "}
            <span style={{ color: "#171717", fontWeight: 500 }}>
              {formatCompactNumber(totalEngagements)} engagements
            </span>{" "}
            across an audience of{" "}
            <span style={{ color: "#171717", fontWeight: 500 }}>
              {formatCompactNumber(audienceTotal)}
            </span>{" "}
            on Instagram, Facebook, and TikTok.
          </p>
        </section>

        {/* 5. Single gold horizontal rule */}
        <div
          style={{
            height: 1,
            backgroundColor: GOLD,
            margin: "0 36px",
          }}
        />

        {/* 6. Marketing (post feed) */}
        <section style={{ padding: "64px 36px" }}>
          <div style={EYEBROW_STYLE}>Marketing</div>
          <h2
            style={{
              marginTop: 18,
              fontSize: "clamp(26px, 4.5vw, 32px)",
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              fontWeight: 500,
              color: "#171717",
            }}
          >
            Every post we put behind your home.
          </h2>

          <div style={{ marginTop: 40 }}>
            <PostFeed posts={posts} />
          </div>
        </section>

        {/* 7. Alliance section */}
        <section
          style={{
            padding: "88px 36px 80px",
            backgroundColor: "#fafafa",
          }}
        >
          <div style={EYEBROW_STYLE}>Alliance</div>
          <h2
            style={{
              marginTop: 18,
              fontSize: "clamp(28px, 5vw, 36px)",
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              fontWeight: 500,
              color: "#171717",
              maxWidth: 720,
            }}
          >
            Your home isn&apos;t being marketed in a silo.
          </h2>
          <p
            style={{
              marginTop: 20,
              maxWidth: 640,
              fontSize: 18,
              lineHeight: 1.6,
              color: "#404040",
              fontWeight: 400,
            }}
          >
            It&apos;s part of an audience built over years — and the work has
            shown up every month.
          </p>

          {/* 2×2 stat grid */}
          <div
            style={{
              marginTop: 56,
              maxWidth: 520,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 64,
            }}
          >
            <AllianceStat
              value={formatCompactNumber(rollup.window_30d.posts)}
              label="Posts in the last 30 days"
            />
            <AllianceStat
              value={formatCompactNumber(rollup.window_30d.reach)}
              label="People reached in the last 30 days"
            />
            <AllianceStat
              value={formatCompactNumber(rollup.window_365d.posts)}
              label="Posts in the last 365 days"
            />
            <AllianceStat
              value={formatCompactNumber(rollup.window_365d.reach)}
              label="People reached in the last 365 days"
            />
          </div>

          <p
            style={{
              marginTop: 64,
              fontSize: 18,
              lineHeight: 1.55,
              color: "#171717",
              fontWeight: 400,
              maxWidth: 640,
            }}
          >
            Other firms don&apos;t open the books like this.
            <br />
            Alliance <span style={{ color: GOLD, fontWeight: 500 }}>does</span>.
          </p>
        </section>

        {/* 8. Agent CTA */}
        <section style={{ padding: "80px 36px 24px" }}>
          <div style={EYEBROW_STYLE}>Your Agent</div>
          <h3
            style={{
              marginTop: 18,
              fontSize: 28,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              fontWeight: 500,
              color: "#171717",
            }}
          >
            {property.agent_name ?? "Your Alliance agent"}
          </h3>
          <div
            style={{
              marginTop: 8,
              fontSize: 15,
              lineHeight: 1.5,
              color: "#737373",
              fontWeight: 400,
            }}
          >
            Century 21 Alliance{officeName ? ` · ${officeName}` : ""}
          </div>

          {property.agent_email ? (
            <a
              href={`mailto:${property.agent_email}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                marginTop: 28,
                padding: "14px 28px",
                backgroundColor: "#171717",
                color: "#ffffff",
                textDecoration: "none",
                fontSize: 13,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Reach {agentFirstName}
              <ArrowRightGlyph />
            </a>
          ) : null}
        </section>

        {/* 9. Footer */}
        <footer
          style={{
            padding: "80px 36px 36px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              opacity: 0.6,
            }}
          >
            <C21SealMark />
            <span
              style={{
                fontSize: 13,
                color: "#171717",
                letterSpacing: "0.01em",
                fontWeight: 400,
              }}
            >
              Century 21 Alliance
            </span>
          </div>
          <div
            style={{
              marginTop: 32,
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 500,
              color: "#a3a3a3",
            }}
          >
            Prepared by Alliance Social
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Direction B — atomic sub-components
 * ----------------------------------------------------------------------- */

function PropertyStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={EYEBROW_STYLE}>{label}</span>
      <span
        style={{
          fontSize: 22,
          lineHeight: 1.1,
          fontWeight: 500,
          color: "#171717",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function AllianceStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "clamp(40px, 8vw, 56px)",
          lineHeight: 0.98,
          letterSpacing: "-0.03em",
          fontWeight: 500,
          color: "#171717",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#737373",
          fontWeight: 400,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function PostFeed({ posts }: { posts: LivePost[] }) {
  if (posts.length === 0) {
    return (
      <div
        style={{
          padding: "48px 0",
          textAlign: "center",
          color: "#a3a3a3",
          fontSize: 15,
          borderTop: "1px solid #ececec",
          borderBottom: "1px solid #ececec",
        }}
      >
        No posts attached to this listing yet.
      </div>
    );
  }

  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {posts.map((post, idx) => {
        const isLast = idx === posts.length - 1;
        return (
          <PostRow key={post.id} post={post} isLast={isLast} />
        );
      })}
    </ol>
  );
}

function PostRow({ post, isLast }: { post: LivePost; isLast: boolean }) {
  const thumb = post.thumbnail_url || post.media_url || null;
  const caption = post.caption || "No caption recorded.";

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "96px minmax(0, 1fr) auto",
        gap: 28,
        padding: "24px 0",
        borderTop: "1px solid #ececec",
        borderBottom: isLast ? "1px solid #ececec" : undefined,
        alignItems: "center",
      }}
    >
      {/* Thumbnail with blurred backdrop */}
      <div
        style={{
          position: "relative",
          width: 96,
          height: 96,
          overflow: "hidden",
          backgroundColor: "#f4f4f4",
        }}
      >
        {thumb ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              aria-hidden="true"
              className="text-transparent"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(16px)",
                transform: "scale(1.15)",
                opacity: 0.55,
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              className="text-transparent"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </>
        ) : null}
      </div>

      {/* Caption block */}
      <div style={{ minWidth: 0 }}>
        <div style={EYEBROW_STYLE}>
          {platformLabel(post.platform)}
          {post.posted_at ? ` · ${formatShortDate(post.posted_at)}` : ""}
        </div>
        <p
          style={{
            marginTop: 8,
            fontSize: 15,
            lineHeight: 1.55,
            color: "#171717",
            fontWeight: 400,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {caption}
        </p>
      </div>

      {/* Reach number */}
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: 24,
            lineHeight: 1.1,
            fontWeight: 500,
            color: "#171717",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
          }}
        >
          {formatCompactNumber(post.reach)}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 500,
            color: "#737373",
          }}
        >
          Reach
        </div>
      </div>
    </li>
  );
}

function DownloadGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 4v12m0 0l-4-4m4 4l4-4M4 18v2h16v-2"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Tiny gold seal mark — approximates the C21 21 mark at 24x28 to anchor the
// footer without shipping a heavy image. 60% opacity is applied by the parent
// wrapper, per the gold-allowance spec.
function C21SealMark() {
  return (
    <svg
      width={24}
      height={28}
      viewBox="0 0 24 28"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect width={24} height={28} fill={GOLD} />
      <text
        x="50%"
        y="58%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily={FONT_STACK}
        fontSize={11}
        fontWeight={500}
        fill="#ffffff"
        letterSpacing="0.04em"
      >
        21
      </text>
    </svg>
  );
}

/* ----------------------------------------------------------------------- *
 *  Address & office helpers
 * ----------------------------------------------------------------------- */

// Address is stored as "Street, Unit, City, State" or similar comma-joined
// shape. We split into:
//   line 1: the street + optional unit token (the part before the second-to-
//           last comma)
//   line 2: "Unit X, City" or "City, State" — whichever is more useful
// This is a best-effort split that keeps the hero clean on real data.
function firstLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? address;
  // First segment is the street address; the rest goes on line 2.
  return parts[0];
}

function secondLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(", ");
}

// Office name is not on the property row today, so we infer from the agent
// email host where possible. Falls back to empty string (the CTA still reads
// cleanly: "Century 21 Alliance").
function officeFromEmail(email: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at === -1) return "";
  const host = email.slice(at + 1).toLowerCase();
  // Most Alliance offices use a single shared domain; surface the host as a
  // crude tag (the design treats this as a soft subtitle).
  if (host.includes("c21alliance")) return "C21 Alliance";
  if (host.includes("century21")) return "Century 21";
  return "";
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

