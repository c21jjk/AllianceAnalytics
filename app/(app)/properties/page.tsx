import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getProperties } from "@/lib/data";
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeTime,
} from "@/lib/format";
import {
  normalizeOfficeName,
  type PropertySortKey,
} from "@/lib/data/properties-db";
import { listOffices } from "@/lib/data/offices";
import {
  fetchPortalStripsForListings,
  type PortalStrip,
} from "@/lib/data/portal-metrics-db";
import PageHeader from "@/components/PageHeader";
import PortalMetricsStrip from "@/components/portal-metrics/PortalMetricsStrip";
import PropertySortDropdown from "@/components/PropertySortDropdown";
import PropertyOfficeFilter from "@/components/PropertyOfficeFilter";
import PropertySearchBox from "@/components/PropertySearchBox";

export const metadata = { title: "Listings — Alliance Social" };
export const dynamic = "force-dynamic";

const ALLOWED_SORTS: PropertySortKey[] = [
  "newest",
  "oldest",
  "price_desc",
  "price_asc",
  "office_asc",
  "dom_desc",
];

interface PageProps {
  searchParams: Promise<{ sort?: string; office?: string; q?: string }>;
}

export default async function PropertiesPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const isAdmin = profile.role === "admin";

  const { sort: rawSort, office: rawOffice, q: rawQ } = await searchParams;
  const sort: PropertySortKey =
    rawSort && (ALLOWED_SORTS as string[]).includes(rawSort)
      ? (rawSort as PropertySortKey)
      : "newest";
  const officeFilter = rawOffice && rawOffice.length > 0 ? rawOffice : null;
  const queryRaw = (rawQ ?? "").trim();
  const queryLower = queryRaw.toLowerCase();

  const [allProperties, offices] = await Promise.all([
    getProperties({ sort, office: officeFilter }),
    // 2026-05-31 — Office filter chips are the curated C21 office roster
    // (the `offices` table), NOT distinct office names off the listing feed.
    // The feed-derived list leaked non-C21 co-listing offices (e.g. "Keller
    // Williams Realty - Washington Twp") and Paragon junk codes (e.g. "S104i"),
    // and dropped C21 offices with no current active listings (LBI, Medford,
    // etc.). `office.name` equals normalizeOfficeName() output, so the
    // `?office=` filter still resolves correctly for offices that have listings.
    listOffices(),
  ]);
  const officeLabels = offices
    .map((o) => o.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));

  // In-memory text filter — runs against MLS, address, city, agent. Inventory
  // is ~21 today (cap 500 from the fetcher), so this is fine; revisit if we
  // start dealing with thousands.
  const properties = queryLower.length === 0
    ? allProperties
    : allProperties.filter((p) => {
        const haystack = [
          p.mls_number,
          p.address,
          p.city,
          p.state,
          p.zip,
          p.agent_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(queryLower);
      });

  // Batch-fetch the 5-portal strip for every listing on screen. Single
  // round-trip against v_listing_portal_metrics_unified — avoids N+1.
  // Window defaults to "since listing_date" per project policy: sellers
  // care about lifetime exposure of the listing, not a rolling window.
  const stripCandidates = properties
    .filter(
      (p): p is typeof p & { source_mls: "cmc" | "sjsr" } =>
        p.source_mls === "cmc" || p.source_mls === "sjsr",
    )
    .map((p) => ({
      mls_number: p.mls_number,
      source_mls: p.source_mls,
      listing_date: p.listing_date ?? null,
    }));

  let portalStripsByKey: Map<string, PortalStrip> = new Map();
  try {
    portalStripsByKey = await fetchPortalStripsForListings(stripCandidates);
  } catch (e) {
    // Non-fatal — listings render without the strip rather than 500'ing
    // the whole /properties view if the portal-metrics table is misbehaving.
    console.warn("portal strips batch fetch failed:", (e as Error).message);
  }

  return (
    <div>
      <PageHeader
        eyebrow={`Active inventory · ${properties.length} ${properties.length === 1 ? "listing" : "listings"}${officeFilter ? ` · ${officeFilter}` : ""}${queryRaw ? ` · search "${queryRaw}"` : ""}`}
        title="Listings"
        description="Every active Century 21 Alliance listing tracked here. CMC and SJSR feeds auto-populate via RETS sync."
        actions={
          isAdmin ? (
            <Link
              href="/properties/new"
              className="btn-primary text-sm inline-flex items-center gap-1.5"
            >
              <PlusIcon />
              Add listing
            </Link>
          ) : undefined
        }
      />

      {/* Search row sits ABOVE the filter row so it's the first thing the
          eye lands on — easier to find a specific MLS that way. */}
      <div className="mt-2 mb-3">
        <PropertySearchBox initialValue={queryRaw} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PropertyOfficeFilter options={officeLabels} value={officeFilter} />
        <PropertySortDropdown value={sort} />
      </div>

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
          <div className="text-sm font-medium text-neutral-900">
            {queryRaw
              ? `No listings match "${queryRaw}"`
              : officeFilter
                ? `No listings for ${officeFilter}`
                : "No listings yet"}
          </div>
          <p className="mt-1 text-sm text-neutral-500 max-w-md mx-auto">
            {queryRaw
              ? "Try a different MLS, address, city, or agent."
              : officeFilter
                ? "Try clearing the office filter or running a fresh RETS sync."
                : "Once RETS sync runs, properties will land here. Each card rolls up the social posts linked to that listing."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {properties.map((p) => (
            <PropertyCard
              key={p.mls_number}
              property={p}
              isAdmin={isAdmin}
              portalStrip={
                p.source_mls === "cmc" || p.source_mls === "sjsr"
                  ? portalStripsByKey.get(`${p.source_mls}|${p.mls_number}`) ?? null
                  : null
              }
            />
          ))}
        </div>
      )}

      <div className="mt-6 text-xs text-neutral-500">
        See the{" "}
        <Link href="/reports" className="text-gold-700 hover:text-gold-800 font-medium">
          company-wide rollup
        </Link>
        .
      </div>
    </div>
  );
}

interface PropertyCardProps {
  property: Awaited<ReturnType<typeof getProperties>>[number];
  isAdmin: boolean;
  /** 5-slot portal strip data, or null when no ListTrac coverage. */
  portalStrip: PortalStrip | null;
}

/**
 * Compact single-listing-per-row card. Hero is 200px wide on the left.
 * Right side is a dense 3-row layout: title block, fact chips + agent/office
 * line, and a footer that combines stats + remarks toggle + actions.
 *
 * The vertical height is roughly 2/3 of the previous design — exploits the
 * wider canvas (max-w-7xl) by going horizontal instead of stacking.
 */
function PropertyCard({ property, isAdmin, portalStrip }: PropertyCardProps) {
  const synced = property.updated_at ? new Date(property.updated_at) : null;
  const syncedOk =
    synced && !Number.isNaN(synced.getTime()) && synced.getTime() > 0;
  const officeLabel = normalizeOfficeName(property.listing_office_name);
  const bathsDisplay = formatBaths(
    property.bathrooms_full,
    property.bathrooms_half,
  );
  const cityState = [property.city, property.state, property.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="relative group rounded-xl border border-neutral-200 bg-white shadow-card hover:shadow-card-hover hover:border-gold-300 transition-all overflow-hidden">
      <Link
        href={`/properties/${encodeURIComponent(property.mls_number)}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
        aria-label={`Open ${property.address ?? property.mls_number}`}
      />

      <div className="relative pointer-events-none flex flex-col sm:flex-row">
        {/* Hero — compact left rail */}
        <div className="relative shrink-0 w-full sm:w-48 md:w-52 aspect-[4/3] sm:aspect-auto sm:min-h-[160px] bg-neutral-100">
          {property.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.hero_image_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-neutral-300">
              <HouseIcon />
            </div>
          )}
          {/* Subtle gradient overlay so the status pill always reads */}
          <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/25 to-transparent pointer-events-none" />
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1">
            <StatusPill status={property.status} />
            {property.is_coming_soon ? <ComingSoonPill /> : null}
          </span>
          {property.source_mls ? (
            <span className="absolute top-1.5 right-1.5 inline-flex items-center rounded-md bg-neutral-900/85 backdrop-blur px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              {property.source_mls.toUpperCase()}
            </span>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 px-4 py-3">
          {/* Top row — MLS#, address/city, price */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
                <span className="font-mono">MLS {property.mls_number}</span>
                {property.property_type ? (
                  <>
                    <span className="text-neutral-300">·</span>
                    <span className="text-neutral-500">
                      {property.property_type}
                    </span>
                  </>
                ) : null}
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-neutral-900 truncate leading-tight">
                {property.address ?? "—"}
              </h3>
              {cityState ? (
                <div className="text-[11px] text-neutral-500 truncate">
                  {cityState}
                </div>
              ) : null}
            </div>
            {property.list_price ? (
              <div className="shrink-0 text-right">
                <div className="text-lg md:text-xl font-semibold tabular-nums bg-gradient-to-r from-gold-700 to-gold-600 bg-clip-text text-transparent leading-tight">
                  {formatCurrency(Number(property.list_price))}
                </div>
                {property.dom_days !== null ? (
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wide">
                    {property.dom_days}d on market
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Middle row — fact chips + agent/office on the same line */}
          <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-1">
              {property.bedrooms !== null ? (
                <FactPill label={`${property.bedrooms} BR`} />
              ) : null}
              {bathsDisplay ? <FactPill label={`${bathsDisplay} BA`} /> : null}
              {property.dom_days !== null && !property.list_price ? (
                <FactPill label={`${property.dom_days}d`} muted />
              ) : null}
            </div>
            <div className="text-[11px] text-neutral-600 truncate flex items-center gap-3 min-w-0">
              {property.agent_name ? (
                <span className="truncate">
                  <span className="text-neutral-400 mr-1">Agent</span>
                  {property.agent_name}
                </span>
              ) : null}
              <span className="truncate">
                <span className="text-neutral-400 mr-1">Office</span>
                {officeLabel}
              </span>
            </div>
          </div>

          {/* MLS remarks toggle — pointer-events-auto so the card link doesn't
              eat the click. Compact button-style summary. */}
          {property.public_remarks ? (
            <details className="mt-2 pointer-events-auto group/remarks">
              <summary className="inline-flex items-center gap-1 text-[10.5px] font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer select-none list-none">
                <ChevronToggle />
                <span className="group-open/remarks:hidden">MLS remarks</span>
                <span className="hidden group-open/remarks:inline">
                  Hide remarks
                </span>
              </summary>
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-gradient-to-br from-gold-50/50 to-neutral-50/30 p-2.5 text-[12px] leading-relaxed text-neutral-800 whitespace-pre-line">
                {property.public_remarks}
              </div>
            </details>
          ) : null}

          {/* Portal strip — 5-slot views breakdown across Zillow / Realtor /
              Trulia / CIH / Other Portals. pointer-events-auto so the title-attribute
              tooltips on each chip are reachable even though the card link
              covers the article. */}
          {portalStrip ? (
            <div className="mt-2 pointer-events-auto">
              <PortalMetricsStrip strip={portalStrip} variant="card" />
            </div>
          ) : null}

          {/* Footer — stats inline + meta + open */}
          <div className="mt-2.5 pt-2 border-t border-neutral-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-4 text-[11px]">
              <InlineStat
                label="Posts"
                value={property.post_count.toString()}
              />
              <InlineStat
                label="Reach"
                value={formatCompactNumber(property.total_reach)}
              />
              <InlineStat
                label="Eng"
                value={formatCompactNumber(property.total_engagements)}
              />
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-neutral-400">
                {syncedOk
                  ? `Updated ${formatRelativeTime(property.updated_at)}`
                  : "Not yet synced"}
              </span>
              {isAdmin ? (
                <Link
                  href={`/properties/${encodeURIComponent(property.mls_number)}/edit`}
                  className="pointer-events-auto text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
                >
                  Edit
                </Link>
              ) : null}
              <span className="text-gold-700 group-hover:text-gold-800 font-semibold inline-flex items-center gap-0.5">
                Open
                <ChevronRight />
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function formatBaths(full: number | null, half: number | null): string | null {
  if (full === null && half === null) return null;
  const f = full ?? 0;
  const h = half ?? 0;
  if (h === 0) return String(f);
  return (f + h * 0.5).toString();
}

function FactPill({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-md ring-1 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums " +
        (muted
          ? "bg-neutral-50 text-neutral-600 ring-neutral-200"
          : "bg-gold-50 text-gold-800 ring-gold-200")
      }
    >
      {label}
    </span>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-neutral-900">{value}</span>
    </span>
  );
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-emerald-50/95 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50/95 text-amber-700 ring-amber-200",
  sold: "bg-neutral-100/95 text-neutral-700 ring-neutral-200",
  expired: "bg-rose-50/95 text-rose-700 ring-rose-200",
};

function ComingSoonPill() {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full ring-1 px-1.5 py-0.5 text-[9.5px] font-semibold backdrop-blur bg-neutral-900/90 text-gold-400 ring-neutral-700">
      Coming Soon
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    STATUS_CLASS[status] ?? "bg-neutral-100/95 text-neutral-700 ring-neutral-200";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={
        "shrink-0 inline-flex items-center rounded-full ring-1 px-1.5 py-0.5 text-[9.5px] font-semibold backdrop-blur " +
        cls
      }
    >
      {label}
    </span>
  );
}

function HouseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" aria-hidden="true">
      <path
        d="M3 11l9-7 9 7M5 9.6V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.6"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronToggle() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-2.5 h-2.5 transition-transform group-open/remarks:rotate-90"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
