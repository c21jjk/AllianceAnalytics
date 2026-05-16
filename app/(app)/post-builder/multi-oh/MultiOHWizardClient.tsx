"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MULTI_OH_MAX_PROPERTIES,
  MULTI_OH_MIN_PROPERTIES,
  type MultiOHEventInput,
  type MultiOHEventProperty,
  type MultiOHGenerateResult,
  type PostBuilderListing,
  type PostFormat,
} from "@/lib/post-builder/types";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** v1/v2/v3 — the per-property variants the multi-OH render endpoint
 *  accepts today. v4-v8 are not yet ported into this flow (mirrors the
 *  same constraint encoded in MultiOHEventInput.per_property_variant). */
type PerPropertyVariant = "v1" | "v2" | "v3";

interface Props {
  /** All upcoming-OH eligible listings, pre-fetched server-side. */
  listings: PostBuilderListing[];
  /** Office name pre-fill (defaults to "Century 21 Alliance"). */
  defaultOfficeName: string;
  /** Profile.full_name from the signed-in user — used as the agent fallback
   *  if the picked properties don't all share a single listing_agent_name. */
  defaultAgentName: string;
}

interface EventDetailsForm {
  event_title: string;
  agent_name: string;
  agent_phone: string;
  agent_email: string;
  office_name: string;
}

/** Wizard step index. 1-based so the stepper UI and the state agree. */
type StepIndex = 1 | 2 | 3 | 4;

interface FormatCardMeta {
  id: PostFormat;
  name: string;
  hint: string;
  /** Aspect ratio for the mini-glyph (w / h). */
  ratio: [number, number];
}

interface VariantCardMeta {
  id: PerPropertyVariant;
  name: string;
  description: string;
}

const FORMAT_CARDS: readonly FormatCardMeta[] = [
  { id: "square_1x1", name: "Square 1:1", hint: "IG · FB feed", ratio: [1, 1] },
  { id: "portrait_4x5", name: "Portrait 4:5", hint: "IG feed preferred", ratio: [4, 5] },
  { id: "story_9x16", name: "Story 9:16", hint: "Stories · TikTok", ratio: [9, 16] },
];

const VARIANT_CARDS: readonly VariantCardMeta[] = [
  {
    id: "v1",
    name: "v1 · Hero Editorial",
    description: "Full-bleed photo, gold type along the bottom.",
  },
  {
    id: "v2",
    name: "v2 · Bold Stats",
    description: "Photo top, dark data pane below.",
  },
  {
    id: "v3",
    name: "v3 · Side-by-Side",
    description: "Side-by-side photo + structured stats.",
  },
];

/** Friendly rotating status messages shown during the generate phase. The
 *  multi-OH endpoint doesn't stream per-property progress today, so we
 *  cycle these on a timer to give the user visual rhythm. */
const GENERATE_STATUSES: readonly string[] = [
  "Rendering hero card…",
  "Composing event overview…",
  "Rendering property cards…",
  "Laying out the carousel…",
  "Almost there — finalizing…",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-property Open House wizard.
 *
 * Four steps:
 *   1. Pick 2-9 properties (selection order = carousel order)
 *   2. Event details (auto pre-fill from picked properties)
 *   3. Format + per-property variant
 *   4. Review (re-order via drag) + Generate
 *
 * State is entirely client-side; the only network call is the final
 * POST to /api/post-builder/multi-oh-generate. On ok=true we push to
 * /post-builder?gp=<id> so the standard editor/resume flow takes over.
 */
export default function MultiOHWizardClient({
  listings,
  defaultOfficeName,
  defaultAgentName,
}: Props) {
  const router = useRouter();

  // ---- step machine ------------------------------------------------------
  const [step, setStep] = useState<StepIndex>(1);

  // ---- step 1 — selection -----------------------------------------------
  /** mls_numbers in selection order; the carousel slide order follows this
   *  list 1:1. Drag-reorder on step 4 mutates this same array. */
  const [selectedMls, setSelectedMls] = useState<readonly string[]>([]);

  // ---- step 2 — event details ------------------------------------------
  const [eventForm, setEventForm] = useState<EventDetailsForm>({
    event_title: "",
    agent_name: "",
    agent_phone: "",
    agent_email: "",
    office_name: defaultOfficeName,
  });
  /** Did the user manually edit event_title? If so we stop auto-overwriting
   *  it when the picked set changes. Same idea for agent_name. */
  const [titleDirty, setTitleDirty] = useState(false);
  const [agentDirty, setAgentDirty] = useState(false);

  // ---- step 3 — format + variant ---------------------------------------
  const [format, setFormat] = useState<PostFormat>("portrait_4x5");
  const [perPropertyVariant, setPerPropertyVariant] = useState<PerPropertyVariant>("v1");

  // ---- step 4 — generate state -----------------------------------------
  const [generating, setGenerating] = useState(false);
  const [generateStatusIdx, setGenerateStatusIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  /** If all picked properties share the same agent_name, use that. Otherwise
   *  fall back to the signed-in user's full_name (passed in as default). */
  const derivedAgentName = useMemo(() => {
    if (selectedListings.length === 0) return defaultAgentName;
    const names = new Set<string>();
    for (const l of selectedListings) {
      if (l.agent_name && l.agent_name.trim().length > 0) {
        names.add(l.agent_name.trim());
      }
    }
    if (names.size === 1) {
      // Single shared agent — use it.
      const first = names.values().next().value;
      return typeof first === "string" ? first : defaultAgentName;
    }
    return defaultAgentName;
  }, [selectedListings, defaultAgentName]);

  // Auto-fill event_title + agent_name when they haven't been manually
  // edited. We can't put these inside useMemo because they need to write
  // to state, so an effect it is.
  useEffect(() => {
    if (!titleDirty) {
      setEventForm((prev) => ({ ...prev, event_title: derivedEventTitle }));
    }
  }, [derivedEventTitle, titleDirty]);
  useEffect(() => {
    if (!agentDirty) {
      setEventForm((prev) => ({ ...prev, agent_name: derivedAgentName }));
    }
  }, [derivedAgentName, agentDirty]);

  // ---- generate-phase status ticker ------------------------------------
  // why: rotate friendly status text on a 4s interval so the spinner feels
  // alive. We don't actually know per-property progress from the server.
  useEffect(() => {
    if (!generating) return;
    const handle = window.setInterval(() => {
      setGenerateStatusIdx((i) => (i + 1) % GENERATE_STATUSES.length);
    }, 4000);
    return () => window.clearInterval(handle);
  }, [generating]);

  // ---- selection handlers ----------------------------------------------

  const toggleSelect = useCallback(
    (mls: string): void => {
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
    },
    [],
  );

  // ---- step navigation --------------------------------------------------

  const canContinueFromStep1 = selectedMls.length >= MULTI_OH_MIN_PROPERTIES;
  const canContinueFromStep2 =
    eventForm.event_title.trim().length > 0 &&
    eventForm.agent_name.trim().length > 0;

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

  const onDragOver = useCallback((e: React.DragEvent<HTMLLIElement>): void => {
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

  // ---- generate ---------------------------------------------------------

  const generate = useCallback(async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    setGenerateStatusIdx(0);
    try {
      // Build the wizard payload. Map each picked listing into the slim
      // MultiOHEventProperty shape the endpoint expects.
      const properties: MultiOHEventProperty[] = selectedListings.map((l) => ({
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
        hosting_agent_name: l.agent_name ?? null,
      }));

      const payload: MultiOHEventInput = {
        event_title: eventForm.event_title.trim(),
        agent_name: eventForm.agent_name.trim(),
        agent_phone: eventForm.agent_phone.trim() || null,
        agent_email: eventForm.agent_email.trim() || null,
        office_name: eventForm.office_name.trim() || defaultOfficeName,
        format,
        per_property_variant: perPropertyVariant,
        properties,
      };

      const res = await fetch("/api/post-builder/multi-oh-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      // why: defensively parse — a Vercel 504 / HTML proxy error would
      // explode on res.json() and leave the user staring at a spinner.
      let parsed: MultiOHGenerateResult | null = null;
      try {
        parsed = (await res.json()) as MultiOHGenerateResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[multi-oh wizard] non-JSON response:", msg);
        throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
      }

      if (!parsed.ok) {
        console.error("[multi-oh wizard] generate failed:", parsed.error);
        setError(parsed.error);
        return;
      }
      // Success — bounce to standard Post Builder with ?gp=<id> so the
      // resume flow rehydrates the freshly-saved row.
      router.push(`/post-builder?gp=${encodeURIComponent(parsed.generated_post_id)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[multi-oh wizard] generate threw:", msg);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [
    selectedListings,
    eventForm,
    format,
    perPropertyVariant,
    defaultOfficeName,
    router,
  ]);

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
          />
        ) : null}
        {step === 2 ? (
          <Step2Details
            eventForm={eventForm}
            onChange={(patch) => {
              if (patch.event_title !== undefined) setTitleDirty(true);
              if (patch.agent_name !== undefined) setAgentDirty(true);
              setEventForm((prev) => ({ ...prev, ...patch }));
            }}
            propertyCount={selectedListings.length}
          />
        ) : null}
        {step === 3 ? (
          <Step3FormatVariant
            format={format}
            onFormatChange={setFormat}
            variant={perPropertyVariant}
            onVariantChange={setPerPropertyVariant}
          />
        ) : null}
        {step === 4 ? (
          <Step4Review
            eventForm={eventForm}
            selectedListings={selectedListings}
            format={format}
            variant={perPropertyVariant}
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
        canContinueFromStep2={canContinueFromStep2}
        onBack={() => goToStep((step - 1) as StepIndex)}
        onContinue={() => {
          if (step === 1 && canContinueFromStep1) setStep(2);
          else if (step === 2 && canContinueFromStep2) setStep(3);
          else if (step === 3) setStep(4);
        }}
        onGenerate={generate}
        generating={generating}
      />

      {generating ? (
        <GeneratingOverlay statusText={GENERATE_STATUSES[generateStatusIdx]} />
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
  { id: 2, label: "Event details" },
  { id: 3, label: "Format + variant" },
  { id: 4, label: "Review + generate" },
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
}

function Step1Pick({ listings, selectedMls, onToggle }: Step1Props) {
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
      <ul className="space-y-2">
        {listings.map((l) => {
          const selectionIndex = selectedMls.indexOf(l.mls_number);
          const isSelected = selectionIndex >= 0;
          const isDisabled = !isSelected && atCap;
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

// ===========================================================================
// Step 2 — Event details
// ===========================================================================

interface Step2Props {
  eventForm: EventDetailsForm;
  onChange: (patch: Partial<EventDetailsForm>) => void;
  propertyCount: number;
}

function Step2Details({ eventForm, onChange, propertyCount }: Step2Props) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-1">
        Event details
      </h2>
      <p className="text-sm text-neutral-600 mb-5">
        Pre-filled from your {propertyCount} picked {propertyCount === 1 ? "property" : "properties"}. Tweak anything that doesn&apos;t fit.
      </p>

      <div className="space-y-4">
        <Field
          id="event_title"
          label="Event title"
          required
          hint="Shown big at the top of the event hero card."
        >
          <input
            id="event_title"
            type="text"
            className="input"
            value={eventForm.event_title}
            onChange={(e) => onChange({ event_title: e.target.value })}
            placeholder="Open House Weekend"
          />
        </Field>

        <Field
          id="agent_name"
          label="Agent name"
          required
          hint="Primary attribution on the event hero (one name shown big)."
        >
          <input
            id="agent_name"
            type="text"
            className="input"
            value={eventForm.agent_name}
            onChange={(e) => onChange({ agent_name: e.target.value })}
            placeholder="Larissa Johnson"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="agent_phone" label="Agent phone" hint="Optional.">
            <input
              id="agent_phone"
              type="tel"
              className="input"
              value={eventForm.agent_phone}
              onChange={(e) => onChange({ agent_phone: e.target.value })}
              placeholder="(609) 555-0123"
            />
          </Field>
          <Field id="agent_email" label="Agent email" hint="Optional.">
            <input
              id="agent_email"
              type="email"
              className="input"
              value={eventForm.agent_email}
              onChange={(e) => onChange({ agent_email: e.target.value })}
              placeholder="agent@c21alliance.com"
            />
          </Field>
        </div>

        <Field id="office_name" label="Office name" hint="Footer of the event hero card.">
          <input
            id="office_name"
            type="text"
            className="input"
            value={eventForm.office_name}
            onChange={(e) => onChange({ office_name: e.target.value })}
            placeholder="Century 21 Alliance"
          />
        </Field>
      </div>
    </section>
  );
}

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

function Field({ id, label, required, hint, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-1"
      >
        {label}
        {required ? <span className="text-gold-700 ml-1">*</span> : null}
      </label>
      {children}
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

// ===========================================================================
// Step 3 — Format + variant
// ===========================================================================

interface Step3Props {
  format: PostFormat;
  onFormatChange: (f: PostFormat) => void;
  variant: PerPropertyVariant;
  onVariantChange: (v: PerPropertyVariant) => void;
}

function Step3FormatVariant({
  format,
  onFormatChange,
  variant,
  onVariantChange,
}: Step3Props) {
  return (
    <section className="space-y-5">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Pick the post format
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          All slides in the carousel render at this aspect ratio — IG and FB enforce uniform sizing across carousel slides.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {FORMAT_CARDS.map((f) => (
            <FormatCard
              key={f.id}
              meta={f}
              active={format === f.id}
              onClick={() => onFormatChange(f.id)}
            />
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Pick the per-property card variant
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          This is the design for each individual property slide. The event hero card uses its own dedicated multi-property layout.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {VARIANT_CARDS.map((v) => (
            <VariantCard
              key={v.id}
              meta={v}
              active={variant === v.id}
              onClick={() => onVariantChange(v.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface FormatCardProps {
  meta: FormatCardMeta;
  active: boolean;
  onClick: () => void;
}

function FormatCard({ meta, active, onClick }: FormatCardProps) {
  const [wRatio, hRatio] = meta.ratio;
  // Mini-glyph max box 56×56. Scale the inner rect to the ratio.
  const maxBox = 56;
  const glyphW = wRatio >= hRatio ? maxBox : Math.round((wRatio / hRatio) * maxBox);
  const glyphH = hRatio >= wRatio ? maxBox : Math.round((hRatio / wRatio) * maxBox);
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border p-4 text-left transition flex items-center gap-3",
        active
          ? "border-gold-500 bg-gold-50/40 ring-2 ring-gold-500/30 shadow-sm"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="w-14 h-14 flex items-center justify-center shrink-0">
        <div
          aria-hidden="true"
          style={{ width: glyphW, height: glyphH }}
          className={[
            "rounded-md ring-1",
            active ? "bg-gold-100 ring-gold-400" : "bg-neutral-100 ring-neutral-300",
          ].join(" ")}
        />
      </div>
      <div className="min-w-0">
        <div
          className={[
            "text-sm font-semibold",
            active ? "text-gold-900" : "text-neutral-900",
          ].join(" ")}
        >
          {meta.name}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">{meta.hint}</div>
      </div>
    </button>
  );
}

interface VariantCardProps {
  meta: VariantCardMeta;
  active: boolean;
  onClick: () => void;
}

function VariantCard({ meta, active, onClick }: VariantCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border p-4 text-left transition",
        active
          ? "border-gold-500 bg-gold-50/40 ring-2 ring-gold-500/30 shadow-sm"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div
        className={[
          "text-sm font-semibold mb-1",
          active ? "text-gold-900" : "text-neutral-900",
        ].join(" ")}
      >
        {meta.name}
      </div>
      <div className="text-xs text-neutral-600 leading-relaxed">
        {meta.description}
      </div>
    </button>
  );
}

// ===========================================================================
// Step 4 — Review + generate
// ===========================================================================

interface Step4Props {
  eventForm: EventDetailsForm;
  selectedListings: readonly PostBuilderListing[];
  format: PostFormat;
  variant: PerPropertyVariant;
  onDragStart: (mls: string) => void;
  onDragOver: (e: React.DragEvent<HTMLLIElement>) => void;
  onDrop: (targetMls: string) => void;
}

function Step4Review({
  eventForm,
  selectedListings,
  format,
  variant,
  onDragStart,
  onDragOver,
  onDrop,
}: Step4Props) {
  return (
    <section className="space-y-4">
      <div className="card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-700 mb-1">
          Summary
        </div>
        <div className="text-base font-semibold text-neutral-900 leading-snug">
          {eventForm.event_title || "Untitled event"}{" "}
          <span className="text-neutral-400 font-normal">·</span>{" "}
          <span className="text-neutral-700">
            {selectedListings.length} {selectedListings.length === 1 ? "property" : "properties"}
          </span>{" "}
          <span className="text-neutral-400 font-normal">·</span>{" "}
          <span className="text-neutral-700">{variant} cards</span>{" "}
          <span className="text-neutral-400 font-normal">·</span>{" "}
          <span className="text-neutral-700">{prettyFormat(format)}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          Hero slide = event overview · slides {selectedListings.length > 0 ? `2-${selectedListings.length + 1}` : "—"} = per-property cards.
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Carousel order
          </h3>
          <span className="text-xs text-neutral-500">
            Drag to re-order — this is your final chance.
          </span>
        </div>
        <ul className="space-y-2">
          {selectedListings.map((l, idx) => (
            <li
              key={l.mls_number}
              draggable
              onDragStart={() => onDragStart(l.mls_number)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(l.mls_number)}
              className="rounded-lg border border-neutral-200 bg-white p-3 flex items-center gap-3 cursor-move hover:border-neutral-300 hover:bg-neutral-50 transition"
            >
              <div
                aria-hidden="true"
                className="text-neutral-400 text-lg select-none leading-none"
                title="Drag to reorder"
              >
                ⋮⋮
              </div>
              <div className="w-7 h-7 rounded-full bg-gold-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {idx + 2 /* slide 1 is the hero */}
              </div>
              {l.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.hero_image_url}
                  alt=""
                  className="w-12 h-12 rounded-md object-cover bg-neutral-100 shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-12 h-12 rounded-md bg-neutral-100 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-neutral-900 truncate">
                  {l.address ?? l.mls_number}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {[l.city, l.state].filter(Boolean).join(", ")}
                  {l.oh_start_at ? ` · ${formatOhBadge(l.oh_start_at, l.oh_end_at ?? null)}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
        Rendering takes about 20-40 seconds depending on the number of properties. You&apos;ll be redirected to Post Builder when it&apos;s ready.
      </div>
    </section>
  );
}

// ===========================================================================
// Sticky footer
// ===========================================================================

interface StickyFooterProps {
  step: StepIndex;
  selectedCount: number;
  canContinueFromStep1: boolean;
  canContinueFromStep2: boolean;
  onBack: () => void;
  onContinue: () => void;
  onGenerate: () => void;
  generating: boolean;
}

function StickyFooter({
  step,
  selectedCount,
  canContinueFromStep1,
  canContinueFromStep2,
  onBack,
  onContinue,
  onGenerate,
  generating,
}: StickyFooterProps) {
  const continueDisabled =
    (step === 1 && !canContinueFromStep1) ||
    (step === 2 && !canContinueFromStep2);

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
          {step < 4 ? (
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
}

function GeneratingOverlay({ statusText }: GeneratingOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-40 bg-neutral-900/50 backdrop-blur-sm flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="bg-white rounded-xl shadow-xl px-8 py-6 max-w-sm w-full mx-4 text-center">
        <Spinner />
        <div className="mt-4 text-sm font-semibold text-neutral-900">
          Building your carousel
        </div>
        <div className="mt-1 text-sm text-neutral-600">{statusText}</div>
        <div className="mt-3 text-xs text-neutral-500">
          This usually takes 20-40 seconds. Hang tight — we&apos;ll redirect you when it&apos;s ready.
        </div>
      </div>
    </div>
  );
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
 * Same-day → "Open House — Saturday May 17"
 * Two consecutive days → "Open House Weekend — May 17-18"
 * Otherwise → "Open House Event"
 *
 * why: this runs every time the picked set changes; intentionally cheap.
 * The user can always override (titleDirty flag stops the auto-overwrite).
 */
function deriveEventTitle(selected: readonly PostBuilderListing[]): string {
  if (selected.length === 0) return "";
  const days = new Set<string>();
  const dates: Date[] = [];
  for (const l of selected) {
    if (!l.oh_start_at) continue;
    const d = new Date(l.oh_start_at);
    if (Number.isNaN(d.getTime())) continue;
    days.add(d.toISOString().slice(0, 10));
    dates.push(d);
  }
  if (dates.length === 0) return "Open House Event";

  if (days.size === 1) {
    const d = dates[0];
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
    const monthDay = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    return `Open House — ${dayName} ${monthDay}`;
  }
  if (days.size === 2) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    const a = dates[0];
    const b = dates[dates.length - 1];
    const month = a.toLocaleDateString("en-US", { month: "long" });
    return `Open House Weekend — ${month} ${a.getDate()}-${b.getDate()}`;
  }
  return "Open House Event";
}

/** Map a PostFormat enum to a short display string. */
function prettyFormat(f: PostFormat): string {
  switch (f) {
    case "square_1x1":
      return "Square 1:1";
    case "portrait_4x5":
      return "Portrait 4:5";
    case "story_9x16":
      return "Story 9:16";
  }
}
