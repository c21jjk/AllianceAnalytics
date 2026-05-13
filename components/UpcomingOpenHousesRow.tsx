"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UpcomingOpenHouse } from "@/lib/data/open-houses";
import { formatCurrency } from "@/lib/format";

interface UpcomingOpenHousesRowProps {
  openHouses: UpcomingOpenHouse[];
  /** Window in days that the parent fetched against. Header copy. */
  windowDays?: number;
  officeShortCode?: string | null;
  className?: string;
}

/** localStorage key for the collapsed-state preference. */
const COLLAPSED_KEY = "open-houses-collapsed";

/**
 * Dashboard card listing upcoming Alliance Open Houses. Sits at the top of
 * the right column on the dashboard, above Under Contract and Recently Sold.
 *
 * Sorted chronologically (next OH first). Larissa hits this surface at 4pm
 * Thursdays to see what's running over the weekend and build promo posts.
 *
 * Collapsible — same pattern as the other milestone cards.
 */
export default function UpcomingOpenHousesRow({
  openHouses,
  windowDays = 7,
  officeShortCode,
  className,
}: UpcomingOpenHousesRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
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
            <h2 className="text-sm font-semibold text-neutral-900">
              Open Houses
              <span className="text-neutral-400 font-normal">
                {" "}· next {windowDays} days · {openHouses.length} {noun}{scope}
              </span>
              {collapsed ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-sky-200/70 ring-1 ring-sky-300 px-2 py-0.5 text-[11px] font-medium text-sky-800 tabular-nums">
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

  return (
    <Link
      href={`/properties/${encodeURIComponent(openHouse.mls_number)}`}
      className="grid items-center hover:opacity-70 transition-opacity"
      style={{
        gridTemplateColumns: "56px 1fr auto",
        gap: 14,
        padding: "12px 0",
        borderTop: isFirst ? "none" : "1px solid #ececec",
      }}
    >
      {/* Hero */}
      <div
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
      </div>

      {/* Body */}
      <div style={{ minWidth: 0 }}>
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
          {openHouse.address ?? "Unknown address"}
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
        {openHouse.agent_name ? (
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
              {openHouse.agent_name}
            </span>
          </div>
        ) : null}
      </div>

      {/* Right column — arrow chevron */}
      <div style={{ color: "#a3a3a3", fontSize: 14 }}>
        <ArrowIcon />
      </div>
    </Link>
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
 */
function formatOpenHouseTimeLabel(
  startIso: string,
  endIso: string | null,
): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "—";
  const weekday = start.toLocaleDateString("en-US", { weekday: "short" });
  const month = start.toLocaleDateString("en-US", { month: "short" });
  const day = start.getDate();
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
  // Render in user's local time. Strip leading zero on hour.
  let s = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // ":00" → drop minutes for whole hours.
  s = s.replace(/:00 /, " ");
  return s;
}
