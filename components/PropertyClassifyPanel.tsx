"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { PostCategory, PostLinkMethod, PropertyRef } from "@/lib/types/post";
import type { AudienceScope } from "@/lib/types/group";
import {
  setGroupAudienceScopeAction,
  setGroupCategoryAction,
  setGroupPropertiesAction,
  type GroupCategory,
} from "@/app/(app)/groups/actions";
import { classifyPostAction } from "@/app/(app)/listings/actions";
import { formatCurrency } from "@/lib/format";

interface ListingResult {
  mls_number: string;
  address: string;
  city: string | null;
  state: string | null;
  list_price: number | null;
  status: string;
  hero_image_url: string | null;
}

export interface OfficeOption {
  id: string;
  short_code: string;
  name: string;
}

interface Props {
  postId: string;
  /** Group id — required for group-level cascading writes (category /
   *  audience / linked listing). When null (singleton post), the audience
   *  and category controls are read-only. */
  groupId?: string | null;
  initialProperty?: PropertyRef;
  initialCategory?: PostCategory;
  initialLinkMethod?: PostLinkMethod;
  initialAgentName?: string;
  /** Active offices — drives the Audience dropdown's per-office options. */
  offices?: OfficeOption[];
  /** Currently saved audience_scope on the group (or null). */
  initialAudienceScope?: AudienceScope | null;
}

const CATEGORY_OPTIONS: Array<{
  value: PostCategory;
  label: string;
}> = [
  { value: "property", label: "Property Promotion" },
  { value: "agent", label: "Agent Promotion" },
  { value: "marketing", label: "Company Promotion" },
  { value: "educational", label: "Real Estate Educational Tips" },
  { value: "sold", label: "Sold / Just Sold" },
  { value: "community", label: "Community / Local" },
  { value: "other", label: "Other" },
];

const DIVISION_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: "shore", label: "Shore Division" },
  { slug: "south_jersey", label: "South Jersey Division" },
];

const LINK_METHOD_LABEL: Record<PostLinkMethod, string> = {
  manual: "Manually linked",
  auto_mls: "Auto-linked by MLS#",
  auto_address_full: "Auto-linked by full address",
  auto_address_partial: "Auto-linked by address fragment",
};

/**
 * Encode an AudienceScope object to the string form the dropdown uses.
 * Mirrors GroupCardSidebar so both surfaces speak the same vocabulary.
 */
function scopeToString(scope: AudienceScope | null): string {
  if (!scope) return "";
  if (scope.kind === "company") return "company";
  return `${scope.kind}:${scope.value ?? ""}`;
}

export default function PropertyClassifyPanel({
  postId,
  groupId = null,
  initialProperty,
  initialCategory,
  initialLinkMethod,
  initialAgentName,
  offices = [],
  initialAudienceScope = null,
}: Props) {
  const [category, setCategory] = useState<PostCategory>(
    initialCategory ?? (initialProperty ? "property" : "other"),
  );
  const [linkedMls, setLinkedMls] = useState<string | null>(
    initialProperty?.mls ?? null,
  );
  const [linkedRef, setLinkedRef] = useState<PropertyRef | null>(
    initialProperty ?? null,
  );
  const [agentName, setAgentName] = useState<string>(initialAgentName ?? "");
  const [audienceScope, setAudienceScope] = useState<string>(
    scopeToString(initialAudienceScope ?? null),
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const debounceRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showSearch = category === "property" || category === "sold";
  const showAgentName = category === "agent";
  const canEditGroup = Boolean(groupId);

  /** AttachListingCta on the post detail dispatches this event when the user
   *  clicks the top-of-page banner. Bump category to property + focus search. */
  useEffect(() => {
    function onFocus() {
      setCategory((prev) =>
        prev === "property" || prev === "sold" ? prev : "property",
      );
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
    window.addEventListener("attach-listing:focus", onFocus);
    return () => window.removeEventListener("attach-listing:focus", onFocus);
  }, []);

  useEffect(() => {
    if (!showSearch) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
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
        const json = (await res.json()) as { results?: ListingResult[] };
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
  }, [query, showSearch]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const linkMethodLabel = useMemo(() => {
    if (!linkedRef) return null;
    if (!initialLinkMethod) return null;
    return LINK_METHOD_LABEL[initialLinkMethod] ?? null;
  }, [linkedRef, initialLinkMethod]);

  function pickResult(r: ListingResult) {
    setLinkedMls(r.mls_number);
    setLinkedRef({
      mls: r.mls_number,
      address: [r.address, r.city, r.state].filter(Boolean).join(", "),
      list_price:
        r.list_price !== null && r.list_price !== undefined
          ? Number(r.list_price)
          : undefined,
    });
    setQuery("");
    setOpen(false);
  }

  function unlink() {
    setLinkedMls(null);
    setLinkedRef(null);
  }

  /** Orchestrates group-level writes for Category / Audience / Listing plus
   *  the per-post agent_name. Calls each action in sequence; first failure
   *  short-circuits with an error. Saving a singleton group's group-level
   *  fields is gracefully skipped — the per-post agent_name still saves. */
  function save() {
    setError(null);
    setSavedMessage(null);

    const dirtyCategory = category !== initialCategoryResolved;
    const dirtyListing =
      (linkedMls ?? null) !== (initialProperty?.mls ?? null);
    const dirtyAudience =
      audienceScope !== scopeToString(initialAudienceScope ?? null);
    const dirtyAgentName =
      showAgentName && agentName.trim() !== (initialAgentName ?? "").trim();

    startTransition(async () => {
      try {
        // 1) Group category (cascades to all posts)
        if (canEditGroup && dirtyCategory && groupId) {
          const result = await setGroupCategoryAction(
            groupId,
            category as GroupCategory,
          );
          if (!result.ok) {
            setError(result.error ?? "Couldn't save category.");
            return;
          }
        }

        // 2) Group audience_scope
        if (canEditGroup && dirtyAudience && groupId) {
          const scope = audienceScope === "" ? null : audienceScope;
          const result = await setGroupAudienceScopeAction(groupId, scope);
          if (!result.ok) {
            setError(result.error ?? "Couldn't save audience.");
            return;
          }
        }

        // 3) Group linked listing (cascades to all posts)
        if (canEditGroup && dirtyListing && groupId) {
          const mlsList =
            linkedMls && (category === "property" || category === "sold")
              ? [linkedMls]
              : [];
          const result = await setGroupPropertiesAction(groupId, mlsList);
          if (!result.ok) {
            setError(result.error ?? "Couldn't save linked listing.");
            return;
          }
        }

        // 4) Per-post agent_name + category fallback for singleton groups
        if (!canEditGroup || dirtyAgentName) {
          const fd = new FormData();
          fd.set("post_id", postId);
          fd.set("category", category);
          if (
            linkedMls &&
            (category === "property" || category === "sold") &&
            !canEditGroup
          ) {
            fd.set("mls_number", linkedMls);
          }
          if (category === "agent" && agentName.trim().length > 0) {
            fd.set("agent_name", agentName.trim());
          }
          fd.set("office_id", ""); // office_id no longer manually editable
          const result = await classifyPostAction(fd);
          if (!result.ok) {
            setError(result.error ?? "Save failed");
            return;
          }
        }

        setSavedMessage("Saved");
        setTimeout(() => setSavedMessage(null), 2200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  const initialCategoryResolved =
    initialCategory ?? (initialProperty ? "property" : "other");
  const dirty =
    category !== initialCategoryResolved ||
    (linkedMls ?? null) !== (initialProperty?.mls ?? null) ||
    audienceScope !== scopeToString(initialAudienceScope ?? null) ||
    (showAgentName && agentName.trim() !== (initialAgentName ?? "").trim());

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Classify this post
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Tag the listing, category, and audience. These three fields are
            the same ones on the dashboard card — edits sync both ways.
          </p>
        </div>
      </header>

      {/* LINKED LISTING ---------------------------------------------------- */}
      {showSearch ? (
        <div ref={wrapperRef} className="relative">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Linked listing
          </div>

          {linkedRef ? (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-mono text-gold-800">
                  {linkedRef.mls}
                </span>
                <span className="text-sm font-medium text-neutral-900 truncate">
                  {linkedRef.address}
                </span>
                {linkedRef.list_price ? (
                  <span className="text-xs text-gold-700 tabular-nums">
                    {formatCurrency(linkedRef.list_price)}
                  </span>
                ) : null}
                {linkMethodLabel ? (
                  <span className="text-[11px] text-neutral-500 mt-0.5">
                    {linkMethodLabel}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={unlink}
                className="ml-auto text-xs font-medium text-neutral-600 hover:text-rose-700"
              >
                Unlink
              </button>
            </div>
          ) : (
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (results.length > 0) setOpen(true);
              }}
              placeholder="Search MLS# or address (e.g. NJCM231 or 123 Park)…"
              className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
            />
          )}

          {open && !linkedRef && results.length > 0 ? (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg max-h-80 overflow-auto">
              {results.map((r) => (
                <button
                  key={r.mls_number}
                  type="button"
                  onClick={() => pickResult(r)}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-50 flex items-center gap-3 border-b border-neutral-100 last:border-b-0"
                >
                  <div className="relative w-9 h-9 flex-shrink-0 rounded-md bg-neutral-100 overflow-hidden ring-1 ring-neutral-200">
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
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-mono text-neutral-700">
                        {r.mls_number}
                      </span>
                      {r.list_price ? (
                        <span className="text-xs text-gold-700 tabular-nums">
                          {formatCurrency(Number(r.list_price))}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm text-neutral-900 truncate">
                      {r.address}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">
                      {[r.city, r.state].filter(Boolean).join(", ")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {open && !linkedRef && !searching && query.trim().length >= 2 && results.length === 0 ? (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg px-3 py-3 text-xs text-neutral-500">
              No listings found. Make sure the listing was added on the
              {" "}
              <a href="/listings/new" className="underline text-gold-700">
                Listings tab
              </a>
              .
            </div>
          ) : null}
        </div>
      ) : null}

      {/* CATEGORY ---------------------------------------------------------- */}
      <div>
        <label
          htmlFor="classify-category"
          className="block text-xs font-medium uppercase tracking-wide text-neutral-500"
        >
          Category
        </label>
        <select
          id="classify-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as PostCategory)}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* AGENT NAME — only when category is "agent" ------------------------ */}
      {showAgentName ? (
        <div>
          <label
            htmlFor="classify-agent-name"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Agent name
          </label>
          <input
            id="classify-agent-name"
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="e.g. Jane Doe"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
          />
        </div>
      ) : null}

      {/* AUDIENCE — replaces the old "Origin Office" picker ---------------- */}
      <div>
        <label
          htmlFor="classify-audience"
          className="block text-xs font-medium uppercase tracking-wide text-neutral-500"
        >
          Audience
        </label>
        <select
          id="classify-audience"
          value={audienceScope}
          onChange={(e) => setAudienceScope(e.target.value)}
          disabled={!canEditGroup}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 disabled:opacity-60"
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
        <p className="mt-1 text-[11px] text-neutral-500">
          Same audience picker shown on the dashboard card. Edits sync both
          ways.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="btn-primary text-xs disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {savedMessage ? (
          <span className="text-xs font-medium text-emerald-700">
            ✓ {savedMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}
