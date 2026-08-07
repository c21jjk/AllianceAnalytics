"use client";

import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  deleteListingNoteAction,
  loadListingNoteThreadAction,
  saveListingNoteAndHoldAction,
  MAX_NOTE_LENGTH,
  type ClientNoteEntry,
} from "@/app/(app)/listings/note-actions";

/**
 * 2026-08-07 (John): "I think there needs to be some sort of simple 'notes'
 * section for each listing so Cheryl, Larissa and I can say something about a
 * particular property post... Just want something where Larissa can say
 * something like 'I'm going to do a live video for this one'."
 *
 * Two pieces that share one open/closed state but live in DIFFERENT columns of
 * the milestone row — the quiet one-liner sits under the agent name in the body
 * column, the labelled NOTES control sits under the Posted checkbox in the
 * action column. Hence the tiny context: <ListingNoteProvider> wraps the row,
 * <ListingNoteLine> and <ListingNoteButton> drop into their respective columns.
 *
 * Design decisions John approved from the 8/07 mockup:
 *   - The NOTES caption always shows, even with no notes. It costs ~10px of row
 *     height and is what makes the feature findable without being told.
 *   - The icon fills SOLID the moment a note exists — that's the at-a-glance
 *     signal. Near-black, not gold: gold is doing primary-action duty on the
 *     Build buttons right above it and shouldn't compete.
 *   - Amber is reserved exclusively for hold.
 *   - The panel opens INLINE inside the row. It never floats over the section
 *     below — same reason the skip-reason menu moved inline on 8/05.
 */

export interface ListingNoteLatest {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
}

export interface ListingNoteHold {
  set_at: string;
  set_by_name: string;
}

interface NoteContextValue {
  mlsNumber: string;
  latest: ListingNoteLatest | null;
  count: number;
  hold: ListingNoteHold | null;
  open: boolean;
  setOpen: (next: boolean) => void;
  /** Property detail page: the thread is the point of the card, so it can't
   *  be collapsed and the Hide/Cancel affordances are suppressed. */
  pinned: boolean;
}

const NoteContext = createContext<NoteContextValue | null>(null);

function useNoteContext(): NoteContextValue | null {
  return useContext(NoteContext);
}

export function ListingNoteProvider({
  mlsNumber,
  latest = null,
  count = 0,
  hold = null,
  pinned = false,
  children,
}: {
  mlsNumber: string;
  latest?: ListingNoteLatest | null;
  count?: number;
  hold?: ListingNoteHold | null;
  pinned?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(pinned);
  return (
    <NoteContext.Provider
      value={{ mlsNumber, latest, count, hold, open: open || pinned, setOpen, pinned }}
    >
      {children}
    </NoteContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* The labelled control that lives in the action column                       */
/* -------------------------------------------------------------------------- */

export function ListingNoteButton({ className }: { className?: string }) {
  const ctx = useNoteContext();
  if (!ctx) return null;
  const { count, hold, open, setOpen } = ctx;

  const hasNotes = count > 0;
  const held = Boolean(hold);

  const title = held
    ? `On hold — set by ${hold?.set_by_name}. ${count} note${count === 1 ? "" : "s"}.`
    : hasNotes
      ? `${count} note${count === 1 ? "" : "s"} on this listing`
      : "Add a note for the team";

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={title}
      title={title}
      onClick={(e) => {
        // Milestone rows are full of links; don't navigate on click.
        e.preventDefault();
        e.stopPropagation();
        setOpen(!open);
      }}
      className={clsx(
        // No margin utility here on purpose — callers position it. Baking in
        // `ml-auto` and overriding it with `ml-0` from a caller is a coin flip
        // (equal specificity, resolved by stylesheet order, not prop order).
        "flex flex-col items-center gap-px shrink-0 px-0.5 leading-none transition-colors",
        held
          ? "text-amber-700"
          : hasNotes
            ? "text-neutral-700 hover:text-neutral-900"
            : "text-neutral-400 hover:text-neutral-700",
        className,
      )}
    >
      {hasNotes || held ? <NoteGlyphSolid /> : <NoteGlyphOutline />}
      <span className="text-[8.5px] font-semibold uppercase tracking-[0.07em]">
        Notes
        {count > 1 ? (
          <span className="tabular-nums"> {count}</span>
        ) : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* The one-liner + inline panel that live in the body column                  */
/* -------------------------------------------------------------------------- */

export function ListingNoteLine() {
  const ctx = useNoteContext();
  if (!ctx) return null;
  const { latest, count, hold, open, setOpen } = ctx;

  // Nothing to say — render nothing at all. Rows without notes must look
  // exactly like they did before this feature existed.
  if (!latest && !hold) return null;

  return (
    <>
      {latest ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(!open);
          }}
          className="group mt-1.5 flex w-full items-center gap-1.5 text-left text-[11px] text-neutral-500 overflow-hidden"
        >
          <MiniGlyph held={Boolean(hold)} />
          <span className="shrink-0 font-medium text-neutral-700">
            {latest.author_name} · {shortAgo(latest.created_at)}
          </span>
          <span className="truncate group-hover:underline underline-offset-2">
            — {latest.body}
          </span>
          {count > 1 ? (
            <span className="shrink-0 text-neutral-400 tabular-nums">
              +{count - 1}
            </span>
          ) : null}
        </button>
      ) : hold ? (
        // Held with no note written — still say so, or the HOLD chip on the
        // address line has no explanation anywhere.
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className="mt-1.5 flex items-center gap-1.5 text-left text-[11px] text-amber-700"
        >
          <MiniGlyph held />
          <span className="font-medium">
            On hold — set by {hold.set_by_name}
          </span>
        </button>
      ) : null}
    </>
  );
}

/**
 * The expanded thread. Deliberately a SEPARATE component from the one-liner so
 * the row can render it full-width underneath the whole grid rather than inside
 * the narrow body column — the milestone cards sit in a half-width dashboard
 * column, so a note thread squeezed into `1fr` of that would be ~260px wide and
 * unreadable. Renders nothing when closed.
 */
export function ListingNotePanel() {
  const ctx = useNoteContext();
  if (!ctx?.open) return null;
  return <NotePanel />;
}

/**
 * Property-detail variant: a titled card with the thread permanently open.
 * Self-contained — it loads its own thread, so the page doesn't have to fetch
 * anything to render it.
 */
export function ListingNoteCard({ mlsNumber }: { mlsNumber: string }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500 mb-2">
        Notes
      </div>
      <ListingNoteProvider mlsNumber={mlsNumber} pinned>
        <ListingNotePanel />
      </ListingNoteProvider>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

function NotePanel() {
  const ctx = useNoteContext();
  const [entries, setEntries] = useState<ClientNoteEntry[] | null>(null);
  // `held` is the checkbox; `serverHeld` is what's actually stored. The two
  // must be tracked separately or "Save" can't tell a real change from the
  // freshly-loaded value — on the property page the panel mounts with no
  // server-supplied hold and would otherwise think every held listing had
  // just been toggled.
  const [held, setHeld] = useState<boolean>(Boolean(ctx?.hold));
  const [serverHeld, setServerHeld] = useState<boolean>(Boolean(ctx?.hold));
  const [serverHoldBy, setServerHoldBy] = useState<string | null>(
    ctx?.hold?.set_by_name ?? null,
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const mlsNumber = ctx?.mlsNumber ?? "";

  const load = useCallback(async () => {
    if (!mlsNumber) return;
    setLoading(true);
    const res = await loadListingNoteThreadAction(mlsNumber);
    if (res.ok) {
      setEntries(res.entries ?? []);
      setHeld(Boolean(res.held));
      setServerHeld(Boolean(res.held));
      setServerHoldBy(res.hold_label ?? null);
      setError(null);
    } else {
      setError(res.error ?? "Couldn't load notes.");
    }
    setLoading(false);
  }, [mlsNumber]);

  // Fetch the thread on open rather than shipping every note for every listing
  // in the dashboard payload. The collapsed row only needs the newest entry.
  useEffect(() => {
    void load();
  }, [load]);

  if (!ctx) return null;

  const remaining = MAX_NOTE_LENGTH - draft.trim().length;
  const holdChanged = held !== serverHeld;
  const canSave = (draft.trim().length > 0 || holdChanged) && remaining >= 0;

  function handleSave() {
    if (!canSave || isPending) return;
    setError(null);
    startTransition(async () => {
      const res = await saveListingNoteAndHoldAction(mlsNumber, draft, held);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setDraft("");
      await load();
    });
  }

  function handleDelete(noteId: string) {
    if (isPending) return;
    setError(null);
    // Optimistic — the row disappears immediately and comes back if the
    // server disagrees.
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== noteId) : prev));
    startTransition(async () => {
      const res = await deleteListingNoteAction(noteId, mlsNumber);
      if (!res.ok) setError(res.error ?? "Couldn't delete.");
      await load();
    });
  }

  return (
    <div
      className={clsx(
        "rounded-[10px] border p-2.5",
        ctx.pinned ? "" : "mb-3 shadow-card animate-fade-in-up",
        held ? "border-amber-200 bg-amber-50/40" : "border-neutral-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-neutral-500">
          Notes
          {entries && entries.length > 0 ? ` · ${entries.length}` : ""}
        </span>
        {ctx.pinned ? null : (
          <button
            type="button"
            onClick={() => ctx.setOpen(false)}
            className="text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2"
          >
            Hide
          </button>
        )}
      </div>

      {loading && entries === null ? (
        <p className="py-1 text-[11px] text-neutral-400">Loading…</p>
      ) : entries && entries.length === 0 ? (
        <p className="py-1 text-[11px] text-neutral-400">
          No notes yet. First one goes below.
        </p>
      ) : (
        <div>
          {(entries ?? []).map((entry, idx) => (
            <div
              key={entry.id}
              className={clsx(
                "relative py-1.5",
                idx > 0 && "border-t border-neutral-100",
              )}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold text-neutral-800">
                  {entry.author_name}
                </span>
                <span className="text-[10px] text-neutral-400">
                  {longWhen(entry.created_at)}
                </span>
              </div>
              <p className="pr-4 text-[12px] leading-[1.45] text-neutral-700 whitespace-pre-wrap break-words">
                {entry.body}
              </p>
              {entry.is_mine ? (
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  disabled={isPending}
                  title="Delete your note"
                  aria-label="Delete your note"
                  className="absolute right-0 top-1.5 text-[12px] leading-none text-neutral-300 hover:text-neutral-600 disabled:opacity-40"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Hold — the one control here allowed to be loud, because the cost of
          missing it is a post going out that shouldn't have. */}
      <label
        className={clsx(
          "mt-2 flex items-center gap-2 rounded-[7px] border px-2 py-1.5 text-[11px] font-medium cursor-pointer select-none",
          held
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-neutral-200 bg-neutral-50 text-neutral-600",
        )}
      >
        <input
          type="checkbox"
          checked={held}
          onChange={(e) => setHeld(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={clsx(
            "grid place-items-center w-3.5 h-3.5 rounded-[3px] border shrink-0",
            held
              ? "border-amber-700 bg-amber-700 text-white"
              : "border-neutral-300 bg-white",
          )}
        >
          {held ? <CheckGlyph /> : null}
        </span>
        Hold — don&rsquo;t post yet
        {serverHeld && serverHoldBy ? (
          <span className="ml-auto text-[10px] font-normal opacity-80">
            set by {serverHoldBy}
          </span>
        ) : null}
      </label>

      <div className="mt-2">
        <textarea
          rows={2}
          value={draft}
          maxLength={MAX_NOTE_LENGTH + 40}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for the team…"
          className="w-full rounded-[7px] border border-neutral-200 px-2 py-1.5 text-[12px] leading-[1.45] text-neutral-800 placeholder:text-neutral-400 resize-none focus:outline-none focus:border-gold-300 focus:ring-2 focus:ring-gold-500/15"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className={clsx(
              "text-[10px] tabular-nums",
              remaining < 0 ? "text-red-700" : "text-neutral-400",
            )}
          >
            {draft.trim().length} / {MAX_NOTE_LENGTH}
          </span>
          {error ? (
            <span className="text-[10px] text-red-700">{error}</span>
          ) : null}
          {ctx.pinned ? (
            <span className="ml-auto" />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setHeld(serverHeld);
                ctx.setOpen(false);
              }}
              className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isPending}
            className="rounded-md bg-neutral-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-neutral-900"
          >
            {isPending
              ? "Saving…"
              : draft.trim()
                ? "Save note"
                : holdChanged
                  ? held
                    ? "Set hold"
                    : "Release hold"
                  : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Standalone HOLD chip for the address line                                  */
/* -------------------------------------------------------------------------- */

export function ListingHoldChip({ className }: { className?: string }) {
  const ctx = useNoteContext();
  if (!ctx?.hold) return null;
  return (
    <span
      title={`On hold — set by ${ctx.hold.set_by_name}. Notes explain why.`}
      className={clsx(
        "ml-1.5 inline-flex items-center align-[1px] rounded px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-800 bg-amber-50 ring-1 ring-amber-200",
        className,
      )}
    >
      Hold
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs + time helpers                                                      */
/* -------------------------------------------------------------------------- */

function NoteGlyphOutline() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function NoteGlyphSolid() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      {/* The fold, knocked out in the card background so the shape still reads
          as a document at 15px rather than a filled blob. */}
      <path
        d="M14 2v6h6"
        fill="none"
        stroke="#FBF8EF"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniGlyph({ held = false }: { held?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="currentColor"
      className={clsx("shrink-0", held ? "text-amber-700" : "text-neutral-500")}
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path
        d="M14 2v6h6"
        fill="none"
        stroke="#FBF8EF"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={9}
      height={9}
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** "just now" / "4h" / "2d" / "Aug 5" — the collapsed one-liner stamp. */
function shortAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * "Today, 8:12 AM" / "Yesterday, 4:47 PM" / "Aug 5, 11:20 AM" — the expanded
 * thread stamp. Pinned to Eastern per the standing render-path timezone rule.
 */
function longWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  const dayKey = (x: Date) =>
    x.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return `Today, ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })}, ${time}`;
}
