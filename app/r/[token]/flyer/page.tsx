import { notFound } from "next/navigation";
import { Barlow } from "next/font/google";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
} from "@/lib/format";
import type { PropertyReportKpis } from "@/lib/types/report";
import type { Platform, AudienceSlice } from "@/lib/types/post";
import { fetchCompanyRollup, type CompanyRollup } from "@/lib/data/company-rollup";

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
  searchParams?: Promise<{ print?: string }>;
}

interface FlyerData {
  token: string;
  recipient_name: string | null;
  property: {
    mls: string;
    address: string;
    list_price: number | null;
    hero_image_url: string | null;
    agent_name: string | null;
    agent_email: string | null;
  };
  period_start: string | null;
  period_end: string | null;
  kpis: PropertyReportKpis;
  posts: FlyerPost[];
  audience: {
    top_locations: AudienceSlice[];
    age_buckets: AudienceSlice[];
    platform_share: { platform: Platform; share: number; reach: number }[];
  };
  narrative_closing: string;
  generated_at: string | null;
  listed_date: string | null;
  companyRollup: CompanyRollup;
}

interface FlyerPost {
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

interface DbReportRow {
  id: string;
  property_id: string;
  report_token: string;
  period_start: string | null;
  period_end: string | null;
  post_ids: string[];
  kpis: unknown;
  audience: unknown;
  narrative: unknown;
  generated_at: string | null;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  hero_image_url: string | null;
  listing_date: string | null;
  agent_name: string | null;
  agent_email: string | null;
}

interface DbPostRow {
  id: string;
  group_id: string | null;
  platform: string;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  posted_at: string | null;
  metrics: Record<string, unknown> | null;
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

function loadKpis(json: unknown): PropertyReportKpis {
  const k = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    total_reach: readNum(k.total_reach),
    total_impressions: readNum(k.total_impressions),
    total_engagements: readNum(k.total_engagements),
    engagement_rate: readNum(k.engagement_rate),
    post_count: readNum(k.post_count),
    platforms_covered: readNum(k.platforms_covered),
    link_clicks: k.link_clicks !== undefined ? readNum(k.link_clicks) : undefined,
    profile_visits:
      k.profile_visits !== undefined ? readNum(k.profile_visits) : undefined,
  };
}

function loadAudience(json: unknown): FlyerData["audience"] {
  const a = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    top_locations: Array.isArray(a.top_locations)
      ? (a.top_locations as AudienceSlice[])
      : [],
    age_buckets: Array.isArray(a.age_buckets)
      ? (a.age_buckets as AudienceSlice[])
      : [],
    platform_share: Array.isArray(a.platform_share)
      ? (a.platform_share as FlyerData["audience"]["platform_share"])
      : [],
  };
}

function loadClosing(json: unknown): string {
  const n = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (typeof n.closing === "string") return n.closing;
  return "Alliance Social put your home in front of a measured, qualified audience across the platforms most likely to drive serious buyer interest.";
}

async function loadFlyerData(token: string): Promise<FlyerData | null> {
  const supabase = createAdminClient();

  // Resolve report (try report_token first, then delivery share_token).
  // Carry through the recipient_name from the matching delivery row when
  // available — Direction B uses it in the "Prepared for" eyebrow.
  let reportRow: DbReportRow | null = null;
  let recipientName: string | null = null;
  const { data: directReport } = await supabase
    .from("reports")
    .select(
      "id, property_id, report_token, period_start, period_end, post_ids, kpis, audience, narrative, generated_at",
    )
    .eq("report_token", token)
    .maybeSingle();
  if (directReport) {
    reportRow = directReport as DbReportRow;
    const { data: delivery } = await supabase
      .from("report_deliveries")
      .select("recipient_name")
      .eq("report_id", reportRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    recipientName = delivery?.recipient_name ?? null;
  }
  if (!reportRow) {
    const { data: delivery } = await supabase
      .from("report_deliveries")
      .select("report_id, recipient_name")
      .eq("share_token", token)
      .maybeSingle();
    if (delivery) {
      recipientName = delivery.recipient_name ?? null;
      const { data: indirectReport } = await supabase
        .from("reports")
        .select(
          "id, property_id, report_token, period_start, period_end, post_ids, kpis, audience, narrative, generated_at",
        )
        .eq("id", delivery.report_id)
        .maybeSingle();
      if (indirectReport) reportRow = indirectReport as DbReportRow;
    }
  }
  if (!reportRow) return null;

  // Property
  const { data: propRow } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, list_price, hero_image_url, listing_date, agent_name, agent_email",
    )
    .eq("id", reportRow.property_id)
    .maybeSingle();
  if (!propRow) return null;
  const prop = propRow as DbPropertyRow;
  const addressParts = [prop.address, prop.city, prop.state].filter(Boolean);

  // Company rollup (30d + 365d + followers).
  const companyRollupPromise = fetchCompanyRollup();

  // Flat chronological post feed (Direction B "Every post we put behind your
  // home"). Re-aggregated at render time so the flyer always reflects the
  // most recent metrics regardless of when the report row was generated.
  let posts: FlyerPost[] = [];
  if (reportRow.post_ids && reportRow.post_ids.length > 0) {
    const { data: postRows } = await supabase
      .from("posts")
      .select(
        "id, group_id, platform, caption, thumbnail_url, media_url, permalink, posted_at, metrics",
      )
      .in("id", reportRow.post_ids)
      .order("posted_at", { ascending: false });
    const rows = (postRows ?? []) as DbPostRow[];
    posts = rows.map((row) => {
      const m = row.metrics ?? {};
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
  }

  const companyRollup = await companyRollupPromise;

  return {
    token,
    recipient_name: recipientName,
    property: {
      mls: prop.mls_number,
      address: addressParts.join(", "),
      list_price:
        prop.list_price === null || prop.list_price === undefined
          ? null
          : Number(prop.list_price),
      hero_image_url: prop.hero_image_url ?? null,
      agent_name: prop.agent_name ?? null,
      agent_email: prop.agent_email ?? null,
    },
    period_start: reportRow.period_start,
    period_end: reportRow.period_end,
    kpis: loadKpis(reportRow.kpis),
    posts,
    audience: loadAudience(reportRow.audience),
    narrative_closing: loadClosing(reportRow.narrative),
    generated_at: reportRow.generated_at,
    listed_date: prop.listing_date,
    companyRollup,
  };
}

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const data = await loadFlyerData(token);
  if (!data) return { title: "Property report — Alliance Social" };
  return {
    title: `${data.property.address} — Marketing report`,
  };
}

export default async function FlyerPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const printMode = sp.print === "1";

  const data = await loadFlyerData(token);
  if (!data) notFound();

  return <FlyerView data={data} printMode={printMode} />;
}

/* ----------------------------------------------------------------------- *
 *  Direction B — "Compass / Minimal Modern" (LOCKED design)
 *
 *  Flyer = printable variant of the Owner Report. The on-screen render
 *  matches the live web view (app/r/[token]/page.tsx) exactly; the
 *  @media print rules (and the ?print=1 emulation) hide the action bar,
 *  break the document into Letter-size pages before Marketing, Alliance,
 *  and Agent CTA, and force the grey Alliance band to white to save toner.
 *
 *  Strict rules baked in:
 *   - Barlow only, weights 400/500
 *   - Gold (#C9A84C) used in exactly 4 places per page:
 *       1) "Download PDF" link in the top action bar
 *       2) 1px gold rule between Performance and Marketing
 *       3) the word "does" in the Alliance closing line
 *       4) tiny C21 seal mark in the footer at 60% opacity
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

function FlyerView({ data, printMode }: { data: FlyerData; printMode: boolean }) {
  const { property, kpis, posts, companyRollup, recipient_name } = data;
  const pdfHref = `/r/${encodeURIComponent(data.token)}/flyer.pdf`;
  const totalReach = kpis.total_reach;
  const totalEngagements = kpis.total_engagements;
  const postCount = kpis.post_count || posts.length;
  const audienceTotal = companyRollup.followers.total;
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
      {/* Print stylesheet — Letter-size pages, page breaks, toolbar hidden */}
      <style>{flyerPrintCss(printMode)}</style>

      {/* 1. Top action bar — hidden in print via .flyer-actions */}
      <div
        className="flyer-actions"
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

      <main>
        {/* 2. Property identity */}
        <section className="flyer-section flyer-section-identity" style={{ padding: "80px 36px 24px" }}>
          <div style={EYEBROW_STYLE}>
            {recipient_name
              ? `Prepared for ${recipient_name}`
              : "Prepared for the owner"}
          </div>

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
                data.listed_date
                  ? formatShortDate(data.listed_date)
                  : "—"
              }
            />
          </div>
        </section>

        {/* 3. Property photo — full bleed */}
        <section className="flyer-section flyer-section-photo" style={{ padding: "0 0 48px" }}>
          <div
            className="flyer-hero-frame"
            style={{
              width: "100%",
              backgroundColor: "#f4f4f4",
              overflow: "hidden",
              height: 360,
            }}
          >
            {property.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={property.hero_image_url}
                alt={`Cover photo for ${property.address}`}
                className="text-transparent flyer-hero-img"
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
        <section className="flyer-section flyer-section-performance" style={{ padding: "64px 36px" }}>
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
          className="flyer-gold-rule"
          style={{
            height: 1,
            backgroundColor: GOLD,
            margin: "0 36px",
          }}
        />

        {/* 6. Marketing (post feed) */}
        <section className="flyer-section flyer-section-marketing" style={{ padding: "64px 36px" }}>
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

        {/* 7. Alliance section — single break band (#fafafa) */}
        <section
          className="flyer-section flyer-section-alliance"
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
              value={formatCompactNumber(companyRollup.window_30d.posts)}
              label="Posts in the last 30 days"
            />
            <AllianceStat
              value={formatCompactNumber(companyRollup.window_30d.reach)}
              label="People reached in the last 30 days"
            />
            <AllianceStat
              value={formatCompactNumber(companyRollup.window_365d.posts)}
              label="Posts in the last 365 days"
            />
            <AllianceStat
              value={formatCompactNumber(companyRollup.window_365d.reach)}
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
        <section className="flyer-section flyer-section-agent" style={{ padding: "80px 36px 24px" }}>
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
          className="flyer-section flyer-section-footer"
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

function PostFeed({ posts }: { posts: FlyerPost[] }) {
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
        return <PostRow key={post.id} post={post} isLast={isLast} />;
      })}
    </ol>
  );
}

function PostRow({ post, isLast }: { post: FlyerPost; isLast: boolean }) {
  const thumb = post.thumbnail_url || post.media_url || null;
  const caption = post.caption || "No caption recorded.";

  return (
    <li
      className="flyer-post-row"
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
      {/* Thumbnail with blurred backdrop (matches live web view pattern) */}
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
 *  Address & office helpers (mirrored from the live web view)
 * ----------------------------------------------------------------------- */

function firstLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? address;
  return parts[0];
}

function secondLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(", ");
}

function officeFromEmail(email: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at === -1) return "";
  const host = email.slice(at + 1).toLowerCase();
  if (host.includes("c21alliance")) return "C21 Alliance";
  if (host.includes("century21")) return "Century 21";
  return "";
}

/* ----------------------------------------------------------------------- *
 *  Print CSS — Letter (8.5×11"), page breaks before Marketing / Alliance
 *  / Agent CTA, no #fafafa band in print (white saves toner), action bar
 *  hidden. The same rules apply inside @media print AND when ?print=1
 *  is set so the in-browser preview matches the final PDF exactly.
 * ----------------------------------------------------------------------- */

function flyerPrintCss(printMode: boolean): string {
  const printRules = `
.flyer-actions { display: none !important; }
.flyer-section-photo { padding: 0 0 24px !important; }
.flyer-hero-frame { height: 320px !important; }
.flyer-hero-img,
.flyer-section-photo img {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.flyer-post-row img {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.flyer-section-alliance {
  background-color: #ffffff !important;
}
.flyer-section-marketing {
  page-break-before: always;
  break-before: page;
}
.flyer-section-alliance {
  page-break-before: always;
  break-before: page;
}
.flyer-section-agent {
  page-break-before: always;
  break-before: page;
}
.flyer-section-footer {
  page-break-before: avoid;
  break-before: avoid;
}
.flyer-post-row {
  page-break-inside: avoid;
  break-inside: avoid;
}
@page {
  size: 8.5in 11in;
  margin: 0.5in;
}
body { background: #ffffff !important; }
`;
  return `
.flyer-actions { color-scheme: light; }

@media print {
${printRules}
}

${printMode ? printRules : ""}
`;
}
