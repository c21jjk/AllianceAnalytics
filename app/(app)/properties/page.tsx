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
  listDistinctOfficeLabels,
  normalizeOfficeName,
  type PropertySortKey,
} from "@/lib/data/properties-db";
import PageHeader from "@/components/PageHeader";
import PropertySortDropdown from "@/components/PropertySortDropdown";
import PropertyOfficeFilter from "@/components/PropertyOfficeFilter";

export const metadata = { title: "Properties — Alliance Social" };
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
  searchParams: Promise<{ sort?: string; office?: string }>;
}

export default async function PropertiesPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const isAdmin = profile.role === "admin";

  const { sort: rawSort, office: rawOffice } = await searchParams;
  const sort: PropertySortKey =
    rawSort && (ALLOWED_SORTS as string[]).includes(rawSort)
      ? (rawSort as PropertySortKey)
      : "newest";
  const officeFilter = rawOffice && rawOffice.length > 0 ? rawOffice : null;

  const [properties, officeLabels] = await Promise.all([
    getProperties({ sort, office: officeFilter }),
    listDistinctOfficeLabels(),
  ]);

  return (
    <div>
      <PageHeader
        title="Properties"
        description="Every active Century 21 Alliance listing tracked here. CMC and SJSR feeds auto-populate via RETS sync; admins can add one manually for edge cases."
        actions={
          isAdmin ? (
            <Link
              href="/properties/new"
              className="btn-primary text-sm inline-flex items-center gap-1.5"
            >
              <PlusIcon />
              Add property
            </Link>
          ) : undefined
        }
      />

      <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-3">
        <PropertyOfficeFilter options={officeLabels} value={officeFilter} />
        <PropertySortDropdown value={sort} />
      </div>

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
          <div className="text-sm font-medium text-neutral-900">
            {officeFilter
              ? `No properties for ${officeFilter}`
              : "No properties yet"}
          </div>
          <p className="mt-1 text-sm text-neutral-500 max-w-md mx-auto">
            {officeFilter
              ? "Try clearing the office filter or running a fresh RETS sync."
              : "Once RETS sync runs (or you add a listing manually), properties will land here. Each card rolls up the social posts linked to that listing."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {properties.map((p) => (
            <PropertyCard key={p.mls_number} property={p} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      <div className="mt-6 text-xs text-neutral-500">
        Tracking{" "}
        <span className="font-medium text-neutral-700">
          {properties.length}{" "}
          {properties.length === 1 ? "property" : "properties"}
        </span>
        {officeFilter ? ` (${officeFilter})` : ""}. See the{" "}
        <Link href="/reports" className="text-gold-700 hover:text-gold-800">
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
}

function PropertyCard({ property, isAdmin }: PropertyCardProps) {
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
    <article className="relative group rounded-xl border border-neutral-200 bg-white shadow-card hover:shadow-card-hover hover:border-gold-200 transition-all overflow-hidden">
      <Link
        href={`/properties/${encodeURIComponent(property.mls_number)}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
        aria-label={`Open ${property.address ?? property.mls_number}`}
      />

      <div className="relative pointer-events-none flex">
        {/* Hero image / placeholder */}
        <div className="relative shrink-0 w-32 sm:w-40 bg-neutral-100">
          {property.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.hero_image_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-neutral-300">
              <HouseIcon />
            </div>
          )}
          <span className="absolute top-1.5 left-1.5">
            <StatusPill status={property.status} />
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 font-mono">
                MLS {property.mls_number}
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-neutral-900 truncate">
                {property.address ?? "—"}
              </h3>
              {cityState ? (
                <div className="text-[11px] text-neutral-500 truncate">
                  {cityState}
                </div>
              ) : null}
              {property.list_price ? (
                <div className="mt-1 text-sm text-gold-700 font-semibold tabular-nums">
                  {formatCurrency(Number(property.list_price))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Beds | Baths | DOM | Type chips */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {property.bedrooms !== null ? (
              <FactPill label={`${property.bedrooms} BR`} />
            ) : null}
            {bathsDisplay ? <FactPill label={`${bathsDisplay} BA`} /> : null}
            {property.dom_days !== null ? (
              <FactPill label={`${property.dom_days}d on market`} />
            ) : null}
            {property.property_type ? (
              <FactPill label={property.property_type} muted />
            ) : null}
          </div>

          {/* Agent + Office */}
          <div className="mt-2 text-[11px] text-neutral-600 leading-snug">
            {property.agent_name ? (
              <div className="truncate">
                <span className="text-neutral-400 uppercase tracking-wide font-medium text-[9px] mr-1">
                  Agent
                </span>
                {property.agent_name}
              </div>
            ) : null}
            <div className="truncate">
              <span className="text-neutral-400 uppercase tracking-wide font-medium text-[9px] mr-1">
                Office
              </span>
              {officeLabel}
            </div>
          </div>

          {/* Posts/Reach/Engagements */}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <MiniStat label="Posts" value={property.post_count.toString()} />
            <MiniStat
              label="Reach"
              value={formatCompactNumber(property.total_reach)}
            />
            <MiniStat
              label="Engagements"
              value={formatCompactNumber(property.total_engagements)}
            />
          </div>

          <div className="mt-3 pt-2 border-t border-neutral-100 flex items-center justify-between text-[11px]">
            <span className="text-neutral-500">
              {syncedOk
                ? `Updated ${formatRelativeTime(property.updated_at)}`
                : "Not yet synced"}
            </span>
            <div className="flex items-center gap-3">
              {isAdmin ? (
                <Link
                  href={`/properties/${encodeURIComponent(property.mls_number)}/edit`}
                  className="pointer-events-auto text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
                >
                  Edit
                </Link>
              ) : null}
              <span className="text-gold-700 group-hover:text-gold-800 font-medium inline-flex items-center gap-1">
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
  // Half-bath as 0.5 decimal: 2 full + 1 half = 2.5
  return (f + h * 0.5).toString();
}

function FactPill({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-md ring-1 px-1.5 py-0.5 text-[10px] font-medium " +
        (muted
          ? "bg-neutral-50 text-neutral-600 ring-neutral-200"
          : "bg-neutral-100 text-neutral-800 ring-neutral-200")
      }
    >
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  sold: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  expired: "bg-rose-50 text-rose-700 ring-rose-200",
};

function StatusPill({ status }: { status: string }) {
  const cls =
    STATUS_CLASS[status] ?? "bg-neutral-100 text-neutral-700 ring-neutral-200";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={
        "shrink-0 inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-medium " +
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
      className="w-3.5 h-3.5"
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
