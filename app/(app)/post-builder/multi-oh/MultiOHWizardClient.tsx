"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Check, Loader2 } from "lucide-react";
import { resolveHostingAgent } from "@/lib/open-houses/host-resolution";
import {
  MULTI_OH_MAX_PROPERTIES,
  MULTI_OH_MIN_PROPERTIES,
  type MultiOHEventInput,
  type MultiOHEventProperty,
  type PostBuilderListing,
  type PostFormat,
} from "@/lib/post-builder/types";
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
  defaultOfficeName,
  dbTemplatesByFormat,
}: Props) {
  const router = useRouter();

  // ---- step machine ------------------------------------------------------
  const [step, setStep] = useState<StepIndex>(1);

  // ---- step 1 — selection -----------------------------------------------
  /** mls_numbers in selection order; the carousel slide order follows this
   *  list 1:1. Drag-reorder on step 4 mutates this same array. */
  const [selectedMls, setSelectedMls] = useState<readonly string[]>([]);
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
  >({});

  // ---- step 1 (cont.) — bulk hosting agent -----------------------------
  // why: the common case is "Larissa hosts everything" — set once at the
  // top of the picker rather than re-typing on every row. The control
  // OVERWRITES every per-row value when applied (even if the user had
  // individually customized rows already), and the dismissible hint below
  // it offers an undo that re-derives each row from its listing.
  const [bulkHostingAgent, setBulkHostingAgent] = useState<string>("");
  /** Snapshot of perPropertyHostingAgent immediately BEFORE the last
   *  bulk-apply, so the undo link can restore each row. We snapshot the
   *  whole map (not just the names that changed) so a partial overwrite
   *  followed by undo lands back exactly where the user left off. */
  const bulkUndoSnapshotRef = useRef<Record<string, string> | null>(null);
  /** Whether the "Applied X to all N — undo" hint is visible. Goes true
   *  after applyBulkHostingAgent; flips false when the user clicks undo or
   *  clears the bulk input. */
  const [bulkHintVisible, setBulkHintVisible] = useState(false);
  /** The agent name actually applied in the most recent bulk overwrite —
   *  cached so the hint copy doesn't update mid-typing if the user keeps
   *  editing the bulk input after applying. */
  const [bulkAppliedAgent, setBulkAppliedAgent] = useState<string>("");

  // Bulk apply/undo handlers are defined LOWER, after `listingsByMls`
  // is constructed — the undo path reads from it to re-derive defaults.

  // ---- step 1 (cont.) — event title ------------------------------------
  // why: event_title used to live on its own "Event details" step alongside
  // event-level agent fields. 2026-05-21 that step was cut — the only thing
  // left to ask is the title (one input, one decision), so we moved it up
  // into Step 1 right above the property list. The auto-derive logic still
  // applies: titleDirty flips true the moment the user edits, after which
  // we stop overwriting the field when the picked set changes.
  const [eventTitle, setEventTitle] = useState<string>("");
  const [titleDirty, setTitleDirty] = useState(false);

  // ---- step 2 — format + variant ---------------------------------------
  const [format, setFormat] = useState<PostFormat>("square_1x1");
  const [perPropertyVariant, setPerPropertyVariant] = useState<PerPropertyVariant>("v2");
  /**
   * Phase 2E — when set, every per-property card in the carousel renders
   * via the admin-authored DB template at this UUID instead of the
   * legacy `perPropertyVariant` registry entry. Mutually exclusive with
   * the variant choice in the UI (picking a DB card clears the legacy
   * variant from the active state; picking a legacy card clears this).
   */
  const [dbTemplateId, setDbTemplateId] = useState<string | null>(null);

  // ---- step 3 — carousel preview focus ---------------------------------
  // why: Step 3 shows a featured slide preview at the top + a ribbon of
  // thumbnails below. The user clicks a thumbnail to swap which slide is
  // featured. We track focus by KEY ("hero" or the property's mls_number)
  // rather than by index so a drag-reorder doesn't change which slide is
  // featured — the user stays anchored on the slide they were looking at.
  const [focusedSlideKey, setFocusedSlideKey] = useState<string>("hero");

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

  /** Auto-derived default event_title from the picked OH dates. The user can
   *  override; once they do, titleDirty stays true and we leave it alone. */
  const derivedEventTitle = useMemo(
    () => deriveEventTitle(selectedListings),
    [selectedListings],
  );

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

  // ---- bulk hosting-agent apply / undo --------------------------------
  // Defined here (not next to the state above) so `listingsByMls` is in
  // scope for the undo path's re-derive fallback.
  const applyBulkHostingAgent = useCallback((): void => {
    const trimmed = bulkHostingAgent.trim();
    if (trimmed.length === 0) return;
    setPerPropertyHostingAgent((prev) => {
      // Snapshot BEFORE overwrite so undo can restore the exact prior
      // state (including any per-row customizations the user had typed).
      bulkUndoSnapshotRef.current = { ...prev };
      const next: Record<string, string> = {};
      for (const mls of Object.keys(prev)) next[mls] = trimmed;
      return next;
    });
    setBulkAppliedAgent(trimmed);
    setBulkHintVisible(true);
  }, [bulkHostingAgent]);

  const undoBulkHostingAgent = useCallback((): void => {
    // Restore from snapshot when we have one; otherwise re-derive each row
    // from its listing (matches the seed logic in toggleSelect).
    const snapshot = bulkUndoSnapshotRef.current;
    setPerPropertyHostingAgent((prev) => {
      if (snapshot) return snapshot;
      const next: Record<string, string> = {};
      for (const mls of Object.keys(prev)) {
        const listing = listingsByMls.get(mls);
        next[mls] = resolveHostingAgent(
          listing?.oh_comments,
          listing?.agent_name,
        );
      }
      return next;
    });
    bulkUndoSnapshotRef.current = null;
    setBulkHintVisible(false);
    setBulkAppliedAgent("");
    setBulkHostingAgent("");
  }, [listingsByMls]);

  // Auto-fill event_title when the user hasn't manually edited it.
  useEffect(() => {
    if (!titleDirty) {
      setEventTitle(derivedEventTitle);
    }
  }, [derivedEventTitle, titleDirty]);

  // Hide the bulk-apply hint as soon as the input is cleared. We don't
  // also clear bulkAppliedAgent here so the hint copy stays stable while
  // visible — only the visibility flag matters for the empty-bulk case.
  useEffect(() => {
    if (bulkHostingAgent.trim().length === 0 && bulkHintVisible) {
      setBulkHintVisible(false);
    }
  }, [bulkHostingAgent, bulkHintVisible]);

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

  // Step 1 also gates on a non-empty event title now that the input lives
  // inline above the property picker. The auto-derive effect keeps the
  // title populated as soon as a property with an oh_start_at is picked,
  // so under normal use this is satisfied the moment selectedMls hits 2 —
  // but the explicit check protects against the edge case where a user
  // blanks the field manually.
  const canContinueFromStep1 =
    selectedMls.length >= MULTI_OH_MIN_PROPERTIES &&
    eventTitle.trim().length > 0;

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
      event_title: eventTitle.trim(),
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
      properties,
    };
  }, [
    selectedListings,
    eventTitle,
    format,
    perPropertyVariant,
    dbTemplateId,
    defaultOfficeName,
    perPropertyHostingAgent,
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
    [router],
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
    router.push(partialResult.redirectPath);
  }, [partialResult, router]);

  // ---- render -----------------------------------------------------------

  return (
    <div className="relative">
      <Stepper currentStep={step} onJump={goToStep} />

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
            selectedMls={selectedMls}
            onToggle={toggleSelect}
            perPropertyHostingAgent={perPropertyHostingAgent}
            onHostingAgentChange={setHostingAgentForProperty}
            eventTitle={eventTitle}
            onEventTitleChange={(next) => {
              setTitleDirty(true);
              setEventTitle(next);
            }}
            consolidationSummary={consolidationSummary}
            bulkHostingAgent={bulkHostingAgent}
            onBulkHostingAgentChange={setBulkHostingAgent}
            onApplyBulkHostingAgent={applyBulkHostingAgent}
            onUndoBulkHostingAgent={undoBulkHostingAgent}
            bulkHintVisible={bulkHintVisible}
            bulkAppliedAgent={bulkAppliedAgent}
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
            eventTitle={eventTitle}
            selectedListings={selectedListings}
            format={format}
            variant={perPropertyVariant}
            perPropertyHostingAgent={perPropertyHostingAgent}
            focusedSlideKey={focusedSlideKey}
            onFocusChange={setFocusedSlideKey}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
        ) : null}
      </div>

      <StickyFooter
        step={step}
        selectedCount={selectedMls.length}
        canContinueFromStep1={canContinueFromStep1}
        onBack={() => goToStep((step - 1) as StepIndex)}
        onContinue={() => {
          if (step === 1 && canContinueFromStep1) setStep(2);
          else if (step === 2) setStep(3);
        }}
        onGenerate={generate}
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
    </div>
  );
}

// ===========================================================================
// Stepper bar
// ===========================================================================

interface StepperProps {
  currentStep: StepIndex;
  onJump: (target: StepIndex) => void;
}

const STEP_LABELS: readonly { id: StepIndex; label: string }[] = [
  { id: 1, label: "Pick properties" },
  { id: 2, label: "Template" },
  { id: 3, label: "Review + generate" },
];

function Stepper({ currentStep, onJump }: StepperProps) {
  return (
    <ol className="mb-6 flex items-center gap-1.5 overflow-x-auto" aria-label="Wizard progress">
      {STEP_LABELS.map((s, idx) => {
        const isActive = s.id === currentStep;
        const isComplete = s.id < currentStep;
        const isClickable = s.id <= currentStep;
        return (
          <li key={s.id} className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => isClickable && onJump(s.id)}
              disabled={!isClickable}
              aria-current={isActive ? "step" : undefined}
              className={[
                "flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-xs font-semibold transition",
                isActive
                  ? "bg-gold-100 text-gold-900 ring-1 ring-gold-500/40"
                  : isComplete
                    ? "bg-gold-50 text-gold-800 hover:bg-gold-100 ring-1 ring-gold-200"
                    : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 cursor-not-allowed",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-bold",
                  isActive
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
  selectedMls: readonly string[];
  onToggle: (mls: string) => void;
  /**
   * Map of mls_number → current hosting agent override value. Keys exist
   * only for currently-selected properties (kept in lockstep by the parent).
   */
  perPropertyHostingAgent: Record<string, string>;
  /** Update one property's hosting agent override. */
  onHostingAgentChange: (mls: string, value: string) => void;
  /** Event title shown on the hero card. Auto-derives from picked OH dates
   *  until the user edits the input, at which point the parent freezes the
   *  derivation (titleDirty). Lives at this step (vs. its own step) because
   *  it's the only event-level field left after the 2026-05-21 wizard cut. */
  eventTitle: string;
  onEventTitleChange: (next: string) => void;
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
  /** Bulk hosting-agent input value — set on the "Hosted by everyone:"
   *  control above the picker. Submitting OVERWRITES every per-row value. */
  bulkHostingAgent: string;
  onBulkHostingAgentChange: (next: string) => void;
  /** Fires when the user submits the bulk control (Enter or Apply button). */
  onApplyBulkHostingAgent: () => void;
  /** Reverts every row to its default listing-agent-derived value. */
  onUndoBulkHostingAgent: () => void;
  /** True after applyBulk; flips false on undo or bulk-input clear. */
  bulkHintVisible: boolean;
  /** The agent name actually applied in the most recent bulk overwrite. */
  bulkAppliedAgent: string;
}

function Step1Pick({
  listings,
  selectedMls,
  onToggle,
  perPropertyHostingAgent,
  onHostingAgentChange,
  eventTitle,
  onEventTitleChange,
  consolidationSummary,
  bulkHostingAgent,
  onBulkHostingAgentChange,
  onApplyBulkHostingAgent,
  onUndoBulkHostingAgent,
  bulkHintVisible,
  bulkAppliedAgent,
}: Step1Props) {
  const atCap = selectedMls.length >= MULTI_OH_MAX_PROPERTIES;

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
            When new open houses are listed, they&apos;ll show up here.
          </div>
          <Link
            href="/post-builder"
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition"
          >
            Go to Post Builder
          </Link>
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
            Use the standard single-listing flow for that one — and come back here once you have at least {MULTI_OH_MIN_PROPERTIES}.
          </div>
          <Link
            href="/post-builder"
            className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition"
          >
            Open standard Post Builder
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-1">
        Pick the open houses for this event
      </h2>
      <p className="text-sm text-neutral-600 mb-4">
        Choose 2-{MULTI_OH_MAX_PROPERTIES} properties happening within the same weekend or event window. The order you pick them in is the order they&apos;ll appear in the carousel.
      </p>

      {/* Event title — auto-derives from the picked OH dates (e.g. "Open
          House — Saturday May 23"). Lives on Step 1 with the property
          picker because it's the only event-level field left after the
          2026-05-21 wizard cut. */}
      <div className="mb-5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
        <label
          htmlFor="event_title"
          className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-1"
        >
          Event title
          <span className="text-gold-700 ml-1">*</span>
        </label>
        <input
          id="event_title"
          type="text"
          value={eventTitle}
          onChange={(e) => onEventTitleChange(e.target.value)}
          placeholder="Open House Weekend"
          className="block w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
        />
        <div className="mt-1 text-[11px] text-neutral-500">
          Shown big at the top of the event hero card. Auto-filled from your picked open-house dates — edit to taste.
        </div>
      </div>

      {/* Bulk hosting-agent override — applies one name to every selected
          row. The common case is Larissa hosting everything; this saves
          re-typing on each row. Submitting overwrites per-row values
          unconditionally, and the dismissible hint below offers an undo
          that re-derives each row from its listing. Hidden until at least
          one property is picked so the strip doesn't clutter an empty list. */}
      {selectedMls.length > 0 ? (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor="bulk-hosting-agent"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-700 shrink-0"
            >
              Hosted by everyone:
            </label>
            <input
              id="bulk-hosting-agent"
              type="text"
              value={bulkHostingAgent}
              onChange={(e) => onBulkHostingAgentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onApplyBulkHostingAgent();
                }
              }}
              placeholder="e.g. Larissa Wilkerson"
              className="flex-1 min-w-[140px] rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
            />
            <button
              type="button"
              onClick={onApplyBulkHostingAgent}
              disabled={bulkHostingAgent.trim().length === 0}
              className={[
                "rounded-md px-3 py-1 text-xs font-semibold transition shrink-0",
                bulkHostingAgent.trim().length === 0
                  ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                  : "bg-gold-500 text-white hover:bg-gold-600",
              ].join(" ")}
            >
              Apply to all
            </button>
          </div>
          {bulkHintVisible && bulkAppliedAgent.length > 0 ? (
            <div className="mt-1.5 text-[11px] text-neutral-500">
              Applied <span className="font-semibold text-neutral-700">{bulkAppliedAgent}</span> to all {selectedMls.length}{" "}
              {selectedMls.length === 1 ? "property" : "properties"} —{" "}
              <button
                type="button"
                onClick={onUndoBulkHostingAgent}
                className="text-gold-700 underline underline-offset-2 hover:text-gold-800"
              >
                undo
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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

      <ul className="space-y-2">
        {listings.map((l) => {
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
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
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
function HostingAgentRow({ mls, value, onChange }: HostingAgentRowProps) {
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
      <input
        id={`hosting-agent-${mls}`}
        type="text"
        value={value}
        onChange={(e) => onChange(mls, e.target.value)}
        placeholder="Hosting agent name"
        className="block w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
      />
      <div className="mt-1 text-[10px] text-neutral-500">
        Defaults to the listing agent. Override if a different agent is hosting this open house.
      </div>
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
          This is the design for each individual property slide. The event hero card uses its own dedicated multi-property layout.
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
// Step 3 — Review + generate (carousel preview)
// ===========================================================================
//
// 2026-05-21 — Step 3 was rewritten from a text-only summary into a visual
// "carousel preview." The user sees what they're about to render before
// clicking Generate:
//
//   • Featured slide preview (top) — ratio-correct CSS mock at ~480px wide
//     that matches the chosen format + variant. Shows the focused slide
//     (hero by default, or any property the user clicks in the ribbon).
//   • Slide ribbon (middle) — every slide as a small thumbnail in carousel
//     order. Property thumbs are drag-reorderable; the hero is pinned at
//     position 1. Clicking a thumb focuses it in the preview above.
//   • Compact summary line (bottom) — single-line metadata + render-time
//     hint, replacing what used to be two separate cards.
//
// The mocks are CSS approximations, not real renders. They convey shape,
// layout, and structure — not pixel fidelity. Real renders happen in the
// 20-40s generate phase.

interface Step3Props {
  eventTitle: string;
  selectedListings: readonly PostBuilderListing[];
  format: PostFormat;
  variant: PerPropertyVariant;
  /** Per-property hosting agent map (mls_number → name). Featured property
   *  mocks read this to display the correct host, falling back to the
   *  listing's own agent_name when no override is set. */
  perPropertyHostingAgent: Record<string, string>;
  /** Which slide is currently featured in the big preview. "hero" or a
   *  property's mls_number. Survives drag-reorders cleanly. */
  focusedSlideKey: string;
  onFocusChange: (key: string) => void;
  onDragStart: (mls: string) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (targetMls: string) => void;
}

function Step3Review({
  eventTitle,
  selectedListings,
  format,
  variant,
  perPropertyHostingAgent,
  focusedSlideKey,
  onFocusChange,
  onDragStart,
  onDragOver,
  onDrop,
}: Step3Props) {
  // Resolve the focused slide. If the user previously focused a property
  // that's no longer in the picked set (shouldn't happen on Step 3 normally,
  // but defensive), fall back to the hero.
  const focusedListing =
    focusedSlideKey === "hero"
      ? null
      : selectedListings.find((l) => l.mls_number === focusedSlideKey) ?? null;
  const isHeroFocused = focusedListing === null;
  const focusedPosition = isHeroFocused
    ? 1
    : selectedListings.findIndex((l) => l.mls_number === focusedSlideKey) + 2;

  const totalSlides = selectedListings.length + 1;

  return (
    <section className="space-y-5">
      {/* ─── Featured slide preview ────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Slide {focusedPosition} of {totalSlides}
              <span className="text-neutral-500 font-normal ml-2">
                {isHeroFocused ? "· Event hero" : `· ${variant.toUpperCase()} property card`}
              </span>
            </h3>
            <div className="text-xs text-neutral-500 mt-0.5">
              Preview is a layout mock — the final render adds full polish, real photo composition, and brand polish.
            </div>
          </div>
          <span className="text-xs text-neutral-500 hidden sm:inline">
            {prettyFormat(format)}
          </span>
        </div>
        <div className="flex justify-center">
          <FeaturedSlideMock
            format={format}
            variant={variant}
            kind={isHeroFocused ? "hero" : "property"}
            eventTitle={eventTitle}
            properties={selectedListings}
            hostingAgents={perPropertyHostingAgent}
            listing={focusedListing}
            hostingAgent={
              focusedListing
                ? perPropertyHostingAgent[focusedListing.mls_number] ?? focusedListing.agent_name ?? ""
                : ""
            }
          />
        </div>
      </div>

      {/* ─── Slide ribbon ──────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Carousel order
          </h3>
          <span className="text-xs text-neutral-500">
            Tap a slide to preview · drag properties to re-order
          </span>
        </div>
        <SlideRibbon
          format={format}
          variant={variant}
          eventTitle={eventTitle}
          selectedListings={selectedListings}
          focusedSlideKey={focusedSlideKey}
          onFocusChange={onFocusChange}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      </div>

      {/* ─── Compact summary + render hint ─────────────────────────── */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
        <div className="text-sm text-neutral-700 leading-snug">
          <span className="font-semibold text-neutral-900">{totalSlides} slides total</span>
          <span className="text-neutral-400 mx-2">·</span>
          <span>{prettyFormat(format)}</span>
          <span className="text-neutral-400 mx-2">·</span>
          <span>{prettyVariant(variant)}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Rendering takes about 20-40 seconds. You&apos;ll be redirected to Post Builder when it&apos;s ready.
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Featured slide mock — large, content-rich CSS approximation of the slide.
// ---------------------------------------------------------------------------

/**
 * Tailwind aspect-ratio classes per PostFormat. Used by both the featured
 * mock and the ribbon thumbnails — same source of truth so a Square pick
 * shows square mocks everywhere, etc.
 */
const FORMAT_ASPECT: Record<PostFormat, string> = {
  square_1x1: "aspect-square",
  story_9x16: "aspect-[9/16]",
};

interface FeaturedSlideMockProps {
  format: PostFormat;
  variant: PerPropertyVariant;
  kind: "hero" | "property";
  eventTitle: string;
  properties: readonly PostBuilderListing[];
  /** Per-property hosting agent map — forwarded to HeroSlideBody so the
   *  featured hero shows "Hosted by …" per row. */
  hostingAgents: Record<string, string>;
  listing: PostBuilderListing | null;
  hostingAgent: string;
}

function FeaturedSlideMock({
  format,
  variant,
  kind,
  eventTitle,
  properties,
  hostingAgents,
  listing,
  hostingAgent,
}: FeaturedSlideMockProps) {
  // Cap featured width per format so square doesn't dominate vs story.
  // Story gets a narrower max (it's tall, will fill vertically); square
  // and portrait get the full ~480px.
  const widthClass =
    format === "story_9x16" ? "w-[280px]" : "w-full max-w-[440px]";

  return (
    <div className={`${widthClass} ${FORMAT_ASPECT[format]} relative shadow-md rounded-sm overflow-hidden ring-1 ring-neutral-200`}>
      {kind === "hero" ? (
        <HeroSlideBody
          eventTitle={eventTitle}
          properties={properties}
          hostingAgents={hostingAgents}
          size="featured"
        />
      ) : listing ? (
        <PropertySlideBody
          variant={variant}
          listing={listing}
          hostingAgent={hostingAgent}
          size="featured"
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero slide body — used by both featured + ribbon, scaled via `size` prop.
// ---------------------------------------------------------------------------

interface HeroSlideBodyProps {
  eventTitle: string;
  properties: readonly PostBuilderListing[];
  size: "featured" | "thumb";
  /** Per-property hosting agent overrides (mls_number → name). Optional —
   *  ribbon thumbs pass undefined since the thumb is too small to legibly
   *  show hosted-by anyway. When present and the featured size is used,
   *  each row renders a "Hosted by …" line below the address/city/time
   *  strip. */
  hostingAgents?: Record<string, string>;
}

function HeroSlideBody({
  eventTitle,
  properties,
  size,
  hostingAgents,
}: HeroSlideBodyProps) {
  const isThumb = size === "thumb";
  // 2026-05-22 — consolidate same-mls picks so a condo unit with Sat + Sun
  // open houses renders as ONE row with both windows on the sub-line,
  // mirroring what the real render does via consolidatePropertiesByMls
  // in the route. Wizard mocks were showing duplicate rows before.
  const consolidated: Array<{
    listing: PostBuilderListing;
    sessions: Array<{ start_at: string | null; end_at: string | null }>;
  }> = [];
  const indexByMls = new Map<string, number>();
  for (const p of properties) {
    const existing = indexByMls.get(p.mls_number);
    const session = { start_at: p.oh_start_at ?? null, end_at: p.oh_end_at ?? null };
    if (existing === undefined) {
      indexByMls.set(p.mls_number, consolidated.length);
      consolidated.push({ listing: p, sessions: [session] });
    } else {
      consolidated[existing].sessions.push(session);
    }
  }
  // Sort each property's sessions chronologically so Sat reads before Sun.
  for (const entry of consolidated) {
    entry.sessions.sort((a, b) => {
      const ta = a.start_at ? new Date(a.start_at).getTime() : 0;
      const tb = b.start_at ? new Date(b.start_at).getTime() : 0;
      return ta - tb;
    });
  }
  // Cap the rendered rows so a 9-property event doesn't blow out the layout
  // — the real render uses computeRowDensity to shrink, but for the mock
  // we just truncate with a "+N more" line.
  const maxRows = isThumb ? 3 : 6;
  const visible = consolidated.slice(0, maxRows);
  const overflow = consolidated.length - visible.length;

  // Resolve a row's hosting agent: explicit override first, listing's own
  // agent_name second, empty third (suppresses the "Hosted by" line). The
  // explicit map mirrors the per-property override the wizard collects on
  // Step 1.
  const hostFor = (p: PostBuilderListing): string => {
    const override = hostingAgents?.[p.mls_number]?.trim() ?? "";
    if (override.length > 0) return override;
    return (p.agent_name ?? "").trim();
  };

  return (
    <div className="w-full h-full bg-[#FCFCFB] flex flex-col p-[6%]">
      {/* eyebrow */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="block bg-gradient-to-r from-[#C9A84C] to-[#A68A4A]"
          style={{ width: isThumb ? 14 : 36, height: 2 }}
        />
        <span
          className={`font-bold uppercase tracking-[0.2em] text-[#A68A4A] ${isThumb ? "text-[5px]" : "text-[10px]"}`}
        >
          Open House Event
        </span>
      </div>
      {/* title */}
      <div
        className={`mt-[3%] font-serif font-bold text-[#18181B] leading-[1.05] ${isThumb ? "text-[7px]" : "text-[20px]"}`}
        style={{ fontFamily: "Georgia, serif" }}
      >
        {eventTitle || "Untitled event"}
      </div>
      {/* property list */}
      <div className={`mt-[4%] flex-1 flex flex-col ${isThumb ? "gap-[2px]" : "gap-2.5"} overflow-hidden`}>
        {visible.map((entry, i) => {
          const p = entry.listing;
          const baseAddress = (p.address ?? p.mls_number ?? "").trim();
          const unit = (p.unit_number ?? "").trim();
          // 2026-05-22 — append unit suffix so condo / townhouse rows
          // show "511 E 11th Avenue · Unit 207" rather than orphaning
          // the unit ID where the consumer can't see it.
          const addressLine = unit
            ? baseAddress
              ? `${baseAddress} · ${unit}`
              : unit
            : baseAddress;
          const cityState = [p.city, p.state].filter(Boolean).join(", ");
          // Every session window for this consolidated entry. Empty array
          // when none have a valid timestamp.
          const sessionLabels = entry.sessions
            .map((s) =>
              s.start_at ? formatOhBadge(s.start_at, s.end_at ?? null) : "",
            )
            .filter((s) => s.length > 0);
          const host = hostFor(p);

          if (isThumb) {
            // Tight one-line row for ribbon thumbs — address truncates,
            // no city/time/host (too small to be legible).
            return (
              <div
                key={p.mls_number}
                className="flex items-center gap-1"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-full bg-gradient-to-br from-[#C9A84C] to-[#A68A4A] text-white font-bold flex items-center justify-center w-[7px] h-[7px] text-[4px]"
                >
                  {i + 1}
                </span>
                <span className="truncate text-[#525250] text-[4px]">
                  {addressLine}
                </span>
              </div>
            );
          }

          // Featured row — multi-line: address + city · session1 · session2 + hosted-by.
          // Mirrors the real renderer's renderPropertyRow output.
          return (
            <div
              key={p.mls_number}
              className="flex items-start gap-2"
            >
              <span
                aria-hidden="true"
                className="shrink-0 mt-0.5 rounded-full bg-gradient-to-br from-[#C9A84C] to-[#A68A4A] text-white font-bold flex items-center justify-center w-4 h-4 text-[9px]"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-[#18181B] leading-tight">
                  {addressLine}
                </div>
                {(cityState || sessionLabels.length > 0) ? (
                  <div className="flex items-center gap-1 mt-0.5 text-[9px] text-[#525250] leading-tight flex-wrap">
                    {cityState ? <span className="truncate">{cityState}</span> : null}
                    {sessionLabels.map((label, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1">
                        {(cityState || idx > 0) ? (
                          <span
                            aria-hidden="true"
                            className="inline-block w-1 h-1 rounded-full bg-[#C9A84C] shrink-0"
                          />
                        ) : null}
                        <span className="truncate">{label}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {host ? (
                  <div className="mt-0.5 text-[9px] italic text-[#525250] truncate">
                    Hosted by {host}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {overflow > 0 ? (
          <div
            className={`text-[#A68A4A] font-semibold ${isThumb ? "text-[4px]" : "text-[9px]"}`}
          >
            + {overflow} more
          </div>
        ) : null}
      </div>
      {/* brand strip */}
      <div className={`${isThumb ? "mt-1 pt-1" : "mt-2 pt-2"} border-t border-[#18181B]/30 relative`}>
        {/* gold accent on top edge */}
        <span
          aria-hidden="true"
          className="absolute top-[-1px] left-0 bg-gradient-to-r from-[#C9A84C] to-[#A68A4A]"
          style={{ width: isThumb ? 18 : 56, height: 2 }}
        />
        <div className="flex items-center justify-between">
          <div className={`flex items-center ${isThumb ? "gap-[3px]" : "gap-1.5"}`}>
            <span
              className={`bg-gradient-to-br from-[#C9A84C] to-[#A68A4A] text-white font-bold flex items-center justify-center rounded-sm ${isThumb ? "w-[8px] h-[8px] text-[4px]" : "w-5 h-5 text-[9px]"}`}
            >
              21
            </span>
            <span
              className={`font-semibold text-[#18181B] ${isThumb ? "text-[4px]" : "text-[10px]"}`}
            >
              Century 21 Alliance
            </span>
          </div>
          <span
            className={`uppercase tracking-wider text-[#525250] ${isThumb ? "text-[3px]" : "text-[8px]"}`}
          >
            Open House Event
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property slide body — switches layout based on variant (v1/v2/v3).
// ---------------------------------------------------------------------------

interface PropertySlideBodyProps {
  variant: PerPropertyVariant;
  listing: PostBuilderListing;
  hostingAgent: string;
  size: "featured" | "thumb";
}

function PropertySlideBody({
  variant,
  listing,
  hostingAgent,
  size,
}: PropertySlideBodyProps) {
  switch (variant) {
    case "v2":
      return <PropertyV2Mock listing={listing} hostingAgent={hostingAgent} size={size} />;
    case "v3":
      return <PropertyV3Mock listing={listing} hostingAgent={hostingAgent} size={size} />;
    case "v6":
      return <PropertyV6Mock listing={listing} hostingAgent={hostingAgent} size={size} />;
    case "v8":
      return <PropertyV8Mock listing={listing} hostingAgent={hostingAgent} size={size} />;
  }
}

interface VariantMockProps {
  listing: PostBuilderListing;
  hostingAgent: string;
  size: "featured" | "thumb";
}

/** v2 — Bold Stats. Photo top ~58%, dark data pane bottom ~42% with
 *  bd/ba/price stats. */
function PropertyV2Mock({ listing, hostingAgent, size }: VariantMockProps) {
  const isThumb = size === "thumb";
  const photo = listing.hero_image_url ?? "";
  return (
    <div className="w-full h-full flex flex-col">
      {/* photo */}
      <div className="relative w-full bg-neutral-300" style={{ flexBasis: "58%" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
        {/* eyebrow over photo */}
        <div className={`absolute top-0 left-0 right-0 flex items-center ${isThumb ? "gap-1 p-1.5" : "gap-2 p-3"}`}>
          <span
            aria-hidden="true"
            className="block bg-gradient-to-r from-[#C9A84C] to-[#A68A4A]"
            style={{ width: isThumb ? 12 : 32, height: 2 }}
          />
          <span
            className={`font-bold uppercase tracking-[0.2em] text-[#C9A84C] ${isThumb ? "text-[5px]" : "text-[10px]"}`}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
          >
            Open House
          </span>
        </div>
      </div>
      {/* dark data pane */}
      <div
        className={`text-white ${isThumb ? "p-1.5" : "p-3"}`}
        style={{ flexBasis: "42%", background: "#18181B" }}
      >
        <div
          className={`font-serif font-bold leading-tight ${isThumb ? "text-[7px]" : "text-base"}`}
          style={{ fontFamily: "Georgia, serif" }}
        >
          {displayAddressWithUnit(listing)}
        </div>
        <div
          className={`opacity-80 ${isThumb ? "text-[5px] mt-0.5" : "text-xs mt-1"}`}
        >
          {[listing.city, listing.state].filter(Boolean).join(", ")}
        </div>
        {/* stats row */}
        {!isThumb ? (
          <div className="mt-2 flex items-center gap-3 text-xs text-white/85">
            {typeof listing.bedrooms === "number" ? (
              <span>
                <span className="font-bold text-white">{listing.bedrooms}</span> bd
              </span>
            ) : null}
            {typeof listing.bathrooms_full === "number" ? (
              <span>
                <span className="font-bold text-white">
                  {listing.bathrooms_full + (listing.bathrooms_half ?? 0) * 0.5}
                </span>{" "}
                ba
              </span>
            ) : null}
            {typeof listing.list_price === "number" ? (
              <span className="text-[#C9A84C] font-bold">
                ${listing.list_price.toLocaleString()}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-1 flex gap-1 opacity-70">
            <span className="block w-3 h-1 rounded-sm bg-white/60" />
            <span className="block w-3 h-1 rounded-sm bg-white/60" />
            <span className="block w-4 h-1 rounded-sm bg-[#C9A84C]" />
          </div>
        )}
        {!isThumb && listing.oh_start_at ? (
          <div className="mt-1.5 text-[10px] text-[#C9A84C] font-medium">
            {formatOhBadge(listing.oh_start_at, listing.oh_end_at ?? null)}
          </div>
        ) : null}
        {!isThumb && hostingAgent ? (
          <div className="mt-0.5 text-[10px] text-white/70">
            Hosted by {hostingAgent}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** v3 — Excellence Collection. Premium tier ($949k+). Gold-trimmed
 *  editorial frame: dominant photo top ~62%, cream pane below with
 *  "EXCELLENCE COLLECTION" eyebrow + Playfair price. Subtle gold rule
 *  along the edges signals luxury. */
function PropertyV3Mock({ listing, hostingAgent, size }: VariantMockProps) {
  const isThumb = size === "thumb";
  const photo = listing.hero_image_url ?? "";
  return (
    <div className="w-full h-full flex flex-col relative bg-[#FCFCFB]">
      {/* Gold trim border — subtle 1px gold rule on all four edges. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none ring-1 ring-[#C9A84C]/60 z-10"
      />
      {/* photo dominant */}
      <div className="relative w-full bg-neutral-300" style={{ flexBasis: "62%" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      {/* cream data pane below */}
      <div
        className={`flex flex-col text-[#18181B] ${isThumb ? "p-1.5" : "p-3"}`}
        style={{ flexBasis: "38%" }}
      >
        {/* eyebrow — gold "Excellence Collection" */}
        <div
          className={`font-bold uppercase tracking-[0.22em] text-[#A68A4A] ${isThumb ? "text-[4px]" : "text-[9px]"}`}
        >
          Excellence Collection
        </div>
        <div
          className={`mt-1 font-serif font-bold leading-tight ${isThumb ? "text-[6px]" : "text-sm"}`}
          style={{ fontFamily: "Georgia, serif" }}
        >
          {displayAddressWithUnit(listing)}
        </div>
        <div
          className={`opacity-70 ${isThumb ? "text-[4px] mt-0.5" : "text-[10px] mt-0.5"}`}
        >
          {[listing.city, listing.state].filter(Boolean).join(", ")}
        </div>
        <div className="flex-1" />
        {!isThumb && typeof listing.list_price === "number" ? (
          <div
            className="font-serif font-bold text-[#A68A4A] text-xl leading-none"
            style={{ fontFamily: "Georgia, serif" }}
          >
            ${listing.list_price.toLocaleString()}
          </div>
        ) : null}
        {!isThumb && listing.oh_start_at ? (
          <div className="mt-1 text-[10px] text-[#525250] font-medium">
            {formatOhBadge(listing.oh_start_at, listing.oh_end_at ?? null)}
          </div>
        ) : null}
        {!isThumb && hostingAgent ? (
          <div className="mt-0.5 text-[10px] text-[#525250]">
            Hosted by {hostingAgent}
          </div>
        ) : null}
        {isThumb ? (
          <div className="flex gap-0.5 mt-auto">
            <span className="block flex-1 h-0.5 bg-[#C9A84C]" />
            <span className="block flex-1 h-0.5 bg-[#A68A4A]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** v6 — Magazine Cover. Hero photo top ~55%, cream surface below with
 *  large serif headline + price. Editorial / magazine-cover feel. */
function PropertyV6Mock({ listing, hostingAgent, size }: VariantMockProps) {
  const isThumb = size === "thumb";
  const photo = listing.hero_image_url ?? "";
  return (
    <div className="w-full h-full flex flex-col bg-[#FCFCFB]">
      {/* photo top — magazine-cover style */}
      <div className="relative w-full bg-neutral-300" style={{ flexBasis: "55%" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
        {/* Top-left masthead-style eyebrow */}
        <div className={`absolute top-0 left-0 right-0 flex items-center ${isThumb ? "gap-1 p-1.5" : "gap-2 p-3"}`}>
          <span
            aria-hidden="true"
            className="block bg-gradient-to-r from-[#C9A84C] to-[#A68A4A]"
            style={{ width: isThumb ? 12 : 32, height: 2 }}
          />
          <span
            className={`font-bold uppercase tracking-[0.22em] text-white ${isThumb ? "text-[5px]" : "text-[10px]"}`}
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
          >
            Open House
          </span>
        </div>
      </div>
      {/* cream pane with editorial headline + price */}
      <div
        className={`flex flex-col text-[#18181B] ${isThumb ? "p-1.5" : "p-3"}`}
        style={{ flexBasis: "45%" }}
      >
        <div
          className={`font-serif font-bold leading-[1.05] ${isThumb ? "text-[8px]" : "text-lg"}`}
          style={{ fontFamily: "Georgia, serif" }}
        >
          {displayAddressWithUnit(listing)}
        </div>
        <div
          className={`opacity-70 ${isThumb ? "text-[4px] mt-0.5" : "text-[11px] mt-1"}`}
        >
          {[listing.city, listing.state].filter(Boolean).join(", ")}
        </div>
        <div className="flex-1" />
        {!isThumb && typeof listing.list_price === "number" ? (
          <div
            className="font-serif font-bold text-[#A68A4A] text-2xl leading-none"
            style={{ fontFamily: "Georgia, serif" }}
          >
            ${listing.list_price.toLocaleString()}
          </div>
        ) : null}
        {!isThumb && listing.oh_start_at ? (
          <div className="mt-1.5 text-[10px] text-[#525250] font-medium">
            {formatOhBadge(listing.oh_start_at, listing.oh_end_at ?? null)}
          </div>
        ) : null}
        {!isThumb && hostingAgent ? (
          <div className="mt-0.5 text-[10px] text-[#525250]">
            Hosted by {hostingAgent}
          </div>
        ) : null}
        {isThumb ? (
          <div className="mt-auto">
            <span
              aria-hidden="true"
              className="block bg-gradient-to-r from-[#C9A84C] to-[#A68A4A]"
              style={{ width: 20, height: 1.5 }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** v8 — Standard NEW LISTING. Cream surface top ~65% with C21 Alliance
 *  badge top-right, dark bottom band ~35% carrying address + city +
 *  bed/bath/feature row. Everyday tier. */
function PropertyV8Mock({ listing, hostingAgent, size }: VariantMockProps) {
  const isThumb = size === "thumb";
  const photo = listing.hero_image_url ?? "";
  return (
    <div className="w-full h-full flex flex-col bg-[#FCFCFB]">
      {/* photo cream-framed */}
      <div className="relative w-full bg-neutral-300" style={{ flexBasis: "65%" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
        {/* C21 Alliance badge top-right */}
        <div className={`absolute top-1 right-1 flex items-center ${isThumb ? "gap-[2px]" : "gap-1"} bg-white/95 rounded ${isThumb ? "px-1 py-0.5" : "px-1.5 py-1"} shadow-sm`}>
          <span
            className={`bg-gradient-to-br from-[#C9A84C] to-[#A68A4A] text-white font-bold flex items-center justify-center rounded-sm ${isThumb ? "w-[8px] h-[8px] text-[4px]" : "w-4 h-4 text-[8px]"}`}
          >
            21
          </span>
          <span
            className={`font-bold uppercase tracking-wider text-[#18181B] ${isThumb ? "text-[3px]" : "text-[7px]"}`}
          >
            Alliance
          </span>
        </div>
      </div>
      {/* dark bottom band */}
      <div
        className={`text-white ${isThumb ? "p-1.5" : "p-3"}`}
        style={{ flexBasis: "35%", background: "#18181B" }}
      >
        <div
          className={`font-bold leading-tight ${isThumb ? "text-[7px]" : "text-sm"}`}
        >
          {displayAddressWithUnit(listing)}
        </div>
        <div
          className={`opacity-80 ${isThumb ? "text-[4px] mt-0.5" : "text-[10px] mt-0.5"}`}
        >
          {[listing.city, listing.state].filter(Boolean).join(", ")}
        </div>
        {/* bed/bath/feature row */}
        {!isThumb ? (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/85">
            {typeof listing.bedrooms === "number" ? (
              <span>
                <span className="font-bold text-white">{listing.bedrooms}</span> bd
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className="inline-block w-0.5 h-0.5 rounded-full bg-[#C9A84C]"
            />
            {typeof listing.bathrooms_full === "number" ? (
              <span>
                <span className="font-bold text-white">
                  {listing.bathrooms_full + (listing.bathrooms_half ?? 0) * 0.5}
                </span>{" "}
                ba
              </span>
            ) : null}
            {typeof listing.list_price === "number" ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block w-0.5 h-0.5 rounded-full bg-[#C9A84C]"
                />
                <span className="text-[#C9A84C] font-bold">
                  ${listing.list_price.toLocaleString()}
                </span>
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-1 flex gap-0.5 opacity-70">
            <span className="block w-2 h-0.5 bg-white/60" />
            <span className="block w-2 h-0.5 bg-white/60" />
            <span className="block w-3 h-0.5 bg-[#C9A84C]" />
          </div>
        )}
        {!isThumb && listing.oh_start_at ? (
          <div className="mt-1 text-[10px] text-[#C9A84C] font-medium">
            {formatOhBadge(listing.oh_start_at, listing.oh_end_at ?? null)}
          </div>
        ) : null}
        {!isThumb && hostingAgent ? (
          <div className="mt-0.5 text-[10px] text-white/70">
            Hosted by {hostingAgent}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide ribbon — every slide as a small thumb, drag-reorderable on props.
// ---------------------------------------------------------------------------

interface SlideRibbonProps {
  format: PostFormat;
  variant: PerPropertyVariant;
  eventTitle: string;
  selectedListings: readonly PostBuilderListing[];
  focusedSlideKey: string;
  onFocusChange: (key: string) => void;
  onDragStart: (mls: string) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (targetMls: string) => void;
}

function SlideRibbon({
  format,
  variant,
  eventTitle,
  selectedListings,
  focusedSlideKey,
  onFocusChange,
  onDragStart,
  onDragOver,
  onDrop,
}: SlideRibbonProps) {
  // why: thumbs are fixed-HEIGHT so the layout stays predictable as count
  // grows. Width derives from the format's aspect ratio. Story is a tall
  // thumb (narrow), square is a square thumb, portrait is in between.
  // 100px tall fits comfortably on mobile; the ribbon scrolls horizontally
  // when total width exceeds the container.
  const thumbHeight = 110;
  const thumbWidthClass: Record<PostFormat, string> = {
    square_1x1: "w-[110px]",
    story_9x16: "w-[62px]",
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mb-2">
      {/* Hero thumb — pinned at position 1, not draggable */}
      <SlideThumb
        keyId="hero"
        position={1}
        focused={focusedSlideKey === "hero"}
        onFocus={() => onFocusChange("hero")}
        draggable={false}
        widthClass={thumbWidthClass[format]}
        heightPx={thumbHeight}
        label="Event hero"
      >
        <HeroSlideBody
          eventTitle={eventTitle}
          properties={selectedListings}
          size="thumb"
        />
      </SlideThumb>

      {/* Property thumbs — drag-reorderable */}
      {selectedListings.map((l, idx) => (
        <SlideThumb
          key={l.mls_number}
          keyId={l.mls_number}
          position={idx + 2}
          focused={focusedSlideKey === l.mls_number}
          onFocus={() => onFocusChange(l.mls_number)}
          draggable
          onDragStart={() => onDragStart(l.mls_number)}
          onDragOver={onDragOver}
          onDrop={() => onDrop(l.mls_number)}
          widthClass={thumbWidthClass[format]}
          heightPx={thumbHeight}
          label={l.address ?? l.mls_number}
        >
          <PropertySlideBody
            variant={variant}
            listing={l}
            hostingAgent=""
            size="thumb"
          />
        </SlideThumb>
      ))}
    </div>
  );
}

interface SlideThumbProps {
  keyId: string;
  position: number;
  focused: boolean;
  onFocus: () => void;
  draggable: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLElement>) => void;
  onDrop?: () => void;
  widthClass: string;
  heightPx: number;
  /** Used for the title attribute / a11y label. */
  label: string;
  children: React.ReactNode;
}

function SlideThumb({
  position,
  focused,
  onFocus,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  widthClass,
  heightPx,
  label,
  children,
}: SlideThumbProps) {
  return (
    <div className={`shrink-0 ${widthClass} flex flex-col items-center gap-1`}>
      <button
        type="button"
        onClick={onFocus}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        title={label}
        aria-label={`Slide ${position}: ${label}`}
        aria-current={focused ? "true" : undefined}
        className={[
          "relative w-full overflow-hidden rounded-sm transition shadow-sm",
          focused
            ? "ring-2 ring-gold-500 ring-offset-2 ring-offset-white shadow-md"
            : "ring-1 ring-neutral-200 hover:ring-neutral-300",
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        ].join(" ")}
        style={{ height: heightPx }}
      >
        {children}
        {/* Position chip — top-left corner */}
        <span
          aria-hidden="true"
          className={[
            "absolute top-1 left-1 w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm",
            focused ? "bg-gold-500" : "bg-neutral-800/80",
          ].join(" ")}
        >
          {position}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 helpers
// ---------------------------------------------------------------------------

/**
 * Compose the address line shown on a property mock, suffixing the
 * unit identifier when present (e.g. "511 E 11th Avenue · Unit 207").
 * Falls back to the MLS number when there's no address at all.
 *
 * 2026-05-22 — added so condo/townhouse units are visible in the
 * wizard preview. The real renderer applies the same suffix via
 * route.ts's toRenderListing.
 */
function displayAddressWithUnit(listing: PostBuilderListing): string {
  const base = (listing.address ?? "").trim();
  const unit = (listing.unit_number ?? "").trim();
  if (base && unit) return `${base} · ${unit}`;
  if (base) return base;
  if (unit) return unit;
  return listing.mls_number;
}

/** Short display name for the variant in summary copy. */
function prettyVariant(v: PerPropertyVariant): string {
  switch (v) {
    case "v2":
      return "v2 Bold Stats";
    case "v3":
      return "v3 Excellence Collection";
    case "v6":
      return "v6 Magazine Cover";
    case "v8":
      return "v8 Standard";
  }
}

// ===========================================================================
// Sticky footer
// ===========================================================================

interface StickyFooterProps {
  step: StepIndex;
  selectedCount: number;
  canContinueFromStep1: boolean;
  onBack: () => void;
  onContinue: () => void;
  onGenerate: () => void;
  generating: boolean;
}

function StickyFooter({
  step,
  selectedCount,
  canContinueFromStep1,
  onBack,
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
          <Link
            href="/post-builder"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition"
          >
            <span aria-hidden="true">◂</span>
            Cancel
          </Link>
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
              {generating ? "Generating…" : "Generate carousel post"}
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

        {/* Hero tile — stacked above the slide grid. */}
        <div className="mt-5 flex flex-col items-center">
          <TileShell
            tile={heroTile}
            sizeClass="w-[180px] h-[180px]"
            failLabel="Hero"
          />
          <div className="mt-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Hero
          </div>
        </div>

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
              Hero + {successCount} of {totalCount} slides ready
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

/**
 * Build a smart default event title from the picked listings' OH dates.
 *
 *   Same day → "Open House — Saturday May 23"
 *   Consecutive multi-day span → "Open House — Saturday–Sunday May 23–24"
 *     (also handles 3+ day consecutive runs like Fri–Sun May 22–24)
 *   Non-consecutive dates → "Open House — May 22 & 24" (each date listed)
 *
 * why: this runs every time the picked set changes; intentionally cheap.
 * The user can always override (titleDirty flag stops the auto-overwrite).
 *
 * 2026-05-27 — broadened from the old same-day/weekend-only logic so 3+
 * consecutive days (Fri–Sun) read naturally and non-consecutive picks
 * (Sat + Mon) don't silently fall through to a generic "Open House Event".
 */
function deriveEventTitle(selected: readonly PostBuilderListing[]): string {
  if (selected.length === 0) return "";
  // Collect one Date per unique calendar day, sorted ascending. We bucket
  // by YYYY-MM-DD so a property with both Sat + Sun OHs contributes both
  // days exactly once even though it appears as two picks.
  const byDay = new Map<string, Date>();
  for (const l of selected) {
    if (!l.oh_start_at) continue;
    const d = new Date(l.oh_start_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, d);
  }
  if (byDay.size === 0) return "Open House Event";
  const dates = Array.from(byDay.values()).sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  // Same-day → "Open House — Saturday May 23"
  if (dates.length === 1) {
    const d = dates[0];
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
    const monthDay = d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    return `Open House — ${dayName} ${monthDay}`;
  }

  // Consecutive run? Walk the sorted list and check each gap is exactly 1
  // calendar day. We compare on UTC-midnight rounding to avoid DST drift
  // tripping the diff over to 23h / 25h.
  const consecutive = dates.every((d, i) => {
    if (i === 0) return true;
    const prev = dates[i - 1];
    const dayMs = 24 * 60 * 60 * 1000;
    const a = Date.UTC(prev.getFullYear(), prev.getMonth(), prev.getDate());
    const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return b - a === dayMs;
  });

  if (consecutive) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    const firstDay = first.toLocaleDateString("en-US", { weekday: "long" });
    const lastDay = last.toLocaleDateString("en-US", { weekday: "long" });
    const firstMonth = first.toLocaleDateString("en-US", { month: "long" });
    const lastMonth = last.toLocaleDateString("en-US", { month: "long" });
    // Same month across the span → "May 23–24"; otherwise → "May 30–June 1".
    const dateRange =
      firstMonth === lastMonth
        ? `${firstMonth} ${first.getDate()}–${last.getDate()}`
        : `${firstMonth} ${first.getDate()}–${lastMonth} ${last.getDate()}`;
    return `Open House — ${firstDay}–${lastDay} ${dateRange}`;
  }

  // Non-consecutive — list each date. "Open House — May 22 & 24" or
  // "Open House — May 22, 24 & 27" when 3+ dates.
  const parts = dates.map((d) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
  );
  if (parts.length === 2) return `Open House — ${parts[0]} & ${parts[1]}`;
  const head = parts.slice(0, -1).join(", ");
  const tail = parts[parts.length - 1];
  return `Open House — ${head} & ${tail}`;
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
