"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AddOpenHouseModal from "@/components/AddOpenHouseModal";
import SyncOpenHousesButton from "@/components/SyncOpenHousesButton";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { resolveHostingAgent } from "@/lib/open-houses/host-resolution";
import {
  MULTI_OH_MAX_PROPERTIES,
  MULTI_OH_MIN_PROPERTIES,
  type MultiOHEventInput,
  type MultiOHEventProperty,
  type PostBuilderListing,
  type PostFormat,
} from "@/lib/post-builder/types";
import {
  synthesizeMultiOHCaption,
  type CaptionTone,
  type MultiOHCaptionResult,
} from "@/lib/post-builder/multi-oh-caption-synth";
import type { TemplateMeta } from "@/lib/template-builder";

// ---------------------------------------------------------------------------
// NDJSON event union — re-declared client-side to keep import boundaries
// clean. Must stay in lockstep with `MultiOHStreamEvent` in
// `app/api/post-builder/multi-oh-generate/route.ts`. If a third consumer
// shows up, promote to a shared module under `lib/post-builder/`.
// ---------------------------------------------------------------------------

type StreamEvent =
  | { type: "started"; totalSlides: number; format: PostFormat }
  | { type: "hero_started" }
  | { type: "hero_done"; url: string }
  | { type: "slide_started"; index: number; address: string | null }
  | { type: "slide_done"; index: number; url: string }
  | { type: "slide_failed"; index: number; error: string; address: string | null }
  | {
      type: "completed";
      generatedPostId: string;
      redirectPath: string;
      heroUrl: string;
      failedIndices: number[];
    }
  | { type: "fatal"; error: string };

/** Tile state for the in-flight carousel skeleton overlay. */
type TileState = "pending" | "rendering" | "done" | "failed";

interface SlideTile {
  state: TileState;
  url: string | null;
  address: string | null;
  error: string | null;
}

/** Partial-progress state — set when `completed` arrives with any failures.
 *  Drives the retry / continue card inside the overlay. */
interface PartialResult {
  generatedPostId: string;
  redirectPath: string;
  heroUrl: string;
  /** failed slide indexes, sorted ascending. */
  failedIndices: readonly number[];
  /** Per-failure detail so the card can list "Slide 3: 511 E 11th couldn't render". */
  failedDetails: ReadonlyArray<{
    index: number;
    address: string | null;
    error: string;
  }>;
}

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** Per-property variants the multi-OH render endpoint accepts. Must match
 *  active templates in lib/post-builder/templates/registry.ts AND the
 *  MultiOHEventInput.per_property_variant constraint in types.ts.
 *  Updated 2026-05-21: v1 Hero Editorial was retired from the registry
 *  on 2026-05-17, so the wizard no longer offers it. v6 (Magazine Cover)
 *  and v8 (Standard NEW LISTING) added in its place. */
type PerPropertyVariant = "v2" | "v3" | "v6" | "v8";

interface Props {
  /** All upcoming-OH eligible listings, pre-fetched server-side. */
  listings: PostBuilderListing[];
  /** 2026-07-17 — company agent roster (sorted display names). The hosting
   *  agent combobox restricts entry to these so attribution (phone/photo by
   *  exact-name match) always resolves. */
  agentRoster?: string[];
  /** Office name pre-fill (defaults to "Century 21 Alliance"). */
  defaultOfficeName: string;
  /**
   * Phase 2E (2026-05-22) — admin-authored DB templates tagged for
   * open_house, keyed by format. The wizard surfaces these as additional
   * cards in Step 2's variant grid. Empty arrays per format when no DB
   * templates exist for OH (the section hides until one is published).
   */
  dbTemplatesByFormat: Record<PostFormat, TemplateMeta[]>;
}

// Hosting-agent resolution lives in lib/open-houses/host-resolution.ts so
// the dashboard row (UpcomingOpenHousesRow) and this wizard share one
// source of truth. Imported above.

/**
 * Wizard step index. 1-based so the stepper UI and the state agree.
 *
 * 2026-05-21 — collapsed from 4 steps to 3. The old Step 2 ("Event
 * details") collected an event-level agent name + phone, but those fields
 * duplicated the per-property hosting agent that each carousel slide
 * already carries. The remaining event-level input (event_title) moved up
 * into Step 1 right above the property picker.
 */
type StepIndex = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// sessionStorage persistence
// ---------------------------------------------------------------------------
//
// 2026-05-28 — Larissa kept losing all her picks whenever she refreshed
// the page or hit browser-back mid-wizard. We snapshot the wizard's
// human-input state into sessionStorage on every change, restore it on
// mount, and clear it on either Cancel or successful generate.
//
// We DO NOT persist transient state (generating / partialResult / slide
// tiles) — those rebuild from the NDJSON stream if the user retries. We
// also don't persist `captionEditorOpen` (a UI overlay, not a decision).
//
// Bump STORAGE_KEY suffix (v1 → v2) when the persisted shape changes so
// stale snapshots from an older deploy don't crash the wizard.

const STORAGE_KEY = "multi-oh-wizard-state-v1";
const MAX_AGE_HOURS = 24;

interface MultiOhWizardPersistedState {
  step: StepIndex;
  selectedMls: string[];
  perPropertyHostingAgent: Record<string, string>;
  format: PostFormat;
  dbTemplateId: string | null;
  tone: CaptionTone;
  captionOverride: string | null;
  /**
   * 2026-07-24 — sorted, comma-joined mls_numbers the caption override was
   * WRITTEN against. Lets Step 3 warn when the user went back and changed
   * the selection after authoring a custom caption (the override's embedded
   * schedule bullets go stale silently otherwise). Null when no override;
   * absent on legacy snapshots (treated as not-stale, no false alarms).
   */
  captionOverrideMlsKey?: string | null;
  /**
   * 2026-07-24 — set (ISO timestamp) when this snapshot's event was
   * successfully GENERATED. Replaces the old clear-on-success behavior:
   * clearing meant browser-back from the final-review screen landed on
   * /post-builder/multi-oh?step=3 with an empty wizard, and the
   * persistence write-effect then immediately saved that empty step-3
   * state — poisoning the snapshot so every subsequent wizard entry ALSO
   * opened on an empty Step 3 ("the system gets confused ... I need to
   * back out and start completely over", John 2026-07-24). Now the
   * snapshot survives generation carrying this stamp; the next mount
   * restores the picks, lands on Step 1, and offers Start-fresh.
   */
  completedAt?: string | null;
  captionPreviewPlatform: "instagram" | "facebook" | "tiktok";
  /** ISO timestamp the snapshot was taken — used to age it out. */
  savedAt: string;
}

/**
 * Read + validate the persisted wizard state. Returns null on:
 *   - sessionStorage unavailable (SSR, private mode, quota errors)
 *   - missing / unparseable / wrong-shape JSON
 *   - snapshot older than MAX_AGE_HOURS
 *
 * The shape check is intentionally loose — we only verify the fields the
 * hydrator actually reads. Anything beyond the contract is silently ignored
 * so we never throw at mount-time on a partially-corrupted blob.
 */
function readPersistedState(): MultiOhWizardPersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MultiOhWizardPersistedState>;
    if (!parsed || typeof parsed !== "object") return null;

    // Required shape checks — bail on anything we can't trust.
    if (
      typeof parsed.step !== "number" ||
      (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3)
    ) {
      return null;
    }
    if (!Array.isArray(parsed.selectedMls)) return null;
    if (parsed.selectedMls.some((v) => typeof v !== "string")) return null;
    if (
      !parsed.perPropertyHostingAgent ||
      typeof parsed.perPropertyHostingAgent !== "object"
    ) {
      return null;
    }
    if (parsed.format !== "square_1x1" && parsed.format !== "story_9x16") {
      return null;
    }
    if (
      parsed.dbTemplateId !== null &&
      typeof parsed.dbTemplateId !== "string"
    ) {
      return null;
    }
    const validTones: ReadonlyArray<CaptionTone> = [
      "auto",
      "coastal",
      "family",
      "investor",
      "cozy",
      "editorial",
    ];
    if (!validTones.includes(parsed.tone as CaptionTone)) return null;
    if (
      parsed.captionOverride !== null &&
      typeof parsed.captionOverride !== "string"
    ) {
      return null;
    }
    if (
      parsed.captionPreviewPlatform !== "instagram" &&
      parsed.captionPreviewPlatform !== "facebook" &&
      parsed.captionPreviewPlatform !== "tiktok"
    ) {
      return null;
    }
    // 2026-07-24 additions — OPTIONAL fields, so legacy snapshots (written
    // before this deploy) stay valid. Malformed values coerce to null
    // rather than invalidating the whole snapshot.
    if (
      parsed.captionOverrideMlsKey !== undefined &&
      parsed.captionOverrideMlsKey !== null &&
      typeof parsed.captionOverrideMlsKey !== "string"
    ) {
      parsed.captionOverrideMlsKey = null;
    }
    if (
      parsed.completedAt !== undefined &&
      parsed.completedAt !== null &&
      typeof parsed.completedAt !== "string"
    ) {
      parsed.completedAt = null;
    }
    if (typeof parsed.savedAt !== "string") return null;

    // Age check.
    const savedAtMs = Date.parse(parsed.savedAt);
    if (Number.isNaN(savedAtMs)) return null;
    const ageHours = (Date.now() - savedAtMs) / (1000 * 60 * 60);
    if (ageHours > MAX_AGE_HOURS) return null;

    return parsed as MultiOhWizardPersistedState;
  } catch {
    return null;
  }
}

function writePersistedState(state: MultiOhWizardPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private-mode failures are non-fatal — the wizard still
    // works, the user just loses persistence.
  }
}

function clearPersistedState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — same defensive posture as the writer.
  }
}

/**
 * Canonical order-insensitive identity for a property selection. Used to
 * detect when a caption override was authored against a DIFFERENT set of
 * properties than the one currently selected (reordering slides is fine —
 * the schedule bullets don't change — so we sort before joining).
 */
function mlsKeyOf(mls: readonly string[]): string {
  return [...mls].sort().join(",");
}

/**
 * Compact "5m ago" / "2h ago" formatter for the restored-picks banner.
 * Coarse on purpose — the banner only needs enough precision for the
 * user to recognize WHICH event was restored.
 */
function formatRelativeAgeShort(iso: string): string {
  const thenMs = Date.parse(iso);
  if (Number.isNaN(thenMs)) return "recently";
  const deltaMin = Math.floor(Math.max(0, Date.now() - thenMs) / 60_000);
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  return `${deltaHr}h ago`;
}

// 2026-05-22 — FormatCardMeta / FORMAT_CARDS / FormatCard removed. The
// format-picker step was retired earlier (we ship Portrait + Story for
// every post automatically), so the card-grid UI and its supporting types
// were dead code.
//
// 2026-05-27 — VARIANT_CARDS + VariantCardMeta removed. The legacy V1
// template registry was deleted on 2026-05-24; every per-property
// variant (v2/v3/v6/v8) now routes to the same `open_house/v1` canvas
// template inside the multi-OH generate route, so the picker grid was
// showing four distinct cards that all rendered identically. Step 2
// now surfaces only DB-template choices when they exist; otherwise it
// shows a single "Using the default Open House template" card.
// `perPropertyVariant` state remains so the legacy `variant` column on
// generated_posts continues to receive a non-null value.

// 2026-05-27 (Phase C) — rotating GENERATE_STATUSES timer was removed.
// Status text is now driven directly by NDJSON events from the streaming
// route (see `runGenerateStream` below) so the user sees true per-slide
// progress instead of a fake "Composing event overview…" message during
// what's actually slide 4 of 6.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-property Open House wizard.
 *
 * Three steps:
 *   1. Pick 2-9 properties (selection order = carousel order) + name the event
 *   2. Format + per-property variant
 *   3. Review (re-order via drag) + Generate
 *
 * Each per-property card carries its own hosting agent attribution (set
 * inline on Step 1), so there is no event-level agent name on the hero —
 * the previous Step 2 that collected one was retired 2026-05-21.
 *
 * State is entirely client-side; the only network call is the final
 * POST to /api/post-builder/multi-oh-generate. On ok=true we push to
 * /post-builder?gp=<id> so the standard editor/resume flow takes over.
 */
export default function MultiOHWizardClient({
  listings,
  agentRoster = [],
  defaultOfficeName,
  dbTemplatesByFormat,
}: Props) {
  const router = useRouter();
  // Task 18 — "Add Open House" modal (manual OH entry). On save we
  // router.refresh() so the server-fetched OH listings prop re-hydrates and
  // the newly-added property appears in the Step 1 picker.
  const [addOhOpen, setAddOhOpen] = useState(false);
  const searchParams = useSearchParams();

  // ---- persistence hydration --------------------------------------------
  // why: Larissa loses everything on refresh / back-nav today. We read
  // sessionStorage exactly ONCE during the initial render (lazy initial
  // value form of useState) so every persisted piece below seeds from the
  // same snapshot atomically — avoids a flash of default state.
  //
  // Stale mls_numbers are filtered out below in a useMemo so a refresh
  // after a listing expired doesn't crash the wizard.
  const persistedOnMount = useRef<MultiOhWizardPersistedState | null>(null);
  if (persistedOnMount.current === null && typeof window !== "undefined") {
    // Set on first client render only; useRef pattern keeps it from
    // re-reading sessionStorage on every render.
    persistedOnMount.current = readPersistedState();
  }
  const initial = persistedOnMount.current;

  // why: URL ?step=N seeds the mounted step (subject to the validation in
  // the step initializer below) so a refresh restores to the same screen.
  // We only honour 2 or 3 because Step 1 doesn't get a URL param (keeps
  // the entry URL clean).
  const urlStepRaw = searchParams?.get("step");
  const urlStep =
    urlStepRaw === "2" ? 2 : urlStepRaw === "3" ? 3 : null;

  // ---- step machine ------------------------------------------------------
  // 2026-07-24 — the mounted step is now VALIDATED against what the
  // restored state can actually support, instead of trusting the URL /
  // snapshot blindly. Two rules:
  //
  //   1. A COMPLETED snapshot (its event already generated) always lands
  //      on Step 1 — the picks are restored for tweak-and-regenerate, but
  //      Steps 2/3 assume an in-progress editing session. This is the
  //      browser-back-from-final-review path: the URL still says ?step=3
  //      but the right destination is the start of a fresh pass.
  //   2. Steps 2/3 REQUIRE a valid selection (≥ MULTI_OH_MIN_PROPERTIES
  //      surviving listings). Mounting on Step 3 with zero properties —
  //      which is what a stale ?step=3 URL produced before this guard —
  //      rendered an empty review screen whose Generate could never
  //      succeed, and the write-effect then persisted that broken state.
  const [step, setStep] = useState<StepIndex>(() => {
    if (initial?.completedAt) return 1;
    const wanted: StepIndex = urlStep ?? initial?.step ?? 1;
    if (wanted === 1) return 1;
    const availableSet = new Set(listings.map((l) => l.mls_number));
    const restoredCount = initial
      ? initial.selectedMls.filter((mls) => availableSet.has(mls)).length
      : 0;
    return restoredCount >= MULTI_OH_MIN_PROPERTIES ? wanted : 1;
  });

  // ---- step 1 — selection -----------------------------------------------
  /** mls_numbers in selection order; the carousel slide order follows this
   *  list 1:1. Drag-reorder on step 4 mutates this same array.
   *
   *  Defensive filter on hydrate: if a listing the user picked yesterday
   *  no longer appears in `listings` (its OH window passed, MLS pulled it,
   *  etc.) we drop it from the restored selection rather than crash when
   *  the renderer tries to look it up.
   */
  const [selectedMls, setSelectedMls] = useState<readonly string[]>(() => {
    if (!initial) return [];
    const availableSet = new Set(listings.map((l) => l.mls_number));
    return initial.selectedMls.filter((mls) => availableSet.has(mls));
  });
  /**
   * Per-property hosting agent override, keyed by mls_number.
   *
   * why: a single multi-OH event can span homes hosted by different agents.
   * The event hero shows ONE primary agent (event-level attribution), but the
   * per-property card + the hero's "Hosted by" sub-line should reflect THAT
   * property's hosting agent. This state holds the per-property override so
   * the wizard can collect it in Step 1 and ship it through the payload.
   *
   * The default for each selected property is the listing's own `agent_name`
   * (so the typical case — Larissa hosts everything — needs zero typing). The
   * user can override per row when a different agent is covering that home.
   *
   * Keys are added when a property is selected and removed when deselected,
   * so this map stays in sync with `selectedMls`. The values are stored as
   * raw strings (not trimmed) while the user is typing; trimming happens at
   * payload-construction time so the input feels natural mid-edit.
   */
  const [perPropertyHostingAgent, setPerPropertyHostingAgent] = useState<
    Record<string, string>
  >(() => {
    if (!initial) return {};
    // Defensive: drop entries for mls_numbers that didn't survive the
    // selection filter above so the map can't get out of sync.
    const availableSet = new Set(listings.map((l) => l.mls_number));
    const out: Record<string, string> = {};
    for (const [mls, agent] of Object.entries(initial.perPropertyHostingAgent)) {
      if (availableSet.has(mls)) out[mls] = agent;
    }
    return out;
  });

  // ---- step 1 (cont.) — bulk hosting agent -----------------------------
  // why: the common case is "Larissa hosts everything" — set once at the
  // top of the picker rather than re-typing on every row. The control
  // OVERWRITES every per-row value when applied (even if the user had
  // individually customized rows already), and the dismissible hint below
  // it offers an undo that re-derives each row from its listing.
  // 2026-05-28 — bulk hosting agent override removed. The per-property
  // hosting-agent input under each property card is still available for
  // anyone who needs to override.

  // ---- step 1 (cont.) — event title ------------------------------------
  // 2026-05-28 — event_title input + auto-derive removed from Step 1. The
  // server derives a deterministic title from the picked OH dates inside
  // the multi-oh-generate route (no user input needed).

  // ---- step 2 — format + variant ---------------------------------------
  const [format, setFormat] = useState<PostFormat>(
    initial?.format ?? "square_1x1",
  );
  const [perPropertyVariant, setPerPropertyVariant] = useState<PerPropertyVariant>("v2");
  /**
   * Phase 2E — when set, every per-property card in the carousel renders
   * via the admin-authored DB template at this UUID instead of the
   * legacy `perPropertyVariant` registry entry. Mutually exclusive with
   * the variant choice in the UI (picking a DB card clears the legacy
   * variant from the active state; picking a legacy card clears this).
   */
  const [dbTemplateId, setDbTemplateId] = useState<string | null>(
    initial?.dbTemplateId ?? null,
  );

  // 2026-05-27 (Phase 6) — `focusedSlideKey` state was removed along with
  // the featured-slide preview. The new Step 3 has no "selected slide"
  // concept; tiles just sit in a grid.

  // ---- step 3 — caption tone + override ---------------------------------
  // 2026-05-27 (Phase 6) — Step 3 now shows a live caption preview with a
  // tone picker (Auto / Coastal / Family / Investor / Cozy / Editorial) and
  // an "Edit caption" overlay for full text override. Both ship through to
  // the multi-oh-generate route in the payload below.
  //
  // `captionOverride` is null when auto-synth is active. When non-null, the
  // tone picker is disabled (override always wins) and the preview shows
  // the override + a "Custom caption" pill. Setting it back to null re-
  // enables auto + the tone picker.
  const [tone, setTone] = useState<CaptionTone>(initial?.tone ?? "auto");
  const [captionOverride, setCaptionOverride] = useState<string | null>(
    initial?.captionOverride ?? null,
  );
  /**
   * 2026-07-24 — the selection identity (sorted mls key) the current
   * captionOverride was authored against. Compared to the live selection
   * in Step 3 to warn when the override's embedded schedule went stale
   * because the user went back and changed the property picks.
   */
  const [captionOverrideMlsKey, setCaptionOverrideMlsKey] = useState<
    string | null
  >(initial?.captionOverrideMlsKey ?? null);
  /** Which platform tab is active in the Step 3 caption preview. */
  const [captionPreviewPlatform, setCaptionPreviewPlatform] = useState<
    "instagram" | "facebook" | "tiktok"
  >(initial?.captionPreviewPlatform ?? "instagram");
  /** Whether the full-screen "Edit caption" overlay is mounted. */
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);

  // ---- restored-after-generation banner ---------------------------------
  // 2026-07-24 — when the mount snapshot carries completedAt, we restored
  // the picks from an ALREADY-GENERATED event (the user navigated back
  // from, or after, final review). Surface that so tweak-and-regenerate
  // is a choice, not a surprise — with a one-click Start-fresh escape.
  // Reads the mount-time ref (not live storage) so the banner survives
  // the write-effect immediately re-stamping the snapshot as in-progress.
  const [restoredBanner, setRestoredBanner] = useState<{
    completedAt: string;
  } | null>(() =>
    initial?.completedAt ? { completedAt: initial.completedAt } : null,
  );

  // ---- step 3 — generate state -----------------------------------------
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One-line status under the overlay header — driven by NDJSON events. */
  const [statusText, setStatusText] = useState<string>("Starting…");
  /** Hero tile state for the overlay skeleton. */
  const [heroTile, setHeroTile] = useState<SlideTile>({
    state: "pending",
    url: null,
    address: null,
    error: null,
  });
  /** Per-slide tile states for the overlay skeleton. Indexed by carousel
   *  slot 0..N-1. Rebuilt at every `started` event. */
  const [slideTiles, setSlideTiles] = useState<readonly SlideTile[]>([]);
  /** Partial-progress card state. Set when `completed` arrives with one or
   *  more `slide_failed` events. Null means: either still generating, or
   *  redirect already happened, or fatal happened. */
  const [partialResult, setPartialResult] = useState<PartialResult | null>(
    null,
  );

  // ---- persistence write effect -----------------------------------------
  // why: snapshot every state change to sessionStorage so refresh / back
  // nav restores the wizard. Effect runs after the render that produced
  // the change, so what we serialize is what's on screen. We omit
  // transient state (generating / partialResult / slide tiles) because
  // mid-flight progress isn't recoverable across a refresh anyway —
  // the user re-clicks Generate and we re-stream.
  //
  // 2026-07-24 — completedStampRef: once the generate flow stamps the
  // snapshot completed (see runGenerateStream's success path), this
  // effect must STOP writing. The success path triggers state updates
  // (setPartialResult(null) etc.) whose re-renders would otherwise fire
  // this effect one more time and overwrite the completed stamp with a
  // plain in-progress snapshot, resurrecting the empty-Step-3 bug the
  // stamp exists to fix. The ref is one-way for the component's
  // lifetime — after stamping, the wizard's next act is always the
  // redirect out.
  const completedStampRef = useRef(false);
  useEffect(() => {
    if (completedStampRef.current) return;
    writePersistedState({
      step,
      selectedMls: [...selectedMls],
      perPropertyHostingAgent,
      format,
      dbTemplateId,
      tone,
      captionOverride,
      captionOverrideMlsKey,
      completedAt: null,
      captionPreviewPlatform,
      savedAt: new Date().toISOString(),
    });
  }, [
    step,
    selectedMls,
    perPropertyHostingAgent,
    format,
    dbTemplateId,
    tone,
    captionOverride,
    captionOverrideMlsKey,
    captionPreviewPlatform,
  ]);

  /**
   * 2026-07-24 — stamp the CURRENT wizard state into sessionStorage as a
   * completed snapshot, then block the write-effect from overwriting it.
   * Called on both success exits (full success + continue-with-partial)
   * in place of the old clearPersistedState(): the picks survive so the
   * user can navigate back to tweak-and-regenerate, and the next mount
   * knows (via completedAt) to land on Step 1 with the restore banner
   * instead of trusting a stale ?step=3 URL into an empty review screen.
   */
  const markPersistedCompleted = useCallback((): void => {
    completedStampRef.current = true;
    writePersistedState({
      step,
      selectedMls: [...selectedMls],
      perPropertyHostingAgent,
      format,
      dbTemplateId,
      tone,
      captionOverride,
      captionOverrideMlsKey,
      completedAt: new Date().toISOString(),
      captionPreviewPlatform,
      savedAt: new Date().toISOString(),
    });
  }, [
    step,
    selectedMls,
    perPropertyHostingAgent,
    format,
    dbTemplateId,
    tone,
    captionOverride,
    captionOverrideMlsKey,
    captionPreviewPlatform,
  ]);

  // ---- URL ?step= sync --------------------------------------------------
  // why: the wizard's step state is the single source of truth and the
  // URL mirrors it (router.replace, so internal Back/Continue clicks
  // don't stack history entries — the browser's own Back always exits
  // the wizard cleanly to wherever the user came from, with
  // sessionStorage carrying their progress for when they return). The
  // ?step= param exists so a refresh restores to the same screen and so
  // the mount-time clamp above can sanity-check deep links.
  //
  // Step 1 deliberately has NO query param (the bare URL is the entry
  // point) so we strip ?step= when stepping back to 1.
  useEffect(() => {
    const current = searchParams?.get("step");
    if (step === 1) {
      if (current !== null) {
        router.replace("/post-builder/multi-oh");
      }
    } else {
      const want = String(step);
      if (current !== want) {
        router.replace(`/post-builder/multi-oh?step=${want}`);
      }
    }
  }, [step, router, searchParams]);

  // ---- derived state ----------------------------------------------------

  const listingsByMls = useMemo(() => {
    const map = new Map<string, PostBuilderListing>();
    for (const l of listings) map.set(l.mls_number, l);
    return map;
  }, [listings]);

  /** The picked listings, resolved in pick order. We filter undefined to be
   *  defensive against a stale mls_number — shouldn't happen in practice
   *  since the list is fixed for the lifetime of the wizard. */
  const selectedListings = useMemo<readonly PostBuilderListing[]>(() => {
    const out: PostBuilderListing[] = [];
    for (const mls of selectedMls) {
      const found = listingsByMls.get(mls);
      if (found) out.push(found);
    }
    return out;
  }, [selectedMls, listingsByMls]);

  /**
   * Consolidation summary — the wizard merges multiple picks of the same MLS
   * (a condo with Sat + Sun OHs picked twice) into ONE carousel slide carrying
   * an oh_sessions[] array. We surface that math inline on Step 1 so the user
   * isn't surprised when "5 windows" renders as 4 slides.
   *
   * Mirrors the server-side consolidatePropertiesByMls in route.ts so the hint
   * and the eventual render agree. Returns null when nothing was consolidated
   * (no hint to show).
   */
  const consolidationSummary = useMemo<{
    pickCount: number;
    slideCount: number;
    duplicateExamples: string[];
    extraDuplicates: number;
  } | null>(() => {
    if (selectedListings.length < 2) return null;
    const counts = new Map<string, { listing: PostBuilderListing; count: number }>();
    for (const l of selectedListings) {
      const existing = counts.get(l.mls_number);
      if (existing) existing.count += 1;
      else counts.set(l.mls_number, { listing: l, count: 1 });
    }
    if (counts.size === selectedListings.length) return null;
    const duplicates: PostBuilderListing[] = [];
    for (const { listing, count } of counts.values()) {
      if (count > 1) duplicates.push(listing);
    }
    const exampleNames = duplicates.slice(0, 2).map((l) => {
      const base = (l.address ?? "").trim();
      return base.length > 0 ? base : l.mls_number;
    });
    return {
      pickCount: selectedListings.length,
      slideCount: counts.size,
      duplicateExamples: exampleNames,
      extraDuplicates: Math.max(0, duplicates.length - exampleNames.length),
    };
  }, [selectedListings]);

  // 2026-05-28 — bulk hosting-agent apply / undo callbacks removed alongside
  // the "Hosted by everyone" UI strip. Per-property hosting-agent inputs
  // under each card remain the only entry point.

  // 2026-05-27 (Phase C) — the 4s rotating-status ticker was removed.
  // The streaming route emits `slide_started` / `slide_done` events as
  // each slot lands, and `statusText` is updated directly from those
  // events in `runGenerateStream` below.

  // ---- selection handlers ----------------------------------------------

  const toggleSelect = useCallback(
    (mls: string): void => {
      // why: capture the resolved hosting agent eagerly here so the
      // selection branch below can seed the per-property hosting-agent map
      // without re-resolving from the listings array inside the setter.
      //
      // resolveHostingAgent scans the open house's `comments` field for a
      // "Hosted by {Name}" pattern first, falling back to the listing's
      // own agent_name. Larissa often delegates open-house hosting to a
      // different agent and notes it in the OH remarks — this auto-detect
      // saves her from manually re-typing host names per property.
      //
      // NOTE: must pass `oh_comments` (open house notes), NOT
      // `public_remarks` (the property's MLS description) — the hosting
      // pattern only lives on the open_houses row.
      const listing = listingsByMls.get(mls);
      const defaultAgent = resolveHostingAgent(
        listing?.oh_comments,
        listing?.agent_name,
      );

      setSelectedMls((prev) => {
        const idx = prev.indexOf(mls);
        if (idx >= 0) {
          // Already selected — remove (and everything after stays in order).
          return prev.filter((m) => m !== mls);
        }
        // Adding — enforce the cap.
        if (prev.length >= MULTI_OH_MAX_PROPERTIES) return prev;
        return [...prev, mls];
      });

      // why: keep the hosting-agent map in lockstep with selection so a
      // deselected mls doesn't leave a stale value hanging around that
      // could leak into the payload if the user re-selects later. Selecting
      // for the first time seeds the value with the listing's own agent so
      // the input field doesn't appear empty when the typical case (Larissa
      // hosts everything) is to just leave it as-is.
      setPerPropertyHostingAgent((prev) => {
        if (prev[mls] !== undefined) {
          // Already had an entry → this toggle is a DESELECT; strip the key.
          const next = { ...prev };
          delete next[mls];
          return next;
        }
        // First-time SELECT → seed the default. Empty string is fine; the
        // input will render with a placeholder hint and the payload code
        // will coerce empty → null.
        return { ...prev, [mls]: defaultAgent };
      });
    },
    [listingsByMls],
  );

  /**
   * Update the hosting-agent value for a single selected property. No-op for
   * un-selected mls keys — defensive against a stale callback firing after
   * the user deselected (e.g., debounced input handlers).
   *
   * why: kept as a useCallback so the Step1 row inputs don't churn React's
   * key map on every parent re-render.
   */
  const setHostingAgentForProperty = useCallback(
    (mls: string, value: string): void => {
      setPerPropertyHostingAgent((prev) => {
        if (prev[mls] === undefined) return prev;
        return { ...prev, [mls]: value };
      });
    },
    [],
  );

  // ---- step navigation --------------------------------------------------

  // 2026-05-28 — event-title input was removed; Step 1 gates only on the
  // minimum property count.
  const canContinueFromStep1 =
    selectedMls.length >= MULTI_OH_MIN_PROPERTIES;

  // 2026-05-28 — Bug 5 auto-skip: when no DB templates are published for
  // the active format, Step 2's only choice is "use the default Open
  // House template" which is what would happen anyway. Skip it to save
  // the user a pointless Continue click. When ANY DB templates are
  // available we keep the step visible so they can pick one.
  const dbTemplatesForFormat = dbTemplatesByFormat[format] ?? [];
  const skipStep2 = dbTemplatesForFormat.length === 0;

  const goToStep = useCallback(
    (target: StepIndex): void => {
      // Only allow jumping BACK to a completed step (stepper-bar click).
      // Going forward is gated by the Continue buttons + their disabled state.
      if (target <= step) {
        setStep(target);
        setError(null);
      }
    },
    [step],
  );

  // ---- step 4 — drag/drop reorder --------------------------------------
  // why: native HTML5 drag/drop is enough for a 2-9 row list. We track the
  // dragged mls in a ref so the dragstart->dragover->drop chain doesn't go
  // through React state and cause re-renders mid-drag.
  const dragMlsRef = useRef<string | null>(null);

  const onDragStart = useCallback((mls: string): void => {
    dragMlsRef.current = mls;
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault(); // allow drop
  }, []);

  const onDrop = useCallback(
    (targetMls: string): void => {
      const sourceMls = dragMlsRef.current;
      dragMlsRef.current = null;
      if (!sourceMls || sourceMls === targetMls) return;
      setSelectedMls((prev) => {
        const fromIdx = prev.indexOf(sourceMls);
        const toIdx = prev.indexOf(targetMls);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [],
  );

  // ---- touch reorder (mobile) ------------------------------------------
  // why: native HTML5 drag events never fire on touch screens, so the
  // iPhone PWA gets explicit "move earlier / later" buttons on each tile.
  // Same pure splice on selectedMls the drop handler performs — one state
  // shape, two input methods. (2026-07-24, mobile build.)
  const onMoveSlide = useCallback((mls: string, direction: -1 | 1): void => {
    setSelectedMls((prev) => {
      const fromIdx = prev.indexOf(mls);
      const toIdx = fromIdx + direction;
      if (fromIdx < 0 || toIdx < 0 || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // ---- generate (NDJSON streaming) -------------------------------------

  /**
   * Build the base payload the route consumes. Used for both fresh
   * generations and retries — the retry path tacks `retry_indices` +
   * `existing_generated_post_id` + `existing_hero_url` on top.
   *
   * why: hosting_agent_name comes from the per-property state map (Step 1
   * input). Trim + coerce empty → null so the renderer's "no Hosted by
   * line" branch fires when the user clears the field. We DO NOT fall
   * back to the listing's agent_name here — the state map was already
   * seeded with that default at selection time, so an empty value at
   * this point is the user explicitly asking to suppress the override.
   */
  const buildBasePayload = useCallback((): MultiOHEventInput => {
    const properties: MultiOHEventProperty[] = selectedListings.map((l) => {
      const rawHost = perPropertyHostingAgent[l.mls_number] ?? "";
      const trimmedHost = rawHost.trim();
      return {
        mls_number: l.mls_number,
        source_mls: l.source_mls,
        listing_id: l.id,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip,
        list_price: l.list_price,
        bedrooms: l.bedrooms,
        bathrooms_full: l.bathrooms_full,
        bathrooms_half: l.bathrooms_half,
        property_type: l.property_type,
        hero_image_url: l.hero_image_url,
        oh_start_at: l.oh_start_at ?? null,
        oh_end_at: l.oh_end_at ?? null,
        hosting_agent_name: trimmedHost.length > 0 ? trimmedHost : null,
        unit_number: l.unit_number ?? null,
      };
    });
    return {
      // 2026-05-28 — event_title was removed from the payload. The
      // multi-oh-generate route derives a deterministic title from the
      // picked OH dates server-side.
      // why: event-level agent fields (agent_name / agent_phone /
      // agent_email) were removed from the wizard on 2026-05-21 — the
      // event hero no longer attributes a single agent because each
      // per-property card carries its own hosting agent. We send null
      // to keep the type contract intact; the renderer + caption
      // synth both tolerate nulls.
      agent_name: null,
      agent_phone: null,
      agent_email: null,
      // office_name is hardcoded to defaultOfficeName ("Century 21
      // Alliance") because there's only one office and the renderer's
      // brand strip says it explicitly already.
      office_name: defaultOfficeName,
      format,
      per_property_variant: perPropertyVariant,
      // Phase 2E — when a DB template was picked, send its UUID; the
      // route uses it instead of per_property_variant for every slide.
      db_template_id: dbTemplateId,
      // Phase 6 (2026-05-27) — tone bias + optional caption override
      // collected on Step 3. The route forwards both into the shared
      // synth module; override wins over tone when set.
      tone,
      caption_override: captionOverride,
      properties,
    };
  }, [
    selectedListings,
    format,
    perPropertyVariant,
    dbTemplateId,
    defaultOfficeName,
    perPropertyHostingAgent,
    tone,
    captionOverride,
  ]);

  /**
   * Core NDJSON streaming runner. Consumes the multi-oh-generate response
   * body line-by-line, updating the carousel skeleton state on each
   * event. Returns when the stream closes — either after `completed` (in
   * which case caller decides redirect vs partial card based on
   * failedIndices) or `fatal` (caller surfaces the error).
   *
   * Why the consumer is inlined here rather than a hook: keeps every
   * piece of state it touches lexically adjacent. The reader loop is the
   * only place where dozens of slide-tile setState calls cluster; pulling
   * it into a separate file would create a long callback-prop drilling
   * boundary for negligible reuse benefit (only one caller).
   *
   * If the user closes the wizard mid-stream, the writer on the server
   * detects the disconnect on the next write and stops emitting, but the
   * heavy work continues — the row still lands in the DB, and the user
   * can resume via "Created Posts" if they re-open the app.
   */
  const runGenerateStream = useCallback(
    async (
      body: Record<string, unknown>,
      mode: "fresh" | "retry",
      retrySet?: ReadonlySet<number>,
    ): Promise<void> => {
      // Local mirrors of the failures we see during this stream. We
      // collect them here and use them when `completed` arrives to build
      // the PartialResult — relying on slideTiles state inside the
      // reader loop would race against React batching.
      const localFailures = new Map<
        number,
        { address: string | null; error: string }
      >();

      let res: Response;
      try {
        res = await fetch("/api/post-builder/multi-oh-generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Network error: ${msg}`);
        setGenerating(false);
        return;
      }

      if (!res.ok || !res.body) {
        // Pre-stream failure — the route returned a 4xx JSON body for
        // auth / validation. Parse defensively.
        const text = await res.text().catch(() => "");
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) errMsg = parsed.error;
        } catch {
          // non-JSON proxy error — surface the raw snippet
          if (text) errMsg = `${errMsg}: ${text.slice(0, 200)}`;
        }
        setError(errMsg);
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawCompleted = false;
      let sawFatal: string | null = null;
      let completedEvent: Extract<StreamEvent, { type: "completed" }> | null =
        null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          switch (evt.type) {
            case "started": {
              // Initialise the skeleton tiles. In retry mode the hero is
              // already done (we passed its URL on the request), so we
              // leave heroTile alone — only the retried slide tiles flip
              // back to "rendering".
              if (mode === "fresh") {
                setHeroTile({
                  state: "pending",
                  url: null,
                  address: null,
                  error: null,
                });
                setSlideTiles(
                  Array.from({ length: evt.totalSlides }, () => ({
                    state: "pending" as TileState,
                    url: null,
                    address: null,
                    error: null,
                  })),
                );
                setStatusText("Preparing carousel…");
              } else if (retrySet) {
                // Flip just the retried slots back to pending; leave the
                // rest (their thumbnails already on screen).
                setSlideTiles((prev) =>
                  prev.map((t, i) =>
                    retrySet.has(i)
                      ? { state: "pending", url: null, address: t.address, error: null }
                      : t,
                  ),
                );
                setStatusText(
                  `Retrying ${retrySet.size} slide${retrySet.size === 1 ? "" : "s"}…`,
                );
              }
              break;
            }
            case "hero_started": {
              setHeroTile((t) => ({ ...t, state: "rendering" }));
              setStatusText("Rendering hero…");
              break;
            }
            case "hero_done": {
              setHeroTile({
                state: "done",
                url: evt.url,
                address: null,
                error: null,
              });
              setStatusText("Hero ready — rendering slides…");
              break;
            }
            case "slide_started": {
              setSlideTiles((prev) =>
                prev.map((t, i) =>
                  i === evt.index
                    ? { ...t, state: "rendering", address: evt.address }
                    : t,
                ),
              );
              setStatusText(`Rendering slide ${evt.index + 1}…`);
              break;
            }
            case "slide_done": {
              setSlideTiles((prev) =>
                prev.map((t, i) =>
                  i === evt.index
                    ? { state: "done", url: evt.url, address: t.address, error: null }
                    : t,
                ),
              );
              break;
            }
            case "slide_failed": {
              localFailures.set(evt.index, {
                address: evt.address,
                error: evt.error,
              });
              setSlideTiles((prev) =>
                prev.map((t, i) =>
                  i === evt.index
                    ? {
                        state: "failed",
                        url: null,
                        address: evt.address,
                        error: evt.error,
                      }
                    : t,
                ),
              );
              break;
            }
            case "completed": {
              sawCompleted = true;
              completedEvent = evt;
              break;
            }
            case "fatal": {
              sawFatal = evt.error;
              break;
            }
          }
        }
      }

      if (sawFatal) {
        setError(sawFatal);
        setGenerating(false);
        return;
      }
      if (!sawCompleted || !completedEvent) {
        // Stream closed without a terminal event — defensive backstop.
        setError("Generation ended without a result. Please try again.");
        setGenerating(false);
        return;
      }

      const failedIndices = completedEvent.failedIndices;
      if (failedIndices.length === 0) {
        setStatusText("All done — redirecting…");
        // why: clear partialResult before navigating so a stale card
        // doesn't flash if the user comes back via browser-back.
        setPartialResult(null);
        // 2026-07-24 — stamp the snapshot COMPLETED instead of clearing
        // it. Clearing meant browser-back from final review re-mounted
        // the wizard on ?step=3 with nothing selected, and the write
        // effect then persisted that empty state — every later entry
        // opened broken until Cancel was clicked from Step 1. With the
        // stamp, the next mount restores these picks on Step 1 with a
        // "restored" banner + Start-fresh button. The 24h age-out still
        // guarantees tomorrow starts clean.
        markPersistedCompleted();
        router.push(completedEvent.redirectPath);
        return;
      }

      // One or more slides failed — surface the partial-progress card.
      setStatusText(
        `Hero + ${failedIndices.length === 1 ? "1 slide" : `${failedIndices.length} slides`} need attention`,
      );
      const failedDetails = failedIndices.map((idx) => {
        const localMatch = localFailures.get(idx);
        return {
          index: idx,
          address: localMatch?.address ?? null,
          error: localMatch?.error ?? "Render failed.",
        };
      });
      setPartialResult({
        generatedPostId: completedEvent.generatedPostId,
        redirectPath: completedEvent.redirectPath,
        heroUrl: completedEvent.heroUrl,
        failedIndices,
        failedDetails,
      });
      setGenerating(false);
    },
    [router, markPersistedCompleted],
  );

  /**
   * User-facing "Generate carousel post" button handler. Builds the
   * fresh payload, resets every overlay slot, and runs the stream.
   */
  const generate = useCallback(async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    setPartialResult(null);
    setStatusText("Starting…");
    setHeroTile({ state: "pending", url: null, address: null, error: null });
    setSlideTiles([]);
    const payload = buildBasePayload();
    await runGenerateStream(payload as unknown as Record<string, unknown>, "fresh");
  }, [buildBasePayload, runGenerateStream]);

  /**
   * Partial-progress retry — re-renders only the slides that failed in
   * the previous stream. The hero is left alone (we pass its URL on the
   * request so the route can skip rendering it) and the existing
   * generated_posts row is UPDATEd in place by the route.
   */
  const retryFailedSlides = useCallback(async (): Promise<void> => {
    if (!partialResult) return;
    const retryIndices = [...partialResult.failedIndices];
    if (retryIndices.length === 0) return;
    const retrySet = new Set(retryIndices);
    setGenerating(true);
    setError(null);
    // why: keep partialResult on screen until the new stream resolves.
    // The skeleton card stays mounted; only the retried slots flip back
    // to "rendering" via the `started` event handler above. Once the
    // retry finishes we either redirect (zero failures) or replace the
    // partial card with the new failure set.
    const basePayload = buildBasePayload();
    const retryPayload: Record<string, unknown> = {
      ...basePayload,
      retry_indices: retryIndices,
      existing_generated_post_id: partialResult.generatedPostId,
      existing_hero_url: partialResult.heroUrl,
    };
    setPartialResult(null);
    setStatusText(
      `Retrying ${retryIndices.length === 1 ? "1 slide" : `${retryIndices.length} slides`}…`,
    );
    await runGenerateStream(retryPayload, "retry", retrySet);
  }, [partialResult, buildBasePayload, runGenerateStream]);

  /**
   * "Continue with what rendered" — abandon the failed slides and
   * redirect to the editor with the partial post. The user can finish
   * or remove the failed slides manually in Studio.
   */
  const continueWithPartial = useCallback((): void => {
    if (!partialResult) return;
    setPartialResult(null);
    // why: same rationale as the zero-failure success path — the user is
    // leaving the wizard with a generated post in hand. Stamp the
    // snapshot completed (2026-07-24, was clearPersistedState) so a
    // back-navigation restores the picks instead of an empty wizard.
    markPersistedCompleted();
    router.push(partialResult.redirectPath);
  }, [partialResult, router, markPersistedCompleted]);

  /**
   * 2026-07-24 — one-click reset from the restored-picks banner. Clears
   * both the persisted snapshot and every piece of restored state so the
   * wizard is exactly as if entered for the first time.
   */
  const startFresh = useCallback((): void => {
    clearPersistedState();
    setRestoredBanner(null);
    setStep(1);
    setSelectedMls([]);
    setPerPropertyHostingAgent({});
    setFormat("square_1x1");
    setDbTemplateId(null);
    setTone("auto");
    setCaptionOverride(null);
    setCaptionOverrideMlsKey(null);
    setCaptionPreviewPlatform("instagram");
    setError(null);
  }, []);

  /* 2026-08-06 (John) — "we need to remove the notification prompting us that
     a property has previously had an Open House post created for it. There
     are several properties that will have Open Houses every weekend, so it
     will be common to have multiple OH posts for the same Property."

     The 2026-07-17 coverage feature is gone from this wizard: the Props
     `postedCoverage` bag, the Step 1 summary banner, the per-row "✓ Posted"
     chips, and the 2026-07-24 duplicate-promotion confirm dialog. Generate now
     runs straight through. Any future "still outstanding" signal has to key on
     the open-house occurrence, not the property. */


  // ---- render -----------------------------------------------------------

  return (
    <div className="relative">
      <Stepper
        currentStep={step}
        onJump={goToStep}
        skipStep2={skipStep2}
      />

      {restoredBanner ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-900">
          <div>
            <span className="font-semibold">
              Restored the picks from your last event
            </span>{" "}
            <span className="text-gold-800">
              (generated {formatRelativeAgeShort(restoredBanner.completedAt)}).
              Tweak anything and generate again to make a new post, or start
              over from scratch.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={startFresh}
              className="rounded-md border border-gold-300 bg-white px-3 py-1 text-xs font-semibold text-gold-800 hover:bg-gold-100 transition"
            >
              Start fresh
            </button>
            <button
              type="button"
              onClick={() => setRestoredBanner(null)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-gold-700 hover:bg-gold-100 transition"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-semibold mb-0.5">Generate failed</div>
          <div className="text-red-700">{error}</div>
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl pb-32">
        {step === 1 ? (
          <Step1Pick
            listings={listings}
            agentRoster={agentRoster}
            selectedMls={selectedMls}
            onToggle={toggleSelect}
            perPropertyHostingAgent={perPropertyHostingAgent}
            onHostingAgentChange={setHostingAgentForProperty}
            consolidationSummary={consolidationSummary}
            onAddOpenHouse={() => setAddOhOpen(true)}
          />
        ) : null}
        {step === 2 ? (
          <Step2FormatVariant
            format={format}
            dbTemplates={dbTemplatesByFormat[format] ?? []}
            dbTemplateId={dbTemplateId}
            onDbTemplateChange={(id) => {
              // 2026-05-27 — picking a DB template no longer clears any
              // legacy variant state; `perPropertyVariant` is just a
              // legacy column write now (every variant routes to the
              // same canvas template inside the generate route).
              setDbTemplateId(id);
            }}
          />
        ) : null}
        {step === 3 ? (
          <Step3Review
            selectedListings={selectedListings}
            tone={tone}
            onToneChange={setTone}
            captionOverride={captionOverride}
            onCaptionOverrideChange={(next) => {
              // 2026-07-24 — record WHICH property set the override was
              // written against so Step 3 can flag it stale if the user
              // later goes back and changes the selection. Clearing the
              // override clears the key.
              setCaptionOverride(next);
              setCaptionOverrideMlsKey(
                next !== null && next.length > 0 ? mlsKeyOf(selectedMls) : null,
              );
            }}
            overrideStale={
              captionOverride !== null &&
              captionOverride.length > 0 &&
              captionOverrideMlsKey !== null &&
              captionOverrideMlsKey !== mlsKeyOf(selectedMls)
            }
            captionPreviewPlatform={captionPreviewPlatform}
            onCaptionPreviewPlatformChange={setCaptionPreviewPlatform}
            captionEditorOpen={captionEditorOpen}
            onOpenCaptionEditor={() => setCaptionEditorOpen(true)}
            onCloseCaptionEditor={() => setCaptionEditorOpen(false)}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onMoveSlide={onMoveSlide}
          />
        ) : null}
      </div>

      <StickyFooter
        step={step}
        selectedCount={selectedMls.length}
        canContinueFromStep1={canContinueFromStep1}
        onBack={() => {
          // 2026-05-28 — Bug 5: when Step 2 is being auto-skipped (no
          // DB templates published), Back from Step 3 jumps straight
          // to Step 1 instead of momentarily landing on the empty
          // Step 2. Symmetric with onContinue's skip behaviour below.
          //
          // why setStep instead of router.back(): router.back() in a
          // Next.js app router context replays the previous history
          // entry, which for a wizard entry might be /post-builder —
          // i.e., leaves the wizard entirely. Driving the step machine
          // directly keeps the user in the wizard, and the URL-sync
          // useEffect handles the ?step= rewrite + history entry.
          if (step === 3 && skipStep2) {
            setStep(1);
            setError(null);
            return;
          }
          goToStep((step - 1) as StepIndex);
        }}
        onCancel={() => {
          // why: Cancel leaves the wizard entirely — wipe persistence
          // so the next visit starts fresh. We trigger the navigation
          // ourselves (used to be a <Link>) so the clear happens
          // synchronously before the route transition.
          clearPersistedState();
          router.push("/post-builder");
        }}
        onContinue={() => {
          if (step === 1 && canContinueFromStep1) {
            // 2026-05-28 — Bug 5: when no DB templates are published
            // for the active format, Step 2's only outcome is "use
            // the default". Skip straight to Step 3 so the user
            // doesn't have to click Continue through an empty
            // pick screen.
            setStep(skipStep2 ? 3 : 2);
          } else if (step === 2) setStep(3);
        }}
        onGenerate={() => void generate()}
        generating={generating}
      />

      {generating || partialResult ? (
        <GeneratingOverlay
          statusText={statusText}
          heroTile={heroTile}
          slideTiles={slideTiles}
          partialResult={partialResult}
          generating={generating}
          onRetryFailed={retryFailedSlides}
          onContinuePartial={continueWithPartial}
        />
      ) : null}

      {/* Task 18 — manual "Add Open House" entry. router.refresh() re-runs
          the server page fetch so the new OH's listing appears in Step 1. */}
      <AddOpenHouseModal
        open={addOhOpen}
        onClose={() => setAddOhOpen(false)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

// ===========================================================================
// Stepper bar
// ===========================================================================

interface StepperProps {
  currentStep: StepIndex;
  onJump: (target: StepIndex) => void;
  /**
   * 2026-05-28 — Bug 5: when true, Step 2 ("Template") is dimmed in
   * the stepper bar because the wizard auto-skips it whenever no DB
   * templates are published for the active format. The label is still
   * visible so the user understands the step exists; it's just
   * disabled and not clickable.
   */
  skipStep2?: boolean;
}

const STEP_LABELS: readonly { id: StepIndex; label: string }[] = [
  { id: 1, label: "Pick properties" },
  { id: 2, label: "Template" },
  { id: 3, label: "Review + generate" },
];

function Stepper({ currentStep, onJump, skipStep2 }: StepperProps) {
  return (
    <ol className="mb-6 flex items-center gap-1.5 overflow-x-auto" aria-label="Wizard progress">
      {STEP_LABELS.map((s, idx) => {
        const isActive = s.id === currentStep;
        const isComplete = s.id < currentStep;
        // 2026-05-28 — Bug 5: dim + un-click Step 2 when it's being
        // auto-skipped. The pill stays in the bar so users still see
        // the three-step shape of the flow.
        const isSkipped = s.id === 2 && skipStep2 === true;
        const isClickable = s.id <= currentStep && !isSkipped;
        return (
          <li key={s.id} className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => isClickable && onJump(s.id)}
              disabled={!isClickable}
              aria-current={isActive ? "step" : undefined}
              title={isSkipped ? "Skipped — no admin templates published for this format" : undefined}
              className={[
                "flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-xs font-semibold transition",
                isSkipped
                  ? "bg-neutral-50 text-neutral-400 ring-1 ring-neutral-200 cursor-not-allowed opacity-60"
                  : isActive
                    ? "bg-gold-100 text-gold-900 ring-1 ring-gold-500/40"
                    : isComplete
                      ? "bg-gold-50 text-gold-800 hover:bg-gold-100 ring-1 ring-gold-200"
                      : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 cursor-not-allowed",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-bold",
                  isSkipped
                    ? "bg-neutral-300 text-white"
                    : isActive
                      ? "bg-gold-500 text-white"
                      : isComplete
                        ? "bg-gold-400 text-white"
                        : "bg-neutral-300 text-white",
                ].join(" ")}
              >
                {s.id}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
            {idx < STEP_LABELS.length - 1 ? (
              <span
                aria-hidden="true"
                className={[
                  "h-px w-6",
                  s.id < currentStep ? "bg-gold-400" : "bg-neutral-200",
                ].join(" ")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ===========================================================================
// Step 1 — Pick properties
// ===========================================================================

interface Step1Props {
  listings: readonly PostBuilderListing[];
  /** listing.id → latest published-OH-post ISO within 7 days (see Props). */
  /** Company agent roster for the hosting-agent combobox. */
  agentRoster: readonly string[];
  selectedMls: readonly string[];
  onToggle: (mls: string) => void;
  /**
   * Map of mls_number → current hosting agent override value. Keys exist
   * only for currently-selected properties (kept in lockstep by the parent).
   */
  perPropertyHostingAgent: Record<string, string>;
  /** Update one property's hosting agent override. */
  onHostingAgentChange: (mls: string, value: string) => void;
  /** Consolidation hint info (null when no duplicates picked). Surfaces the
   *  N-picks → M-slides math so the user isn't surprised the carousel is
   *  smaller than their pick count. */
  consolidationSummary:
    | {
        pickCount: number;
        slideCount: number;
        duplicateExamples: string[];
        extraDuplicates: number;
      }
    | null;
  /** Task 18 — opens the shared Add Open House modal (manual OH entry). */
  onAddOpenHouse: () => void;
}

function Step1Pick({
  listings,
  agentRoster,
  selectedMls,
  onToggle,
  perPropertyHostingAgent,
  onHostingAgentChange,
  consolidationSummary,
  onAddOpenHouse,
}: Step1Props) {
  const atCap = selectedMls.length >= MULTI_OH_MAX_PROPERTIES;

  // 2026-08-07 (John) — the picker is batched by office division to match the
  // dashboard card. `listings` already arrives sorted by open-house start time
  // (see the sort in lib/post-builder/listings.ts), and bucketing preserves
  // that order inside each section, so Saturday morning still reads before
  // Saturday afternoon before Sunday.
  //
  // 2026-08-08 — MUST stay above the two early returns below. It originally
  // sat next to its first use, which put a hook behind a conditional return:
  // with 0 or 1 upcoming open houses Step1Pick returned early and never ran
  // this useMemo, so the render where a second open house arrived changed the
  // hook count and React threw. Hooks first, then the guards.
  const divisionSections = useMemo(
    () => groupListingsByDivision(listings),
    [listings],
  );

  if (listings.length === 0) {
    return (
      <section className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Pick the open houses for this event
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          Choose 2-{MULTI_OH_MAX_PROPERTIES} properties happening within the same weekend or event window.
        </p>
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <div className="text-sm font-medium text-neutral-900 mb-1">
            No open houses scheduled yet.
          </div>
          <div className="text-sm text-neutral-600 mb-4">
            The feeds refresh every few hours. If the office just finalised
            the weekend, pull them in now — or add one yourself.
          </div>
          {/* 2026-07-31 — an empty list is the single most likely moment
              someone wants a fresh pull, so the sync sits above the fold
              here with its full result panel rather than tucked in a
              header. */}
          <div className="mx-auto mb-4 max-w-md text-left">
            <SyncOpenHousesButton />
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
            type="button"
            onClick={onAddOpenHouse}
            className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gold-600 transition shadow-sm"
          >
            + Add Open House
          </button>
            <Link
              href="/post-builder"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition"
            >
              Go to Post Builder
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (listings.length < MULTI_OH_MIN_PROPERTIES) {
    return (
      <section className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Pick the open houses for this event
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          You need at least {MULTI_OH_MIN_PROPERTIES} upcoming open houses to make a multi-property event post.
        </p>
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-8 text-center">
          <div className="text-sm font-medium text-neutral-900 mb-1">
            Only {listings.length} upcoming open house right now.
          </div>
          <div className="text-sm text-neutral-600 mb-4">
            Pull the latest from the MLS feeds, add another open house right
            here, or use the standard single-listing flow for the one you
            have.
          </div>
          <div className="mx-auto mb-4 max-w-md text-left">
            <SyncOpenHousesButton />
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onAddOpenHouse}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gold-600 transition shadow-sm"
            >
              + Add Open House
            </button>
            <Link
              href="/post-builder"
              className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition"
            >
              Open standard Post Builder
            </Link>
          </div>
        </div>
      </section>
    );
  }


  // One row renderer, used by both the flat and the grouped branch. Defined
  // here rather than inline so the two branches can never drift apart.
  const renderListingRow = (l: (typeof listings)[number]) => {
          const selectionIndex = selectedMls.indexOf(l.mls_number);
          const isSelected = selectionIndex >= 0;
          const isDisabled = !isSelected && atCap;
          // why: read the current hosting-agent value from the parent map.
          // Falls back to empty string when the key isn't present (i.e., the
          // listing isn't selected) so the controlled input stays typed.
          const hostingAgentValue =
            perPropertyHostingAgent[l.mls_number] ?? "";
          return (
            <li key={l.mls_number}>
              <button
                type="button"
                onClick={() => !isDisabled && onToggle(l.mls_number)}
                disabled={isDisabled}
                title={
                  isDisabled
                    ? `Carousel cap is ${MULTI_OH_MAX_PROPERTIES + 1} slides — hero + ${MULTI_OH_MAX_PROPERTIES} properties.`
                    : undefined
                }
                className={[
                  "w-full text-left rounded-lg border p-3 flex items-center gap-3 transition",
                  isSelected
                    ? "border-gold-500 bg-gold-50/50 ring-2 ring-gold-500/30"
                    : isDisabled
                      ? "border-neutral-200 bg-neutral-50 cursor-not-allowed opacity-50"
                      : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                ].join(" ")}
              >
                {l.hero_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.hero_image_url}
                    alt=""
                    className="w-16 h-16 rounded-md object-cover bg-neutral-100 shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-neutral-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-neutral-900 truncate">
                    {l.address ?? l.mls_number}
                  </div>
                  <div className="text-xs text-neutral-600 truncate">
                    {[l.city, l.state].filter(Boolean).join(", ")}
                    {l.zip ? ` ${l.zip}` : ""}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 flex items-center gap-2 flex-wrap">
                    {l.oh_start_at ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-1.5 py-0.5 font-medium text-emerald-800">
                        <span aria-hidden="true">🗓</span>
                        <span>{formatOhBadge(l.oh_start_at, l.oh_end_at ?? null)}</span>
                      </span>
                    ) : null}
                    {typeof l.list_price === "number" ? (
                      <span className="text-gold-700 font-medium">
                        ${l.list_price.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                <SelectionChip selectionIndex={selectionIndex} />
              </button>
              {/* Per-property hosting agent override — only on selected rows.
                  why: keeps the picker list scannable when nothing is selected
                  yet, and gives the user an obvious touchpoint to override the
                  default exactly where the property lives in the list. */}
              {isSelected ? (
                <HostingAgentRow
                  mls={l.mls_number}
                  value={hostingAgentValue}
                  onChange={onHostingAgentChange}
                  roster={agentRoster}
                />
              ) : null}
            </li>
          );
  };

  return (
    <section className="card p-6">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-900">
          Pick the open houses for this event
        </h2>
        {/* Task 18 — manual OH entry, right where a missing property is
            noticed. Opens the shared AddOpenHouseModal.
            2026-07-31 — paired with the on-demand feed sync: "it's missing"
            has two fixes, and pulling the feed is the one to try first. */}
        <div className="flex flex-none items-start gap-2">
          <SyncOpenHousesButton variant="compact" />
          <button
            type="button"
            onClick={onAddOpenHouse}
            className="flex-none inline-flex items-center gap-1.5 rounded-md border border-gold-300 bg-gold-50/40 px-3 py-1.5 text-xs font-semibold text-gold-800 hover:bg-gold-100 transition"
          >
            + Add Open House
          </button>
        </div>
      </div>
      <p className="text-sm text-neutral-600 mb-4">
        Choose 2-{MULTI_OH_MAX_PROPERTIES} properties happening within the same weekend or event window. The order you pick them in is the order they&apos;ll appear in the carousel. Missing one? Sync the feeds or add it by hand with the buttons above.
      </p>


      {/* Consolidation hint — only when picks > unique-MLS. Mirrors the
          server-side consolidatePropertiesByMls behavior so the user sees
          ahead-of-time that "5 windows → 4 slides" is intentional. */}
      {consolidationSummary ? (
        <div className="mb-3 text-[11px] text-neutral-500 leading-snug">
          {consolidationSummary.pickCount} windows selected → {consolidationSummary.slideCount} carousel{" "}
          {consolidationSummary.slideCount === 1 ? "slide" : "slides"}
          {consolidationSummary.duplicateExamples.length > 0 ? (
            <>
              {" "}(
              {consolidationSummary.duplicateExamples.join(", ")} appears twice
              {consolidationSummary.extraDuplicates > 0
                ? ` and ${consolidationSummary.extraDuplicates} ${consolidationSummary.extraDuplicates === 1 ? "other" : "others"}`
                : ""}
              )
            </>
          ) : null}
        </div>
      ) : null}

      {/* 2026-08-07 (John): "On the home screen, the open houses are
          separated by South Jersey division and Shore division but when you
          click the build a multi property open house button it merges them
          all together in the next screen."

          Same batching as the dashboard Open Houses card, same labels and
          same order, so the two surfaces finally agree. Collapses to a flat
          list when only one section has rows, so a lone subheader and a
          stray divider can never appear. */}
      {divisionSections.length <= 1 ? (
        <ul className="space-y-2">
          {(divisionSections[0]?.rows ?? listings).map(renderListingRow)}
        </ul>
      ) : (
        <div>
          {divisionSections.map((section, si) => (
            <div
              key={section.key}
              className={si > 0 ? "mt-5 pt-5 border-t border-neutral-200" : ""}
            >
              <DivisionHeader
                label={section.label}
                count={section.rows.length}
              />
              <ul className="space-y-2">
                {section.rows.map(renderListingRow)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Division batching for the Step 1 picker.
 *
 * Deliberately a copy of the shape used by components/UpcomingOpenHousesRow
 * rather than a shared import: that module works on UpcomingOpenHouse rows
 * from lib/data/open-houses, this one works on PostBuilderListing rows from
 * lib/post-builder/listings. Same labels, same order, same "Other Offices"
 * safety net, different row type. Keep the two lists in sync.
 */
const DIVISION_SECTIONS: { key: string; label: string }[] = [
  { key: "south_jersey", label: "South Jersey Division" },
  { key: "shore", label: "Shore Division" },
];

interface ListingDivisionSection<T> {
  key: string;
  label: string;
  rows: T[];
}

/**
 * Bucket listings by office division, preserving the incoming order (which is
 * open-house start time ascending) inside each bucket. Anything with a missing
 * or unrecognised division falls into a trailing "Other Offices" bucket, so an
 * office with no division set can never make an open house silently vanish
 * from the picker.
 */
function groupListingsByDivision<T extends { division?: string | null }>(
  // readonly: Step1Props types `listings` as a readonly array, and this helper
  // only ever reads from it.
  listings: readonly T[],
): ListingDivisionSection<T>[] {
  const byKey = new Map<string, T[]>();
  const other: T[] = [];
  for (const l of listings) {
    const known = DIVISION_SECTIONS.some((s) => s.key === l.division);
    if (l.division && known) {
      const arr = byKey.get(l.division) ?? [];
      arr.push(l);
      byKey.set(l.division, arr);
    } else {
      other.push(l);
    }
  }
  const sections: ListingDivisionSection<T>[] = [];
  for (const { key, label } of DIVISION_SECTIONS) {
    const rows = byKey.get(key);
    if (rows && rows.length > 0) sections.push({ key, label, rows });
  }
  if (other.length > 0) {
    sections.push({ key: "other", label: "Other Offices", rows: other });
  }
  return sections;
}

/** Subheader labelling a division batch, with its open-house count. */
function DivisionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">
        {label}
      </h3>
      <span className="inline-flex items-center rounded-full bg-sky-100 ring-1 ring-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 tabular-nums">
        {count}
      </span>
    </div>
  );
}

interface SelectionChipProps {
  /** -1 = not selected; 0-based selection index otherwise. */
  selectionIndex: number;
}

function SelectionChip({ selectionIndex }: SelectionChipProps) {
  const isSelected = selectionIndex >= 0;
  return (
    <div
      aria-hidden="true"
      className={[
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition shrink-0",
        isSelected
          ? "bg-gold-500 text-white shadow-sm"
          : "bg-white ring-1 ring-neutral-300 text-neutral-400",
      ].join(" ")}
    >
      {isSelected ? selectionIndex + 1 : ""}
    </div>
  );
}

interface HostingAgentRowProps {
  mls: string;
  value: string;
  onChange: (mls: string, value: string) => void;
  /** Company roster names — the combobox restricts entry to these. */
  roster: readonly string[];
}

/**
 * Compact per-property hosting-agent override input. Slides in below a
 * selected property row so it's visually anchored to the listing it belongs
 * to — no separate "agents per property" panel later in the wizard, no
 * extra step. The whole thing adds ~40px of height when present.
 *
 * why: the input uses the same gold-focus + neutral-border styling as the
 * other text fields in the wizard, but at a smaller size so it reads as
 * a sub-detail of the row above rather than an equally weighted new field.
 * Keyboard focus + click events here intentionally do NOT bubble up to the
 * row's select toggle — the wrapper has `onClick={stop}` so a user can
 * click the input without inadvertently deselecting the row.
 */
function HostingAgentRow({ mls, value, onChange, roster }: HostingAgentRowProps) {
  // 2026-07-17 — roster combobox replaces free-hand entry. Attribution
  // (phone via Alliance Dash, headshot via the Agents library) matches by
  // EXACT name, so a typo like "Barb Hunt" silently dropped the phone +
  // photo from the slide. Typing filters the company roster; clicking a
  // match commits the canonical spelling. A value that matches no roster
  // name gets an amber flag so Larissa knows attribution won't resolve.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q.length < 1) return [];
    return roster.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [value, roster]);
  const exactMatch = useMemo(
    () => roster.some((n) => n.toLowerCase() === value.trim().toLowerCase()),
    [value, roster],
  );
  return (
    <div
      className="mt-1.5 ml-3 mr-3 rounded-md border border-neutral-200 bg-white/70 px-3 py-2"
      // why: stop clicks inside this strip from bubbling to the row's
      // select-toggle button — a user fine-tuning the override shouldn't
      // accidentally deselect the property.
      onClick={(e) => e.stopPropagation()}
    >
      <label
        htmlFor={`hosting-agent-${mls}`}
        className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1"
      >
        Hosting agent
      </label>
      <div className="relative">
        <input
          id={`hosting-agent-${mls}`}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(mls, e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          // why: delay the close so a click on a dropdown option lands
          // before the list unmounts (blur fires first otherwise).
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          placeholder="Start typing an agent's name…"
          autoComplete="off"
          className="block w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
        />
        {dropdownOpen && matches.length > 0 && !exactMatch ? (
          <ul
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
            role="listbox"
          >
            {matches.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  // onMouseDown (not onClick) so selection commits BEFORE
                  // the input's blur closes the dropdown.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(mls, name);
                    setDropdownOpen(false);
                  }}
                  className="block w-full px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-gold-50"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {value.trim().length > 0 && !exactMatch ? (
        <div className="mt-1 text-[10px] font-medium text-amber-700">
          ⚠ Not in the agent roster — pick a name from the list so the
          agent&apos;s phone and photo appear on the slide.
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-neutral-500">
          Defaults to the listing agent. Override if a different agent is
          hosting this open house.
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Step 2 — Template
// ===========================================================================
//
// Step 2 was formerly an "Event details" form that collected an event-level
// agent name + phone. We dropped that 2026-05-21 — every per-property card
// already shows the host who'll be at that home, so the event-level
// attribution was misleading on multi-host events. The remaining
// event-level field (event_title) moved up into Step 1.
//
// 2026-05-27 — the legacy variant card grid (v2/v3/v6/v8) was removed.
// After the 2026-05-24 V1 HTML template purge, every per-property variant
// resolved to the same `open_house/v1` canvas template inside the
// generate route, so the four picker cards were showing distinct copy for
// the same render. Step 2 now surfaces only DB-template choices when
// they exist; otherwise it shows a single informational card describing
// the default canvas template.

interface Step2Props {
  format: PostFormat;
  /** Phase 2E — DB templates available for the active format. */
  dbTemplates: readonly TemplateMeta[];
  /** Phase 2E — currently-selected DB template, or null when the default
   *  canvas template is in play. */
  dbTemplateId: string | null;
  /** Phase 2E — fires with the new id (or null when deselecting). */
  onDbTemplateChange: (id: string | null) => void;
}

function Step2FormatVariant({
  format,
  dbTemplates,
  dbTemplateId,
  onDbTemplateChange,
}: Step2Props) {
  // why: silence unused-prop lint in the no-DB-templates path. `format`
  // is part of the Step2Props contract because parent passes it; keep
  // the surface stable for when a future format-aware default lands.
  void format;
  return (
    <section className="space-y-5">
      {/* 2026-05-22 — Format-picker card removed. Multi-OH carousels
          always render as Portrait 4:5 (IG-preferred feed shape; FB feed
          also handles 4:5 fine). 9:16 Story is reserved for the
          "Make a Reel?" flow that fires after save. One less decision
          for Larissa to make. */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Choose a template
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          {/* 2026-05-28 — Bug 5 copy refresh. Prior helper text
              referenced the event hero card, but the hero is no
              longer published to social (only per-property slides
              are). New copy describes the actual choice the user is
              making here. */}
          Pick a published template, or stick with the default Open House design.
        </p>
        {/* Phase 2E (2026-05-22) — admin-authored DB templates for OH.
            Section hides when no DB templates exist for the active
            format. Clicking a card sets `dbTemplateId`. Same gold "DB"
            badge as PostBuilderClient for consistency. */}
        {dbTemplates.length > 0 ? (
          <div className="mb-4">
            <div className="eyebrow mb-2">
              Admin templates{" "}
              <span className="text-neutral-400 font-normal normal-case tracking-normal">
                · authored in /admin/templates
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {dbTemplates.map((t) => {
                const active = dbTemplateId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onDbTemplateChange(active ? null : t.id)}
                    title={t.description ?? t.name}
                    aria-label={
                      active
                        ? `Deselect admin template ${t.name}`
                        : `Use admin template ${t.name}`
                    }
                    className={[
                      "text-left rounded-xl border p-3 transition flex flex-col",
                      active
                        ? "border-gold-500 bg-gold-50/40 ring-2 ring-gold-500/30 shadow-sm cursor-pointer"
                        : "border-neutral-200 bg-white cursor-pointer hover:border-gold-300 hover:ring-2 hover:ring-gold-300/40 hover:shadow-sm",
                    ].join(" ")}
                  >
                    {/* Task 16 (2026-07-17) — visual sample of each template
                        so the picker isn't a blind name-only choice. Uses the
                        preview PNG Studio saves alongside every published
                        template; object-contain shows the whole design
                        letterboxed (never cropped). Falls back to a labelled
                        placeholder when a template has no saved preview. */}
                    {t.preview_image_url ? (
                      <div className="mb-2 aspect-square w-full overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={t.preview_image_url}
                          alt={`${t.name} template preview`}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50 text-[11px] text-neutral-400">
                        No preview yet
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-neutral-900 line-clamp-1">
                        {t.name}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider rounded-full bg-gold-500/95 px-2 py-0.5 text-neutral-900">
                        DB
                      </span>
                    </div>
                    {t.description ? (
                      <div className="text-xs text-neutral-600 line-clamp-2">
                        {t.description}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          // 2026-05-27 — when no DB templates are published for this
          // format, Step 2 shows a single informational card instead of
          // a pick grid. The default canvas template handles every
          // per-property slide; the user just hits Continue.
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-sm font-semibold text-neutral-900">
              Using the default Open House template
            </div>
            <div className="mt-1 text-xs text-neutral-600 leading-relaxed">
              Every per-property slide renders with the standard Alliance Open House layout. Publish a custom Open House template in /admin/templates to surface it here as a pick.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ===========================================================================
// Step 3 — Review + generate (carousel reorder + caption preview)
// ===========================================================================
//
// 2026-05-27 (Phase 6) — Step 3 was rewritten again. The previous version
// led with a large featured-slide mock + ribbon. That mock no longer
// reflects reality because:
//
//   • The event hero card was retired as a published carousel slide (only
//     the per-property cards are pushed to social), so the hero mock at
//     slide 1 was misleading.
//   • The variant-flavored "v2/v3 property card" mock was disclaiming
//     itself as a layout sketch — Larissa stopped trusting it.
//
// The new Step 3 surfaces what Larissa actually decides on this screen:
//
//   1. Header band — "Step 3 of 3 · Review + generate" + one-line guidance.
//   2. Carousel order panel — drag-reorderable thumbnail grid of the
//      selected properties (one tile per property; no hero tile).
//   3. Caption preview panel — per-platform tabs (IG / FB / TT) showing the
//      live composed caption from the shared synth module, with a "char
//      count / 5 hashtags" footer + an Edit pencil that opens a full-text
//      override overlay.
//   4. Tone picker — 6 small pills (Auto · Coastal · Family · Investor ·
//      Cozy · Editorial) that bias the synth. Disabled when an override
//      is active.
//
// Generate CTA + status copy stay on the sticky footer. The primary action
// is "Review & Post": it renders every slide, then drops the user straight on
// the Final Review screen (MultiOhFinalStage) where they confirm captions and
// publish. Studio is NOT on the critical path — it's an opt-in per-slide edit
// affordance inside that review screen. (Renamed 2026-07-17 from the old
// "Build Slides in Studio" label, which wrongly implied a Studio-first flow.)

interface Step3Props {
  selectedListings: readonly PostBuilderListing[];
  /** Caption tone bias. `auto` runs heuristic detection in the synth. */
  tone: CaptionTone;
  onToneChange: (next: CaptionTone) => void;
  /** Null when auto-synth is active; non-null when the user has saved a
   *  full-caption override via the Edit overlay. */
  captionOverride: string | null;
  onCaptionOverrideChange: (next: string | null) => void;
  /**
   * 2026-07-24 — true when the custom caption was written against a
   * DIFFERENT property selection than the current one (user went back to
   * Step 1 and added/removed homes after authoring it). Renders an amber
   * warning so the stale embedded schedule can't slip into a live post.
   */
  overrideStale: boolean;
  /** Which platform tab is selected in the caption preview. */
  captionPreviewPlatform: "instagram" | "facebook" | "tiktok";
  onCaptionPreviewPlatformChange: (
    next: "instagram" | "facebook" | "tiktok",
  ) => void;
  /** True while the Edit-caption overlay is mounted. */
  captionEditorOpen: boolean;
  onOpenCaptionEditor: () => void;
  onCloseCaptionEditor: () => void;
  /** Carousel reorder drag handlers — same shape as Step 1 ribbon. */
  onDragStart: (mls: string) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (targetMls: string) => void;
  /** Touch-friendly reorder (mobile) — move a slide one step earlier/later. */
  onMoveSlide: (mls: string, direction: -1 | 1) => void;
}

function Step3Review({
  selectedListings,
  tone,
  onToneChange,
  captionOverride,
  onCaptionOverrideChange,
  overrideStale,
  captionPreviewPlatform,
  onCaptionPreviewPlatformChange,
  captionEditorOpen,
  onOpenCaptionEditor,
  onCloseCaptionEditor,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveSlide,
}: Step3Props) {
  // ---- Caption synth — debounced AI preview with deterministic fallback -
  // 2026-05-28 — switched from local deterministic synth to a debounced
  // POST against /api/post-builder/multi-oh-caption-preview. The server
  // calls Claude Haiku and returns the same MultiOHCaptionResult shape;
  // the deterministic synth runs as the local fallback when the request
  // fails or the user is offline.
  //
  // Why debounce: every keystroke in the address override / tone picker
  // shouldn't burn a Haiku call. 300ms is long enough to coalesce a
  // burst but short enough that the preview feels live.
  //
  // Why keep `captionResult` non-null with a starting deterministic
  // value: we don't want the preview tabs to flash empty on first paint
  // while the API call is in flight. Same reason we preserve the prior
  // result during in-flight requests further down.
  const captionInputForSynth = useMemo(
    () => ({
      tone,
      caption_override: captionOverride,
      properties: selectedListings.map((l) => ({
        address: l.address,
        city: l.city,
        mls_number: l.mls_number,
        source_mls: l.source_mls,
        unit_number: l.unit_number,
        list_price: l.list_price,
        property_type: l.property_type,
        oh_start_at: l.oh_start_at ?? null,
        oh_end_at: l.oh_end_at ?? null,
      })),
    }),
    [tone, captionOverride, selectedListings],
  );

  const [captionResult, setCaptionResult] = useState<MultiOHCaptionResult>(
    () => synthesizeMultiOHCaption(captionInputForSynth),
  );
  const [captionLoading, setCaptionLoading] = useState(false);
  const captionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // why: 300ms debounce — long enough to coalesce a burst of state
    // updates (tone toggle + carousel reorder happening together),
    // short enough that the preview feels live.
    const handle = setTimeout(() => {
      // Cancel any in-flight request before starting a new one. The
      // server stays stateless so a stale request can't taint state,
      // but we still drop it to avoid a late response overwriting a
      // newer one.
      if (captionAbortRef.current) {
        captionAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      captionAbortRef.current = ctrl;
      setCaptionLoading(true);

      fetch("/api/post-builder/multi-oh-caption-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          properties: captionInputForSynth.properties,
          tone: captionInputForSynth.tone,
          captionOverride: captionInputForSynth.caption_override,
          hostingAgentNames: [],
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`preview endpoint ${res.status}`);
          }
          const json = (await res.json()) as {
            ok: boolean;
            result?: MultiOHCaptionResult;
            error?: string;
          };
          if (!json.ok || !json.result) {
            throw new Error(json.error ?? "preview returned no result");
          }
          // why: don't overwrite if the controller was aborted between
          // network completion and JSON parse. AbortController.signal
          // doesn't always reject the .then chain cleanly.
          if (!ctrl.signal.aborted) {
            setCaptionResult(json.result);
            setCaptionLoading(false);
          }
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          // why: client-side fallback so the user ALWAYS sees a caption.
          // The deterministic synth is pure + fast; running it on the
          // client avoids leaving the preview empty when the API is
          // unreachable (offline mode, or Claude key not configured).
          console.warn(
            "[multi-oh-wizard] caption preview failed; using deterministic fallback:",
            err,
          );
          setCaptionResult(synthesizeMultiOHCaption(captionInputForSynth));
          setCaptionLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(handle);
    };
  }, [captionInputForSynth]);

  // Best-effort cancel on unmount.
  useEffect(() => {
    return () => {
      captionAbortRef.current?.abort();
    };
  }, []);

  const overrideActive = captionOverride !== null && captionOverride.length > 0;

  return (
    <section className="space-y-6">
      {/* ─── Header band ────────────────────────────────────────────── */}
      <div>
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-gold-600">
          Step 3 of 3
        </div>
        <h2 className="mt-1 text-2xl font-semibold text-neutral-900 leading-tight">
          Review + generate
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Drag to reorder slides. Edit the caption if you&apos;d like. Then
          generate.
        </p>
      </div>

      {/* ─── Carousel order ─────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Carousel order
          </h3>
          <span className="text-xs text-neutral-500">
            {selectedListings.length} slide{selectedListings.length === 1 ? "" : "s"}
            {" · "}
            <span className="hidden sm:inline">drag tiles to reorder</span>
            <span className="sm:hidden">tap arrows to reorder</span>
          </span>
        </div>
        <CarouselReorderGrid
          selectedListings={selectedListings}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onMoveSlide={onMoveSlide}
        />
      </div>

      {/* ─── Caption preview panel ──────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">
              Caption preview
            </h3>
            {overrideActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 text-gold-700 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wider">
                Custom caption
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onOpenCaptionEditor}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 transition"
            aria-label="Edit caption"
          >
            <Pencil size={12} aria-hidden="true" />
            Edit caption
          </button>
        </div>

        {/* Per-platform tabs */}
        <div className="flex items-center gap-1.5 mb-3">
          {(["instagram", "facebook", "tiktok"] as const).map((p) => {
            const label =
              p === "instagram" ? "IG" : p === "facebook" ? "FB" : "TT";
            const active = captionPreviewPlatform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onCaptionPreviewPlatformChange(p)}
                className={[
                  "rounded-full px-3 py-1 text-xs font-semibold transition",
                  active
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                ].join(" ")}
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 2026-07-24 — stale-override guard. The custom caption embeds
            the day-by-day schedule bullets, so a selection change made
            AFTER authoring it silently leaves wrong addresses/times in
            the caption. Warn + offer the one-click reset. */}
        {overrideStale ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
              <span>
                Your custom caption was written for a{" "}
                <span className="font-semibold">different property list</span> —
                the schedule inside it may be out of date.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenCaptionEditor}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 transition"
              >
                Review it
              </button>
              <button
                type="button"
                onClick={() => onCaptionOverrideChange(null)}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 transition"
              >
                Reset to auto
              </button>
            </div>
          </div>
        ) : null}

        {/* why: surface in-flight state inline under the platform tabs.
            We keep the previously-rendered captionResult visible while a
            new request is in flight so the box doesn't blink to empty —
            the status text is the only visual change. */}
        {captionLoading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mb-2">
            <Loader2
              size={12}
              className="animate-spin"
              aria-hidden="true"
            />
            <span>Writing your caption…</span>
          </div>
        ) : null}

        <CaptionPreviewBox
          platform={captionPreviewPlatform}
          captionResult={captionResult}
        />
      </div>

      {/* ─── Tone picker ────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Caption tone
          </h3>
          <span className="text-xs text-neutral-500">
            {overrideActive
              ? "Disabled while a custom caption is active"
              : tone === "auto"
                ? `Auto · resolved to ${captionResult.resolved_tone}`
                : "Manually selected"}
          </span>
        </div>
        <TonePillRow
          tone={tone}
          onToneChange={onToneChange}
          disabled={overrideActive}
        />
      </div>

      {/* ─── Edit caption overlay ───────────────────────────────────── */}
      {captionEditorOpen ? (
        <EditCaptionOverlay
          initialValue={
            captionOverride !== null
              ? captionOverride
              : // Pre-fill from the synthesized IG body so the user has a
                // starting point. They can edit-from-blank by clearing the
                // textarea.
                captionResult.captions.instagram.caption +
                (captionResult.captions.instagram.hashtags.length > 0
                  ? "\n\n" +
                    captionResult.captions.instagram.hashtags.join(" ")
                  : "")
          }
          overrideActive={overrideActive}
          onSave={(text) => {
            onCaptionOverrideChange(text.length > 0 ? text : null);
            onCloseCaptionEditor();
          }}
          onResetToAuto={() => {
            onCaptionOverrideChange(null);
            onCloseCaptionEditor();
          }}
          onCancel={onCloseCaptionEditor}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Carousel reorder grid — drag-and-drop tiles, no hero entry.
// ---------------------------------------------------------------------------

interface CarouselReorderGridProps {
  selectedListings: readonly PostBuilderListing[];
  onDragStart: (mls: string) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (targetMls: string) => void;
  /** Touch reorder — move a slide one step earlier/later. */
  onMoveSlide: (mls: string, direction: -1 | 1) => void;
}

function CarouselReorderGrid({
  selectedListings,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveSlide,
}: CarouselReorderGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {selectedListings.map((l, idx) => (
        <CarouselReorderTile
          key={l.mls_number}
          position={idx + 1}
          listing={l}
          onDragStart={() => onDragStart(l.mls_number)}
          onDragOver={onDragOver}
          onDrop={() => onDrop(l.mls_number)}
          onMoveEarlier={idx > 0 ? () => onMoveSlide(l.mls_number, -1) : null}
          onMoveLater={
            idx < selectedListings.length - 1
              ? () => onMoveSlide(l.mls_number, 1)
              : null
          }
        />
      ))}
    </div>
  );
}

interface CarouselReorderTileProps {
  position: number;
  listing: PostBuilderListing;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: () => void;
  /** Null at the ends of the list (button hidden). */
  onMoveEarlier: (() => void) | null;
  onMoveLater: (() => void) | null;
}

function CarouselReorderTile({
  position,
  listing,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveEarlier,
  onMoveLater,
}: CarouselReorderTileProps) {
  const baseAddress = (listing.address ?? "").trim();
  const unit = (listing.unit_number ?? "").trim();
  const addressLine = unit
    ? baseAddress
      ? `${baseAddress} · ${unit}`
      : unit
    : baseAddress || listing.mls_number;
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");
  const ohLabel = listing.oh_start_at
    ? formatOhBadge(listing.oh_start_at, listing.oh_end_at ?? null)
    : null;
  const photo = listing.hero_image_url ?? "";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="group relative flex flex-col rounded-lg border border-neutral-200 bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-neutral-300 transition cursor-grab active:cursor-grabbing"
    >
      {/* Photo square — aspect ratio matches the carousel image. */}
      <div className="relative aspect-square bg-neutral-200">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : null}
        {/* Position chip */}
        <span
          aria-hidden="true"
          className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-neutral-900/85 text-white text-[11px] font-bold flex items-center justify-center shadow-sm"
        >
          {position}
        </span>
        {/* Grip handle (pointer devices) */}
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-white/85 text-neutral-700 hidden sm:flex items-center justify-center shadow-sm opacity-70 group-hover:opacity-100"
        >
          <GripVertical size={14} />
        </span>
        {/* Touch reorder buttons — HTML5 drag never fires on touch, so
            phones get explicit earlier/later controls (2026-07-24). */}
        <div className="absolute bottom-1.5 right-1.5 flex gap-1 sm:hidden">
          {onMoveEarlier ? (
            <button
              type="button"
              aria-label="Move slide earlier"
              onClick={onMoveEarlier}
              className="w-8 h-8 rounded-md bg-white/90 text-neutral-800 flex items-center justify-center shadow-sm active:bg-white"
            >
              <ChevronLeft size={16} />
            </button>
          ) : null}
          {onMoveLater ? (
            <button
              type="button"
              aria-label="Move slide later"
              onClick={onMoveLater}
              className="w-8 h-8 rounded-md bg-white/90 text-neutral-800 flex items-center justify-center shadow-sm active:bg-white"
            >
              <ChevronRight size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {/* Caption block */}
      <div className="p-2.5">
        <div className="text-xs font-semibold text-neutral-900 leading-tight truncate">
          {addressLine}
        </div>
        {cityState ? (
          <div className="mt-0.5 text-[11px] text-neutral-600 leading-tight truncate">
            {cityState}
          </div>
        ) : null}
        {ohLabel ? (
          <div className="mt-1 text-[11px] text-gold-700 font-medium leading-tight truncate">
            {ohLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caption preview box — read-only textarea-styled block + char counter.
// ---------------------------------------------------------------------------

interface CaptionPreviewBoxProps {
  platform: "instagram" | "facebook" | "tiktok";
  captionResult: MultiOHCaptionResult;
}

function CaptionPreviewBox({ platform, captionResult }: CaptionPreviewBoxProps) {
  const slot = captionResult.captions[platform];
  const fullText =
    slot.hashtags.length > 0
      ? `${slot.caption}\n\n${slot.hashtags.join(" ")}`
      : slot.caption;
  const charLimit =
    platform === "instagram" ? 2200 : platform === "facebook" ? 1500 : 250;
  const overLimit = fullText.length > charLimit;

  return (
    <div>
      <div
        className={[
          "rounded-md border bg-neutral-50 p-3 text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed font-[ui-sans-serif]",
          overLimit ? "border-red-300" : "border-neutral-200",
        ].join(" ")}
        style={{ maxHeight: "320px", overflowY: "auto" }}
      >
        {fullText.length > 0 ? (
          fullText
        ) : (
          <span className="text-neutral-400 italic">
            Pick at least 2 properties to preview the caption.
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
        <span>
          <span
            className={overLimit ? "font-semibold text-red-600" : "text-neutral-700"}
          >
            {fullText.length.toLocaleString()}
          </span>
          {" / "}
          {charLimit.toLocaleString()} chars
          <span className="mx-1.5 text-neutral-300">·</span>
          {slot.hashtags.length} hashtag{slot.hashtags.length === 1 ? "" : "s"}
        </span>
        {overLimit ? (
          <span className="text-red-600 font-semibold">Over the limit</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tone picker — 6 pills, gold-active, disabled when override is active.
// ---------------------------------------------------------------------------

interface TonePillRowProps {
  tone: CaptionTone;
  onToneChange: (next: CaptionTone) => void;
  disabled: boolean;
}

const TONE_PILLS: ReadonlyArray<{ value: CaptionTone; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "coastal", label: "Coastal" },
  { value: "family", label: "Family" },
  { value: "investor", label: "Investor" },
  { value: "cozy", label: "Cozy" },
  { value: "editorial", label: "Editorial" },
];

function TonePillRow({ tone, onToneChange, disabled }: TonePillRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TONE_PILLS.map((pill) => {
        const active = tone === pill.value;
        return (
          <button
            key={pill.value}
            type="button"
            onClick={() => onToneChange(pill.value)}
            disabled={disabled}
            className={[
              "rounded-full px-3 py-1 text-xs font-semibold transition border",
              active
                ? "bg-gold-500 text-white border-gold-500 shadow-sm"
                : "bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50",
              disabled ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
            aria-pressed={active}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit caption overlay — fullscreen-ish modal with textarea + save/cancel.
// ---------------------------------------------------------------------------

interface EditCaptionOverlayProps {
  initialValue: string;
  overrideActive: boolean;
  onSave: (text: string) => void;
  onResetToAuto: () => void;
  onCancel: () => void;
}

function EditCaptionOverlay({
  initialValue,
  overrideActive,
  onSave,
  onResetToAuto,
  onCancel,
}: EditCaptionOverlayProps) {
  const [draft, setDraft] = useState<string>(initialValue);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-caption-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm"
      onClick={(e) => {
        // Click on backdrop cancels (no save).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div>
            <h3
              id="edit-caption-title"
              className="text-base font-semibold text-neutral-900"
            >
              Edit caption
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Applies to all platforms · per-platform overrides are a future
              feature
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 overflow-y-auto p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            spellCheck
            className="w-full rounded-md border border-neutral-300 bg-white p-3 text-sm font-mono text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500 resize-y leading-relaxed"
            placeholder="Write your caption here…"
            autoFocus
          />
          <p className="mt-2 text-[11px] text-neutral-500">
            Caption emojis are allowed. Hashtags will be auto-appended for
            each platform unless you include them in your override.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-4 border-t border-neutral-200 bg-neutral-50">
          <div>
            {overrideActive ? (
              <button
                type="button"
                onClick={onResetToAuto}
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
              >
                Reset to auto
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft.trim())}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold px-4 py-1.5 transition shadow-sm"
            >
              <Check size={14} aria-hidden="true" />
              Save override
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ===========================================================================
// Sticky footer
// ===========================================================================

interface StickyFooterProps {
  step: StepIndex;
  selectedCount: number;
  canContinueFromStep1: boolean;
  onBack: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onGenerate: () => void;
  generating: boolean;
}

function StickyFooter({
  step,
  selectedCount,
  canContinueFromStep1,
  onBack,
  onCancel,
  onContinue,
  onGenerate,
  generating,
}: StickyFooterProps) {
  // Only step 1 has a gating condition now — step 2 (format/variant) has
  // sensible defaults so the user can always continue from it.
  const continueDisabled = step === 1 && !canContinueFromStep1;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={onBack}
            disabled={generating}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">◂</span>
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition"
          >
            <span aria-hidden="true">◂</span>
            Cancel
          </button>
        )}

        {step === 1 ? (
          <div className="text-sm text-neutral-600">
            <span className="font-semibold text-neutral-900">
              {selectedCount}
            </span>{" "}
            of {MULTI_OH_MAX_PROPERTIES} selected
            {selectedCount < MULTI_OH_MIN_PROPERTIES ? (
              <span className="text-neutral-500">
                {" "}
                · need at least {MULTI_OH_MIN_PROPERTIES}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="ml-auto">
          {step < 3 ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={continueDisabled}
              className={[
                "inline-flex items-center gap-1 rounded-md px-4 py-1.5 text-sm font-semibold transition shadow-sm",
                continueDisabled
                  ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                  : "bg-gold-500 text-white hover:bg-gold-600",
              ].join(" ")}
            >
              Continue
              <span aria-hidden="true">▸</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              aria-busy={generating}
              className={[
                "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold transition shadow-sm",
                generating
                  ? "bg-gold-400 text-white cursor-wait"
                  : "bg-gold-500 text-white hover:bg-gold-600",
              ].join(" ")}
            >
              <span aria-hidden="true">✦</span>
              {generating ? "Generating…" : "Review & Post"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Generating overlay
// ===========================================================================

interface GeneratingOverlayProps {
  statusText: string;
  heroTile: SlideTile;
  slideTiles: readonly SlideTile[];
  partialResult: PartialResult | null;
  /** True while a stream is in flight. Used to disable the retry button so
   *  the user can't double-fire while a retry is mid-stream. */
  generating: boolean;
  onRetryFailed: () => void;
  onContinuePartial: () => void;
}

/**
 * Visual progress overlay for the multi-OH generate flow.
 *
 * Layout: hero tile centered above an N-tile grid of slide thumbnails.
 * Each tile shows skeleton / image / red-fail state driven by the NDJSON
 * event stream. When the stream finishes with one or more `slide_failed`
 * events, a partial-progress footer appears with Retry / Continue actions.
 *
 * The overlay stays mounted while `partialResult` is non-null (even
 * though `generating` has flipped false) so the user can act on the
 * failures without the modal disappearing.
 */
function GeneratingOverlay({
  statusText,
  heroTile,
  slideTiles,
  partialResult,
  generating,
  onRetryFailed,
  onContinuePartial,
}: GeneratingOverlayProps) {
  const successCount =
    slideTiles.length === 0
      ? 0
      : slideTiles.filter((t) => t.state === "done").length;
  const totalCount = slideTiles.length;

  // Cap failure list at 4 lines + an "and N others" tail so a many-fail
  // run doesn't blow up the modal height past viewport.
  const visibleFailures = partialResult?.failedDetails.slice(0, 4) ?? [];
  const extraFailures = partialResult
    ? Math.max(0, partialResult.failedDetails.length - visibleFailures.length)
    : 0;

  return (
    <div
      className="fixed inset-0 z-40 bg-neutral-900/50 backdrop-blur-sm flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="bg-white rounded-xl shadow-xl px-6 py-6 max-w-2xl w-full mx-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          {generating ? <Spinner /> : null}
          <div>
            <div className="text-sm font-semibold text-neutral-900">
              {partialResult
                ? "Carousel built with some gaps"
                : "Building your carousel"}
            </div>
            <div className="mt-0.5 text-sm text-neutral-600">{statusText}</div>
          </div>
        </div>

        {/* Live progress bar — Task 15 (2026-07-17). The success/total counts
            were only surfaced in the partial-failure footer; during a normal
            run the user saw tiles flip but no explicit "X of N" progress. Now
            a gold bar + count tracks completion live, and stays accurate for
            retries (successCount recomputes from tile state each render). */}
        {totalCount > 0 && !partialResult ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-neutral-600">
              <span>
                {successCount} of {totalCount} slide{totalCount === 1 ? "" : "s"} rendered
              </span>
              <span>{Math.round((successCount / totalCount) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-[#C9A84C] transition-all duration-500"
                style={{ width: `${(successCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Per-slide grid (suppressed before `started` event arrives). */}
        {slideTiles.length > 0 ? (
          <div
            className="mt-5 grid gap-3"
            style={{
              gridTemplateColumns:
                "repeat(auto-fit, minmax(0, 120px))",
              justifyContent: "center",
            }}
          >
            {slideTiles.map((tile, idx) => (
              <div key={idx} className="flex flex-col items-center">
                <TileShell
                  tile={tile}
                  sizeClass="w-[120px] h-[120px]"
                  failLabel={`Slide ${idx + 1}`}
                />
                {tile.address ? (
                  <div
                    className="mt-1 text-[10px] text-neutral-500 text-center leading-tight max-w-[120px] truncate"
                    title={tile.address}
                  >
                    {tile.address}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Partial-progress footer — only when the stream completed with
            at least one slide failure. */}
        {partialResult ? (
          <div className="mt-4 pt-4 border-t border-neutral-200">
            <div className="text-sm font-semibold text-neutral-900">
              {successCount} of {totalCount} slides ready
            </div>
            <ul className="mt-1 space-y-0.5">
              {visibleFailures.map((f) => (
                <li
                  key={f.index}
                  className="text-xs text-neutral-600"
                >
                  Slide {f.index + 1} — {f.address ?? "address unknown"} couldn&apos;t render
                </li>
              ))}
              {extraFailures > 0 ? (
                <li className="text-xs text-neutral-500 italic">
                  and {extraFailures} other{extraFailures === 1 ? "" : "s"}
                </li>
              ) : null}
            </ul>
            <div className="mt-3 flex gap-3 justify-end">
              <button
                type="button"
                onClick={onContinuePartial}
                disabled={generating}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Continue with what rendered
              </button>
              <button
                type="button"
                onClick={onRetryFailed}
                disabled={generating}
                className="rounded-md bg-[#C9A84C] hover:bg-[#B89540] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {generating ? "Retrying…" : "Retry failed slides"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Single-tile visual shell used by both the hero and per-slide grid. The
 * three states (skeleton / image / fail) all use the same outer dimensions
 * so the layout doesn't shift as tiles resolve.
 *
 * why: extracted to keep the GeneratingOverlay JSX flat. Both call sites
 * use slightly different sizes (180×180 hero vs 120×120 grid) and fail
 * labels (`"Hero"` vs `"Slide N"`), so size + label are props.
 */
interface TileShellProps {
  tile: SlideTile;
  /** Tailwind sizing classes — `"w-[180px] h-[180px]"` etc. */
  sizeClass: string;
  /** Label shown inside the failed-state tile under the warning icon. */
  failLabel: string;
}

function TileShell({ tile, sizeClass, failLabel }: TileShellProps) {
  const base = `${sizeClass} rounded-md overflow-hidden`;
  if (tile.state === "failed") {
    return (
      <div
        className={`${base} bg-red-50 border border-red-200 flex flex-col items-center justify-center gap-1`}
      >
        <AlertTriangle className="w-5 h-5 text-red-600" />
        <div className="text-xs text-red-700 font-medium">{failLabel}</div>
      </div>
    );
  }
  if (tile.state === "done" && tile.url) {
    return (
      <div className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tile.url}
          alt={tile.address ?? failLabel}
          className="object-cover w-full h-full"
        />
      </div>
    );
  }
  // pending / rendering → skeleton
  return <div className={`${base} bg-neutral-200 animate-pulse`} />;
}

function Spinner() {
  return (
    <div className="mx-auto w-10 h-10 relative" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border-2 border-neutral-200" />
      <div className="absolute inset-0 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Format the OH start/end window as a short human-readable badge.
 * Example: "Sat May 17 · 11–1 PM" or "Sat May 17 · 11 AM" if no end.
 *
 * why: extracted as a pure function so step 1 and step 4 both share the
 * same string format. Tolerates a bad ISO string by falling back to the
 * raw value so the UI never crashes on a weird timestamp.
 */
function formatOhBadge(startIso: string, endIso: string | null): string {
  try {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return startIso;
    const day = start.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const startHour = formatHour(start);
    if (!endIso) return `${day} · ${startHour}`;
    const end = new Date(endIso);
    if (Number.isNaN(end.getTime())) return `${day} · ${startHour}`;
    const endHour = formatHour(end);
    return `${day} · ${startHour}–${endHour}`;
  } catch {
    return startIso;
  }
}

/**
 * "11 AM" / "1:30 PM" — short hour with minutes only when non-zero.
 */
function formatHour(d: Date): string {
  const opts: Intl.DateTimeFormatOptions =
    d.getMinutes() === 0
      ? { hour: "numeric", hour12: true }
      : { hour: "numeric", minute: "2-digit", hour12: true };
  return d.toLocaleTimeString("en-US", opts);
}

/** Map a PostFormat enum to a short display string. */
function prettyFormat(f: PostFormat): string {
  switch (f) {
    case "square_1x1":
      return "Square 1:1";
    case "story_9x16":
      return "Story 9:16";
  }
}
