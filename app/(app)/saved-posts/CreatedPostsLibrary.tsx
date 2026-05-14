"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { deleteGeneratedPostAction } from "@/app/(app)/post-builder/actions";
import type {
  CreatedPostRow,
  CreatedPostsLibraryQuery,
  CreatedPostsLibraryResult,
} from "@/lib/data/created-posts-db";
import type { PostType, SourceMls } from "@/lib/post-builder/types";

/**
 * Client surface for /saved-posts — owns the filter form + bulk-select +
 * single delete. The data itself was fetched server-side and handed in via
 * `initialResult`; filter changes round-trip through the URL so the server
 * page re-fetches with the new params (router.push to /saved-posts?…).
 */

const POST_TYPE_DISPLAY: Record<PostType, string> = {
  just_listed: "Just Listed",
  just_sold: "Just Sold",
  under_contract: "Under Contract",
  open_house: "Open House",
  price_reduction: "Price Reduced",
};

const VALID_POST_TYPES: PostType[] = [
  "just_listed",
  "open_house",
  "price_reduction",
  "under_contract",
  "just_sold",
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "posted", label: "Posted" },
  { value: "downloaded", label: "Downloaded" },
];

const SOURCE_MLS_OPTIONS: Array<{ value: Exclude<SourceMls, null>; label: string }> = [
  { value: "cmc", label: "CMC" },
  { value: "sjsr", label: "SJSR" },
  { value: "bright", label: "Bright" },
  { value: "manual", label: "Manual" },
];

interface Props {
  initialResult: CreatedPostsLibraryResult;
  initialQuery: CreatedPostsLibraryQuery;
}

export default function CreatedPostsLibrary({
  initialResult,
  initialQuery,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<CreatedPostRow[]>(initialResult.rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // why: track text-search locally so the input feels responsive — only
  // commit to URL on submit/blur, not on every keystroke. Keeps the page
  // from re-rendering 12 times per word.
  const [searchValue, setSearchValue] = useState<string>(initialQuery.q ?? "");

  const total = initialResult.total;
  const pageSize = initialResult.pageSize;
  const page = initialResult.page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Active filter set — used to highlight the current chip selection.
  const activeTypes = new Set(initialQuery.postTypes ?? []);
  const activeStatuses = new Set(initialQuery.statuses ?? []);
  const activeSources = new Set(initialQuery.sourceMls ?? []);

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    // Always reset to page 0 on filter change so the user doesn't land on a
    // page that no longer exists with the narrower result set.
    params.delete("page");
    startTransition(() => {
      router.push(`/saved-posts?${params.toString()}`);
    });
  }

  function toggleParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const existing = params.getAll(key);
    if (existing.includes(value)) {
      params.delete(key);
      for (const v of existing) {
        if (v !== value) params.append(key, v);
      }
    } else {
      params.append(key, value);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`/saved-posts?${params.toString()}`);
    });
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 0) {
      params.delete("page");
    } else {
      params.set("page", String(p));
    }
    startTransition(() => {
      router.push(`/saved-posts?${params.toString()}`);
    });
  }

  function applySearch() {
    pushParams((p) => {
      if (searchValue.trim().length > 0) p.set("q", searchValue.trim());
      else p.delete("q");
    });
  }

  function clearAllFilters() {
    startTransition(() => {
      setSearchValue("");
      router.push(`/saved-posts`);
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleDelete(ids: string[]) {
    if (ids.length === 0) return;
    setErrorMsg(null);
    // Optimistic remove. If any fail, we'd need to re-fetch; for now we
    // just surface the first failure and refresh from server.
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelected(new Set());
    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) => deleteGeneratedPostAction({ id })),
      );
      const firstFail = results.findIndex((r) => !r.ok);
      if (firstFail !== -1) {
        const fail = results[firstFail];
        setErrorMsg(
          `Delete failed: ${fail.ok ? "unknown" : fail.error}. Refreshing list.`,
        );
        setRows(snapshot);
      }
      router.refresh();
    });
  }

  const filterChipBase =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 transition";

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        {/* Search row */}
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearch();
              }
            }}
            onBlur={applySearch}
            placeholder="Search by MLS # or caption…"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
          />
          <button
            type="button"
            onClick={clearAllFilters}
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          >
            Clear filters
          </button>
        </div>

        {/* Chip rows */}
        <FilterRow label="Post type">
          {VALID_POST_TYPES.map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => toggleParam("postType", pt)}
              className={[
                filterChipBase,
                activeTypes.has(pt)
                  ? "bg-gold-100 ring-gold-400 text-gold-900"
                  : "bg-white ring-neutral-200 text-neutral-700 hover:bg-neutral-50",
              ].join(" ")}
            >
              {POST_TYPE_DISPLAY[pt]}
            </button>
          ))}
        </FilterRow>

        <FilterRow label="Status">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => toggleParam("status", s.value)}
              className={[
                filterChipBase,
                activeStatuses.has(s.value)
                  ? "bg-gold-100 ring-gold-400 text-gold-900"
                  : "bg-white ring-neutral-200 text-neutral-700 hover:bg-neutral-50",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </FilterRow>

        <FilterRow label="Source">
          {SOURCE_MLS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => toggleParam("sourceMls", s.value)}
              className={[
                filterChipBase,
                activeSources.has(s.value)
                  ? "bg-gold-100 ring-gold-400 text-gold-900"
                  : "bg-white ring-neutral-200 text-neutral-700 hover:bg-neutral-50",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </FilterRow>
      </div>

      {/* Bulk action toolbar — appears when selection is non-empty */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
          <span>
            {selected.size} selected
            <button
              type="button"
              onClick={clearSelection}
              className="ml-3 text-neutral-300 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </span>
          <button
            type="button"
            onClick={() => handleDelete([...selected])}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {isPending ? "Deleting…" : `Delete ${selected.size}`}
          </button>
        </div>
      ) : null}

      {errorMsg ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {errorMsg}
        </div>
      ) : null}

      {/* Result count + select-all */}
      <div className="flex items-center justify-between text-sm text-neutral-600">
        <div>
          {total === 0
            ? "No saved posts match these filters."
            : `${total} saved ${total === 1 ? "post" : "posts"}`}
          {total > 0 ? (
            <>
              {" "}· Page {page + 1} of {totalPages}
            </>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={selectAllOnPage}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            Select all on page
          </button>
        ) : null}
      </div>

      {/* Grid */}
      {rows.length === 0 ? (
        <EmptyState hasFilters={initialQueryHasAnyFilter(initialQuery)} />
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {rows.map((p) => (
            <li key={p.id}>
              <LibraryCard
                post={p}
                isSelected={selected.has(p.id)}
                onToggleSelect={() => toggleSelected(p.id)}
                onDelete={() => handleDelete([p.id])}
                disabled={isPending}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 0}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-neutral-600 tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page + 1 >= totalPages}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 sm:w-16 sm:shrink-0">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function initialQueryHasAnyFilter(q: CreatedPostsLibraryQuery): boolean {
  return Boolean(
    q.q ||
      (q.postTypes && q.postTypes.length > 0) ||
      (q.statuses && q.statuses.length > 0) ||
      (q.sourceMls && q.sourceMls.length > 0) ||
      q.updatedSince,
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-6 py-10 text-center">
        <div className="text-sm font-medium text-neutral-700">
          Nothing matches these filters.
        </div>
        <div className="mt-1 text-sm text-neutral-500">
          Try clearing one or two of the chips above.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-6 py-10 text-center">
      <div className="text-sm font-medium text-neutral-700">
        You haven&rsquo;t saved any posts in Studio yet.
      </div>
      <div className="mt-1 text-sm text-neutral-500">
        Open a listing in the{" "}
        <Link
          href="/post-builder"
          className="font-medium text-gold-800 underline-offset-2 hover:underline"
        >
          Post Builder
        </Link>{" "}
        and hit Save in Studio — the post will show up here.
      </div>
    </div>
  );
}

interface LibraryCardProps {
  post: CreatedPostRow;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  disabled: boolean;
}

function LibraryCard({
  post,
  isSelected,
  onToggleSelect,
  onDelete,
  disabled,
}: LibraryCardProps) {
  const [confirming, setConfirming] = useState(false);
  const relative = useMemo(() => relativeTime(post.updated_at), [post.updated_at]);
  return (
    <div
      className={[
        "relative rounded-lg overflow-hidden border bg-white shadow-card transition",
        isSelected
          ? "border-gold-500 ring-2 ring-gold-400/40"
          : "border-neutral-200 hover:border-gold-300 hover:shadow-card-hover",
      ].join(" ")}
    >
      <Link href={`/post-builder?gp=${post.id}`} className="block">
        <div className="aspect-[4/5] bg-neutral-100 relative">
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400">
              No image
            </div>
          )}
          <StatusBadge post={post} />
        </div>
        <div className="px-2.5 py-2 space-y-1">
          <div className="text-[11px] font-mono text-neutral-700 truncate">
            #{post.mls_number}
          </div>
          <div className="text-[11px] text-neutral-500 truncate">
            {POST_TYPE_DISPLAY[post.post_type]} · {fmtFormat(post.format)} · {post.variant}
          </div>
          <div className="text-[11px] text-neutral-500">Edited {relative}</div>
        </div>
      </Link>

      {/* Select checkbox top-left, sitting above the status badge column */}
      <label className="absolute top-1.5 left-1.5 flex items-center justify-center w-6 h-6 rounded-md bg-white/90 ring-1 ring-neutral-300 backdrop-blur-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-3.5 h-3.5 accent-gold-600"
          aria-label="Select this post"
        />
      </label>

      {/* Delete top-right */}
      <div className="absolute top-1.5 right-1.5">
        {confirming ? (
          <div className="flex items-center gap-1 rounded-md bg-white/95 ring-1 ring-rose-300 backdrop-blur-sm px-1.5 py-1 shadow-md">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
                setConfirming(false);
              }}
              disabled={disabled}
              className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 hover:text-rose-900 disabled:opacity-60"
            >
              {disabled ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirming(false);
              }}
              className="text-[10px] text-neutral-500 hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirming(true);
            }}
            className="inline-flex items-center justify-center rounded-md bg-white/85 ring-1 ring-neutral-300 backdrop-blur-sm px-1.5 py-1 text-neutral-700 hover:text-rose-700 hover:ring-rose-300 transition"
            aria-label="Delete saved post"
            title="Delete this saved post"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 4h11M6.5 4V2.5h3V4M3.5 4l.7 9a1 1 0 001 .9h5.6a1 1 0 001-.9l.7-9M6.5 7v4M9.5 7v4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ post }: { post: CreatedPostRow }) {
  if (post.is_posted) {
    return (
      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Posted
      </span>
    );
  }
  if (post.status === "scheduled") {
    return (
      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Scheduled
      </span>
    );
  }
  return (
    <span className="absolute bottom-1.5 left-1.5 inline-flex items-center rounded-md bg-neutral-900/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
      Draft
    </span>
  );
}

function fmtFormat(f: CreatedPostRow["format"]): string {
  if (f === "square_1x1") return "1:1";
  if (f === "portrait_4x5") return "4:5";
  return "9:16";
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
