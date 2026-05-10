import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getProperties } from "@/lib/data";
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeTime,
} from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Properties — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const isAdmin = profile.role === "admin";

  const properties = await getProperties();

  return (
    <div>
      <PageHeader
        title="Properties"
        description="Every active and recent listing tracked here. CMC, SJSR, and Bright listings auto-populate via RETS sync; admins can add one manually for edge cases."
        actions={
          isAdmin ? (
            <Link href="/properties/new" className="btn-primary text-sm inline-flex items-center gap-1.5">
              <PlusIcon />
              Add property
            </Link>
          ) : undefined
        }
      />

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
          <div className="text-sm font-medium text-neutral-900">
            No properties yet
          </div>
          <p className="mt-1 text-sm text-neutral-500 max-w-md mx-auto">
            Once RETS sync runs (or you add a listing manually), properties
            will land here. Each card rolls up the social posts linked to that
            listing.
          </p>
          {isAdmin ? (
            <div className="mt-4">
              <Link href="/properties/new" className="btn-primary text-sm">
                Add a property
              </Link>
            </div>
          ) : null}
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
          {properties.length} {properties.length === 1 ? "property" : "properties"}
        </span>
        . See the{" "}
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
  const synced = property.updated_at
    ? new Date(property.updated_at)
    : null;
  const syncedOk = synced && !Number.isNaN(synced.getTime()) && synced.getTime() > 0;

  return (
    <article className="relative group rounded-xl border border-neutral-200 bg-white shadow-card hover:shadow-card-hover hover:border-gold-200 transition-all">
      {/* Stretched link layer — covers the whole card body. The Edit link below
          re-enables pointer events so it doesn't fire the card-level navigation. */}
      <Link
        href={`/properties/${encodeURIComponent(property.mls_number)}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
        aria-label={`Open ${property.address ?? property.mls_number}`}
      />

      <div className="relative pointer-events-none p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500 font-mono">
              MLS {property.mls_number}
            </div>
            <h3 className="mt-1 text-base font-semibold text-neutral-900 truncate">
              {property.address ?? "—"}
            </h3>
            {property.list_price ? (
              <div className="mt-0.5 text-sm text-gold-700 font-semibold tabular-nums">
                {formatCurrency(Number(property.list_price))}
              </div>
            ) : null}
            {property.city || property.state ? (
              <div className="mt-0.5 text-xs text-neutral-500">
                {[property.city, property.state, property.zip]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            ) : null}
          </div>

          <StatusPill status={property.status} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
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

        <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-sm">
          <span className="text-neutral-500">
            {syncedOk ? `Updated ${formatRelativeTime(property.updated_at)}` : "Not yet synced"}
          </span>

          <div className="flex items-center gap-3">
            {isAdmin ? (
              <Link
                href={`/properties/${encodeURIComponent(property.mls_number)}/edit`}
                className="pointer-events-auto text-xs text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
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
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
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
  const cls = STATUS_CLASS[status] ?? "bg-neutral-100 text-neutral-700 ring-neutral-200";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={
        "shrink-0 inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] font-medium " +
        cls
      }
    >
      {label}
    </span>
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
