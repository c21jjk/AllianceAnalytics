"use client";

/**
 * AddOpenHouseModal — manually schedule an Open House for a listing.
 *
 * Task 18 (2026-07-17). Shared by the Multi-OH wizard (Step 1) and the Post
 * Builder's Open House tab. Flow:
 *
 *   1. Search — one box matches street address, MLS #, or listing agent
 *      (searchListingsForOpenHouseAction ORs all three server-side).
 *   2. Pick — choosing a result loads that property's existing upcoming
 *      sessions so duplicates are visible before adding.
 *   3. Sessions — one or more Day + Start + End rows ("+ Add another day").
 *   4. Save — rows land in open_houses with feed_short_code='manual';
 *      every OH surface (builder bucket, wizard, dashboard) reads that
 *      table, so the property appears immediately after refresh.
 *
 * Manual sessions can be deleted here; feed-sourced ones (cmc/sjsr/bright)
 * are shown read-only — their sync owns them.
 *
 * Times are entered in the browser's local timezone (Larissa is ET) and
 * converted to UTC ISO on save — the same convention post scheduling uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Trash2, Search, CalendarPlus } from "lucide-react";
import {
  searchListingsForOpenHouseAction,
  getOpenHouseSessionsForPropertyAction,
  addManualOpenHouseSessionsAction,
  deleteManualOpenHouseAction,
  type OhSearchResult,
  type OhSessionRow,
} from "@/app/(app)/post-builder/open-house-actions";

interface SessionDraft {
  /** YYYY-MM-DD from <input type="date"> */
  date: string;
  /** HH:mm from <input type="time"> */
  startTime: string;
  /** HH:mm from <input type="time"> */
  endTime: string;
}

export interface AddOpenHouseModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires after a successful save or delete so the parent can refresh its
   *  listing data (typically router.refresh()). */
  onSaved: () => void;
}

const EMPTY_DRAFT: SessionDraft = { date: "", startTime: "", endTime: "" };

/** Format a UTC ISO into "Sat, Jul 18 · 12:00 PM – 2:00 PM" (browser-local). */
function formatSession(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return startIso;
  const day = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const t = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const end = endIso ? new Date(endIso) : null;
  return end && !Number.isNaN(end.getTime())
    ? `${day} · ${t(start)} – ${t(end)}`
    : `${day} · ${t(start)}`;
}

export default function AddOpenHouseModal({
  open,
  onClose,
  onSaved,
}: AddOpenHouseModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OhSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<OhSearchResult | null>(null);
  const [existing, setExisting] = useState<OhSessionRow[]>([]);
  const [drafts, setDrafts] = useState<SessionDraft[]>([{ ...EMPTY_DRAFT }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  // why: monotonic token so a slow search response can't clobber the
  // results of a newer query the user has since typed.
  const searchSeq = useRef(0);

  // Reset everything when the modal opens fresh.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setPicked(null);
    setExisting([]);
    setDrafts([{ ...EMPTY_DRAFT }]);
    setError(null);
    setSavedFlash(false);
  }, [open]);

  // Debounced search (300ms). Skipped once a property is picked — the
  // search box is hidden at that point.
  useEffect(() => {
    if (!open || picked) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const handle = setTimeout(() => {
      setSearching(true);
      searchListingsForOpenHouseAction(q)
        .then((rows) => {
          if (searchSeq.current === seq) setResults(rows);
        })
        .catch(() => {
          if (searchSeq.current === seq) setResults([]);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [query, open, picked]);

  const loadExisting = useCallback(async (propertyId: string) => {
    try {
      setExisting(await getOpenHouseSessionsForPropertyAction(propertyId));
    } catch {
      setExisting([]);
    }
  }, []);

  const handlePick = useCallback(
    (r: OhSearchResult) => {
      setPicked(r);
      setError(null);
      void loadExisting(r.property_id);
    },
    [loadExisting],
  );

  const updateDraft = useCallback(
    (idx: number, patch: Partial<SessionDraft>) => {
      setDrafts((prev) =>
        prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
      );
    },
    [],
  );

  /** Client-side validation mirror; the action re-validates server-side. */
  const draftProblem = useMemo<string | null>(() => {
    const filled = drafts.filter(
      (d) => d.date || d.startTime || d.endTime,
    );
    if (filled.length === 0) return "Add at least one day and time.";
    for (const d of filled) {
      if (!d.date || !d.startTime || !d.endTime) {
        return "Each session needs a date, start time, and end time.";
      }
      const start = Date.parse(`${d.date}T${d.startTime}`);
      const end = Date.parse(`${d.date}T${d.endTime}`);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return "One of the dates or times is invalid.";
      }
      if (end <= start) return "End time must be after the start time.";
      if (start < Date.now() - 12 * 3600_000) {
        return "Open house dates must not be in the past.";
      }
    }
    return null;
  }, [drafts]);

  const handleSave = useCallback(async () => {
    if (!picked || draftProblem) return;
    setSaving(true);
    setError(null);
    const sessions = drafts
      .filter((d) => d.date && d.startTime && d.endTime)
      .map((d) => ({
        start_at: new Date(`${d.date}T${d.startTime}`).toISOString(),
        end_at: new Date(`${d.date}T${d.endTime}`).toISOString(),
      }));
    try {
      const res = await addManualOpenHouseSessionsAction(
        picked.property_id,
        sessions,
      );
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setSavedFlash(true);
      setDrafts([{ ...EMPTY_DRAFT }]);
      await loadExisting(picked.property_id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [picked, drafts, draftProblem, loadExisting, onSaved]);

  const handleDeleteExisting = useCallback(
    async (id: string) => {
      if (!picked) return;
      setError(null);
      const res = await deleteManualOpenHouseAction(id);
      if (!res.ok) {
        setError(res.error ?? "Delete failed.");
        return;
      }
      await loadExisting(picked.property_id);
      onSaved();
    },
    [picked, loadExisting, onSaved],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Open House"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarPlus size={18} className="text-gold-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-neutral-900">
              Add Open House
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* 1 — property search (hidden once picked) */}
          {!picked ? (
            <div>
              <label
                htmlFor="oh-search"
                className="mb-1 block text-xs font-medium text-neutral-600"
              >
                Find the listing — address, MLS #, or listing agent
              </label>
              <div className="relative">
                <Search
                  size={15}
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  id="oh-search"
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. 71 Palmer, NJBL2114898, or Barbara Hunt"
                  className="input w-full pl-9 text-sm"
                />
              </div>
              {searching ? (
                <div className="mt-2 text-xs text-neutral-500">Searching…</div>
              ) : null}
              {!searching && query.trim().length >= 2 && results.length === 0 ? (
                <div className="mt-2 text-xs text-neutral-500">
                  No active listings match. Check the spelling — only active
                  listings can host an open house.
                </div>
              ) : null}
              {results.length > 0 ? (
                <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 overflow-hidden">
                  {results.map((r) => (
                    <li key={r.property_id}>
                      <button
                        type="button"
                        onClick={() => handlePick(r)}
                        className="flex w-full items-center gap-3 bg-white px-3 py-2 text-left hover:bg-gold-50/50 transition"
                      >
                        {r.hero_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.hero_image_url}
                            alt=""
                            className="h-10 w-10 flex-none rounded object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 flex-none rounded bg-neutral-100" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-neutral-900">
                            {r.address ?? r.mls_number}
                            {r.unit_number ? ` · ${r.unit_number}` : ""}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            {[r.city, r.mls_number, r.agent_name]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {typeof r.list_price === "number" ? (
                          <span className="flex-none text-xs font-semibold text-neutral-700">
                            ${r.list_price.toLocaleString()}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <>
              {/* Picked property card */}
              <div className="flex items-center gap-3 rounded-lg border border-gold-300 bg-gold-50/40 p-3">
                {picked.hero_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={picked.hero_image_url}
                    alt=""
                    className="h-12 w-12 flex-none rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 flex-none rounded bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-neutral-900">
                    {picked.address ?? picked.mls_number}
                    {picked.unit_number ? ` · ${picked.unit_number}` : ""}
                  </div>
                  <div className="truncate text-xs text-neutral-600">
                    {[picked.city, picked.mls_number, picked.agent_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    setExisting([]);
                    setError(null);
                  }}
                  className="flex-none text-xs font-medium text-neutral-500 hover:text-neutral-800 transition"
                >
                  Change
                </button>
              </div>

              {/* Existing sessions */}
              {existing.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-neutral-600">
                    Already scheduled
                  </div>
                  <ul className="space-y-1">
                    {existing.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5"
                      >
                        <span className="text-xs text-neutral-800">
                          {formatSession(s.start_at, s.end_at)}
                        </span>
                        {s.feed_short_code === "manual" ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteExisting(s.id)}
                            aria-label="Remove this manual session"
                            className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                            {s.feed_short_code}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* New session rows */}
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-600">
                  New day(s) &amp; time(s)
                </div>
                <div className="space-y-2">
                  {drafts.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="date"
                        value={d.date}
                        onChange={(e) => updateDraft(i, { date: e.target.value })}
                        className="input flex-1 text-sm"
                        aria-label={`Session ${i + 1} date`}
                      />
                      <input
                        type="time"
                        value={d.startTime}
                        onChange={(e) =>
                          updateDraft(i, { startTime: e.target.value })
                        }
                        className="input w-[104px] text-sm"
                        aria-label={`Session ${i + 1} start time`}
                      />
                      <span className="text-xs text-neutral-400">–</span>
                      <input
                        type="time"
                        value={d.endTime}
                        onChange={(e) =>
                          updateDraft(i, { endTime: e.target.value })
                        }
                        className="input w-[104px] text-sm"
                        aria-label={`Session ${i + 1} end time`}
                      />
                      {drafts.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((prev) => prev.filter((_, j) => j !== i))
                          }
                          aria-label={`Remove session ${i + 1}`}
                          className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => [...prev, { ...EMPTY_DRAFT }])}
                  disabled={drafts.length >= 10}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gold-700 hover:text-gold-900 disabled:opacity-50 transition"
                >
                  <Plus size={13} aria-hidden="true" />
                  Add another day
                </button>
              </div>
            </>
          )}

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          ) : null}
          {savedFlash && !error ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Saved — this open house now shows everywhere open houses are
              listed. Add more days above, or close this window.
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition"
          >
            {savedFlash ? "Done" : "Cancel"}
          </button>
          {picked ? (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !!draftProblem}
              title={draftProblem ?? undefined}
              className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {saving ? "Saving…" : "Save Open House"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
