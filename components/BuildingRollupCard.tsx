import Link from "next/link";
import type { BuildingRollup } from "@/lib/data/portal-metrics-db";
import PortalMetricsStrip from "@/components/portal-metrics/PortalMetricsStrip";
import { formatCompactNumber, formatCurrency } from "@/lib/format";

interface BuildingRollupCardProps {
  rollup: BuildingRollup;
  /** The MLS# of the listing on whose page this card is rendering — used to
   *  bold the "you are here" row in the member table. */
  currentMls: string;
}

/**
 * Building-level rollup card on a property detail page. Shown when the
 * listing is part of a multi-unit building (2+ distinct canonical units at
 * the same normalized address).
 *
 * Layout:
 *   - Header: "Building total · N units" + address
 *   - Combined 5-portal strip (CIH-aware) across every unit
 *   - Member table: each unit's MLS#, status, price, individual view count,
 *     linked to that unit's detail page (the row matching currentMls is
 *     visually emphasized but not linked away).
 */
export default function BuildingRollupCard({
  rollup,
  currentMls,
}: BuildingRollupCardProps) {
  const cityLine = rollup.display_city
    ? `${rollup.display_address}, ${rollup.display_city}`
    : rollup.display_address;

  return (
    <section className="rounded-2xl border border-gold-200 bg-gradient-to-br from-gold-50/40 to-white shadow-card overflow-hidden">
      <header className="px-5 py-4 border-b border-gold-200/70 bg-gold-50/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-800">
              Building total
            </div>
            <h2 className="mt-0.5 text-lg font-semibold text-neutral-900 truncate">
              {cityLine}
            </h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              {rollup.member_count} {rollup.member_count === 1 ? "unit" : "units"} at this address —{" "}
              {rollup.active_count > 0 ? `${rollup.active_count} active` : null}
              {rollup.active_count > 0 && (rollup.pending_count > 0 || rollup.sold_count > 0) ? ", " : null}
              {rollup.pending_count > 0 ? `${rollup.pending_count} pending` : null}
              {rollup.pending_count > 0 && rollup.sold_count > 0 ? ", " : null}
              {rollup.sold_count > 0 ? `${rollup.sold_count} sold` : null}
            </p>
          </div>
          {rollup.strip.has_data ? (
            <div className="shrink-0 text-right">
              <div className="text-2xl font-bold text-neutral-900 tabular-nums leading-none">
                {formatCompactNumber(rollup.strip.total_views)}
              </div>
              <div className="text-[10px] text-neutral-600 uppercase tracking-wider mt-1">
                combined views
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="px-5 py-4 space-y-4">
        <PortalMetricsStrip
          strip={rollup.strip}
          variant="card"
          caption={`Combined across all ${rollup.member_count} units`}
        />

        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 mb-2">
            Units in this building
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-3 py-2 font-medium">MLS#</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium text-right">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rollup.members.map((m) => {
                  const isCurrent = m.mls_number === currentMls;
                  const rowCls = isCurrent
                    ? "bg-gold-50/30"
                    : "hover:bg-neutral-50/60";
                  return (
                    <tr key={m.mls_number} className={rowCls}>
                      <td className="px-3 py-2.5">
                        {isCurrent ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-neutral-900 font-semibold">
                              {m.mls_number}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-gold-800 bg-gold-100 px-1.5 py-0.5 rounded">
                              you are here
                            </span>
                          </div>
                        ) : (
                          <Link
                            href={`/properties/${encodeURIComponent(m.mls_number)}`}
                            className="font-mono text-xs text-gold-700 hover:text-gold-900 hover:underline"
                          >
                            {m.mls_number}
                          </Link>
                        )}
                        {m.source_mls ? (
                          <div className="text-[9px] uppercase tracking-wide text-neutral-500 mt-0.5">
                            {m.source_mls}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">
                        {m.list_price !== null
                          ? formatCurrency(m.list_price)
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800 font-semibold">
                        {m.views > 0 ? formatCompactNumber(m.views) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: "Active",    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    pending:   { label: "Pending",   cls: "bg-amber-50  text-amber-700  ring-amber-200" },
    sold:      { label: "Sold",      cls: "bg-neutral-100 text-neutral-700 ring-neutral-200" },
    expired:   { label: "Expired",   cls: "bg-rose-50  text-rose-700  ring-rose-200" },
    withdrawn: { label: "Withdrawn", cls: "bg-rose-50  text-rose-700  ring-rose-200" },
  };
  const m = map[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-700 ring-neutral-200" };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
