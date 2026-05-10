import Link from "next/link";
import type { PropertyDetail } from "@/lib/data/properties-db";
import { formatCurrency, formatCompactNumber } from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";

interface LivePropertyDetailProps {
  property: PropertyDetail;
}

/**
 * Simplified property detail view rendered when the MLS exists in the live
 * `properties` table (RETS-synced) but no fixture-style report has been
 * generated yet. Shows hero photo, key facts, agent + office, and a grid of
 * the linked posts. The fuller report-style view (PropertyReportHero,
 * PropertyKpiRollup, AudienceReachRollup) remains available via the
 * legacy fixture path on the parent page for demo/seed listings.
 *
 * "Generate report" is intentionally left for the follow-up sprint — it
 * ties into the existing GenerateReportButton flow which currently only
 * accepts fixture-shaped inputs.
 */
export default function LivePropertyDetail({
  property,
}: LivePropertyDetailProps) {
  const cityState = [property.city, property.state]
    .filter(Boolean)
    .join(", ");
  const bathTotal =
    (property.bathrooms_full ?? 0) + 0.5 * (property.bathrooms_half ?? 0);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-800">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/properties" className="hover:text-neutral-800">
          Properties
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 truncate max-w-md">
          {property.address ?? property.mls_number}
        </span>
      </div>

      {/* Hero — large image + key facts overlay */}
      <section className="rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-card">
        <div className="relative aspect-[16/9] bg-neutral-100">
          {property.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.hero_image_url}
              alt={property.address ?? "Property"}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-neutral-400 text-sm">
              No hero photo on file
            </div>
          )}
        </div>
        <div className="p-5 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-neutral-900 leading-tight">
              {property.address ?? "Unknown address"}
            </h1>
            {cityState ? (
              <p className="text-sm text-neutral-500 mt-0.5">
                {cityState}
                {property.zip ? ` ${property.zip}` : ""}
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px] text-neutral-700">
              {property.list_price !== null ? (
                <span className="inline-flex items-center rounded-md bg-gold-50 ring-1 ring-gold-200 px-2 py-0.5 font-semibold text-gold-800 tabular-nums">
                  {formatCurrency(property.list_price)}
                </span>
              ) : null}
              {property.bedrooms !== null ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5">
                  {property.bedrooms} bed
                </span>
              ) : null}
              {bathTotal > 0 ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5">
                  {bathTotal} bath
                </span>
              ) : null}
              {property.property_type ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5">
                  {property.property_type}
                </span>
              ) : null}
              {property.dom_days !== null ? (
                <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5">
                  DOM {property.dom_days}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5 font-mono text-[11px]">
                #{property.mls_number}
              </span>
            </div>
            {property.agent_name ? (
              <p className="mt-2 text-xs text-neutral-500">
                Listed by{" "}
                <span className="text-neutral-700 font-medium">
                  {property.agent_name}
                </span>
                {property.listing_office_name
                  ? ` · ${property.listing_office_name}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Quick stats — only meaningful when there are posts */}
      {property.post_count > 0 ? (
        <section className="grid grid-cols-3 gap-3">
          <StatTile label="Posts" value={String(property.post_count)} />
          <StatTile
            label="Total reach"
            value={formatCompactNumber(property.total_reach)}
          />
          <StatTile
            label="Engagements"
            value={formatCompactNumber(property.total_engagements)}
          />
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-6 text-center text-sm text-neutral-500">
          No social posts linked to this listing yet. Once a post including{" "}
          <span className="font-mono text-neutral-700">
            #{property.mls_number}
          </span>{" "}
          syncs, it&rsquo;ll appear here automatically.
        </section>
      )}

      {/* Linked posts grid */}
      {property.posts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Posts for this listing
            </h2>
            <p className="text-sm text-neutral-500">
              {property.posts.length}{" "}
              {property.posts.length === 1 ? "post" : "posts"} linked across{" "}
              {countPlatforms(property)}{" "}
              {countPlatforms(property) === 1 ? "platform" : "platforms"}.
              Click any post to open detail.
            </p>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {property.posts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="block rounded-lg border border-neutral-200 bg-white shadow-card hover:border-gold-200 hover:shadow-card-hover transition overflow-hidden"
                >
                  <div className="aspect-square bg-neutral-100 relative">
                    {post.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.thumbnail_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : null}
                    <span className="absolute top-1.5 left-1.5">
                      <PlatformBadge platform={post.platform} size="sm" />
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="text-[11px] text-neutral-500">
                      {post.posted_at
                        ? new Date(post.posted_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )
                        : "—"}{" "}
                      · {platformLabel(post.platform)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-700 line-clamp-2 leading-snug">
                      {post.caption ?? (
                        <span className="text-neutral-400 italic">
                          No caption
                        </span>
                      )}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500 tabular-nums">
                      <span>
                        <span className="font-semibold text-neutral-800">
                          {formatCompactNumber(post.reach)}
                        </span>{" "}
                        reach
                      </span>
                      <span>
                        {formatCompactNumber(post.total_engagements)} eng
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Public remarks (MLS description) */}
      {property.public_remarks ? (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-2">
            MLS description
          </h2>
          <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
            {property.public_remarks}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-xl font-semibold text-neutral-900 tabular-nums leading-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

function countPlatforms(property: PropertyDetail): number {
  const set = new Set(property.posts.map((p) => p.platform));
  return set.size;
}
