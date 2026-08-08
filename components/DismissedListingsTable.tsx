"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { undismissListingPromotionAction } from "@/app/(app)/listings/actions";
import { clearListingSkipAction } from "@/app/(app)/listings/skip-actions";
import { formatCurrency, formatShortDate } from "@/lib/format";

export interface DismissedListingRow {
  mls_number: string;
  source_mls: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  listing_date: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  dismissed_by_name: string | null;
  /**
   * 2026-08-07 — which milestone was skipped. "just_listed" also covers the
   * legacy property-wide dismissals, which is why it is the fallback.
   */
  post_type: "just_listed" | "under_contract" | "just_sold" | "price_reduction";
}

interface Props {
  rows: DismissedListingRow[];
}

const REASON_LABELS: Record<string, string> = {
  low_price: "Low price point",
  condition: "Property condition",
  owner_request: "Owner request",
  other: "Other",
};

/**
 * Audit table for the /settings/promotions page. Each row shows the
 * dismissed listing summary, who dismissed it, when, the reason, and a
 * Restore button that calls undismissListingPromotionAction.
 */
export default function DismissedListingsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-card">
        <p className="text-sm text-neutral-600">
          No dismissed listings. When staff dismisses a listing from the
          dashboard, it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="text-left px-4 py-2.5">Listing</th>
            <th className="text-left px-4 py-2.5">Dismissed</th>
            <th className="text-left px-4 py-2.5">Reason</th>
            <th className="text-right px-4 py-2.5">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DismissedRow key={row.mls_number} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DismissedRow({ row }: { row: DismissedListingRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      // 2026-08-07 — skips now live in listing_skip_marks, per milestone.
      // clearListingSkipAction also clears the legacy property-wide column
      // for just_listed, so one call restores either kind of skip.
      const result =
        row.post_type === "just_listed"
          ? await clearListingSkipAction(row.mls_number, "just_listed").then(
              async (r) =>
                r.ok ? undismissListingPromotionAction(row.mls_number) : r,
            )
          : await clearListingSkipAction(row.mls_number, row.post_type);
      if (!result.ok) setError(result.error ?? "Unable to restore.");
    });
  }

  const cityState = [row.city, row.state].filter(Boolean).join(", ");
  const reasonLabel = row.dismissed_reason
    ? REASON_LABELS[row.dismissed_reason] ?? row.dismissed_reason
    : "—";

  return (
    <tr className="border-t border-neutral-100">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-neutral-100 overflow-hidden shrink-0">
            {row.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.hero_image_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <Link
              href={`/properties/${encodeURIComponent(row.mls_number)}`}
              className="text-neutral-900 font-medium hover:underline truncate block"
            >
              {row.address ?? row.mls_number}
            </Link>
            <div className="text-[11px] text-neutral-500 truncate">
              {cityState ? `${cityState} · ` : ""}
              {row.list_price ? formatCurrency(row.list_price) : "—"} ·{" "}
              {row.source_mls ? row.source_mls.toUpperCase() : ""} {row.mls_number}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-[12px] text-neutral-700">
        <div>
          {row.dismissed_at
            ? formatShortDate(row.dismissed_at)
            : "—"}
        </div>
        {row.dismissed_by_name ? (
          <div className="text-[11px] text-neutral-500">
            by {row.dismissed_by_name}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-[12px] text-neutral-700">{reasonLabel}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={handleRestore}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {isPending ? "Restoring..." : "Restore"}
        </button>
        {error ? (
          <p className="mt-1 text-[10px] text-red-700">{error}</p>
        ) : null}
      </td>
    </tr>
  );
}
