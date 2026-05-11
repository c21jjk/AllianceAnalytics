import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  formatShortDate,
} from "@/lib/format";
import type { PropertyReportKpis } from "@/lib/types/report";
import type { Platform, AudienceSlice } from "@/lib/types/post";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ print?: string }>;
}

interface FlyerData {
  token: string;
  property: {
    mls: string;
    address: string;
    list_price: number | null;
    hero_image_url: string | null;
  };
  period_start: string | null;
  period_end: string | null;
  kpis: PropertyReportKpis;
  campaigns: FlyerCampaign[];
  audience: {
    top_locations: AudienceSlice[];
    age_buckets: AudienceSlice[];
    platform_share: { platform: Platform; share: number; reach: number }[];
  };
  narrative_closing: string;
  generated_at: string | null;
}

interface FlyerCampaign {
  id: string;
  label: string;
  thumbnail_url: string | null;
  total_reach: number;
  total_engagements: number;
  by_platform: { platform: Platform; reach: number; engagements: number }[];
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
}

interface DbPostRow {
  id: string;
  group_id: string | null;
  platform: string;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
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

  // Resolve report (try report_token first, then delivery share_token)
  let reportRow: DbReportRow | null = null;
  const { data: directReport } = await supabase
    .from("reports")
    .select(
      "id, property_id, report_token, period_start, period_end, post_ids, kpis, audience, narrative, generated_at",
    )
    .eq("report_token", token)
    .maybeSingle();
  if (directReport) reportRow = directReport as DbReportRow;
  if (!reportRow) {
    const { data: delivery } = await supabase
      .from("report_deliveries")
      .select("report_id")
      .eq("share_token", token)
      .maybeSingle();
    if (delivery) {
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
    .select("id, mls_number, address, city, state, list_price, hero_image_url")
    .eq("id", reportRow.property_id)
    .maybeSingle();
  if (!propRow) return null;
  const prop = propRow as DbPropertyRow;
  const addressParts = [prop.address, prop.city, prop.state].filter(Boolean);

  // Posts -> campaigns. We re-aggregate from posts at render time so that the
  // flyer always reflects the latest metrics, even if the report row was
  // created before the most recent sync run.
  const campaigns: FlyerCampaign[] = [];
  if (reportRow.post_ids && reportRow.post_ids.length > 0) {
    const { data: postRows } = await supabase
      .from("posts")
      .select(
        "id, group_id, platform, caption, thumbnail_url, media_url, metrics",
      )
      .in("id", reportRow.post_ids);
    const posts = (postRows ?? []) as DbPostRow[];
    const byGroup = new Map<string, FlyerCampaign>();
    for (const p of posts) {
      const key = p.group_id ?? `ungrouped:${p.id}`;
      const m = p.metrics ?? {};
      const reach = readNum(m.reach) || readNum(m.impressions);
      const engagements =
        readNum(m.likes) +
        readNum(m.comments) +
        readNum(m.shares) +
        readNum(m.saves);
      const platform = asPlatform(p.platform);
      const existing = byGroup.get(key);
      if (!existing) {
        const caption = (p.caption ?? "").trim();
        const label = caption.length > 0
          ? caption.split(/[.!?]\s/)[0].slice(0, 80)
          : "Untitled campaign";
        byGroup.set(key, {
          id: key,
          label,
          thumbnail_url: p.thumbnail_url ?? p.media_url ?? null,
          total_reach: reach,
          total_engagements: engagements,
          by_platform: [{ platform, reach, engagements }],
        });
      } else {
        existing.total_reach += reach;
        existing.total_engagements += engagements;
        const slot = existing.by_platform.find((x) => x.platform === platform);
        if (slot) {
          slot.reach += reach;
          slot.engagements += engagements;
        } else {
          existing.by_platform.push({ platform, reach, engagements });
        }
      }
    }
    campaigns.push(
      ...Array.from(byGroup.values()).sort(
        (a, b) => b.total_reach - a.total_reach,
      ),
    );
  }

  return {
    token,
    property: {
      mls: prop.mls_number,
      address: addressParts.join(", "),
      list_price:
        prop.list_price === null || prop.list_price === undefined
          ? null
          : Number(prop.list_price),
      hero_image_url: prop.hero_image_url ?? null,
    },
    period_start: reportRow.period_start,
    period_end: reportRow.period_end,
    kpis: loadKpis(reportRow.kpis),
    campaigns: campaigns.slice(0, 6),
    audience: loadAudience(reportRow.audience),
    narrative_closing: loadClosing(reportRow.narrative),
    generated_at: reportRow.generated_at,
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

  const pdfHref = `/r/${encodeURIComponent(token)}/flyer.pdf`;

  return (
    <div className="flyer-root min-h-screen bg-neutral-25 print:bg-white">
      {/* Print stylesheet — hides UI controls, sizes pages, swaps backgrounds */}
      <style>{flyerCss(printMode)}</style>

      {/* Floating download bar — hidden when printing */}
      <div className="flyer-toolbar print:hidden">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">
            Report for {data.property.address} · MLS {data.property.mls}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/r/${encodeURIComponent(token)}`}
              className="text-xs text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-md hover:bg-neutral-100"
            >
              View standard report
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

      <main className="flyer-main max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10 print:py-0 print:px-0 print:max-w-none">
        {/* Page 1 — hero */}
        <section className="flyer-page">
          <header className="flyer-header">
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
                  Property performance report
                </div>
              </div>
            </div>
            <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
              {data.period_start && data.period_end
                ? `${formatShortDate(data.period_start)} – ${formatShortDate(data.period_end)}`
                : data.generated_at
                  ? formatShortDate(data.generated_at)
                  : ""}
            </div>
          </header>

          <div className="flyer-hero">
            {data.property.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.property.hero_image_url}
                alt={`Cover photo for ${data.property.address}`}
                className="flyer-hero-img"
              />
            ) : (
              <div className="flyer-hero-fallback" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/c21-seal.png"
                  alt=""
                  className="flyer-hero-fallback-mark"
                />
              </div>
            )}
            <div className="flyer-hero-overlay">
              <div className="text-[11px] font-medium uppercase tracking-wider text-white/80">
                MLS {data.property.mls}
              </div>
              <h1 className="mt-1.5 text-3xl md:text-4xl font-semibold tracking-tight text-white">
                {data.property.address}
              </h1>
              {data.property.list_price ? (
                <div className="mt-3 inline-flex items-center rounded-md bg-white/95 px-3 py-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                    List price
                  </span>
                  <span className="ml-2 text-sm font-semibold text-gold-700">
                    {formatCurrency(data.property.list_price)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flyer-callout">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Prepared for
            </div>
            <div className="mt-1 text-base font-semibold text-neutral-900">
              The seller of {data.property.address}
            </div>
            <div className="mt-1 text-sm text-neutral-600">
              An Alliance Social marketing report covering every post we put
              behind your home across Instagram, Facebook, and TikTok.
            </div>
          </div>
        </section>

        {/* Page 2 — KPIs */}
        <section className="flyer-page flyer-page-break">
          <h2 className="flyer-section-h">The numbers, at a glance</h2>
          <p className="flyer-section-sub">
            Aggregated across every post that ran for {data.property.address}{" "}
            during the report period.
          </p>
          <div className="flyer-kpi-grid">
            <Kpi label="Total reach" value={formatCompactNumber(data.kpis.total_reach)} />
            <Kpi
              label="Total engagements"
              value={formatCompactNumber(data.kpis.total_engagements)}
            />
            <Kpi
              label="Engagement rate"
              value={formatPercent(data.kpis.engagement_rate)}
            />
            <Kpi label="Posts" value={data.kpis.post_count.toString()} />
            <Kpi
              label="Platforms"
              value={data.kpis.platforms_covered.toString()}
            />
            <Kpi
              label="Link clicks"
              value={
                data.kpis.link_clicks !== undefined
                  ? formatCompactNumber(data.kpis.link_clicks)
                  : "—"
              }
            />
          </div>

          {data.audience.platform_share.length > 0 ? (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-2">
                Where the reach came from
              </div>
              <div className="flyer-platform-share">
                {data.audience.platform_share.map((slice) => (
                  <div key={slice.platform} className="flyer-platform-row">
                    <span className="flyer-platform-label">
                      {platformLabel(slice.platform)}
                    </span>
                    <div className="flyer-platform-bar">
                      <div
                        className="flyer-platform-bar-fill"
                        style={{ width: `${Math.round(slice.share * 100)}%` }}
                      />
                    </div>
                    <span className="flyer-platform-pct">
                      {Math.round(slice.share * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Page 3 — top campaigns */}
        {data.campaigns.length > 0 ? (
          <section className="flyer-page flyer-page-break">
            <h2 className="flyer-section-h">Top campaigns</h2>
            <p className="flyer-section-sub">
              The posts that drove the most reach for your home.
            </p>
            <div className="flyer-campaign-list">
              {data.campaigns.slice(0, 3).map((c) => (
                <article key={c.id} className="flyer-campaign">
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.thumbnail_url}
                      alt=""
                      className="flyer-campaign-thumb"
                    />
                  ) : (
                    <div className="flyer-campaign-thumb flyer-campaign-thumb-placeholder" />
                  )}
                  <div className="flyer-campaign-body">
                    <div className="text-sm font-semibold text-neutral-900 line-clamp-2">
                      {c.label}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
                      <span>
                        <strong className="text-neutral-900">
                          {formatCompactNumber(c.total_reach)}
                        </strong>{" "}
                        reach
                      </span>
                      <span>
                        <strong className="text-neutral-900">
                          {formatCompactNumber(c.total_engagements)}
                        </strong>{" "}
                        engagements
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {c.by_platform.map((p) => (
                        <span
                          key={p.platform}
                          className="inline-flex items-center gap-1 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-neutral-700"
                        >
                          {platformLabel(p.platform)} ·{" "}
                          {formatCompactNumber(p.reach)}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Page 4 — narrative + sign-off */}
        <section className="flyer-page flyer-page-break">
          <h2 className="flyer-section-h">What this means for your sale</h2>
          <p className="flyer-narrative">{data.narrative_closing}</p>
          {data.audience.top_locations.length > 0 ? (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-2">
                Top locations the audience came from
              </div>
              <ul className="flyer-list">
                {data.audience.top_locations.slice(0, 5).map((loc) => (
                  <li key={loc.label} className="flyer-list-row">
                    <span className="text-sm text-neutral-700">{loc.label}</span>
                    <span className="text-xs text-neutral-500">
                      {Math.round(loc.share * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flyer-signoff text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/alliance-wordmark.png"
              alt="Century 21 Alliance"
              className="mx-auto h-7 md:h-8 w-auto opacity-90 mb-3"
            />
            <div className="text-sm text-neutral-700">
              Prepared by Alliance Social
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Questions? Reply to the email this report came from, or contact
              your Alliance agent directly.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flyer-kpi">
      <div className="flyer-kpi-label">{label}</div>
      <div className="flyer-kpi-value">{value}</div>
    </div>
  );
}

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

function flyerCss(printMode: boolean): string {
  return `
.flyer-root { color-scheme: light; }
.flyer-toolbar {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid #e5e5e5;
}
.flyer-page {
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 14px;
  padding: 32px;
  margin-bottom: 20px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.flyer-page + .flyer-page-break { /* spacing on screen, page break on print */ }
.flyer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f1f1;
  margin-bottom: 20px;
}
.flyer-hero {
  position: relative; overflow: hidden;
  border-radius: 12px;
  aspect-ratio: 16/9;
  background: #f5f5f5;
}
.flyer-hero-img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
}
.flyer-hero-fallback {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #b78b3f 0%, #f3d57e 100%);
  display: flex; align-items: center; justify-content: center;
}
.flyer-hero-fallback-mark {
  width: 30%; max-width: 200px; height: auto;
  object-fit: contain;
  opacity: 0.92;
}
.flyer-hero-overlay {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 24px;
  background: linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0));
}
.flyer-callout {
  margin-top: 24px; padding: 18px 20px;
  border: 1px solid #efe2c4;
  background: linear-gradient(135deg, #fffbf1 0%, #ffffff 60%);
  border-radius: 10px;
}
.flyer-section-h {
  font-size: 22px; font-weight: 600; letter-spacing: -0.01em;
  color: #171717;
}
.flyer-section-sub {
  margin-top: 4px; font-size: 13px; color: #6b6b6b;
}
.flyer-kpi-grid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (min-width: 700px) {
  .flyer-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.flyer-kpi {
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 14px 16px;
  background: #ffffff;
}
.flyer-kpi-label {
  font-size: 10px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #6b6b6b;
}
.flyer-kpi-value {
  margin-top: 6px;
  font-size: 24px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #111111;
}
.flyer-platform-share { display: flex; flex-direction: column; gap: 8px; }
.flyer-platform-row {
  display: grid;
  grid-template-columns: 92px 1fr 40px;
  align-items: center;
  gap: 12px;
}
.flyer-platform-label { font-size: 12px; color: #404040; }
.flyer-platform-bar {
  height: 8px; background: #f1f1f1; border-radius: 4px; overflow: hidden;
}
.flyer-platform-bar-fill {
  height: 100%; background: linear-gradient(90deg, #d8a93c, #b78b3f);
}
.flyer-platform-pct {
  font-size: 12px; color: #404040; text-align: right;
  font-variant-numeric: tabular-nums;
}
.flyer-campaign-list {
  margin-top: 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.flyer-campaign {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 14px;
  padding: 12px;
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  background: #ffffff;
}
.flyer-campaign-thumb {
  width: 96px; height: 96px;
  object-fit: cover;
  border-radius: 8px;
  background: #f1f1f1;
}
.flyer-campaign-thumb-placeholder {
  background: linear-gradient(135deg, #f3d57e 0%, #b78b3f 100%);
}
.flyer-campaign-body { min-width: 0; }
.flyer-narrative {
  margin-top: 12px;
  font-size: 14px; line-height: 1.65; color: #404040;
  max-width: 70ch;
}
.flyer-list { margin: 0; padding: 0; list-style: none; }
.flyer-list-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #ececec;
}
.flyer-list-row:last-child { border-bottom: none; }
.flyer-signoff {
  margin-top: 28px; padding-top: 16px;
  border-top: 1px solid #efefef;
}

/* Print rules — emulate when ?print=1 is set so the in-browser preview
   already looks like the final PDF. */
${
  printMode
    ? `
.flyer-toolbar { display: none !important; }
.flyer-main { padding: 0 !important; max-width: 100% !important; }
.flyer-page {
  border-radius: 0;
  border: none;
  box-shadow: none;
  page-break-after: always;
  break-after: page;
  margin-bottom: 0;
  padding: 28px 32px;
  min-height: 96vh;
}
.flyer-page:last-child { page-break-after: auto; break-after: auto; }
body, .flyer-root { background: #ffffff !important; }
`
    : ""
}

@media print {
  .flyer-toolbar { display: none !important; }
  .flyer-main { padding: 0 !important; max-width: 100% !important; }
  .flyer-page {
    border-radius: 0;
    border: none;
    box-shadow: none;
    page-break-after: always;
    break-after: page;
    margin-bottom: 0;
    padding: 28px 32px;
    min-height: 96vh;
  }
  .flyer-page:last-child { page-break-after: auto; break-after: auto; }
  body, .flyer-root { background: #ffffff !important; }
}
`;
}
