"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UpcomingOpenHouse } from "@/lib/data/open-houses";
import { formatCurrency } from "@/lib/format";
import { resolveHostingAgent } from "@/lib/open-houses/host-resolution";

interface UpcomingOpenHousesRowProps {
  openHouses: UpcomingOpenHouse[];
  /** Window in days that the parent fetched against. Header copy. */
  windowDays?: number;
  officeShortCode?: string | null;
  /** Count of OHs first seen in the last 24h. Drives the "new" badge. */
  freshCount?: number;
  className?: string;
}

/** localStorage key for the collapsed-state preference.
 *  Default is COLLAPSED. Stored value "0" means the user explicitly
 *  expanded the card and wants it to stay open across reloads. */
const COLLAPSED_KEY = "open-houses-collapsed";

/**
 * Dashboard card listing upcoming Alliance Open Houses. Sits at the top of
 * the right column on the dashboard, above Under Contract and Recently Sold.
 *
 * Sorted chronologically (next OH first). Larissa hits this surface at 4pm
 * Thursdays to see what's running over the weekend and build promo posts.
 *
 * Collapsed by default; freshCount drives a pulsing gold "X new" badge
 * that alerts Larissa when there's news from the last 24 hours.
 */
export default function UpcomingOpenHousesRow({
  openHouses,
  windowDays = 7,
  officeShortCode,
  freshCount = 0,
  className,
}: UpcomingOpenHousesRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "0") setCollapsed(false);
    } catch {
      // localStorage unavailable
    }
    setHydrated(true);
  }, []);

  function handleToggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  const noun = openHouses.length === 1 ? "open house" : "open houses";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-sky-200/70 bg-sky-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="Upcoming Open Houses"
    >
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          aria-controls="open-houses-body"
          className="group min-w-0 flex items-start gap-2 text-left -ml-1 rounded-md px-1 py-0.5 hover:bg-sky-100/60 transition-colors flex-1"
        >
          <ChevronIcon collapsed={collapsed} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 inline-flex items-center flex-wrap gap-2">
              Open Houses
              <span className="text-neutral-400 font-normal">
                · next {windowDays} days · {openHouses.length} {noun}{scope}
              </span>
              {freshCount > 0 ? <FreshBadge count={freshCount} /> : null}
              {collapsed && freshCount === 0 ? (
                <span className="inline-flex items-center rounded-full bg-sky-200/70 ring-1 ring-sky-300 px-2 py-0.5 text-[11px] font-medium text-sky-800 tabular-nums">
                  {openHouses.length}
                </span>
              ) : null}
            </h2>
            {!collapsed ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                {openHouses.length === 0
                  ? "Nothing scheduled in the next " + windowDays + " days."
                  : "Click any open house to make a promo post for it."}
              </p>
            ) : null}
          </div>
        </button>

        {/* Multi-property OH entry point — sibling to the toggle button so
            clicking the CTA doesn't expand/collapse the card.
            why: this used to live in the Post Builder's OH listings column,
            but the dashboard is where Larissa is already scanning open
            houses and deciding what to promote, so the affordance was moved
            here on 2026-05-21. Conditional on having 2+ open houses — below
            that threshold a multi-property post is nonsensical, so the CTA
            simply doesn't render (no muted hint on the dashboard). */}
        {openHouses.length >= 2 ? (
          <Link
            href="/post-builder/multi-oh"
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gold-800 transition hover:border-gold-500 hover:bg-gold-100"
            title="Build a Multi-property Open House post"
            aria-label={`Build Multi-property Open House post (${openHouses.length} open houses)`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* why: 4-house glyph reads as "multiple properties" at a
                  glance — same icon used in the Post Builder predecessor of
                  this CTA so the visual identity stays consistent. */}
              <path d="M2 14h12" />
              <path d="M3 14V9l2-1.5L7 9v5" />
              <path d="M9 14V9l2-1.5L13 9v5" />
            </svg>
            {/* Full label hidden on mobile; the icon + title attribute keep
                the affordance accessible at narrow widths. */}
            <span className="hidden sm:inline">Build Multi-Property Open House</span>
            <span className="rounded-full bg-gold-200/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-900 tabular-nums">
              {openHouses.length}
            </span>
          </Link>
        ) : null}
      </header>

      {!collapsed && hydrated ? (
        <div id="open-houses-body" className="mt-3">
          {openHouses.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              No upcoming Open Houses.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {openHouses.map((oh, idx) => (
                <li key={oh.id}>
                  <OpenHouseRow openHouse={oh} isFirst={idx === 0} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* SSR fallback — render expanded so first paint matches default. */}
      {!hydrated ? (
        <div id="open-houses-body" className="mt-3">
          {openHouses.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              No upcoming Open Houses.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {openHouses.map((oh, idx) => (
                <li key={oh.id}>
                  <OpenHouseRow openHouse={oh} isFirst={idx === 0} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function OpenHouseRow({
  openHouse,
  isFirst,
}: {
  openHouse: UpcomingOpenHouse;
  isFirst: boolean;
}) {
  const cityState = [openHouse.city, openHouse.state]
    .filter(Boolean)
    .join(", ");
  const timeLabel = formatOpenHouseTimeLabel(openHouse.start_at, openHouse.end_at);

  // Building consolidation: a multi-unit building shows as ONE entry. Use the
  // building's display address as the headline and a "N open houses" badge in
  // place of the single-unit identifier.
  const isBuilding = Boolean(
    openHouse.building_id && (openHouse.building_oh_count ?? 1) > 1,
  );
  const headlineAddress = isBuilding
    ? openHouse.building_address ?? openHouse.address ?? "Unknown address"
    : openHouse.address ?? "Unknown address";
  const buildingOhCount = openHouse.building_oh_count ?? 1;

  const propertyHref = `/properties/${encodeURIComponent(openHouse.mls_number)}`;
  // Phase 7 — deep-link straight to Post Builder with the OH template
  // pre-selected. Skips the property-detail → builder hop entirely.
  const buildHref = `/post-builder?mls=${encodeURIComponent(
    openHouse.mls_number,
  )}&postType=open_house`;

  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "56px 1fr auto",
        gap: 14,
        padding: "12px 0",
        borderTop: isFirst ? "none" : "1px solid #ececec",
      }}
    >
      {/* Hero — clickable into property detail */}
      <Link
        href={propertyHref}
        className="block hover:opacity-70 transition-opacity"
        style={{
          width: 56,
          height: 56,
          backgroundColor: "#f4f4f4",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {openHouse.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={openHouse.hero_image_url}
            alt=""
            className="text-transparent"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : null}
      </Link>

      {/* Body — also a link into property detail */}
      <Link
        href={propertyHref}
        className="block hover:opacity-80 transition-opacity"
        style={{ minWidth: 0 }}
      >
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.3,
            color: "#171717",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {headlineAddress}
          {/* Building consolidation: one entry for the whole building, badged
              with the count of open houses across its units. */}
          {isBuilding ? (
            <span
              style={{
                color: "#8a6d1f",
                fontWeight: 600,
                fontSize: 11,
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 999,
                background: "#fbf3da",
                border: "1px solid #ecd9a0",
                whiteSpace: "nowrap",
              }}
            >
              {buildingOhCount} open houses
            </span>
          ) : null}
          {/* 2026-05-22 — condo/townhouse unit identifier so consumers
              know which unit to visit when multiple units at the same
              building show separate OHs. Hidden for collapsed building
              entries (the building label already covers it). */}
          {!isBuilding && openHouse.unit_number ? (
            <span style={{ color: "#525250", fontWeight: 500 }}>
              {" · "}
              {openHouse.unit_number}
            </span>
          ) : null}
          {cityState ? (
            <span style={{ color: "#737373", fontWeight: 400 }}>
              , {cityState}
            </span>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            color: "#737373",
            fontWeight: 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: "#0369a1", fontWeight: 600 }}>
            {timeLabel}
          </span>
          {openHouse.list_price !== null ? (
            <>
              <span style={{ color: "#d4d4d4" }}> · </span>
              <span
                style={{
                  color: "#171717",
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrency(openHouse.list_price)}
              </span>
            </>
          ) : null}
          {openHouse.office_short_code ? (
            <>
              <span style={{ color: "#d4d4d4" }}> · </span>
              <span style={{ color: "#737373" }}>
                {openHouse.office_short_code}
              </span>
            </>
          ) : null}
        </div>
        {(() => {
          // Comments override listing agent: an OH's "Hosted by …" line in
          // the Paragon notes (e.g. "Hosted by PJ Dougherty") wins over the
          // listing agent attribution. Falls back to the listing agent when
          // the notes don't mention a host explicitly.
          const displayHost = resolveHostingAgent(
            openHouse.comments,
            openHouse.agent_name,
          );
          if (!displayHost) return null;
          return (
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                color: "#737373",
                fontWeight: 400,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span style={{ color: "#a3a3a3" }}>Hosted by </span>
              <span style={{ color: "#171717", fontWeight: 500 }}>
                {displayHost}
              </span>
            </div>
          );
        })()}
      </Link>

      {/* Right column — primary "Build OH promo" CTA, with the chevron
          collapsed into a quiet "Open" link below. */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Link
          href={buildHref}
          className="inline-flex items-center rounded-md bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold px-2.5 py-1 transition-colors"
          title="Build a promo post for this open house"
        >
          + Build post
        </Link>
        <Link
          href={propertyHref}
          className="inline-flex items-center text-[10px] font-medium text-neutral-500 hover:text-neutral-800"
        >
          Open
          <ArrowIcon />
        </Link>
      </div>
    </div>
  );
}

/**
 * Pulsing gold badge shown when there are fresh items (added in the last
 * 24h) in this card. Same visual treatment across all four dashboard
 * milestone cards so Larissa learns to scan for the gold dot.
 */
function FreshBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-gold-100 ring-1 ring-gold-300 px-2 py-0.5 text-[11px] font-semibold text-gold-800 tabular-nums"
      aria-label={`${count} new in the last 24 hours`}
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse"
      />
      {count} new
    </span>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-4 h-4 mt-0.5 text-neutral-500 group-hover:text-neutral-700 transition-transform shrink-0 ${
        collapsed ? "-rotate-90" : "rotate-0"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Format the open-house time window for the row eyebrow.
 *   "Saturday May 17 · 1–3 PM"
 *   "Sun May 18 · 2:30–4:00 PM"
 *
 * Always renders in America/New_York. Without an explicit timeZone option
 * the runtime defaults are used — and Next.js renders this Client Component
 * via SSR first, where Vercel's server runs in UTC. The result is that an
 * OH at 14:00 UTC (10am EDT) renders as "2 PM" on first paint. Forcing the
 * Eastern timezone keeps SSR + hydration identical and matches Alliance's
 * physical office locations.
 */
const ALLIANCE_TZ = "America/New_York";

function formatOpenHouseTimeLabel(
  startIso: string,
  endIso: string | null,
): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "—";
  const weekday = start.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: ALLIANCE_TZ,
  });
  const month = start.toLocaleDateString("en-US", {
    month: "short",
    timeZone: ALLIANCE_TZ,
  });
  // Use `day: "numeric"` rather than getDate() — getDate() returns the date
  // in the runtime's TZ, which on Vercel SSR is UTC and can roll back/forward
  // a day for late-night/early-morning Eastern timestamps.
  const day = start.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: ALLIANCE_TZ,
  });
  const startTime = formatTimeOfDay(start);
  if (!endIso) return `${weekday} ${month} ${day} · ${startTime}`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) {
    return `${weekday} ${month} ${day} · ${startTime}`;
  }
  const endTime = formatTimeOfDay(end);
  // Same-AM/PM range: collapse "1 PM–3 PM" → "1–3 PM"
  const sP = startTime.endsWith("M") ? startTime.slice(-2) : "";
  const eP = endTime.endsWith("M") ? endTime.slice(-2) : "";
  if (sP && sP === eP) {
    const sCore = startTime.slice(0, -3);
    return `${weekday} ${month} ${day} · ${sCore}–${endTime}`;
  }
  return `${weekday} ${month} ${day} · ${startTime}–${endTime}`;
}

function formatTimeOfDay(d: Date): string {
  // Render in Alliance's Eastern timezone. Strip leading zero on hour.
  let s = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ALLIANCE_TZ,
  });
  // ":00" → drop minutes for whole hours.
  s = s.replace(/:00 /, " ");
  return s;
}
