"use client";

/**
 * AgentPanel — Phase 3
 * --------------------
 *
 * Left-sidebar tab that lists every agent_headshot synced from Google Drive
 * into the brand_assets table. Larissa picks a headshot here, the
 * orchestrator drops it onto the Fabric canvas as a circular image layer.
 *
 * Visual language matches LayerListPanel.tsx + BrandPanel.tsx (same aside
 * w-72 / border-l / white bg, same header eyebrow treatment).
 *
 * Filter row:
 *   • One chip per office in `props.offices`, plus an "All offices" chip
 *     pinned to the far left.
 *   • Active chip = gold-500 bg + white text. Inactive = neutral border.
 *   • Initial chip = props.defaultOfficeId (null → "All").
 *   • Chips wrap to a 2nd row when the office list overflows w-72; chosen
 *     over a horizontal-scroll affordance because there are at most 8
 *     offices (per Alliance multi-office reality) and a scroller hides the
 *     trailing chips on first paint, which costs Larissa a discoverability
 *     beat for offices that don't fit.
 *
 * Headshot grid:
 *   • Same 80×80 tile pattern as BrandPanel, but rounded-full (circular)
 *     because headshots crop tightly and a square frame would make
 *     foreheads / chins read as cropped instead of intentionally framed.
 *   • Click → onAssetPicked(asset). Orchestrator handles Fabric mutation.
 *
 * Why no third-party state library:
 *   The only client state here is "which office chip is selected". A
 *   useState in this component covers it; lifting to context would just
 *   trade prop drilling for indirection on a 200-line component.
 *
 * Why `crossOrigin="anonymous"` on every <img>:
 *   Same reason as BrandPanel — Chrome caches the response per origin+CORS
 *   header tuple, and a tainted image breaks the eventual fabric canvas
 *   export. Setting it on the FIRST load (the thumbnail) is what keeps the
 *   cache clean for the canvas later.
 *
 * Phase 4 extension hooks (not implemented yet, easy to add):
 *   • Favorites — flag on BrandAsset, then a "Favorites" chip at the head
 *     of the chip row that filters across all offices.
 *   • Search — controlled <input> below the chips; pass query into the
 *     filtered useMemo (dep would become [assets, activeOfficeId, query]).
 *   • Recent — read the orchestrator's recent-asset list and surface a
 *     "Recent" chip; same shape as office filter, just a different predicate.
 */

import { type JSX, useMemo, useState } from "react";

import type { AgentPanelProps, BrandAsset } from "../contracts";

// ===========================================================================
// Constants
// ===========================================================================

const TILE_PX = 80;
const SKELETON_COUNT = 6;

// why: sentinel value for the "All offices" chip. A literal string is safer
// than null in setState union juggling — useState<string | null> would force
// every comparison to special-case null, but useState<string> with this
// sentinel reads cleanly everywhere it's compared.
const ALL_OFFICES = "__ALL__";

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function AgentPanel(props: AgentPanelProps): JSX.Element {
  // why: initial chip = defaultOfficeId when provided, else "All offices".
  // We deliberately do NOT mirror defaultOfficeId via useEffect — if the
  // orchestrator changes the active listing's office mid-session, the user's
  // explicit chip click should win over the new default. (Resetting on
  // listing-change would surprise them.)
  const [activeOfficeId, setActiveOfficeId] = useState<string>(
    props.defaultOfficeId ?? ALL_OFFICES,
  );

  // why: filter assets to agent_headshots that match the active chip. The
  // contract says props.assets is already the agent_headshot slice, but we
  // re-check `kind === "agent_headshot"` defensively — a single misrouted
  // row from the parent would otherwise render a logo in the agent grid.
  const filtered = useMemo(() => {
    const list = props.assets.filter(
      (a) =>
        a.kind === "agent_headshot" &&
        (activeOfficeId === ALL_OFFICES || a.office_id === activeOfficeId),
    );
    // why: alphabetical by label so the same agent shows up in the same spot
    // across reloads. DB order is not deterministic.
    return [...list].sort((a, b) => a.label.localeCompare(b.label));
  }, [props.assets, activeOfficeId]);

  // why: friendly name for the empty-state copy — look up the office on
  // every render is fine, the list is at most 8 entries.
  const activeOfficeName: string =
    activeOfficeId === ALL_OFFICES
      ? "any office"
      : (props.offices.find((o) => o.id === activeOfficeId)?.name ??
          "this office");

  return (
    <aside className="flex w-72 flex-col border-l border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Agents
          </h2>
          {!props.isLoading ? (
            <span className="text-xs text-neutral-400">({filtered.length})</span>
          ) : null}
        </div>
      </header>

      <OfficeChipRow
        offices={props.offices}
        activeOfficeId={activeOfficeId}
        onChange={setActiveOfficeId}
      />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.isLoading ? (
          <SkeletonGrid />
        ) : filtered.length === 0 ? (
          <EmptyState officeName={activeOfficeName} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((asset) => (
              <AgentThumb
                key={asset.id}
                asset={asset}
                onAssetPicked={props.onAssetPicked}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ===========================================================================
// Office chip row
// ===========================================================================

interface OfficeChipRowProps {
  offices: readonly { id: string; name: string }[];
  activeOfficeId: string;
  onChange: (next: string) => void;
}

function OfficeChipRow(props: OfficeChipRowProps): JSX.Element {
  // why: a horizontally-scrollable strip with flex-wrap fallback would be
  // overengineered for 8 offices. Plain flex-wrap with gap-1.5 lets all
  // chips be reachable on first paint at the cost of a 2nd row when needed.
  return (
    <div className="border-b border-neutral-200 px-3 py-2">
      <div className="flex flex-wrap gap-1.5">
        <Chip
          label="All offices"
          isActive={props.activeOfficeId === ALL_OFFICES}
          onClick={() => props.onChange(ALL_OFFICES)}
        />
        {props.offices.map((office) => (
          <Chip
            key={office.id}
            label={office.name}
            isActive={props.activeOfficeId === office.id}
            onClick={() => props.onChange(office.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function Chip(props: ChipProps): JSX.Element {
  // why: aria-pressed (not just visual styling) so screen readers announce
  // chip state. The same focus-visible gold ring as BrandPanel's thumbs
  // keeps keyboard nav consistent.
  const base =
    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500";
  const stateClass = props.isActive
    ? "bg-gold-500 text-white"
    : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50";
  return (
    <button
      type="button"
      aria-pressed={props.isActive}
      onClick={props.onClick}
      className={`${base} ${stateClass}`}
    >
      {props.label}
    </button>
  );
}

// ===========================================================================
// Thumb tile (circular variant)
// ===========================================================================

interface AgentThumbProps {
  asset: BrandAsset;
  onAssetPicked: (asset: BrandAsset) => void;
}

function AgentThumb(props: AgentThumbProps): JSX.Element {
  // why: rounded-full on the OUTER frame AND on the <img> overflow region.
  // object-cover (not object-contain like in BrandPanel) because headshots
  // are photographic and clipping at the head/shoulder line is the goal —
  // we want a tight circular crop, not letterboxed photo bars.
  return (
    <button
      type="button"
      onClick={() => props.onAssetPicked(props.asset)}
      className="group flex flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
      aria-label={`Insert headshot of ${props.asset.label}`}
    >
      <div
        className="overflow-hidden rounded-full border border-neutral-200 bg-neutral-100 transition-colors group-hover:border-gold-500"
        style={{ width: TILE_PX, height: TILE_PX }}
      >
        <img
          src={props.asset.public_url}
          alt={props.asset.label}
          crossOrigin="anonymous"
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <span className="line-clamp-1 w-full truncate text-center text-[10px] text-neutral-600">
        {props.asset.label}
      </span>
    </button>
  );
}

// ===========================================================================
// Loading + empty states
// ===========================================================================

function SkeletonGrid(): JSX.Element {
  // why: same 6-tile pattern as BrandPanel for visual coherence — but
  // skeleton dots are circular here to match the real agent tiles. Different
  // shape would briefly flash a different layout the moment data arrives.
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 rounded-md p-1"
        >
          <div
            className="animate-pulse rounded-full bg-neutral-200"
            style={{ width: TILE_PX, height: TILE_PX }}
          />
          <div className="h-2 w-14 animate-pulse rounded bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ officeName }: { officeName: string }): JSX.Element {
  // why: more specific copy than BrandPanel's — we know the active filter,
  // so the message can point Larissa at the exact gap ("no headshots for
  // Mainland yet") rather than a generic "nothing here".
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gold-500/50 bg-gold-50/30 px-3 py-8 text-center">
      <div className="mb-2 text-gold-600">
        <PersonPlaceholderIcon />
      </div>
      <p className="text-xs font-medium text-neutral-700">
        No headshots for {officeName} yet.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">
        Admins can sync from Google Drive.
      </p>
    </div>
  );
}

// ===========================================================================
// Inline SVG icon
// ===========================================================================

function PersonPlaceholderIcon(): JSX.Element {
  // why: minimal head + shoulders glyph. Matches the line-art weight of
  // every other icon in the editor (LayerListPanel, BrandPanel) so the
  // visual system stays consistent.
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
