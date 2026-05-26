import { fetchPortalTrafficForListing } from "@/lib/data/portal-metrics-db";
import { formatCompactNumber } from "@/lib/format";

interface PortalTrafficSectionProps {
  mlsNumber: string;
  sourceMls: "cmc" | "sjsr";
  /** Trailing window in days. Default 90 — full Cape May DOM arc. */
  windowDays?: number;
}

/**
 * Portal traffic section on /properties/[mls]. Renders ListTrac-powered
 * counts for views, inquiries, saves, shares, and gallery/virtual-tour
 * opens across every portal that picked up the listing.
 *
 * Three tiers of detail:
 *   1. Headline cards — Total views + CIH bundle + Big Portals + saves
 *   2. Per-portal table — every site that reported, sorted by views desc
 *   3. Daily sparkline — quick visual of activity over the window
 *
 * Per project memory the data is sourced from `v_listing_portal_metrics_unified`
 * which already dedupes CMC/SJSR twins to the CMC canonical MLS#.
 */
export default async function PortalTrafficSection({
  mlsNumber,
  sourceMls,
  windowDays = 90,
}: PortalTrafficSectionProps) {
  const data = await fetchPortalTrafficForListing(
    mlsNumber,
    sourceMls,
    windowDays,
  );

  const cih = data.per_bundle.find((b) => b.slug === "cih");
  const bigPortals = data.per_bundle.find((b) => b.slug === "big_portals");

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Portal traffic
          </h2>
          <p className="text-sm text-neutral-500">
            Where buyers are seeing this listing across syndicated portals,
            powered by ListTrac (Golden Ruler). Last {windowDays} days.
          </p>
        </div>
        {data.first_date && data.last_date ? (
          <div className="text-xs text-neutral-500 whitespace-nowrap">
            <span className="font-medium text-neutral-700">
              {data.days_with_activity}
            </span>{" "}
            {data.days_with_activity === 1 ? "day" : "days"} with activity
          </div>
        ) : null}
      </div>

      {!data.has_data ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-5 text-sm text-neutral-600">
          <span className="font-medium text-neutral-700">
            Portal traffic data not available for this listing.
          </span>{" "}
          ListTrac doesn&rsquo;t currently report syndication counts for MLS#{" "}
          <code className="font-mono text-xs px-1 py-0.5 bg-neutral-100 rounded">
            {data.canonical_mls}
          </code>
          . This often happens with brand-new listings (give it a few days),
          office-only flagged listings, or sub-feeds ListTrac isn&rsquo;t
          wired into. The daily sync will pick it up automatically once
          counts start flowing.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Total views"
              value={formatCompactNumber(data.total_views)}
              sub={`across ${data.per_portal.length} ${data.per_portal.length === 1 ? "site" : "sites"}`}
              highlight
            />
            <MetricCard
              label="Big consumer portals"
              value={formatCompactNumber(bigPortals?.views ?? 0)}
              sub={`Zillow, Realtor.com, Trulia${(bigPortals?.portal_count ?? 0) > 3 ? " +" : ""}`}
            />
            <MetricCard
              label="CIH brand network"
              value={formatCompactNumber(cih?.views ?? 0)}
              sub={
                cih && cih.portal_count > 0
                  ? `C21, CB, Sotheby's, Compass family · ${cih.portal_count} ${cih.portal_count === 1 ? "site" : "sites"}`
                  : "Anywhere/Compass family"
              }
            />
            <MetricCard
              label="Saves & engagement"
              value={
                data.total_favorites +
                data.total_shares +
                data.total_gallery_opens >
                0
                  ? `${data.total_favorites + data.total_shares + data.total_gallery_opens}`
                  : "—"
              }
              sub={
                data.total_favorites +
                  data.total_shares +
                  data.total_gallery_opens >
                0
                  ? `${data.total_favorites} saves · ${data.total_shares} shares · ${data.total_gallery_opens} galleries`
                  : "ListTrac rarely tracks these"
              }
            />
          </div>

          {data.daily.length > 0 ? (
            <DailySparkline daily={data.daily} />
          ) : null}

          <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Portal</th>
                  <th className="px-4 py-2.5 font-medium text-right">Views</th>
                  <th className="px-4 py-2.5 font-medium text-right">Saves</th>
                  <th className="px-4 py-2.5 font-medium text-right">Gallery</th>
                  <th className="px-4 py-2.5 font-medium text-right">Shares</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.per_portal.map((p) => (
                  <tr
                    key={p.portal_name}
                    className="text-neutral-800 hover:bg-neutral-50/50"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-neutral-900">
                        {p.portal_name}
                      </div>
                      {p.portal_type ? (
                        <div className="text-[11px] text-neutral-500">
                          {p.portal_type}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-neutral-900">
                      {p.views.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                      {p.favorites > 0 ? p.favorites : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                      {p.gallery_opens > 0 ? p.gallery_opens : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                      {p.shares > 0 ? p.shares : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-xl border border-gold-200 bg-gold-50/50 shadow-card p-4"
          : "rounded-xl border border-neutral-200 bg-white shadow-card p-4"
      }
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div
        className={
          highlight
            ? "text-2xl font-semibold text-gold-800 tabular-nums leading-tight mt-1"
            : "text-2xl font-semibold text-neutral-900 tabular-nums leading-tight mt-1"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">{sub}</div>
    </div>
  );
}

/**
 * SVG sparkline — daily view totals across the window. Inline SVG so it
 * renders server-side, no client JS, no dependency on Chart.js / Recharts.
 */
function DailySparkline({
  daily,
}: {
  daily: Array<{ metric_date: string; views: number }>;
}) {
  if (daily.length < 2) return null;
  const width = 800;
  const height = 80;
  const padding = 6;
  const max = Math.max(1, ...daily.map((d) => d.views));
  const points = daily
    .map((d, i) => {
      const x = padding + ((width - 2 * padding) * i) / (daily.length - 1);
      const y =
        height - padding - ((height - 2 * padding) * d.views) / max;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Build a filled area path for visual weight.
  const areaPath =
    `M ${padding},${height - padding} ` +
    daily
      .map((d, i) => {
        const x = padding + ((width - 2 * padding) * i) / (daily.length - 1);
        const y =
          height - padding - ((height - 2 * padding) * d.views) / max;
        return `L ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") +
    ` L ${width - padding},${height - padding} Z`;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Daily views — {daily.length} days
        </div>
        <div className="text-[11px] text-neutral-500 tabular-nums">
          peak {max.toLocaleString()} on{" "}
          {daily.find((d) => d.views === max)?.metric_date ?? ""}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-20"
        aria-hidden="true"
      >
        <path d={areaPath} fill="#C9A84C" opacity={0.18} />
        <polyline
          points={points}
          fill="none"
          stroke="#C9A84C"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-neutral-500 tabular-nums mt-1">
        <span>{daily[0].metric_date}</span>
        <span>{daily[daily.length - 1].metric_date}</span>
      </div>
    </div>
  );
}
