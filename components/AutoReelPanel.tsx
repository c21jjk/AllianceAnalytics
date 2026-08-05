"use client";

/**
 * AutoReel launcher + import panel — 2026-08-05
 * ---------------------------------------------------------------------------
 *
 * AutoReel (autoreelapp.com) is the third-party reel maker used for listings
 * that don't get a Larissa live video. It has no API, but its create flow
 * only needs two paste-able strings — a project name and the property
 * address (its address importer pulls every listing photo itself, verified
 * 2026-08-05: 33/33 photos in ~5s) — and its finished renders are public
 * MP4s our import route can pull in.
 *
 * So this panel is a "prep sheet": one-click copy chips for everything
 * AutoReel asks for, a popup-window launcher (no lost tabs), a slot to
 * paste the project link back for tracking, and the import box that turns
 * the finished video into a draft reel in Saved Posts.
 *
 * Modes:
 *   <AutoReelLaunchButton listing={...} project={...} variant="row|card|header" />
 *     — trigger + modal, listing known up front (dashboard rows, property page)
 *   <AutoReelLaunchButton variant="header" />
 *     — no listing: the modal opens with a listing search first (Post Builder)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface AutoReelListingSummary {
  mls_number: string;
  source_mls?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  status?: string | null;
  list_price?: number | null;
  bedrooms?: number | null;
  bathrooms_full?: number | null;
  bathrooms_half?: number | null;
  hero_image_url?: string | null;
  public_remarks?: string | null;
  /** Next upcoming open house line, pre-formatted (property page passes it). */
  oh_line?: string | null;
}

export interface AutoReelProjectSummary {
  project_url: string | null;
  status: "project_created" | "video_imported";
}

export interface AutoReelDraftSummary {
  gp_id: string;
  status: string;
}

interface AutoReelLaunchButtonProps {
  listing?: AutoReelListingSummary;
  project?: AutoReelProjectSummary | null;
  variant: "row" | "card" | "header";
}

/**
 * why /listings and not the bare domain: autoreelapp.com shows the MARKETING
 * page even for signed-in users (verified 2026-08-05, John hit this too).
 * /listings redirects into the app (most recent project, sidebar + Create
 * button visible) — one click closer to work.
 */
const AUTOREEL_HOME = "https://www.autoreelapp.com/listings";

/** Open AutoReel in an app-like popup window instead of a lost tab. */
function openAutoReelWindow(url: string) {
  const w = Math.min(1360, Math.max(980, Math.floor(window.screen.width * 0.75)));
  const h = Math.min(940, Math.max(700, Math.floor(window.screen.height * 0.85)));
  const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - h) / 3));
  window.open(
    url,
    "autoreel",
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
  );
}

function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** "115 W 6th Avenue, North Wildwood, NJ" — what AutoReel's address importer wants. */
function buildAddressLine(l: AutoReelListingSummary): string {
  return [l.address, l.city, l.state].filter(Boolean).join(", ");
}

/** Caption-context blurb for AutoReel's Captions tab "additional info" box. */
function buildCaptionContext(l: AutoReelListingSummary): string {
  const parts: string[] = [];
  const price = formatPrice(l.list_price);
  const baths =
    (l.bathrooms_full ?? 0) + 0.5 * (l.bathrooms_half ?? 0) || null;
  const facts = [
    price,
    l.bedrooms ? `${l.bedrooms} bed` : null,
    baths ? `${baths} bath` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (facts) parts.push(facts);
  if (l.oh_line) parts.push(l.oh_line);
  if (l.public_remarks) {
    const remarks = l.public_remarks.trim();
    parts.push(remarks.length > 700 ? `${remarks.slice(0, 700)}…` : remarks);
  }
  parts.push("Listed by CENTURY 21 Alliance.");
  return parts.join("\n\n");
}

export default function AutoReelLaunchButton({
  listing,
  project,
  variant,
}: AutoReelLaunchButtonProps) {
  const [open, setOpen] = useState(false);
  // "Reel waiting to publish" — an imported draft that hasn't gone out yet.
  // Drives the gold dot AND makes the button a direct shortcut to the
  // review page (2026-08-05, John: "clicking the dot should take me right
  // to the preview, not through the modal again"). Fetched lazily per
  // listing (dashboard rows are few, so the extra GETs are cheap) and
  // refreshed when the modal closes.
  const [pendingGpId, setPendingGpId] = useState<string | null>(null);
  const checkedMls = useRef<string | null>(null);

  const refreshDraftState = useCallback(() => {
    if (!listing?.mls_number) return;
    void fetch(
      `/api/post-builder/autoreel-import?mls=${encodeURIComponent(listing.mls_number)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          project?: AutoReelProjectSummary | null;
          draft?: AutoReelDraftSummary | null;
        } | null) => {
          setPendingGpId(
            j?.project?.status === "video_imported" &&
              j?.draft?.status === "draft" &&
              j.draft.gp_id
              ? j.draft.gp_id
              : null,
          );
        },
      )
      .catch(() => undefined);
  }, [listing?.mls_number]);

  useEffect(() => {
    if (!listing?.mls_number || checkedMls.current === listing.mls_number) return;
    checkedMls.current = listing.mls_number;
    refreshDraftState();
  }, [listing?.mls_number, refreshDraftState]);

  const pendingDraft = pendingGpId !== null;
  const dot = pendingDraft ? <PendingDot /> : null;

  /** Dot showing → jump straight to the review page; otherwise open the
   *  prep/import modal as usual. */
  function handleClick() {
    if (pendingGpId) {
      window.location.assign(`/post-builder/autoreel-review?gp=${pendingGpId}`);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      {variant === "row" ? (
        <button
          type="button"
          onClick={handleClick}
          className="relative inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-600 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition-colors"
          title={
            pendingDraft
              ? "A reel is imported and waiting — click to preview and publish"
              : "Make a reel for this listing with AutoReel"
          }
        >
          <ClapperGlyph />
          AutoReel
          {dot}
        </button>
      ) : variant === "card" ? (
        <button
          type="button"
          onClick={handleClick}
          className="relative inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors focus-ring"
        >
          <ClapperGlyph />
          {pendingDraft
            ? "AutoReel · reel ready to publish"
            : project?.status === "video_imported"
              ? "AutoReel · video imported"
              : project?.project_url
                ? "Open AutoReel project"
                : "Make a reel with AutoReel"}
          {dot}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition focus-ring"
        >
          <ClapperGlyph />
          AutoReel
        </button>
      )}
      {open ? (
        <AutoReelModal
          initialListing={listing ?? null}
          initialProject={project ?? null}
          onClose={() => {
            setOpen(false);
            // The modal may have imported or published — refresh the dot.
            refreshDraftState();
          }}
        />
      ) : null}
    </>
  );
}

function PendingDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 inline-block w-2.5 h-2.5 rounded-full bg-gold-500 ring-2 ring-white"
    />
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface SearchResult extends AutoReelListingSummary {
  status: string;
}

function AutoReelModal({
  initialListing,
  initialProject,
  onClose,
}: {
  initialListing: AutoReelListingSummary | null;
  initialProject: AutoReelProjectSummary | null;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<AutoReelListingSummary | null>(
    initialListing,
  );
  const [project, setProject] = useState<AutoReelProjectSummary | null>(
    initialProject,
  );
  const [draft, setDraft] = useState<AutoReelDraftSummary | null>(null);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When opened from a dashboard row we have the listing but not its saved
  // project / imported-draft state — fetch both so the launch button
  // deep-links correctly and the pending-reel banner can render.
  const fetchedForMls = useRef<string | null>(null);
  useEffect(() => {
    if (!listing) return;
    if (fetchedForMls.current === listing.mls_number) return;
    fetchedForMls.current = listing.mls_number;
    void fetch(
      `/api/post-builder/autoreel-import?mls=${encodeURIComponent(listing.mls_number)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          project?: AutoReelProjectSummary | null;
          draft?: AutoReelDraftSummary | null;
        } | null) => {
          if (j?.project && !initialProject) setProject(j.project);
          if (j?.draft) setDraft(j.draft);
        },
      )
      .catch(() => undefined);
  }, [listing, initialProject]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="AutoReel"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-elevated mt-10 mb-10">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-neutral-100">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 inline-flex items-center gap-2">
              <ClapperGlyph />
              AutoReel
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {listing
                ? buildAddressLine(listing) || listing.mls_number
                : "Pick a listing, then create or import its reel."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
          >
            <XGlyph />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {!listing ? (
            <ListingSearch
              onPick={(l, p) => {
                setListing(l);
                setProject(p);
              }}
            />
          ) : (
            <>
              {draft?.status === "draft" ? (
                <a
                  href={`/post-builder/autoreel-review?gp=${draft.gp_id}`}
                  className="block rounded-lg bg-gold-50 ring-1 ring-gold-300 px-3 py-2.5 text-sm text-gold-900 hover:bg-gold-100 transition-colors"
                >
                  <span className="font-semibold">
                    A reel for this listing is imported and waiting.
                  </span>{" "}
                  Review captions and publish it →
                </a>
              ) : null}
              <PrepSection listing={listing} project={project} onProjectSaved={setProject} />
              <ImportSection
                listing={listing}
                onImported={(gpId) => {
                  setDraft({ gp_id: gpId, status: "draft" });
                  setProject((prev) => ({
                    project_url: prev?.project_url ?? null,
                    status: "video_imported",
                  }));
                }}
              />
              {initialListing === null ? (
                <button
                  type="button"
                  onClick={() => {
                    setListing(null);
                    setProject(null);
                    fetchedForMls.current = null;
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
                >
                  ← Pick a different listing
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listing search (header variant — no listing context)
// ---------------------------------------------------------------------------

function ListingSearch({
  onPick,
}: {
  onPick: (l: AutoReelListingSummary, p: AutoReelProjectSummary | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setBusy(true);
      void fetch(
        `/api/post-builder/autoreel-import?q=${encodeURIComponent(q.trim())}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { results?: SearchResult[] } | null) => {
          setResults(j?.results ?? []);
        })
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(r: SearchResult) {
    // Pull the saved project alongside so the panel opens fully hydrated.
    let project: AutoReelProjectSummary | null = null;
    try {
      const res = await fetch(
        `/api/post-builder/autoreel-import?mls=${encodeURIComponent(r.mls_number)}`,
      );
      if (res.ok) {
        const j = (await res.json()) as { project?: AutoReelProjectSummary | null };
        project = j.project ?? null;
      }
    } catch {
      // fine — panel works without it
    }
    onPick(r, project);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600 mb-1">
        Which listing is this reel for?
      </label>
      <input
        type="text"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by address or MLS #..."
        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
      />
      {busy ? (
        <p className="mt-2 text-xs text-neutral-400">Searching…</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 overflow-hidden">
          {results.map((r) => (
            <li key={r.mls_number}>
              <button
                type="button"
                onClick={() => void pick(r)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
              >
                {r.hero_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.hero_image_url}
                    alt=""
                    className="w-9 h-9 rounded object-cover bg-neutral-100 shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-neutral-100 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm text-neutral-900 truncate">
                    {r.address ?? r.mls_number}
                    {r.city ? (
                      <span className="text-neutral-500">, {r.city}</span>
                    ) : null}
                  </span>
                  <span className="block text-[11px] text-neutral-500">
                    #{r.mls_number}
                    {r.status ? ` · ${r.status}` : ""}
                    {formatPrice(r.list_price) ? ` · ${formatPrice(r.list_price)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prep section — copy chips + launch + save project link
// ---------------------------------------------------------------------------

function PrepSection({
  listing,
  project,
  onProjectSaved,
}: {
  listing: AutoReelListingSummary;
  project: AutoReelProjectSummary | null;
  onProjectSaved: (p: AutoReelProjectSummary) => void;
}) {
  const addressLine = useMemo(() => buildAddressLine(listing), [listing]);
  const captionContext = useMemo(() => buildCaptionContext(listing), [listing]);
  const [linkDraft, setLinkDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  /**
   * why the launch button also copies the address: the address is the ONLY
   * string AutoReel's create flow needs (it doubles as the project name AND
   * the photo-import query), so pre-loading the clipboard turns the whole
   * dance into open → Create → paste → Next → Address tab → paste.
   */
  function handleOpen() {
    const target = project?.project_url ?? AUTOREEL_HOME;
    if (!project?.project_url && addressLine) {
      void navigator.clipboard
        ?.writeText(addressLine)
        .then(() => {
          setAddressCopied(true);
          setTimeout(() => setAddressCopied(false), 6000);
        })
        .catch(() => undefined);
    }
    openAutoReelWindow(target);
  }

  async function saveLink() {
    const url = linkDraft.trim();
    if (!url) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_project_link",
          mls_number: listing.mls_number,
          project_url: url,
        }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        project?: { project_url: string | null; status: "project_created" | "video_imported" };
      };
      if (!j.ok || !j.project) {
        setSaveError(j.error ?? "Could not save the link.");
      } else {
        onProjectSaved({ project_url: j.project.project_url, status: j.project.status });
        setShowLinkInput(false);
        setLinkDraft("");
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        1 · Create the project
      </h3>
      {/* The exact click path, verified in AutoReel 8/05. The address is
          pre-copied by the launch button, so both pastes are ready. */}
      <ol className="mt-1.5 space-y-0.5 text-xs text-neutral-600 leading-relaxed list-decimal list-inside">
        <li>
          Click <span className="font-medium text-neutral-800">Create</span> and
          paste the address as the project name
        </li>
        <li>
          On the upload step, stay on the{" "}
          <span className="font-medium text-neutral-800">Address</span> tab,
          paste again, and pick the listing — every MLS photo imports itself
        </li>
        <li>Select the photos for the video, in the order they should play</li>
        <li>
          On the Edit step switch orientation to{" "}
          <span className="font-semibold text-neutral-900">Portrait</span> (it
          defaults to Landscape, which is wrong for reels)
        </li>
        <li>Pick template/music if you want them, then Render</li>
      </ol>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <CopyChip
          label="Address · project name"
          value={addressLine || listing.mls_number}
        />
        <CopyChip label="Caption context" value={captionContext} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex items-center gap-2 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gold-600 transition-colors"
        >
          {project?.project_url ? "Open AutoReel project" : "Open AutoReel"}
          <ExternalGlyph />
        </button>
        {addressCopied ? (
          <span className="text-[11px] font-medium text-emerald-700">
            ✓ Address copied — ready to paste
          </span>
        ) : null}
        {!showLinkInput ? (
          <button
            type="button"
            onClick={() => setShowLinkInput(true)}
            className="text-xs text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
          >
            {project?.project_url ? "Update project link" : "Save project link"}
          </button>
        ) : null}
      </div>

      {showLinkInput ? (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <input
              type="url"
              autoFocus
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              placeholder="https://www.autoreelapp.com/listings/..."
              className="flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
            <button
              type="button"
              onClick={() => void saveLink()}
              disabled={saving || !linkDraft.trim()}
              className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            Copy the address-bar URL from the AutoReel project page so this
            listing's button deep-links straight back to it.
          </p>
          {saveError ? (
            <p className="mt-1 text-[11px] text-red-700">{saveError}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Import section
// ---------------------------------------------------------------------------

function ImportSection({
  listing,
  onImported,
}: {
  listing: AutoReelListingSummary;
  onImported: (gpId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneGpId, setDoneGpId] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const runImport = useCallback(async () => {
    const videoUrl = url.trim();
    if (!videoUrl) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          mls_number: listing.mls_number,
          video_url: videoUrl,
        }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        gp_id?: string;
        caption?: string;
        already_imported?: boolean;
      };
      if (!j.ok || !j.gp_id) {
        setError(j.error ?? "Import failed — try again.");
      } else {
        setDoneGpId(j.gp_id);
        setCaption(j.caption ?? null);
        onImported(j.gp_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed — try again.");
    } finally {
      setBusy(false);
    }
  }, [url, listing.mls_number, onImported]);

  async function publishNow() {
    if (!doneGpId) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", gp_id: doneGpId }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) {
        setError(j.error ?? "Could not queue the reel.");
      } else {
        setPublished(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the reel.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="border-t border-neutral-100 pt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        2 · Import the finished video
      </h3>
      {doneGpId ? (
        <div className="mt-2 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5">
          {published ? (
            <>
              <p className="text-sm font-medium text-emerald-900">
                Queued — posting to Facebook + Instagram within about 5 minutes.
              </p>
              <p className="mt-0.5 text-xs text-emerald-800">
                Track it in{" "}
                <a
                  href="/saved-posts"
                  className="font-semibold underline underline-offset-2"
                >
                  Saved Posts
                </a>
                . The listing agent gets their notification email on publish.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-emerald-900">
                Reel imported — captions are drafted from the listing.
              </p>
              {caption ? (
                <p className="mt-1.5 text-xs text-emerald-800 leading-relaxed line-clamp-3 border-l-2 border-emerald-300 pl-2">
                  {caption}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void publishNow()}
                  disabled={publishing}
                  className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-600 disabled:opacity-50 transition-colors"
                >
                  {publishing ? "Queueing…" : "Publish to FB + IG"}
                </button>
                <a
                  href={`/post-builder/autoreel-review?gp=${doneGpId}`}
                  className="text-xs font-medium text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
                >
                  Watch it &amp; edit captions first
                </a>
              </div>
            </>
          )}
          {error ? (
            <p className="mt-1.5 text-[11px] text-red-700">{error}</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
            When the video is done in AutoReel, right-click it and choose{" "}
            <span className="font-medium text-neutral-800">
              Copy Video Address
            </span>{" "}
            (the link starts with media.autoreelapp.com), then paste it here.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://media.autoreelapp.com/renders/…/out.mp4"
              className="flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={busy || !url.trim()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
          {busy ? (
            <p className="mt-1.5 text-[11px] text-neutral-400">
              Downloading the video and drafting captions — this can take up to
              a minute for longer reels.
            </p>
          ) : null}
          {error ? (
            <p className="mt-1.5 text-[11px] text-red-700">{error}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chips + glyphs
// ---------------------------------------------------------------------------

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => undefined);
      }}
      disabled={!value}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 transition-colors"
      title={value}
    >
      <span className="font-medium">{label}</span>
      <span className="text-[9px] uppercase tracking-wide font-semibold text-neutral-500">
        {copied ? "✓ copied" : "copy"}
      </span>
    </button>
  );
}

function ClapperGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="12" rx="1.5" />
      <path d="M3 8l2-4 4 1-2 4M9 5l4 1-2 4M13 6l4 1-2 4M17 7l4 1" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6M15 3h6v6M10 14L21 3" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
