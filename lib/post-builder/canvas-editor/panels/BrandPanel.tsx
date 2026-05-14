"use client";

/**
 * BrandPanel — Phase 3
 * --------------------
 *
 * Left-sidebar tab that lists every C21 logo + co-brand partner-logo that
 * admins have synced from Google Drive into the brand_assets table.
 *
 * Visual language matches LayerListPanel.tsx exactly:
 *   • aside w-72, border-l, white bg
 *   • header eyebrow: text-xs uppercase tracking-wider text-neutral-500
 *   • a small "(N)" count badge to the right of the title (parity w/ LayerList)
 *
 * Behavior:
 *   • Section 1 — "C21 Logos" — kind === "logo".
 *     Optionally sub-grouped by `logo_category` (e.g. "Horizontal", "Stacked",
 *     "Seal"). Categories rendered as small headings; alphabetical order.
 *     Assets with logo_category === null fall under an "Uncategorized" bucket
 *     and render LAST (so the named groups read top-down by name).
 *   • Section 2 — "Partners & Co-brand" — kind === "partner_logo".
 *     Flat 2-column grid, no sub-grouping (partner libraries are small and
 *     the visual identity of each partner is more useful than a categorical
 *     split).
 *
 * Why a presentational-only component:
 *   The orchestrator (CanvasEditor.tsx) owns the brand_assets query, the
 *   Fabric canvas, and the layerVersion bump that fires after `canvas.add(...)`.
 *   This panel emits `onAssetPicked(asset)` and lets the orchestrator do the
 *   actual work. Same boundary as LayerListPanel's `onReorder`.
 *
 * Why `crossOrigin="anonymous"` on every <img>:
 *   When a logo is later dropped onto the Fabric canvas (Phase 4), Fabric
 *   loads the same URL into an HTMLImageElement. If the FIRST load (here in
 *   the thumbnail grid) didn't set crossOrigin, Chrome caches a tainted
 *   response — the SECOND load (Fabric) gets the cached tainted image and
 *   any canvas.toDataURL() / toJPEG() export blows up with a security error.
 *   Setting it now keeps the cache clean for downstream use.
 *
 * Phase 4 extension hooks (not implemented yet, but easy to add):
 *   • Favorites — add `favorited: boolean` to BrandAsset and a star icon
 *     overlay on each tile. A "Favorites" section at the top would key off
 *     it. Memoization already groups assets, so adding a third bucket is
 *     one block of JSX.
 *   • Search — a controlled <input> above the sections, filter `assets`
 *     before grouping. The useMemo dep array is already keyed on `assets`,
 *     so changing it to `[assets, query]` is the entire wiring.
 *   • Drag-to-canvas — wrap each tile button with @dnd-kit's `useDraggable`
 *     and add `useDroppable` to the canvas area; same library already in
 *     LayerListPanel.
 */

import { type JSX, useMemo } from "react";

import type { BrandAsset, BrandPanelProps } from "../contracts";

// ===========================================================================
// Constants
// ===========================================================================

// why: literal width/height so the same dimensions can be applied to skeleton
// tiles AND real tiles without depending on a parent layout. 80px is the
// minimum tile size where a typical wordmark logo is still recognizable, and
// 2 tiles + gap fits within w-72 minus padding (288 - 32 padding - 8 gap = 248,
// each tile ~80 = 160; the remainder breathes around them).
const TILE_PX = 80;

// why: 6 skeletons fills a 2-column grid with 3 rows — enough to telegraph
// "list is incoming" without dominating the viewport on a small monitor.
const SKELETON_COUNT = 6;

// why: stable label for assets with no logo_category. Sort key '~' pushes it
// after alphabetical category names so the named groups render first.
const UNCATEGORIZED_KEY = "Uncategorized";

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function BrandPanel(props: BrandPanelProps): JSX.Element {
  // why: split the asset list into the two sections in one pass rather than
  // filtering twice. useMemo's dep is just `assets` — re-running on every
  // render would re-iterate the whole library on hover events etc.
  const { logoGroups, partners } = useMemo(() => {
    // why: Map preserves insertion order, which lets us sort categories
    // explicitly below and still iterate them in the chosen order.
    const groups = new Map<string, BrandAsset[]>();
    const partnerList: BrandAsset[] = [];

    for (const asset of props.assets) {
      if (asset.kind === "logo") {
        const key = asset.logo_category ?? UNCATEGORIZED_KEY;
        const bucket = groups.get(key);
        if (bucket === undefined) {
          groups.set(key, [asset]);
        } else {
          bucket.push(asset);
        }
      } else if (asset.kind === "partner_logo") {
        partnerList.push(asset);
      }
      // why: agent_headshot rows are intentionally ignored here; they live in
      // AgentPanel. The orchestrator passes the full filtered slice, but the
      // contract docstring promises "logo + partner_logo rows" — being
      // defensive against an upstream wiring mistake costs almost nothing.
    }

    // why: sort categories alphabetically, then pin "Uncategorized" to the
    // bottom by treating it as a sort key greater than any letter.
    const sortedGroups: Array<readonly [string, BrandAsset[]]> = [
      ...groups.entries(),
    ].sort(([a], [b]) => {
      if (a === UNCATEGORIZED_KEY) return 1;
      if (b === UNCATEGORIZED_KEY) return -1;
      return a.localeCompare(b);
    });

    // why: also sort the assets inside each bucket by label so the visual
    // order is stable across reloads. The DB could return rows in any order.
    for (const [, bucket] of sortedGroups) {
      bucket.sort((a, b) => a.label.localeCompare(b.label));
    }
    partnerList.sort((a, b) => a.label.localeCompare(b.label));

    return { logoGroups: sortedGroups, partners: partnerList };
  }, [props.assets]);

  const totalLogos = logoGroups.reduce((sum, [, list]) => sum + list.length, 0);
  const totalPartners = partners.length;
  const isEmpty =
    !props.isLoading && totalLogos === 0 && totalPartners === 0;

  return (
    <aside className="flex w-72 flex-col border-l border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Brand
          </h2>
          {!props.isLoading && !isEmpty ? (
            <span className="text-xs text-neutral-400">
              ({totalLogos + totalPartners})
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.isLoading ? (
          <SkeletonGrid />
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {/* why: render the C21 Logos section only when there's at least
                one logo. Otherwise the section header becomes a confusing
                orphan label above a co-brand section. */}
            {totalLogos > 0 ? (
              <section className="mb-4">
                <SectionHeader label="C21 Logos" />
                {logoGroups.map(([category, items]) => (
                  <LogoCategoryBlock
                    key={category}
                    category={category}
                    items={items}
                    showCategoryHeading={logoGroups.length > 1}
                    onAssetPicked={props.onAssetPicked}
                  />
                ))}
              </section>
            ) : null}

            {totalPartners > 0 ? (
              <section>
                <SectionHeader label="Partners & Co-brand" />
                <ThumbGrid>
                  {partners.map((asset) => (
                    <BrandThumb
                      key={asset.id}
                      asset={asset}
                      onAssetPicked={props.onAssetPicked}
                    />
                  ))}
                </ThumbGrid>
              </section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

// ===========================================================================
// Sub-section pieces
// ===========================================================================

function SectionHeader({ label }: { label: string }): JSX.Element {
  // why: secondary eyebrow — visually subordinate to the panel-level eyebrow
  // in the header, but still picked out via the same uppercase-tracking
  // treatment. The thin bottom border separates the section title from its
  // grid cells without needing a heavyweight divider.
  return (
    <div className="mb-2 flex items-center gap-2 border-b border-neutral-100 pb-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
        {label}
      </h3>
    </div>
  );
}

interface LogoCategoryBlockProps {
  category: string;
  items: BrandAsset[];
  showCategoryHeading: boolean;
  onAssetPicked: (asset: BrandAsset) => void;
}

function LogoCategoryBlock(props: LogoCategoryBlockProps): JSX.Element {
  // why: if there's only one category total under C21 Logos, the category
  // heading becomes redundant noise (e.g. a single "Horizontal" label above
  // the entire logo grid). The parent passes `showCategoryHeading=false` in
  // that case and we render just the grid.
  return (
    <div className="mb-3">
      {props.showCategoryHeading ? (
        <div className="mb-1 mt-2 px-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
          {props.category}
        </div>
      ) : null}
      <ThumbGrid>
        {props.items.map((asset) => (
          <BrandThumb
            key={asset.id}
            asset={asset}
            onAssetPicked={props.onAssetPicked}
          />
        ))}
      </ThumbGrid>
    </div>
  );
}

// ===========================================================================
// Grid + tile primitives
// ===========================================================================

function ThumbGrid({ children }: { children: React.ReactNode }): JSX.Element {
  // why: 2-column grid sized to the panel's content width. gap-2 (8px) is the
  // smallest gap that still reads as separation at 80px tile size — anything
  // tighter and adjacent logos visually fuse.
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

interface BrandThumbProps {
  asset: BrandAsset;
  onAssetPicked: (asset: BrandAsset) => void;
}

function BrandThumb(props: BrandThumbProps): JSX.Element {
  // why: <button> so keyboard focus + Enter activation work for free. The
  // hover ring + gold focus ring match LayerListPanel's selected-row treatment
  // so the editor feels visually consistent across tabs.
  return (
    <button
      type="button"
      onClick={() => props.onAssetPicked(props.asset)}
      className="group flex flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
      aria-label={`Insert ${props.asset.label}`}
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-white transition-colors group-hover:border-gold-500"
        style={{ width: TILE_PX, height: TILE_PX }}
      >
        {/* why: object-contain (not cover) preserves the wordmark's aspect
            ratio — logos are NOT photos and cropping them would clip the
            brand mark. The white tile background also lets light-on-light
            logos still read. */}
        <img
          src={props.asset.public_url}
          alt={props.asset.label}
          crossOrigin="anonymous"
          loading="lazy"
          className="max-h-full max-w-full object-contain"
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
  // why: deterministic loop rather than Array.from with random keys; React's
  // reconciler is happy with index keys here because the skeleton list is
  // pure decoration that unmounts wholesale when isLoading flips to false.
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 rounded-md p-1"
        >
          <div
            className="animate-pulse rounded-md bg-neutral-200"
            style={{ width: TILE_PX, height: TILE_PX }}
          />
          <div className="h-2 w-12 animate-pulse rounded bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  // why: gold-dashed border with a soft cream tint mirrors the "add logo"
  // placeholder pattern Larissa already sees in the template gallery, so
  // the editor's empty state feels familiar rather than broken. Copy
  // surfaces who can fix it (admins) without sounding like a stack trace.
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gold-500/50 bg-gold-50/30 px-3 py-8 text-center">
      <div className="mb-2 text-gold-600">
        <LogoPlaceholderIcon />
      </div>
      <p className="text-xs font-medium text-neutral-700">No logos synced yet</p>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">
        Admins can sync from Google Drive.
      </p>
    </div>
  );
}

// ===========================================================================
// Inline SVG icon (same convention as LayerListPanel — no icon library)
// ===========================================================================

function LogoPlaceholderIcon(): JSX.Element {
  // why: generic image-frame glyph that reads as "media missing" without
  // implying a specific kind of file. Matches the line-art weight of the
  // icons in LayerListPanel so the two panels feel like one toolkit.
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
