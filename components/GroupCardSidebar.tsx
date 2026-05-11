"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  setGroupAudienceScopeAction,
  setGroupCategoryAction,
  setGroupPropertiesAction,
  type GroupCategory,
} from "@/app/(app)/groups/actions";
import type { AudienceScope, PostGroup } from "@/lib/types/group";
import { formatCurrency } from "@/lib/format";

/**
 * Shape returned by `/api/listings/search`. Subset of properties columns
 * that the typeahead dropdown needs to render a row.
 */
interface ListingSearchResult {
  mls_number: string;
  address: string;
  city: string | null;
  state: string | null;
  list_price: number | null;
  status: string;
  hero_image_url: string | null;
}

/** Loose regex for "looks like a raw MLS hashtag" — used for the Enter-to-submit fast path. */
const MLS_LIKE_RE = /^(?:njbl|cmc|sjsr|njcd|nj[a-z]{2})\d{4,}$/i;

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
      <CategoryBlock group={group} isAdmin={isAdmin} />
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isSingleton = group.id.startsWith("solo-");
  const linkedMlsNumbers = group.properties
    .map((p) => p.mls)
    .filter((m): m is string => typeof m === "string" && m.length > 0);

  // Debounced search-as-you-type against the existing listings endpoint.
  // Triggers on query length ≥ 2 so a single keystroke doesn't fire a request.
  useEffect(() => {
    if (!adding) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/listings/search?q=${encodeURIComponent(query.trim())}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as {
          results?: ListingSearchResult[];
        };
        setResults(json.results ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, adding]);

  // Click-away closes the dropdown but keeps the input mounted.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function persistAddition(mlsToAdd: string) {
    setError(null);
    setUnmatched([]);
    const newList = Array.from(new Set([...linkedMlsNumbers, mlsToAdd]));
    startTransition(async () => {
      const result = await setGroupPropertiesAction(group.id, newList);
      if (!result.ok) {
        setError(result.error ?? "Unable to update.");
        return;
      }
      if (result.unmatched_mls?.length) setUnmatched(result.unmatched_mls);
      setQuery("");
      setResults([]);
      setOpen(false);
      setAdding(false);
    });
  }

  /** Click on a typeahead row — attach the picked listing's MLS. */
  function handlePick(r: ListingSearchResult) {
    persistAddition(r.mls_number);
  }

  /**
   * Fallback "raw MLS" submit — fires when the user presses Enter and the
   * query looks like a hashtag (e.g. `NJBL2078123`, `CMC230456`). Lets power
   * users paste an MLS without waiting for a search result.
   */
  function handleRawSubmit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (MLS_LIKE_RE.test(trimmed)) {
      persistAddition(trimmed.toUpperCase());
    }
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
      aria-label="Linked listings"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {group.properties.length > 1 ? "Listings" : "Listing"}
        </h4>
        {group.properties.length > 0 ? (
          <span className="text-[10px] text-neutral-400 tabular-nums">
            {group.properties.length} linked
          </span>
        ) : null}
      </div>

      {group.properties.length === 0 && !adding ? (
        <p className="mt-1.5 text-[11px] text-neutral-400 italic">
          No listing linked yet.
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
            <div ref={wrapperRef} className="relative">
              <div className="flex items-center gap-1">
                <input
                  ref={searchInputRef}
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => {
                    if (results.length > 0) setOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleRawSubmit();
                    }
                    if (e.key === "Escape") {
                      setAdding(false);
                      setQuery("");
                      setResults([]);
                      setOpen(false);
                    }
                  }}
                  placeholder="MLS # or address (e.g. 727 spruce, NJBL2078)…"
                  className="flex-1 min-w-0 rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setQuery("");
                    setResults([]);
                    setOpen(false);
                  }}
                  className="text-[11px] text-neutral-500 hover:text-neutral-700 px-1"
                  aria-label="Cancel"
                >
                  ✕
                </button>
              </div>

              {open && results.length > 0 ? (
                <div className="absolute z-20 mt-1 left-0 right-0 rounded-lg border border-neutral-200 bg-white shadow-lg max-h-72 overflow-auto">
                  {results.map((r) => (
                    <button
                      key={r.mls_number}
                      type="button"
                      onClick={() => handlePick(r)}
                      disabled={isPending}
                      className="w-full text-left px-2 py-1.5 hover:bg-neutral-50 flex items-center gap-2 border-b border-neutral-100 last:border-b-0 disabled:opacity-60"
                    >
                      <div className="relative w-8 h-8 flex-shrink-0 rounded bg-neutral-100 overflow-hidden ring-1 ring-neutral-200">
                        {r.hero_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.hero_image_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] font-mono text-neutral-700 truncate">
                            {r.mls_number}
                          </span>
                          {r.list_price ? (
                            <span className="text-[10px] text-gold-700 tabular-nums">
                              {formatCurrency(Number(r.list_price))}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-neutral-900 truncate">
                          {r.address}
                        </div>
                        <div className="text-[10px] text-neutral-500 truncate">
                          {[r.city, r.state].filter(Boolean).join(", ")}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {open &&
              !searching &&
              query.trim().length >= 2 &&
              results.length === 0 ? (
                <div className="absolute z-20 mt-1 left-0 right-0 rounded-lg border border-neutral-200 bg-white shadow-lg px-2 py-2 text-[11px] text-neutral-500">
                  No listings found. Try the MLS# directly, or add the listing
                  on the{" "}
                  <Link
                    href="/listings/new"
                    className="underline text-gold-700"
                  >
                    Listings tab
                  </Link>
                  .
                </div>
              ) : null}
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

      {/* Owner reports — high-emphasis CTA per linked listing. Only renders
          once posts are at least 7 days old (matches the GenerateReportButton
          gate). Owner reports are the headline output of the system, so this
          uses the gold-on-gold filled-button treatment rather than a quiet
          inline link. */}
      {group.properties.length > 0 && group.days_old >= 7 ? (
        <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1.5">
          {group.properties.map((prop) =>
            prop.mls ? (
              <Link
                key={prop.mls}
                href={`/properties/${encodeURIComponent(prop.mls)}`}
                className="group flex items-center gap-2 rounded-md bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-600 hover:to-gold-700 px-2.5 py-2 text-white shadow-sm hover:shadow transition-all"
                title={`View owner report for ${prop.address ?? prop.mls}`}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-white/15 shrink-0"
                >
                  <DocumentIcon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/85 leading-none">
                    Owner Report
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-white truncate leading-tight">
                    {prop.address ?? prop.mls}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-white/85 group-hover:translate-x-0.5 transition-transform"
                >
                  →
                </span>
              </Link>
            ) : null,
          )}
        </div>
      ) : null}
    </section>
  );
}

function DocumentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
      <path d="M14.5 3.5V8h4M9 13h6M9 17h4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Block 1b — Category (editorial type of campaign)
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS: Array<{ value: GroupCategory; label: string }> = [
  { value: "property", label: "Property Promotion" },
  { value: "open_house", label: "Open House Promotion" },
  { value: "agent", label: "Agent Promotion" },
  { value: "marketing", label: "Company Promotion" },
  { value: "educational", label: "Real Estate Educational Tips" },
  { value: "sold", label: "Sold / Just Sold" },
  { value: "community", label: "Community / Local" },
  { value: "other", label: "Other" },
];

function CategoryBlock({
  group,
  isAdmin,
}: {
  group: PostGroup;
  isAdmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSingleton = group.id.startsWith("solo-");

  const currentValue = group.category ?? "";

  function handleChange(next: string) {
    setError(null);
    const category: GroupCategory | null =
      next === ""
        ? null
        : (CATEGORY_OPTIONS.find((c) => c.value === next)?.value ?? null);
    startTransition(async () => {
      const result = await setGroupCategoryAction(group.id, category);
      if (!result.ok) setError(result.error ?? "Unable to update.");
    });
  }

  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white shadow-sm p-2.5"
      aria-label="Category"
    >
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Category
      </h4>
      {isAdmin && !isSingleton ? (
        <select
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={isPending}
          className="mt-1.5 w-full rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-800 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-60"
        >
          <option value="">Uncategorized</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1.5 text-[11px] text-neutral-700">
          {CATEGORY_OPTIONS.find((c) => c.value === group.category)?.label ??
            "Uncategorized"}
        </p>
      )}
      {error ? (
        <p className="mt-1.5 text-[10px] text-rose-700">{error}</p>
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
