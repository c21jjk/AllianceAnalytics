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

import { type JSX, useEffect, useMemo, useRef, useState } from "react";

import type { BrandAsset, BrandPanelProps, BrandSyncOutcome } from "../contracts";
import SyncStatusPill from "./SyncStatusPill";

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

  // (SyncButton highlight was removed 2026-05-17 along with the button.)

  // why: 2026-05-17 — admin can add/remove logos directly in the sidecar.
  // Non-admins see a read-only panel (existing behavior). The modal opens
  // pre-filled with `kind` matching whichever section's "+ Add Asset"
  // was clicked so the user doesn't have to pick.
  const [uploadKind, setUploadKind] = useState<
    "logo" | "partner_logo" | null
  >(null);

  return (
    <aside className="flex h-full min-h-0 w-72 flex-col border-l border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
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
          {/* why: SyncButton retired 2026-05-17 — logos are admin-managed,
              not Drive-synced. We still keep the prop in the contract for
              backward compatibility but the button no longer renders here.
              Headshot syncing happens via the AgentPanel sync button. */}
        </div>
        {props.syncStatus ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <SyncStatusPill status={props.syncStatus} />
          </div>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.isLoading ? (
          <SkeletonGrid />
        ) : (
          <>
            <section className="mb-4">
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-neutral-100 pb-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                  C21 Logos
                </h3>
                {props.isAdmin && props.onUploadAsset ? (
                  <button
                    type="button"
                    onClick={() => setUploadKind("logo")}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-700 transition-colors hover:bg-gold-50"
                    aria-label="Add a new logo"
                  >
                    <span aria-hidden>+</span>
                    Add asset
                  </button>
                ) : null}
              </div>
              {totalLogos === 0 ? (
                <p className="px-1 py-2 text-xs text-neutral-400">
                  {props.isAdmin
                    ? "Empty. Click + Add asset to upload your first logo."
                    : "No logos uploaded yet."}
                </p>
              ) : (
                logoGroups.map(([category, items]) => (
                  <LogoCategoryBlock
                    key={category}
                    category={category}
                    items={items}
                    showCategoryHeading={logoGroups.length > 1}
                    onAssetPicked={props.onAssetPicked}
                    isAdmin={props.isAdmin === true}
                    onArchiveAsset={props.onArchiveAsset}
                  />
                ))
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-neutral-100 pb-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                  Partners &amp; Co-brand
                </h3>
                {props.isAdmin && props.onUploadAsset ? (
                  <button
                    type="button"
                    onClick={() => setUploadKind("partner_logo")}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-700 transition-colors hover:bg-gold-50"
                    aria-label="Add a new partner logo"
                  >
                    <span aria-hidden>+</span>
                    Add asset
                  </button>
                ) : null}
              </div>
              {totalPartners === 0 ? (
                <p className="px-1 py-2 text-xs text-neutral-400">
                  {props.isAdmin
                    ? "Empty. Click + Add asset to upload a co-brand mark."
                    : "No partner logos uploaded yet."}
                </p>
              ) : (
                <ThumbGrid>
                  {partners.map((asset) => (
                    <BrandThumb
                      key={asset.id}
                      asset={asset}
                      onAssetPicked={props.onAssetPicked}
                      isAdmin={props.isAdmin === true}
                      onArchiveAsset={props.onArchiveAsset}
                    />
                  ))}
                </ThumbGrid>
              )}
            </section>
          </>
        )}
      </div>

      {uploadKind && props.onUploadAsset ? (
        <UploadAssetModal
          kind={uploadKind}
          onClose={() => setUploadKind(null)}
          onUpload={props.onUploadAsset}
        />
      ) : null}
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
  isAdmin: boolean;
  onArchiveAsset?: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
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
            isAdmin={props.isAdmin}
            onArchiveAsset={props.onArchiveAsset}
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
  isAdmin: boolean;
  onArchiveAsset?: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function BrandThumb(props: BrandThumbProps): JSX.Element {
  const [archiving, setArchiving] = useState(false);

  async function handleArchiveClick(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!props.onArchiveAsset || archiving) return;
    const ok = window.confirm(
      `Remove "${props.asset.label}" from the brand library? Existing saved posts that already used this logo will still render — only the picker hides it.`,
    );
    if (!ok) return;
    setArchiving(true);
    try {
      const res = await props.onArchiveAsset(props.asset.id);
      if (!res.ok) {
        // why: dead-simple alert is fine here — the failure path is rare
        // (admin-only call against our own server action) and putting a
        // toast system in the sidecar just for this is overkill.
        window.alert(`Remove failed: ${res.error}`);
      }
    } finally {
      setArchiving(false);
    }
  }

  // why: <button> so keyboard focus + Enter activation work for free. The
  // hover ring + gold focus ring match LayerListPanel's selected-row treatment
  // so the editor feels visually consistent across tabs.
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => props.onAssetPicked(props.asset)}
        disabled={archiving}
        className="flex w-full flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
      {props.isAdmin && props.onArchiveAsset ? (
        <button
          type="button"
          onClick={handleArchiveClick}
          disabled={archiving}
          className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-rose-600 shadow-md ring-1 ring-rose-200 transition-colors hover:bg-rose-50 hover:text-rose-700 group-hover:flex disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Remove ${props.asset.label} from the brand library`}
          title="Remove from library"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 2 L8 8 M8 2 L2 8" />
          </svg>
        </button>
      ) : null}
    </div>
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

// ===========================================================================
// Sync button — manual Drive→Supabase refresh
// ===========================================================================

interface SyncButtonProps {
  onSync: () => Promise<BrandSyncOutcome>;
  /**
   * When true, paints the button with the rose-50/rose-700 attention
   * treatment so a user whose last sync FAILED has an obvious "retry"
   * affordance. Defaults to the neutral hover-gold treatment.
   */
  highlight?: boolean;
}

function SyncButton({ onSync, highlight = false }: SyncButtonProps): JSX.Element {
  // why: three-state machine — idle, syncing (spinner + disabled), result
  // (transient toast). The toast dismisses itself after 4s so Larissa
  // doesn't have to click it away mid-edit.
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BrandSyncOutcome | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!result) return;
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setResult(null), 4000);
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [result]);

  async function handleClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await onSync();
      setResult(outcome);
    } catch (e) {
      setResult({
        ok: false,
        summary: `Sync threw: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  // why: derived class string so the `highlight` retry treatment composes
  // cleanly with the hover/disabled states. Rose is the project's standard
  // error palette; we use the 50/200/700 triple to match the toast.
  const buttonClass = highlight
    ? "inline-flex items-center justify-center rounded-md border border-rose-300 bg-rose-50 px-1.5 py-1 text-rose-700 transition-colors hover:bg-rose-100 hover:text-rose-800 disabled:opacity-60 disabled:cursor-not-allowed"
    : "inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-neutral-600 transition-colors hover:border-gold-300 hover:bg-gold-50/40 hover:text-gold-800 disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        title={
          busy
            ? "Syncing from Google Drive…"
            : highlight
              ? "Last sync failed — click to retry"
              : "Sync from Google Drive now"
        }
        aria-label={busy ? "Syncing brand assets" : "Sync brand assets from Google Drive"}
        className={buttonClass}
      >
        <RefreshIcon spinning={busy} />
      </button>
      {result ? (
        <div
          role="status"
          className={`absolute right-0 top-full z-20 mt-1 w-60 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug shadow-md ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {result.summary}
        </div>
      ) : null}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M13.5 4.5A6 6 0 102 8" />
      <path d="M13.5 1.5v3h-3" />
    </svg>
  );
}

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

// ===========================================================================
// Upload modal — admin-only "+ Add asset"
// ===========================================================================
//
// Tiny inline modal rendered when the admin clicks "+ Add asset" on either
// section. Captures: label (required), optional logo_category, and the
// file itself. On submit it base64-encodes the file client-side, calls the
// parent's onUpload (which wraps uploadBrandAssetAction), and closes.

interface UploadAssetModalProps {
  kind: "logo" | "partner_logo";
  onClose: () => void;
  onUpload: (input: {
    kind: "logo" | "partner_logo";
    label: string;
    logo_category: string | null;
    filename: string;
    content_type: string;
    file_base64: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function UploadAssetModal(props: UploadAssetModalProps): JSX.Element {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
  const MAX_MB = 5;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Max ${MAX_MB} MB.`);
      return;
    }
    const labelTrim = label.trim();
    if (!labelTrim) {
      setError("Label is required.");
      return;
    }
    setBusy(true);
    try {
      // why: read file → base64. FileReader.readAsDataURL gives us a
      // data: URL we then strip the header off to get raw base64.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error ?? new Error("read failed"));
        r.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(",");
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      const res = await props.onUpload({
        kind: props.kind,
        label: labelTrim,
        logo_category: category.trim() ? category.trim() : null,
        filename: file.name,
        content_type: file.type,
        file_base64: base64,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        props.onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const titleLabel =
    props.kind === "logo" ? "Add a C21 logo" : "Add a partner / co-brand mark";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) props.onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-700">
              Brand library
            </div>
            <h3 className="text-base font-bold text-neutral-900">
              {titleLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            className="text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-700">
              Label <span className="text-rose-600">*</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
              placeholder={
                props.kind === "logo"
                  ? "e.g. Gold Logo Horizontal"
                  : "e.g. Family of Services"
              }
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
              autoFocus
            />
          </label>

          {props.kind === "logo" ? (
            <label className="block">
              <span className="text-xs font-medium text-neutral-700">
                Category{" "}
                <span className="text-neutral-400">(optional grouping)</span>
              </span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={busy}
                placeholder="e.g. Horizontal, Stacked, Seal"
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="text-xs font-medium text-neutral-700">
              File <span className="text-rose-600">*</span>
            </span>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="mt-1 block w-full text-xs text-neutral-600 file:mr-2 file:rounded-md file:border-0 file:bg-gold-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gold-700 hover:file:bg-gold-100"
            />
            <span className="mt-1 block text-[10px] text-neutral-500">
              PNG, JPG, WEBP, or SVG. Max {MAX_MB} MB.
            </span>
          </label>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !file || !label.trim()}
            className="rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
