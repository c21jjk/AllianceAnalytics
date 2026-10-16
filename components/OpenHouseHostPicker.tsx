"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  getHostRosterAction,
  setOpenHouseHostAction,
} from "@/app/(app)/listings/open-house-host-actions";

/**
 * 2026-10-16 (John) — "Hosted by" line on the dashboard Open Houses card,
 * now clickable so the host can be changed before the post is built.
 *
 * Saves to open_houses.host_agent_name for this one occurrence. The Multi-OH
 * wizard and the single Open House render read the same column, so the slide
 * name, phone and headshot follow the pick. Matching uses the same roster and
 * ranking as the wizard's host combobox (Alliance agents first, word-prefix
 * before substring) because attribution resolves by EXACT name.
 */

type Roster = { roster: string[]; priority: string[] };

// One roster fetch per page load, shared by every row on the card.
let rosterPromise: Promise<Roster> | null = null;
function loadRoster(): Promise<Roster> {
  if (!rosterPromise) {
    rosterPromise = getHostRosterAction().catch(() => {
      rosterPromise = null;
      return { roster: [], priority: [] };
    });
  }
  return rosterPromise;
}

const SUGGESTION_LIMIT = 8;

export default function OpenHouseHostPicker({
  openHouseId,
  displayHost,
  savedHost,
}: {
  openHouseId: string;
  /** What the row shows today (saved host, else MLS notes, else listing agent). */
  displayHost: string;
  /** The dashboard-saved host, when one is set. */
  savedHost: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [shown, setShown] = useState(displayHost);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Server refresh after a save hands down the new value.
  useEffect(() => setShown(displayHost), [displayHost]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    let live = true;
    loadRoster().then((r) => {
      if (live) setRoster(r);
    });
    return () => {
      live = false;
    };
  }, [editing]);

  const prioritySet = useMemo(
    () => new Set((roster?.priority ?? []).map((n) => n.toLowerCase())),
    [roster],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!roster || q.length < 1) return [];
    const scored: Array<{ name: string; score: number; order: number }> = [];
    roster.roster.forEach((name, order) => {
      const lower = name.toLowerCase();
      if (!lower.includes(q)) return;
      const startsWord = lower.split(/[\s-]+/).some((w) => w.startsWith(q));
      scored.push({
        name,
        score: (prioritySet.has(lower) ? 0 : 2) + (startsWord ? 0 : 1),
        order,
      });
    });
    scored.sort((a, b) => a.score - b.score || a.order - b.order);
    return scored.slice(0, SUGGESTION_LIMIT).map((e) => e.name);
  }, [query, roster, prioritySet]);

  function save(name: string | null) {
    setError(null);
    const previous = shown;
    if (name) setShown(name);
    setEditing(false);
    setQuery("");
    startTransition(async () => {
      const res = await setOpenHouseHostAction(openHouseId, name);
      if (!res.ok) {
        setShown(previous);
        setError(res.error ?? "Couldn't save.");
      }
    });
  }

  if (!editing) {
    return (
      <div
        style={{
          marginTop: 2,
          fontSize: 11,
          color: "#737373",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span style={{ color: "#a3a3a3" }}>Hosted by </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          title="Change host"
          className="group inline-flex items-center gap-1 text-neutral-900 font-medium hover:underline decoration-dotted underline-offset-2 disabled:opacity-60"
        >
          {shown || "Pick a host"}
          <PencilGlyph />
        </button>
        {error ? (
          <span className="ml-2 text-[10px] text-red-600">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative mt-1" style={{ maxWidth: 280 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
            setQuery("");
          }
          if (e.key === "Enter" && matches.length > 0) {
            e.preventDefault();
            save(matches[0]);
          }
        }}
        // Delay so a click on a suggestion lands before the list unmounts.
        onBlur={() =>
          setTimeout(() => {
            setEditing(false);
            setQuery("");
          }, 150)
        }
        placeholder={shown ? `Hosted by ${shown}` : "Agent name"}
        autoComplete="off"
        className="block w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
      />
      {(matches.length > 0 || savedHost) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          {matches.map((name) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(e) => {
                  e.preventDefault();
                  save(name);
                }}
                className="block w-full px-2.5 py-1.5 text-left text-xs text-neutral-900 hover:bg-gold-50"
              >
                {name}
              </button>
            </li>
          ))}
          {savedHost ? (
            <li className="border-t border-neutral-100">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  save(null);
                }}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-50"
              >
                Reset to MLS host
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="text-neutral-400 group-hover:text-neutral-700"
    >
      <path
        d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
