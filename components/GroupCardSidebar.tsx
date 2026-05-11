"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  setGroupAudienceScopeAction,
  setGroupPropertiesAction,
} from "@/app/(app)/groups/actions";
import type { AudienceScope, PostGroup } from "@/lib/types/group";

/**
 * One office option for the audience scope dropdown.
 * Pre-populated by the parent server component from the offices table.
 */
export interface AudienceOfficeOption {
  short_code: string;
  name: string;
}

/** Hardcoded division options for v1 — promote to a divisions table later. */
const DIVISION_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: "shore", label: "Shore Division" },
  { slug: "south_jersey", label: "South Jersey Division" },
];

interface GroupCardSidebarProps {
  group: PostGroup;
  /** All active offices, for the audience scope dropdown. */
  offices: AudienceOfficeOption[];
  /** When false, all interactive controls are read-only (non-admin viewers). */
  isAdmin: boolean;
  /** Visual variant: "card" (dashboard, full chrome) or "drawer" (compact). */
  variant?: "card" | "drawer";
  className?: string;
}

/**
 * Right-rail housekeeping panel for the dashboard Property Card.
 *
 * Three blocks, top to bottom:
 *   1. Linkage     — multi-MLS editor, property chips, owner-report buttons
 *   2. Attribution — audience scope dropdown (company / division / office)
 *   3. Status      — tracking pill + promote placeholder
 *
 * All edits are admin-only and persist via server actions. The component
 * is interactive but lives inside a stretched-link card; the parent renders
 * it inside a `pointer-events-auto` zone so clicks here never trigger the
 * card's "open detail" navigation.
 */
export default function GroupCardSidebar({
  group,
  offices,
  isAdmin,
  variant = "card",
  className,
}: GroupCardSidebarProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-3 pointer-events-auto",
        variant === "card" ? "w-full md:w-72 md:shrink-0" : "w-full",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <LinkageBlock group={group} isAdmin={isAdmin} />
      <AttributionBlock group={group} offices={offices} isAdmin={isAdmin} />
      <StatusBlock group={group} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block 1 — Linkage (multi-MLS + property chips + owner reports)
// ---------------------------------------------------------------------------

function LinkageBlock({
  group,
  isAdmin,
}: {
  group: PostGroup;
  isAdmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draftMls, setDraftMls] = useState("");

  const isSingleton = group.id.startsWith("solo-");
  const linkedMlsNumbers = group.properties
    .map((p) => p.mls)
    .filter((m): m is string => typeof m === "string" && m.length > 0);

  function handleAdd() {
    const next = draftMls.trim();
    if (!next) return;
    setError(null);
    setUnmatched([]);
    const newList = Array.from(new Set([...linkedMlsNumbers, next]));
    startTransition(async () => {
      const result = await setGroupPropertiesAction(group.id, newList);
      if (!result.ok) {
        setError(result.error ?? "Unable to update.");
        return;
      }
      if (result.unmatched_mls?.length) setUnmatched(result.unmatched_mls);
      setDraftMls("");
      setAdding(false);
    });
  }

  function handleRemove(mlsNumber: string) {
    setError(null);
    setUnmatched([]);
    const newList = linkedMlsNumbers.filter((m) => m !== mlsNumber);
    startTransition(async () => {
      const result = await setGroupPropertiesAction(group.id, newList);
      if (!result.ok) setError(result.error ?? "Unable to update.");
    });
  }

  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white shadow-sm p-2.5"
      aria-label="Linked properties"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {group.properties.length > 1 ? "Properties" : "Property"}
        </h4>
        {group.properties.length > 0 ? (
          <span className="text-[10px] text-neutral-400 tabular-nums">
            {group.properties.length} linked
          </span>
        ) : null}
      </div>

      {group.properties.length === 0 && !adding ? (
        <p className="mt-1.5 text-[11px] text-neutral-400 italic">
          No property linked yet.
        </p>
      ) : null}

      {group.properties.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {group.properties.map((prop) => (
            <li
              key={prop.mls}
              className="flex items-center gap-1.5 rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-1.5 py-1"
            >
              {prop.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={prop.hero_image_url}
                  alt=""
                  className="w-7 h-7 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded bg-neutral-200 shrink-0" />
              )}
              <Link
                href={
                  prop.mls
                    ? `/properties/${encodeURIComponent(prop.mls)}`
                    : "#"
                }
                className="flex-1 min-w-0 text-[11px] font-medium text-neutral-800 hover:text-neutral-950 truncate"
              >
                {prop.address ?? prop.mls ?? "Unknown property"}
              </Link>
              {isAdmin && !isSingleton ? (
                <button
                  type="button"
                  onClick={() => prop.mls && handleRemove(prop.mls)}
                  disabled={isPending || !prop.mls}
                  className="text-[11px] text-neutral-400 hover:text-rose-600 px-1 leading-none disabled:opacity-50"
                  title="Remove this property from the campaign"
                  aria-label={`Remove ${prop.mls ?? ""}`}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {isAdmin && !isSingleton ? (
        <div className="mt-1.5">
          {adding ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={draftMls}
                onChange={(e) => setDraftMls(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraftMls("");
                  }
                }}
                placeholder="MLS # (e.g. NJBL2078123)"
                className="flex-1 min-w-0 rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                maxLength={32}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !draftMls.trim()}
                className="text-[11px] font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded px-2 py-1 disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraftMls("");
                }}
                className="text-[11px] text-neutral-500 hover:text-neutral-700 px-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
            >
              + Add MLS #
            </button>
          )}
        </div>
      ) : null}

      {unmatched.length > 0 ? (
        <p
          className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded px-1.5 py-0.5"
          title="These MLS numbers don't match any synced property — add them to the listings table or check the format."
        >
          Unmatched: {unmatched.join(", ")}
        </p>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-[10px] text-rose-700">{error}</p>
      ) : null}

      {/* Owner reports — one button per property, only when ≥7 days old */}
      {group.properties.length > 0 && group.days_old >= 7 ? (
        <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1">
          {group.properties.map((prop) =>
            prop.mls ? (
              <Link
                key={prop.mls}
                href={`/properties/${encodeURIComponent(prop.mls)}`}
                className="block text-[11px] font-medium text-gold-700 hover:text-gold-900 hover:bg-gold-50 rounded px-1.5 py-1 transition truncate"
                title={`View owner report for ${prop.address ?? prop.mls}`}
              >
                📄 Report → {prop.address ?? prop.mls}
              </Link>
            ) : null,
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Block 2 — Attribution (audience scope dropdown)
// ---------------------------------------------------------------------------

function AttributionBlock({
  group,
  offices,
  isAdmin,
}: {
  group: PostGroup;
  offices: AudienceOfficeOption[];
  isAdmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSingleton = group.id.startsWith("solo-");

  const currentValue = scopeToString(group.audience_scope ?? null);

  function handleChange(next: string) {
    setError(null);
    const scope = next === "" ? null : next;
    startTransition(async () => {
      const result = await setGroupAudienceScopeAction(group.id, scope);
      if (!result.ok) setError(result.error ?? "Unable to update.");
    });
  }

  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white shadow-sm p-2.5"
      aria-label="Audience scope"
    >
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Audience
      </h4>
      {isAdmin && !isSingleton ? (
        <select
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={isPending}
          className="mt-1.5 w-full rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-800 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-60"
        >
          <option value="">Unscoped</option>
          <option value="company">Whole company</option>
          <optgroup label="Divisions">
            {DIVISION_OPTIONS.map((d) => (
              <option key={d.slug} value={`division:${d.slug}`}>
                {d.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Offices">
            {offices.map((o) => (
              <option key={o.short_code} value={`office:${o.short_code}`}>
                {o.name}
              </option>
            ))}
          </optgroup>
        </select>
      ) : (
        <p className="mt-1.5 text-[11px] text-neutral-700">
          {scopeToLabel(group.audience_scope ?? null, offices)}
        </p>
      )}
      {error ? (
        <p className="mt-1.5 text-[10px] text-rose-700">{error}</p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Block 3 — Status + actions (tracking pill, promote placeholder)
// ---------------------------------------------------------------------------

function StatusBlock({ group }: { group: PostGroup }) {
  const insight = group.ai_insight;
  const tone = insight?.tone ?? "quiet";
  const trackingTone =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "info"
          ? "bg-sky-50 text-sky-700 ring-sky-200"
          : "bg-neutral-50 text-neutral-600 ring-neutral-200";

  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white shadow-sm p-2.5"
      aria-label="Campaign status"
    >
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Status
      </h4>
      <div
        className={clsx(
          "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1",
          trackingTone,
        )}
      >
        ✦ {insight?.headline ?? "Awaiting insight"}
      </div>
      <div className="mt-2 pt-2 border-t border-neutral-100">
        <button
          type="button"
          disabled
          className="w-full text-[11px] font-medium text-neutral-400 bg-neutral-50 ring-1 ring-neutral-200 rounded px-2 py-1 cursor-not-allowed"
          title="Promote flow ships in a follow-up sprint"
        >
          🚀 Promote (coming soon)
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopeToString(scope: AudienceScope | null): string {
  if (!scope) return "";
  if (scope.kind === "company") return "company";
  return `${scope.kind}:${scope.value ?? ""}`;
}

function scopeToLabel(
  scope: AudienceScope | null,
  offices: AudienceOfficeOption[],
): string {
  if (!scope) return "Unscoped";
  if (scope.kind === "company") return "Whole company";
  if (scope.kind === "division") {
    const match = DIVISION_OPTIONS.find((d) => d.slug === scope.value);
    return match?.label ?? `Division: ${scope.value ?? ""}`;
  }
  if (scope.kind === "office") {
    const match = offices.find((o) => o.short_code === scope.value);
    return match ? match.name : `Office: ${scope.value ?? ""}`;
  }
  return "Unscoped";
}
