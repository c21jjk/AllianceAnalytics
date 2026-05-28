/**
 * POST /api/post-builder/multi-oh-generate
 * ------------------------------------------
 *
 * Orchestrates a multi-property Open House carousel post. Inputs are the
 * wizard's `MultiOHEventInput` payload. Outputs are:
 *
 *   1. ONE event-overview hero image (rendered by `multi-oh-render.ts`).
 *      This is the carousel's slide 0 — it lists every property's address,
 *      OH window, and agent contact in a single designed graphic.
 *   2. N per-property cards (rendered by the canvas-template OH
 *      pipeline — `findCanvasTemplate` + `renderCanvasSchema`, the
 *      same path the single-listing OH render uses; the legacy V1
 *      `renderTemplate` shim was dropped on 2026-05-27 after the
 *      V1 HTML registry was deleted). These are slides 1..N.
 *   3. ONE inserted `generated_posts` row. The hero is the row's
 *      `image_url`; the per-property URLs land in `additional_images` so
 *      the standard Post Builder carousel UX picks the bundle up without
 *      special-casing.
 *
 * On success the caller (the wizard's "Generate" button) redirects to
 * `/post-builder?gp=<generated_post_id>` and the user lands in the regular
 * resume flow — at that point the multi-OH event behaves like any other
 * carousel post in Studio.
 *
 * Why a dedicated route (and not just `actions.ts`):
 *   • Headless Chromium rendering needs `runtime = "nodejs"` + a long
 *     `maxDuration`. Server actions inherit the page's runtime, which is
 *     edge-by-default for some routes and harder to tune.
 *   • We render N+1 images sequentially with a bounded concurrency window;
 *     a route handler gives us a clean POST shape, NDJSON streaming, and
 *     the same call-and-redirect pattern the wizard already wires up for
 *     `/api/post-builder/render`.
 *   • Error semantics: emitting per-slide `slide_failed` events on the
 *     NDJSON stream lets the wizard offer a partial-progress retry on just
 *     the failed indexes instead of forcing a full re-render.
 *
 * 2026-05-27 — Phase C: converted to NDJSON streaming. The response is now
 * a `Content-Type: application/x-ndjson` body with one JSON event per line.
 * Event types (see `MultiOHStreamEvent` below):
 *   `started`       — fires first; carries totalSlides + format.
 *   `hero_started`  — before hero render begins.
 *   `hero_done`     — hero PNG uploaded; carries url.
 *   `slide_started` — before each per-property render.
 *   `slide_done`    — per-property PNG uploaded; carries index + url.
 *   `slide_failed`  — per-property render threw; carries index + error.
 *                     Stream continues — subsequent slides still try.
 *   `completed`     — final event after the generated_posts row was
 *                     inserted/updated. Fires even if some slides failed;
 *                     the client decides whether to redirect or offer
 *                     retry based on whether any `slide_failed` events
 *                     arrived.
 *   `fatal`         — hero render or DB insert failed; no `completed`
 *                     follows. Stream closes.
 *
 * Retry mode: when the body carries `retry_indices` + an
 * `existing_generated_post_id`, the route SKIPS hero render (assumes the
 * caller already has the hero URL from the original generation), only
 * re-renders the listed slide indexes, and on `completed` UPDATES the
 * existing row's `additional_images` + `slide_metadata` arrays so the
 * retried slots land in place. This lets the wizard's "Retry failed
 * slides" button avoid re-rendering 8 cards just because 1 flunked.
 *
 * Auth: requires a signed-in Alliance user.
 *
 * Body (JSON): `MultiOHEventInput` plus optional retry fields — see
 * `MultiOHStreamBody` below.
 */

import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import {
  renderMultiOHEventOverview,
  type MultiOHRenderResult,
} from "@/lib/post-builder/multi-oh-render";
import { renderDbTemplate } from "@/lib/template-builder";
import { formatShortName } from "@/lib/post-builder/templates/registry";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { renderCanvasSchema } from "@/lib/post-builder/canvas-editor/render-canvas-schema";
import {
  MULTI_OH_MAX_PROPERTIES,
  MULTI_OH_MIN_PROPERTIES,
  type MultiOHEventInput,
  type MultiOHEventProperty,
  type MultiOHGenerateErr,
  type PostBuilderListing,
  type PostFormat,
  type SlideMetadata,
  type SourceMls,
} from "@/lib/post-builder/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAgentAttribution,
  type AgentAttribution,
} from "@/lib/data/alliance-dash-agents";
import type { Json } from "@/lib/supabase/types";

// why: the V1 render pipeline launches headless Chromium, which only runs on
// the Node.js runtime — Edge is a hard nope. force-dynamic keeps Next from
// trying to cache responses; this route mutates Storage + DB on every call.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// why: Chromium renders run 5-15s each in the worst case. We render hero +
// up to 9 per-property cards, capped at 5-in-flight, so a worst-case timing
// budget is roughly two batches of ~15s plus the hero plus DB/Storage I/O.
// 2026-05-27 — Phase C bumped to 120s to comfortably cover the NDJSON
// streaming window. The function emits events incrementally so a stuck
// slide doesn't block the user from seeing partial progress, but the
// overall ceiling still needs to cover hero + 9 slides + DB I/O.
export const maxDuration = 120;

/**
 * Union of NDJSON events the streaming route emits. One JSON object per
 * line on the wire (newline-delimited). The wizard consumes this via
 * `getReader()` + `TextDecoder`, matching the pattern at
 * `app/api/post-builder/design-and-render/route.ts`.
 *
 * Kept inline (not in `lib/post-builder/multi-oh-stream.ts`) because both
 * producer + consumer ship in the same task and re-declaring the union
 * on the wizard side stays cheap. If a third consumer ever appears (e.g.,
 * a CLI smoke test), promote this to a shared type module.
 */
export type MultiOHStreamEvent =
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

// why: cap parallelism so we don't blow past the function's memory ceiling
// when all 9 Chromium instances + hero spin up at once. 5 in flight is a
// gentle number — 9 properties takes 2 batches max, and total wall time is
// roughly 2 × (worst per-property render), which is well inside maxDuration.
const RENDER_CONCURRENCY = 5;

// why: the three valid PostFormat literals. Pulled into a tuple so we can do
// a typed runtime check without importing the type-only PostFormat alias.
const VALID_FORMATS = [
  "square_1x1",
  "story_9x16",
] as const satisfies readonly PostFormat[];

// why: only v1/v2/v3 are valid per-property variants in the multi-OH flow
// today. v6/v7/v8 weren't designed for the dense data plus shared event
// branding the carousel needs — they read as standalone hero posts. If we
// add them later, just widen this tuple.
// 2026-05-21 — v1 Hero Editorial was retired from lib/post-builder/templates/
// registry.ts on 2026-05-17 (active set: v2, v3, v6, v8, v9, v10). The
// multi-OH wizard offers the four that fit an Open House per-property card.
// v9/v10 are post-type-specific (just_sold / coming_soon) and don't belong
// here.
const VALID_PER_PROPERTY_VARIANTS = ["v2", "v3", "v6", "v8"] as const;
type ValidPerPropertyVariant = (typeof VALID_PER_PROPERTY_VARIANTS)[number];

/**
 * Minimal listing-row shape we read from `properties` to feed into the V1
 * render pipeline. The wizard's `MultiOHEventInput.properties[]` is a slim
 * audience-facing summary; the V1 render needs the full template-binding
 * shape — `public_remarks`, `listing_office_name`, etc. — to populate the
 * card. We fetch those by mls_number here.
 */
interface PropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: "active" | "pending" | "sold" | "expired";
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  close_price: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  property_type: string | null;
  unit_number: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
}

/**
 * Body shape for the streaming route. The base `MultiOHEventInput` plus
 * optional retry fields. When `retry_indices` is set the route SKIPS the
 * hero render and only re-renders the listed slide indexes, then UPDATES
 * the existing generated_posts row rather than inserting a new one.
 *
 * `existing_hero_url` is required in retry mode because the route does
 * not refetch the existing row (the client already has the URL from the
 * original `hero_done` event). Skipping the DB round-trip keeps retry
 * latency close to "just the slides".
 */
interface MultiOHStreamBody extends MultiOHEventInput {
  retry_indices?: readonly number[];
  existing_generated_post_id?: string;
  existing_hero_url?: string;
}

/**
 * Slim parser for the raw POST body. We accept `unknown` and narrow defensively
 * — there's no zod here, and TypeScript can't trust JSON at the boundary.
 */
function parseBody(raw: unknown):
  | { ok: true; value: MultiOHStreamBody }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;

  const event_title =
    typeof r.event_title === "string" && r.event_title.trim().length > 0
      ? r.event_title.trim()
      : "Open House This Weekend"; // why: sensible default vs hard failure
  // 2026-05-21 — agent_name / agent_phone / agent_email are no longer
  // collected by the wizard (per-property hosts on each carousel slide
  // are the only attribution shown). We still accept them defensively so
  // older clients / persisted bodies don't fail; the renderer ignores
  // them.
  const agent_name =
    typeof r.agent_name === "string" && r.agent_name.trim().length > 0
      ? r.agent_name.trim()
      : null;
  const office_name =
    typeof r.office_name === "string" && r.office_name.trim().length > 0
      ? r.office_name.trim()
      : "Century 21 Alliance";

  const agent_phone =
    typeof r.agent_phone === "string" && r.agent_phone.length > 0
      ? r.agent_phone
      : null;
  const agent_email =
    typeof r.agent_email === "string" && r.agent_email.length > 0
      ? r.agent_email
      : null;

  const format = r.format;
  if (
    typeof format !== "string" ||
    !VALID_FORMATS.includes(format as PostFormat)
  ) {
    return {
      ok: false,
      error: `format must be one of: ${VALID_FORMATS.join(", ")}`,
    };
  }

  // why: stale clients in the wild may still send "v1" (Hero Editorial,
  // retired from the registry on 2026-05-17). Silently upgrade to v2 —
  // structurally the closest analog and the wizard's new default — so a
  // user with a cached bundle doesn't see a hard error. Any value outside
  // the legacy + active set still fails loud.
  const rawVariant = r.per_property_variant;
  const per_property_variant: ValidPerPropertyVariant =
    rawVariant === "v1"
      ? "v2"
      : (rawVariant as ValidPerPropertyVariant);
  if (
    typeof rawVariant !== "string" ||
    !VALID_PER_PROPERTY_VARIANTS.includes(per_property_variant)
  ) {
    return {
      ok: false,
      error: `per_property_variant must be one of: ${VALID_PER_PROPERTY_VARIANTS.join(", ")}`,
    };
  }

  if (!Array.isArray(r.properties)) {
    return { ok: false, error: "properties must be an array" };
  }
  if (r.properties.length < MULTI_OH_MIN_PROPERTIES) {
    return {
      ok: false,
      error: `at least ${MULTI_OH_MIN_PROPERTIES} properties required`,
    };
  }
  if (r.properties.length > MULTI_OH_MAX_PROPERTIES) {
    return {
      ok: false,
      error: `at most ${MULTI_OH_MAX_PROPERTIES} properties allowed`,
    };
  }

  const properties: MultiOHEventProperty[] = [];
  for (let i = 0; i < r.properties.length; i++) {
    const rawProp = r.properties[i];
    if (typeof rawProp !== "object" || rawProp === null) {
      return { ok: false, error: `properties[${i}] must be an object` };
    }
    const p = rawProp as Record<string, unknown>;
    const mls_number = p.mls_number;
    if (typeof mls_number !== "string" || mls_number.trim().length === 0) {
      return {
        ok: false,
        error: `properties[${i}].mls_number required`,
      };
    }
    properties.push({
      mls_number: mls_number.trim(),
      source_mls: normalizeSourceMls(p.source_mls),
      listing_id: typeof p.listing_id === "string" ? p.listing_id : null,
      address: typeof p.address === "string" ? p.address : null,
      city: typeof p.city === "string" ? p.city : null,
      state: typeof p.state === "string" ? p.state : null,
      zip: typeof p.zip === "string" ? p.zip : null,
      list_price: typeof p.list_price === "number" ? p.list_price : null,
      bedrooms: typeof p.bedrooms === "number" ? p.bedrooms : null,
      bathrooms_full:
        typeof p.bathrooms_full === "number" ? p.bathrooms_full : null,
      bathrooms_half:
        typeof p.bathrooms_half === "number" ? p.bathrooms_half : null,
      property_type: typeof p.property_type === "string" ? p.property_type : null,
      hero_image_url:
        typeof p.hero_image_url === "string" ? p.hero_image_url : null,
      oh_start_at: typeof p.oh_start_at === "string" ? p.oh_start_at : null,
      oh_end_at: typeof p.oh_end_at === "string" ? p.oh_end_at : null,
      hosting_agent_name:
        typeof p.hosting_agent_name === "string"
          ? p.hosting_agent_name
          : null,
      unit_number:
        typeof p.unit_number === "string" && p.unit_number.length > 0
          ? p.unit_number
          : null,
    });
  }

  // Phase 2E (2026-05-22) — optional db_template_id. When set, every
  // per-property slide renders via the admin-authored DB template at
  // this UUID instead of the legacy per_property_variant. Validated as
  // a non-empty string; if absent or empty we treat it as not-set.
  const rawDbTemplateId = r.db_template_id;
  const db_template_id =
    typeof rawDbTemplateId === "string" && rawDbTemplateId.trim().length > 0
      ? rawDbTemplateId.trim()
      : null;

  // Phase C (2026-05-27) — optional retry fields. When `retry_indices`
  // is present, the route runs in retry mode: skip the hero render,
  // only re-render slides at the listed indexes, UPDATE the existing
  // generated_posts row rather than inserting a fresh one.
  let retry_indices: readonly number[] | undefined;
  if (Array.isArray(r.retry_indices)) {
    const arr: number[] = [];
    for (let i = 0; i < r.retry_indices.length; i++) {
      const v = r.retry_indices[i];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return {
          ok: false,
          error: `retry_indices[${i}] must be a non-negative integer`,
        };
      }
      if (v >= properties.length) {
        return {
          ok: false,
          error: `retry_indices[${i}] (${v}) is out of range for properties (length ${properties.length})`,
        };
      }
      arr.push(v);
    }
    retry_indices = arr;
  }
  const existing_generated_post_id =
    typeof r.existing_generated_post_id === "string" &&
    r.existing_generated_post_id.length > 0
      ? r.existing_generated_post_id
      : undefined;
  const existing_hero_url =
    typeof r.existing_hero_url === "string" && r.existing_hero_url.length > 0
      ? r.existing_hero_url
      : undefined;
  // why: retry mode is all-or-nothing on its three companion fields. If
  // a stale client sends `retry_indices` without the row id or hero url
  // we'd silently fall into the wrong code path (re-render the hero,
  // insert a duplicate row). Fail loud instead.
  if (retry_indices !== undefined) {
    if (!existing_generated_post_id) {
      return {
        ok: false,
        error: "retry_indices requires existing_generated_post_id",
      };
    }
    if (!existing_hero_url) {
      return {
        ok: false,
        error: "retry_indices requires existing_hero_url",
      };
    }
  }

  return {
    ok: true,
    value: {
      event_title,
      agent_name,
      agent_phone,
      agent_email,
      office_name,
      format: format as PostFormat,
      per_property_variant: per_property_variant as ValidPerPropertyVariant,
      db_template_id,
      properties,
      retry_indices,
      existing_generated_post_id,
      existing_hero_url,
    },
  };
}

/**
 * Narrows a raw `unknown` into the `SourceMls` union. Anything outside the
 * known feed codes falls through to `null` — we don't want a typo (e.g.,
 * "bright_mls") to spread into the persisted row.
 */
function normalizeSourceMls(value: unknown): SourceMls {
  if (value === "cmc" || value === "sjsr" || value === "bright" || value === "manual") {
    return value;
  }
  return null;
}

/**
 * Fetch the full listing rows for every property in the wizard payload, in
 * a single batched query, and return them keyed by mls_number. Missing rows
 * are tolerated — the per-property render falls through to the wizard-
 * supplied fields when a listing isn't in our DB (e.g., an off-MLS event).
 */
async function fetchListingRows(
  mlsNumbers: readonly string[],
): Promise<Map<string, PropertyRow>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date, unit_number",
    )
    .in("mls_number", [...mlsNumbers]);
  if (error) {
    // why: don't blow up the whole flow on a bad batch lookup — the
    // per-property render path falls through to wizard-supplied fields when
    // a row is missing. Log so we can spot a wider DB issue.
    console.error("[multi-oh-generate] property fetch error:", error.message);
    return new Map();
  }
  const out = new Map<string, PropertyRow>();
  for (const row of (data ?? []) as PropertyRow[]) {
    out.set(row.mls_number, row);
  }
  return out;
}

/**
 * Build the `PostBuilderListing` shape the V1 render expects, merging the
 * wizard's per-property summary with whatever we have in the `properties`
 * table. The DB row wins for richer fields (public_remarks, office name)
 * but the wizard's OH times always come through — the listings fetcher
 * only attaches OH windows for the standard single-listing flow.
 */
function toRenderListing(
  prop: MultiOHEventProperty,
  row: PropertyRow | undefined,
): PostBuilderListing {
  // 2026-05-22 — suffix unit_number onto the displayed address so the
  // per-property card variants (v2/v3/v6/v8) show "511 E 11th Avenue ·
  // Unit 207" without having to edit each template primitive. The
  // unit also stays available on `unit_number` for any future template
  // that wants to render it as a separate element.
  const baseAddress = prop.address ?? row?.address ?? null;
  const unit = (prop.unit_number ?? row?.unit_number ?? "").trim();
  const displayAddress = unit
    ? baseAddress
      ? `${baseAddress} · ${unit}`
      : unit
    : baseAddress;
  return {
    id: row?.id ?? prop.listing_id ?? prop.mls_number,
    mls_number: prop.mls_number,
    source_mls: prop.source_mls,
    address: displayAddress,
    city: prop.city ?? row?.city ?? null,
    state: prop.state ?? row?.state ?? null,
    zip: prop.zip ?? row?.zip ?? null,
    list_price: prop.list_price ?? row?.list_price ?? null,
    close_price: row?.close_price ?? null,
    bedrooms: prop.bedrooms ?? row?.bedrooms ?? null,
    bathrooms_full: prop.bathrooms_full ?? row?.bathrooms_full ?? null,
    bathrooms_half: prop.bathrooms_half ?? row?.bathrooms_half ?? null,
    property_type: prop.property_type ?? row?.property_type ?? null,
    public_remarks: row?.public_remarks ?? null,
    hero_image_url: prop.hero_image_url ?? row?.hero_image_url ?? null,
    listing_office_name: row?.listing_office_name ?? null,
    // why: the per-property card shows the hosting agent, not the listing
    // agent. The hosting agent is who'll be at THIS open house — that's the
    // contact Larissa wants on the slide.
    agent_name: prop.hosting_agent_name ?? row?.agent_name ?? null,
    listing_date: row?.listing_date ?? null,
    status: row?.status ?? "active",
    oh_start_at: prop.oh_start_at,
    oh_end_at: prop.oh_end_at,
    // 2026-05-22 — unit_number surfaces on the per-property card by
    // being suffixed into the rendered address. The DB row is the
    // canonical source; the wizard's property summary forwards it.
    unit_number: prop.unit_number ?? row?.unit_number ?? null,
  };
}

/**
 * Consolidate same-property entries into one per-property record, with
 * every session window collected into `oh_sessions`. Used by the renderer
 * so that picking BOTH Sat and Sun open houses for the same condo unit
 * shows ONE row on the hero card listing both days/times — and ONE
 * carousel slide rather than two duplicate slides.
 *
 * Preserves the order of FIRST appearance of each mls_number, so the
 * wizard's drag-reorder still controls carousel slide order. Within a
 * property, sessions are sorted chronologically.
 *
 * 2026-05-22 — added when John pointed out that 511 E 11th Unit 207 with
 * a Sat + Sun open house was showing as two separate rows on the hero
 * (and two duplicate slides in the carousel).
 */
function consolidatePropertiesByMls(
  properties: readonly MultiOHEventProperty[],
): MultiOHEventProperty[] {
  const seen = new Map<string, MultiOHEventProperty>();
  const order: string[] = [];
  for (const p of properties) {
    const key = p.mls_number;
    const session = { start_at: p.oh_start_at, end_at: p.oh_end_at };
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        ...p,
        oh_sessions: [session],
      });
      order.push(key);
      continue;
    }
    // why: subsequent picks of the same property append a session window.
    // The first pick's other fields (hero image, hosting agent, etc.) stay
    // authoritative — the user picked them first so they're the intent.
    seen.set(key, {
      ...existing,
      oh_sessions: [...(existing.oh_sessions ?? []), session],
    });
  }
  // Sort each property's sessions chronologically by start_at so the
  // hero card reads Sat → Sun naturally rather than in pick order.
  for (const key of order) {
    const p = seen.get(key);
    if (!p?.oh_sessions) continue;
    const sorted = [...p.oh_sessions].sort((a, b) => {
      const ta = a.start_at ? new Date(a.start_at).getTime() : 0;
      const tb = b.start_at ? new Date(b.start_at).getTime() : 0;
      return ta - tb;
    });
    seen.set(key, {
      ...p,
      oh_sessions: sorted,
      // Keep oh_start_at / oh_end_at as the FIRST chronological session
      // so any consumer that still reads the singular fields gets a
      // sensible default.
      oh_start_at: sorted[0]?.start_at ?? p.oh_start_at,
      oh_end_at: sorted[0]?.end_at ?? p.oh_end_at,
    });
  }
  return order.map((k) => seen.get(k)!).filter((p): p is MultiOHEventProperty => p !== undefined);
}

/**
 * Result of a single per-property render attempt. Tracks the source index
 * so we can preserve carousel order in the final response.
 */
interface PerPropertyRenderResult {
  index: number;
  mls_number: string;
  image_url: string;
  image_path: string;
}

interface PerPropertyRenderFailure {
  index: number;
  mls_number: string;
  error: string;
}

/**
 * Normalize a hosting-agent name into the same key shape we use to dedupe
 * attribution lookups. Empty / whitespace-only / unparseable names return
 * null so the caller treats them as "no host" and skips the lookup.
 *
 * Mirrors the matching logic in `lib/data/alliance-dash-agents.ts` so the
 * map key is consistent between where it's written (the resolver loop) and
 * where it's read (each per-property render dispatch).
 */
function normalizeForAttributionKey(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const parts = trimmed
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z'-]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Resolve hosting-agent attribution (name + phone + photo) for every
 * distinct host across the consolidated property list. Runs all lookups
 * in parallel via Promise.all and uses an in-request cache passed into
 * `getAgentAttribution` so duplicate names only hit the DB once.
 *
 * Returns a Map keyed by the normalized hosting name; each value is the
 * fully resolved AgentAttribution (phone formatted, photo resolved). The
 * map is then handed to renderPerPropertyCards which threads the entry
 * into the renderDbTemplate call for each slide.
 *
 * Missing host names (null / empty) are skipped — those slides will
 * resolve to the listing-agent fallback via the bound-field resolvers in
 * fabric-factory.ts.
 */
async function buildHostingAttributionMap(
  properties: readonly MultiOHEventProperty[],
): Promise<Map<string, AgentAttribution>> {
  const out = new Map<string, AgentAttribution>();
  // Collect distinct (normalizedKey, originalName) pairs. The original
  // name is what we hand to getAgentAttribution — the helper uses it for
  // both the exact-match Supabase query AND the normalized last-name
  // fallback, so we want to preserve casing / punctuation as the wizard
  // captured it.
  const distinct = new Map<string, string>();
  for (const p of properties) {
    const key = normalizeForAttributionKey(p.hosting_agent_name);
    if (!key) continue;
    if (!distinct.has(key)) {
      distinct.set(key, p.hosting_agent_name as string);
    }
  }
  if (distinct.size === 0) return out;

  // In-request memo cache shared across all lookups so a single name
  // never resolves twice even if the normalization upstream missed a
  // dupe (e.g., "Larissa Stevenson" vs "Larissa  Stevenson").
  const cache = new Map<string, Promise<AgentAttribution>>();

  const entries = await Promise.all(
    Array.from(distinct.entries()).map(async ([key, name]) => {
      const attribution = await getAgentAttribution(name, cache);
      return [key, attribution] as const;
    }),
  );
  for (const [key, attribution] of entries) {
    out.set(key, attribution);
  }
  return out;
}

/**
 * Render N per-property cards with bounded parallelism. Returns whichever
 * succeeded plus a list of failures — caller decides whether to fail the
 * whole flow or surface a partial-progress error.
 *
 * Phase C (2026-05-27) — accepts:
 *   • `onSlideStarted` / `onSlideDone` / `onSlideFailed` callbacks so the
 *     NDJSON stream can emit a `slide_started` event right before each
 *     render kicks off and a `slide_done` / `slide_failed` event as soon
 *     as that slide settles. Without these the user would see the whole
 *     chunk land at once instead of per-slide tick-down.
 *   • `restrictToIndexes` — when set (retry mode), only renders the
 *     listed indexes. Other slides are skipped silently; the caller is
 *     responsible for preserving the unchanged slides in the existing
 *     row's additional_images. We still emit the lifecycle events for
 *     just the retried indexes so the wizard's skeleton flips back.
 */
async function renderPerPropertyCards(
  input: MultiOHEventInput,
  listingByMls: Map<string, PropertyRow>,
  hostingAttribution: Map<string, AgentAttribution>,
  callbacks: {
    onSlideStarted: (index: number, address: string | null) => void;
    onSlideDone: (index: number, url: string) => void;
    onSlideFailed: (
      index: number,
      error: string,
      address: string | null,
    ) => void;
  },
  restrictToIndexes?: ReadonlySet<number>,
): Promise<{
  successes: PerPropertyRenderResult[];
  failures: PerPropertyRenderFailure[];
}> {
  const successes: PerPropertyRenderResult[] = [];
  const failures: PerPropertyRenderFailure[] = [];
  // Phase 2E (2026-05-22) — the wizard's DB-template pick (one per event)
  // wins over the canvas-template default for every per-property slide.
  // The per-slide dispatch below picks the right pipeline.
  const dbTemplateId = input.db_template_id ?? null;

  // Pre-compute the index list we'll actually process. In retry mode we
  // shrink to just the requested indexes; the chunking below still uses
  // the same RENDER_CONCURRENCY budget but over the filtered set.
  const allIndexes = input.properties.map((_, i) => i);
  const indexesToRender = restrictToIndexes
    ? allIndexes.filter((i) => restrictToIndexes.has(i))
    : allIndexes;

  // why: simple windowed parallelism — process the indexes in chunks of
  // RENDER_CONCURRENCY. Promise.all on chunks is good enough for ≤9 inputs;
  // a real semaphore would be overkill.
  for (let start = 0; start < indexesToRender.length; start += RENDER_CONCURRENCY) {
    const chunkIndexes = indexesToRender.slice(start, start + RENDER_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunkIndexes.map(async (idx) => {
        const prop = input.properties[idx];
        // why: emit `slide_started` AFTER we've narrowed the slot but
        // BEFORE the heavy render call. The wizard flips its skeleton
        // tile to a "rendering…" state on this event, so we want the
        // user to see the activity even on the very first slide that
        // hasn't reached its render yet.
        callbacks.onSlideStarted(idx, prop.address ?? null);
        const row = listingByMls.get(prop.mls_number);
        const listing = toRenderListing(prop, row);
        if (!listing.hero_image_url) {
          const err = "no hero_image_url for property";
          callbacks.onSlideFailed(idx, err, prop.address ?? null);
          return {
            kind: "err" as const,
            failure: {
              index: idx,
              mls_number: prop.mls_number,
              error: err,
            },
          };
        }
        // Phase 2E — DB-template branch. renderDbTemplate signs a render
        // token + screenshots the /render/template/<token> page. Format,
        // hosting agent, and OH window are passed through so the DB
        // template's binding context receives them.
        if (dbTemplateId) {
          const ohWindow = formatOhWindowLabel(prop);
          // why: look up the pre-resolved hosting-agent attribution
          // (phone + photo) for this slide. The map is keyed by the
          // normalized hosting name; entries are built once before the
          // per-property render loop so 9 slides sharing a host hit
          // Alliance Dash + brand_assets just once. Missing entry =>
          // host had no usable name; the corner-block bound fields fall
          // back to the listing agent at render time.
          const hostKey = normalizeForAttributionKey(prop.hosting_agent_name);
          const hosting = hostKey
            ? hostingAttribution.get(hostKey)
            : undefined;
          const dbResult = await renderDbTemplate({
            template_id: dbTemplateId,
            listing,
            format: input.format,
            hosting_agent_name: prop.hosting_agent_name ?? null,
            hosting_agent_phone: hosting?.phone ?? null,
            hosting_agent_photo_url: hosting?.photo_url ?? null,
            oh_window: ohWindow,
          });
          if (!dbResult.ok) {
            const err = `db_template render failed: ${dbResult.error}`;
            callbacks.onSlideFailed(idx, err, prop.address ?? null);
            return {
              kind: "err" as const,
              failure: {
                index: idx,
                mls_number: prop.mls_number,
                error: err,
              },
            };
          }
          callbacks.onSlideDone(idx, dbResult.image_url);
          return {
            kind: "ok" as const,
            success: {
              index: idx,
              mls_number: prop.mls_number,
              image_url: dbResult.image_url,
              image_path: dbResult.image_path,
            },
          };
        }
        // Default canvas-template path (2026-05-27).
        //
        // The legacy V1 HTML template registry was deleted on
        // 2026-05-24 (`lib/post-builder/templates/registry.ts` is a
        // stub — `getTemplate()` now returns null), so the previous
        // `renderTemplate(legacyTemplateId)` call always dead-ended in
        // `Unknown template: open_house_square_v2` for the multi-OH
        // per-property slides. Route them through the same canvas-
        // template pipeline the single-listing OH render in
        // `app/api/post-builder/render/route.ts` uses.
        //
        // The variant axis (v2/v3/v6/v8) is now cosmetic — every
        // per-property variant resolves to the same `open_house/v1`
        // canvas template via findCanvasTemplate's variant-ignored
        // lookup. We still persist `input.per_property_variant` on the
        // generated_posts row so legacy DB schema reads (and the Step 2
        // grid before it was retired) don't break.
        const schema = findCanvasTemplate(
          "open_house",
          "v1",
          input.format,
        );
        if (!schema) {
          const err = `no canvas template for open_house/${input.format}`;
          callbacks.onSlideFailed(idx, err, prop.address ?? null);
          return {
            kind: "err" as const,
            failure: {
              index: idx,
              mls_number: prop.mls_number,
              error: err,
            },
          };
        }
        // why: reuse the same hosting-attribution lookup the DB-template
        // branch above performs so multi-host events get phone + photo
        // resolved once per distinct host and shared across slides.
        const hostKey = normalizeForAttributionKey(prop.hosting_agent_name);
        const hosting = hostKey
          ? hostingAttribution.get(hostKey)
          : undefined;
        const rendered = await renderCanvasSchema({
          schema,
          listingId: listing.id,
          mlsNumber: prop.mls_number,
          format: input.format,
          logLabel: `multi-oh-property:${schema.id}`,
          // Fall back to the listing agent inside the canvas template's
          // bound-field resolver when no host name is set on this slide.
          hostingAgentName: prop.hosting_agent_name ?? null,
          hostingAgentPhone: hosting?.phone ?? null,
          hostingAgentPhotoUrl: hosting?.photo_url ?? null,
        });
        if (!rendered.ok) {
          const err = `${rendered.stage} failed: ${rendered.error}`;
          callbacks.onSlideFailed(idx, err, prop.address ?? null);
          return {
            kind: "err" as const,
            failure: {
              index: idx,
              mls_number: prop.mls_number,
              error: err,
            },
          };
        }
        callbacks.onSlideDone(idx, rendered.image_url);
        return {
          kind: "ok" as const,
          success: {
            index: idx,
            mls_number: prop.mls_number,
            image_url: rendered.image_url,
            image_path: rendered.image_path,
          },
        };
      }),
    );
    for (const r of chunkResults) {
      if (r.kind === "ok") successes.push(r.success);
      else failures.push(r.failure);
    }
  }

  // why: sort by carousel index so the response (and the persisted
  // additional_images JSON) preserves the user's chosen slide order, even
  // though render results came back out of order from Promise.all.
  successes.sort((a, b) => a.index - b.index);
  failures.sort((a, b) => a.index - b.index);
  return { successes, failures };
}

/**
 * Build the "Sat 11 AM–1 PM" style label the DB template renderer expects
 * via the BindingContext.oh_window placeholder. Walks the property's
 * oh_sessions (the consolidated session list) and joins them with " · "
 * when there are multiple — same shape the caption synth uses.
 */
function formatOhWindowLabel(prop: MultiOHEventProperty): string | null {
  const sessions =
    prop.oh_sessions && prop.oh_sessions.length > 0
      ? prop.oh_sessions
      : [{ start_at: prop.oh_start_at, end_at: prop.oh_end_at }];
  const parts = sessions
    .map((s) => formatSingleSession(s.start_at, s.end_at))
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function formatSingleSession(
  startIso: string | null,
  endIso: string | null,
): string | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const day = start.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  });
  const startStr = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  if (!endIso) return `${day} ${startStr}`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${day} ${startStr}`;
  const endStr = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${day} ${startStr}–${endStr}`;
}

/**
 * Build the additional_images JSON column payload. Slide ordering and id
 * generation matter — the publish route reads this array in order, and the
 * Studio carousel UI keys on `id` for drag-and-drop reordering later.
 */
function buildAdditionalImages(
  successes: readonly PerPropertyRenderResult[],
): Json {
  return successes.map((s) => ({
    // why: fresh UUID per slide. The carousel UI uses this for stable React
    // keys + reorder operations. Generated server-side so the client can't
    // collide with itself between Generate and Studio open.
    id: crypto.randomUUID(),
    url: s.image_url,
    source: "listing",
    // why: a 1-indexed sequence hint so future "reorder by original sort"
    // affordances have somewhere to anchor. The carousel UI doesn't rely
    // on it today.
    listingPhotoSequence: s.index + 1,
  })) as unknown as Json;
}

/**
 * Build the slide_metadata JSON column payload — a parallel array to
 * additional_images. Each entry carries the source metadata Studio needs
 * to re-open a per-slide design for editing: listing_mls, variant, format,
 * and optional hosting agent override.
 *
 * The `layer_tree` field is intentionally omitted on first generation —
 * it gets populated only after the user has opened + saved the slide in
 * Studio via `updateGeneratedPostSlideAction`. Until then, opening a slide
 * for edit resolves the factory template via `findCanvasTemplate(...)`.
 */
function buildSlideMetadata(
  input: MultiOHEventInput,
  successes: readonly PerPropertyRenderResult[],
): Json {
  // why: walk successes (not input.properties) so indexes line up exactly
  // with additional_images. successes is already sorted by index above.
  const out: SlideMetadata[] = successes.map((s) => {
    const prop = input.properties[s.index];
    return {
      listing_mls: prop.mls_number,
      // Phase 2E — variant remains for legacy rehydration paths. When a
      // db_template_id is set on the event, the field below is
      // authoritative; variant is informational only.
      variant: input.per_property_variant,
      db_template_id: input.db_template_id ?? null,
      format: input.format,
      hosting_agent_name: prop.hosting_agent_name ?? null,
      layer_tree: null,
    };
  });
  return out as unknown as Json;
}

/**
 * The handler. Auth + body parse + validate happen synchronously and may
 * return a JSON 4xx response. Past that point everything flows through
 * the NDJSON stream — heavy lifting runs in a detached async IIFE so the
 * response headers go out immediately and the client sees the first
 * `started` event without waiting for the hero render.
 */
export async function POST(request: Request): Promise<Response> {
  // ---- Auth (pre-stream) ----
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json<MultiOHGenerateErr>(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ---- Parse + validate body (pre-stream) ----
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    return NextResponse.json<MultiOHGenerateErr>(
      {
        ok: false,
        error: `invalid_json: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return NextResponse.json<MultiOHGenerateErr>(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  // 2026-05-22 — consolidate same-mls picks into one record carrying
  // all session windows in oh_sessions. The wizard's pick list is
  // OH-instance-flat (Sat + Sun for the same condo come in as two
  // entries); the renderer + per-property carousel slides + caption
  // synth all want one entry per unique property.
  //
  // 2026-05-27 (Phase C) — consolidation happens ONLY on first
  // generation. In retry mode we trust the client to send the same
  // post-consolidation order it originally received so `retry_indices`
  // line up with the persisted row's additional_images.
  const isRetry = parsed.value.retry_indices !== undefined;
  const properties = isRetry
    ? parsed.value.properties
    : consolidatePropertiesByMls(parsed.value.properties);
  const input: MultiOHEventInput = {
    ...parsed.value,
    properties,
  };
  const retryIndexes = parsed.value.retry_indices
    ? new Set(parsed.value.retry_indices)
    : undefined;
  const existingGeneratedPostId = parsed.value.existing_generated_post_id;
  const existingHeroUrl = parsed.value.existing_hero_url;

  // ---- NDJSON streaming setup ----
  // Mirrors design-and-render: TransformStream + a writeLine helper that
  // swallows write errors (client may have disconnected, but the
  // server-side work continues so we don't leave half-rendered slides
  // in Storage).
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const writeLine = async (evt: MultiOHStreamEvent): Promise<void> => {
    try {
      await writer.write(encoder.encode(JSON.stringify(evt) + "\n"));
    } catch {
      // Client disconnected — keep the server work running so the row
      // still lands in the DB; the user can resume via the saved
      // generated_post_id even though the stream went away.
    }
  };

  // why: the inner block returns immediately after kicking off the
  // background work so the Response can flush its headers. All errors
  // past this point go through `fatal` events, not HTTP status codes —
  // the client is already reading the body as NDJSON.
  void (async () => {
    try {
      // ---- started ----
      await writeLine({
        type: "started",
        totalSlides: input.properties.length,
        format: input.format,
      });

      // ---- Hero render (skipped in retry mode) ----
      // Retry mode trusts the client-supplied existing_hero_url. We never
      // refetch the row's image_url because (a) it adds a DB round-trip
      // on the hot path and (b) the client just had it from the original
      // `hero_done` event milliseconds ago.
      let heroUrl: string;
      let heroPath: string | null = null;
      if (isRetry) {
        heroUrl = existingHeroUrl ?? "";
        // emit no hero_started / hero_done in retry — the carousel
        // skeleton on the client already shows the hero from the prior
        // stream.
      } else {
        await writeLine({ type: "hero_started" });
        let hero: MultiOHRenderResult;
        try {
          hero = await renderMultiOHEventOverview(input);
        } catch (err) {
          await writeLine({
            type: "fatal",
            error: `hero_render_failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          return;
        }
        heroUrl = hero.image_url;
        heroPath = hero.image_path;
        await writeLine({ type: "hero_done", url: heroUrl });
      }

      // ---- Fetch full listing rows for the per-property render path ----
      const mlsNumbers = input.properties.map((p) => p.mls_number);
      const listingByMls = await fetchListingRows(mlsNumbers);

      // ---- Resolve hosting-agent attribution (phone + photo) ----
      // why: build the (name → { name, phone, photo_url }) map ONCE before
      // the per-property render loop kicks off. Lookups for the same agent
      // (common — Larissa may host multiple OHs in a single event) collapse
      // into one round-trip via the Map dedupe in buildHostingAttributionMap.
      // The map is then threaded into renderPerPropertyCards which hands
      // each slide its host's resolved attribution.
      const hostingAttribution = await buildHostingAttributionMap(
        input.properties,
      );

      // ---- Build per-slide hosting-agent attribution array ----
      // why: persisted on `generated_posts.hosting_agents_by_index` so Studio
      // can hydrate the hosting_agent_* bound fields when Larissa re-opens an
      // individual slide for editing. Mirrors what the headless render token
      // already injects at render time (see app/render/template/[token]/page.tsx
      // lines 113–119) — without persisting here, the rendered PNG carries the
      // host's photo + phone but the editor view would resolve to the listing
      // agent on reopen because the token was discarded after screenshot.
      //
      // The array is keyed by carousel position (0-based, starting at the
      // first per-property slide — the hero is slide 0 of additional_images
      // here, NOT a per-property slide, so index 0 in this array maps to the
      // first per-property card). Entries are emitted for ALL input
      // properties so retry mode can read the same array shape regardless of
      // which slides ran.
      const hostingAgentsByIndex = input.properties.map((prop, index) => {
        const hostKey = normalizeForAttributionKey(prop.hosting_agent_name);
        const attribution = hostKey
          ? hostingAttribution.get(hostKey)
          : undefined;
        return {
          index,
          name: prop.hosting_agent_name ?? null,
          phone: attribution?.phone ?? null,
          photo_url: attribution?.photo_url ?? null,
        };
      });

      // ---- Render per-property cards (bounded parallelism + streaming events) ----
      const { successes, failures } = await renderPerPropertyCards(
        input,
        listingByMls,
        hostingAttribution,
        {
          onSlideStarted: (index, address) => {
            void writeLine({ type: "slide_started", index, address });
          },
          onSlideDone: (index, url) => {
            void writeLine({ type: "slide_done", index, url });
          },
          onSlideFailed: (index, error, address) => {
            void writeLine({
              type: "slide_failed",
              index,
              error,
              address,
            });
          },
        },
        retryIndexes,
      );

      // ---- Persist (INSERT for first generation, UPDATE for retry) ----
      const supabase = createAdminClient();
      const failedIndices = failures.map((f) => f.index).sort((a, b) => a - b);

      if (isRetry && existingGeneratedPostId) {
        // Retry mode — merge the retried slides into the existing row.
        // We read the row's current additional_images + slide_metadata,
        // splice in the new entries at their indexes, and write back.
        //
        // Judgment call: we do NOT race-protect the UPDATE. Two
        // simultaneous retries on the same row would clobber each other,
        // but the wizard's UI gates the retry button (one in-flight
        // stream at a time per wizard instance) and the row id is
        // session-scoped, so a real-world collision would require two
        // tabs both retrying the same row at the same instant. If that
        // ever becomes a problem, switch to a server-side RPC that
        // patches by index inside a single SQL statement.
        const { data: existing, error: fetchErr } = await supabase
          .from("generated_posts")
          .select("additional_images, slide_metadata")
          .eq("id", existingGeneratedPostId)
          .maybeSingle();
        if (fetchErr || !existing) {
          await writeLine({
            type: "fatal",
            error: `retry_fetch_failed: ${fetchErr?.message ?? "row not found"}`,
          });
          return;
        }
        const currentAdditional = Array.isArray(existing.additional_images)
          ? (existing.additional_images as unknown as Array<{
              id: string;
              url: string;
              source: string;
              listingPhotoSequence: number;
            }>)
          : [];
        const currentMeta = Array.isArray(existing.slide_metadata)
          ? (existing.slide_metadata as unknown as SlideMetadata[])
          : [];
        const nextAdditional = [...currentAdditional];
        const nextMeta = [...currentMeta];
        for (const s of successes) {
          const slot = nextAdditional[s.index];
          nextAdditional[s.index] = {
            // Preserve the previous slot's id so React keys / drag-drop
            // state on the Studio carousel stay stable across the retry.
            id: slot?.id ?? crypto.randomUUID(),
            url: s.image_url,
            source: "listing",
            listingPhotoSequence: s.index + 1,
          };
          const prop = input.properties[s.index];
          nextMeta[s.index] = {
            listing_mls: prop.mls_number,
            variant: input.per_property_variant,
            db_template_id: input.db_template_id ?? null,
            format: input.format,
            hosting_agent_name: prop.hosting_agent_name ?? null,
            layer_tree: null,
          };
        }
        const { error: updateErr } = await supabase
          .from("generated_posts")
          .update({
            additional_images: nextAdditional as unknown as Json,
            slide_metadata: nextMeta as unknown as Json,
            // why: re-write the per-slide hosting-agent attribution array on
            // retry too. The wizard re-sends the same MultiOHEventInput when
            // it retries (only retry_indices narrows the render scope), so
            // `hostingAgentsByIndex` rebuilt above is identical for unchanged
            // slots and refreshed for the retried ones. Safe to overwrite
            // wholesale — and forward-fills the column on rows that were
            // first generated before this column existed.
            hosting_agents_by_index: hostingAgentsByIndex as unknown as Json,
          })
          .eq("id", existingGeneratedPostId);
        if (updateErr) {
          await writeLine({
            type: "fatal",
            error: `retry_update_failed: ${updateErr.message}`,
          });
          return;
        }
        await writeLine({
          type: "completed",
          generatedPostId: existingGeneratedPostId,
          redirectPath: `/post-builder?gp=${encodeURIComponent(existingGeneratedPostId)}`,
          heroUrl,
          failedIndices,
        });
        return;
      }

      // First-generation INSERT path. The persisted row carries whichever
      // slides succeeded; the failed ones stay out of additional_images
      // entirely so the client's "Continue with what rendered" affordance
      // lands the user in Studio with N-of-M slides + nothing broken.
      const firstProp = input.properties[0];
      const formatShort = formatShortName(input.format);

      // why: Phase D guard — without a caption, /api/post-builder/post 412s
      // on "generated_post has no caption" the first time Larissa tries to
      // publish a freshly-generated multi-OH row. We synthesize a
      // deterministic multi-OH caption + per-platform map so Post Now
      // always has something to publish. Larissa can override either in
      // Studio's caption pane before publishing.
      const synthesized = synthesizeMultiOHCaption(input);

      const { data: inserted, error: insertError } = await supabase
        .from("generated_posts")
        .insert({
          mls_number: firstProp.mls_number,
          source_mls: firstProp.source_mls,
          property_id: firstProp.listing_id,
          post_type: "open_house",
          // why: persist the wizard's chosen per-property variant (v2/v3/v6/v8).
          // 2026-05-21 — used to hardcode "v1" here back when v1 was the
          // active default, but v1 was retired from the canvas-editor
          // template registry on 2026-05-17, leaving downstream lookups
          // (findCanvasTemplate, Edit in Studio, the resume-auto-open
          // effect) failing for every multi-OH row. The synthetic
          // `template_id` below (`multi_oh_event_*`) remains the canonical
          // "this row is a multi-OH event" marker; variant just needs to
          // match an ACTIVE registered template so Studio can resolve the
          // per-property card schema when Larissa edits a slide.
          variant: input.per_property_variant,
          format: input.format,
          // why: synthetic template id that won't collide with the V1 registry.
          // Future "edit in Studio" code reads this prefix to decide whether
          // to rehydrate the multi-OH wizard vs. open the standard editor.
          template_id: `multi_oh_event_${formatShort}`,
          image_url: heroUrl,
          image_path: heroPath,
          // why: the event hero is a freshly designed graphic, not derived
          // from any single listing's photo. Leaving this null tells the
          // "reset to source photo" affordance in Studio that there's no
          // upstream source to reset to.
          hero_image_source_url: null,
          template_props: {} as Json,
          customizations: {} as Json,
          // Phase D — synthesized deterministic caption + per-platform map.
          // See synthesizeMultiOHCaption below.
          caption: synthesized.legacy.caption,
          hashtags: synthesized.legacy.hashtags,
          mls_hashtag: synthesized.legacy.mls_hashtag,
          captions_by_platform: synthesized.captions as unknown as Json,
          // why: no canvas-editor layer tree — the event hero isn't a Path C
          // template. The per-property cards are V1 renders, also without
          // layer trees. A future "edit hero in Studio" flow would need to
          // synthesize a tree from the hero's HTML, but that's not scope here.
          layer_tree: null,
          additional_images: buildAdditionalImages(successes),
          // why: parallel array enabling per-slide edit. Index N here maps to
          // additional_images[N]. Re-opening a slide in Studio reads variant +
          // format + hosting agent here to resolve the source template.
          slide_metadata: buildSlideMetadata(input, successes),
          // why: per-slide hosting-agent attribution (name + phone + photo_url),
          // captured from the same `hostingAttribution` map the renderer uses.
          // Studio's per-slide edit handler reads this on resume and injects
          // it into the MLSListingPayload before bound-field resolution, so
          // the editor view matches the rendered PNG (photo block populated
          // instead of empty). Null entries are kept so the array length lines
          // up with `input.properties.length` regardless of which slides
          // succeeded.
          hosting_agents_by_index: hostingAgentsByIndex as unknown as Json,
          status: "draft",
          created_by: profile.id,
        })
        .select("id")
        .maybeSingle();

      if (insertError) {
        await writeLine({
          type: "fatal",
          error: `insert_failed: ${insertError.message}`,
        });
        return;
      }
      if (!inserted || typeof inserted.id !== "string") {
        await writeLine({
          type: "fatal",
          error: "insert returned no row",
        });
        return;
      }

      await writeLine({
        type: "completed",
        generatedPostId: inserted.id,
        redirectPath: `/post-builder?gp=${encodeURIComponent(inserted.id)}`,
        heroUrl,
        failedIndices,
      });
    } catch (err) {
      // Defensive — any uncaught throw past the hero / per-property /
      // insert try-catch boundaries lands here. Surface as a final
      // `fatal` event so the client never hangs on a silent stream close.
      await writeLine({
        type: "fatal",
        error: `threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed
      }
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Phase D — synthesize a caption + per-platform variants for a multi-OH
 * event row at insert time. Deterministic (no AI call) because the
 * multi-OH render path is already 30+ seconds of Chromium work and we
 * shouldn't add another network round-trip on the critical path. The
 * synthesized caption is intentionally short so Larissa is encouraged
 * to edit it in Studio before publishing; the goal is to clear the
 * "no caption" 412 in the publish route, not to write the final copy.
 *
 * Returns both the legacy single-caption fields (caption / hashtags /
 * mls_hashtag) and the per-platform CaptionsByPlatform map. The publish
 * routes read whichever is populated, with the per-platform map taking
 * precedence — so writing both keeps every consumer happy.
 */
function synthesizeMultiOHCaption(input: MultiOHEventInput): {
  legacy: { caption: string; hashtags: string[]; mls_hashtag: string };
  captions: Record<
    "instagram" | "facebook" | "tiktok",
    { caption: string; hashtags: string[] }
  >;
} {
  const count = input.properties.length;
  const eventTitle = input.event_title?.trim() || "Open Houses This Weekend";

  // 2026-05-27 — Phase D polish. Variant pool widened so two different
  // events don't read like the same boilerplate, day-of-week + town
  // phrasing surfaces in the lead, and per-platform shape is enforced
  // (IG long with hashtags, FB shorter with no body hashtags, TT one
  // line with hashtags). All variant selection is hash-derived from
  // (event_title + count) so the same event always gets the same
  // caption but different events feel different.
  const firstProp = input.properties[0];
  const anchorMls = canonicalMlsHashtag(
    firstProp?.mls_number ?? "",
    firstProp?.source_mls ?? null,
  );

  // Canonical MLS hashtags for every property, in carousel order. We
  // dedupe defensively — if a wizard ever submitted the same listing
  // twice we don't want a duplicate hashtag.
  const allMlsTags = uniqueStrings(
    input.properties
      .map((p) => canonicalMlsHashtag(p.mls_number, p.source_mls))
      .filter((t) => t.length > 1),
  );

  // ---- Voice ingredients derived from the event ----
  // Day-of-week phrasing pulled from every property's sessions. Pinned
  // to ET via formatCaptionTime so server-side TZ drift doesn't shove
  // a Saturday OH into Sunday's bucket.
  const dayPhrase = describeEventDays(input);
  // Property-count phrasing — "two open houses", "five properties" — so
  // the lead doesn't repeat the same digit-N pattern every time.
  const countPhrase = describeCount(count);
  // Address / town context — how the lead refers to "where". 2–4 lists
  // addresses; 5–6 lists towns; 7+ summarizes top 3 towns ("across X,
  // Y, and Z"). Returns "" when nothing meaningful can be said.
  const townPhrase = describeTowns(input.properties);
  // Single bulk-host attribution. When every property's hosting agent
  // is the same person, we get to add a "Hosted by [name]" line. When
  // they differ, we omit it — per-property bullets already attribute
  // each host individually.
  const bulkHost = describeBulkHost(input.properties);

  // Per-property bullet lines. Mirrors the rendered hero card:
  //   "1) 220 Village Road · Unit 207, Villas · Sat 11–1 PM · Hosted by Larissa"
  //
  // 2026-05-22 — also surfaces unit_number and iterates oh_sessions so a
  // condo unit with Sat + Sun open houses lists both windows on one
  // bullet rather than appearing as two duplicate bullets.
  const propertyLines = input.properties.map((p, i) => {
    const baseAddress = p.address?.trim() ?? "";
    const unit = p.unit_number?.trim() ?? "";
    const addressWithUnit = unit
      ? baseAddress
        ? `${baseAddress} · ${unit}`
        : unit
      : baseAddress;
    const city = p.city?.trim() ?? "";
    const addressFull =
      addressWithUnit && city
        ? `${addressWithUnit}, ${city}`
        : addressWithUnit || city || `Property ${i + 1}`;
    const sessions =
      p.oh_sessions && p.oh_sessions.length > 0
        ? p.oh_sessions
        : [{ start_at: p.oh_start_at, end_at: p.oh_end_at }];
    const timeLabels = sessions
      .map((s) => formatCaptionTime(s.start_at, s.end_at))
      .filter((t) => t.length > 0);
    const host = p.hosting_agent_name?.trim() ?? "";
    const parts: string[] = [addressFull, ...timeLabels];
    if (host) parts.push(`Hosted by ${host}`);
    return `${i + 1}) ${parts.join(" · ")}`;
  });

  // ---- Deterministic variant pick ----
  // Hash on event title + property count so the same event always
  // resolves to the same opener/body/closer triple. Different events
  // pick from the pool at different offsets so two carousels generated
  // back-to-back don't read identically.
  const seed = hashSeed(`${eventTitle}|${count}`);

  // 8 openers. Each is a `(ctx) => string` so it can splice in the
  // event title, the day phrase, the count phrase, and the town phrase
  // when present. Openers are written advanced/optimistic per Larissa's
  // voice rules — punchy, address-forward, no clichés, no emoji.
  const OPENERS: Array<(c: CaptionCtx) => string> = [
    (c) =>
      `${c.eventTitle}. ${capFirst(c.countPhrase)} on the calendar${c.dayPhrase ? ` ${c.dayPhrase}` : ""}${c.townPhrase ? ` ${c.townPhrase}` : ""}.`,
    (c) =>
      `${c.eventTitle} — ${c.countPhrase}${c.dayPhrase ? ` ${c.dayPhrase}` : ""}${c.townPhrase ? `, ${c.townPhrase}` : ""}.`,
    (c) =>
      `${c.dayPhrase ? `${capFirst(c.dayPhrase)} we're opening doors at ${c.countPhrase}` : `We're opening doors at ${c.countPhrase}`}${c.townPhrase ? ` ${c.townPhrase}` : ""}. ${c.eventTitle}.`,
    (c) =>
      `${c.eventTitle}: ${c.countPhrase}${c.townPhrase ? ` ${c.townPhrase}` : ""}${c.dayPhrase ? `, ${c.dayPhrase}` : ""}.`,
    (c) =>
      `${capFirst(c.countPhrase)} unlocked${c.dayPhrase ? ` ${c.dayPhrase}` : ""}${c.townPhrase ? ` ${c.townPhrase}` : ""}. ${c.eventTitle}.`,
    (c) =>
      `${c.eventTitle}. ${c.dayPhrase ? `${capFirst(c.dayPhrase)}, ` : ""}walk through ${c.countPhrase}${c.townPhrase ? ` ${c.townPhrase}` : ""}.`,
    (c) =>
      `Open house run${c.dayPhrase ? ` ${c.dayPhrase}` : ""} — ${c.countPhrase}${c.townPhrase ? ` ${c.townPhrase}` : ""}. ${c.eventTitle}.`,
    (c) =>
      `${c.eventTitle}. Tour ${c.countPhrase}${c.townPhrase ? ` ${c.townPhrase}` : ""}${c.dayPhrase ? ` ${c.dayPhrase}` : ""} — full schedule below.`,
  ];

  // 6 body intros — the one-line label that sits between the opener and
  // the numbered property bullets. Keeps the bullet block from feeling
  // like a wall of text.
  const BODY_INTROS: Array<(c: CaptionCtx) => string> = [
    () => "Here's the schedule:",
    () => "On the tour:",
    () => "Doors open at:",
    () => "Where + when:",
    () => "This weekend's lineup:",
    () => "Stops on the route:",
  ];

  // 5 closers — short call to action that leans on views / showings,
  // never on "don't miss out" / "dream home" / similar bans. Mini
  // commercials: end with a reason to keep watching or stop by.
  const CLOSERS: Array<(c: CaptionCtx) => string> = [
    () => "Stop by any of them — agents will be on-site to answer questions.",
    () => "DM for a private showing, or just walk in.",
    () => "Send a message for a private tour, otherwise we'll see you on the doorstep.",
    () => "Save this post so you've got the schedule on your phone.",
    () => "Bring a friend — the more eyes on these, the better the offers tend to be.",
  ];

  const ctx: CaptionCtx = {
    eventTitle,
    count,
    countPhrase,
    dayPhrase,
    townPhrase,
    bulkHost,
  };

  const opener = OPENERS[seed % OPENERS.length](ctx);
  const bodyIntro = BODY_INTROS[(seed >>> 3) % BODY_INTROS.length](ctx);
  const closer = CLOSERS[(seed >>> 6) % CLOSERS.length](ctx);

  // Per-platform caption bodies.
  // IG: full opener + body intro + every property bullet + optional
  // bulk-host line + closer. Has the 2200-char ceiling but realistically
  // sits under 1000 even at 9 properties.
  // FB: same shape as IG but with a tighter closer chosen from the same
  // pool (we share the same string because the rendered caption is
  // primarily one-line-per-property either way). FB caps at 1500.
  // TT: opener + "+ N more — see the carousel" + bulk-host if present.
  // Never includes bullet lines — TT truncates after ~100 chars in feed
  // and the bullets would just look broken. TT caps at 300.

  const igLines: string[] = [opener, "", bodyIntro, ...propertyLines];
  if (bulkHost) {
    igLines.push("", `Hosted by ${bulkHost} across all stops.`);
  }
  igLines.push("", closer);
  const igBody = clampBody(igLines.join("\n"), 2200);

  const fbLines: string[] = [opener, "", bodyIntro, ...propertyLines];
  if (bulkHost) {
    fbLines.push("", `Hosted by ${bulkHost} across all stops.`);
  }
  fbLines.push("", closer);
  const fbBody = clampBody(fbLines.join("\n"), 1500);

  // TikTok — one tight line. Re-use the opener (already references
  // count + day + town), append a "see the carousel" hook so the user
  // knows there's more, and tack on the bulk host when we have one.
  const ttPieces: string[] = [opener];
  if (count > 1) {
    ttPieces.push("Full schedule in the carousel.");
  }
  if (bulkHost) {
    ttPieces.push(`Hosted by ${bulkHost}.`);
  }
  const ttBody = clampBody(ttPieces.join(" "), 250); // leave room for tags

  // Tag set: post-type + brand + every property's MLS hashtag. Order
  // matters — `cap()` below preserves the anchor MLS but trims later
  // tags to fit per-platform limits, so we put the anchor first.
  const brand = ["#Century21Alliance", "#C21Alliance", "#SouthJerseyRealEstate"];
  const postType = ["#OpenHouse", "#OpenHouseWeekend"];
  // Anchor MLS goes first within the MLS sub-list so the cap() helper
  // can guarantee it survives even on TikTok's tight 5-tag limit.
  const orderedMls = anchorMls
    ? [anchorMls, ...allMlsTags.filter((t) => t !== anchorMls)]
    : allMlsTags;
  const baseTags = [...postType, ...brand, ...orderedMls].filter(
    (t) => t.length > 1,
  );

  // Per-platform cap that always preserves the anchor MLS hashtag, and
  // packs as many additional property MLS hashtags as the platform's
  // tag budget allows. IG fits all 9 comfortably; FB is intentionally
  // pared to the anchor MLS only (FB's algorithm doesn't reward
  // hashtags and Larissa's voice on FB is conversational, not tagged);
  // TT sees the anchor + maybe 1 more so the caption stays under 300
  // total chars.
  const cap = (
    tags: readonly string[],
    limit: number,
  ): string[] => {
    const slice = tags.slice(0, limit);
    if (!anchorMls || slice.includes(anchorMls)) return slice;
    return [anchorMls, ...slice.slice(0, limit - 1)];
  };

  const igTags = cap(baseTags, 30);
  // FB: anchor MLS only — preserves the auto-linker join (it keys on
  // the MLS hashtag in caption + hashtags) while keeping the body
  // clean of hashtag noise per Larissa's FB voice.
  const fbTags = anchorMls ? [anchorMls] : [];
  const ttTags = cap(baseTags, 5);

  return {
    legacy: {
      // why: legacy single-caption mirrors the IG variant — that's the
      // platform the auto-linker and OG-tag preview both key on.
      caption: igBody,
      hashtags: igTags,
      mls_hashtag: anchorMls,
    },
    captions: {
      instagram: { caption: igBody, hashtags: igTags },
      facebook: { caption: fbBody, hashtags: fbTags },
      tiktok: { caption: ttBody, hashtags: ttTags },
    },
  };
}

/** Context passed into every opener/body/closer variant. Kept small
 *  and string-only so the variant functions stay readable. */
interface CaptionCtx {
  eventTitle: string;
  count: number;
  countPhrase: string;
  dayPhrase: string;
  townPhrase: string;
  bulkHost: string;
}

/**
 * "two open houses" / "five properties" / "nine homes" style phrasing.
 * Cycles through {open houses, properties, homes} based on count so a
 * 2-property post and an 8-property post don't both say the same noun.
 * Numbers 2–9 are spelled out (AP style for small counts); 10+ uses
 * the digit form, though MULTI_OH_MAX_PROPERTIES is 9 today so the
 * digit branch is defensive.
 */
function describeCount(count: number): string {
  const WORDS: Record<number, string> = {
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
  };
  const numWord = WORDS[count] ?? String(count);
  // Pick the noun deterministically from count — "open houses" for the
  // 2/4/6/8 cohort, "properties" for 3/5/7/9 — so successive events
  // alternate naturally without needing a hash here.
  const noun =
    count % 2 === 0 ? "open houses" : count <= 4 ? "properties" : "homes";
  return `${numWord} ${noun}`;
}

/**
 * Day-of-week phrasing derived from the union of every property's OH
 * sessions. Returns "" when no dates parse (caller should drop the
 * segment cleanly).
 *
 * Outputs feel like Larissa wrote them:
 *   single day        → "Saturday only"
 *   Sat + Sun         → "this Saturday + Sunday"
 *   Sat + Sun + Mon   → "all weekend"
 *   other 2-day combo → "Friday + Saturday"
 *   other 3+ day      → "all weekend"
 */
function describeEventDays(input: MultiOHEventInput): string {
  const days = new Set<string>();
  for (const p of input.properties) {
    const sessions =
      p.oh_sessions && p.oh_sessions.length > 0
        ? p.oh_sessions
        : [{ start_at: p.oh_start_at, end_at: p.oh_end_at }];
    for (const s of sessions) {
      if (!s.start_at) continue;
      const d = new Date(s.start_at);
      if (Number.isNaN(d.getTime())) continue;
      const name = d.toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: CAPTION_TZ,
      });
      days.add(name);
    }
  }
  if (days.size === 0) return "";
  const sortedDays = Array.from(days).sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  );
  if (sortedDays.length === 1) {
    return `${sortedDays[0]} only`;
  }
  const hasSat = days.has("Saturday");
  const hasSun = days.has("Sunday");
  if (sortedDays.length === 2 && hasSat && hasSun) {
    return "this Saturday + Sunday";
  }
  if (sortedDays.length >= 3 && hasSat && hasSun) {
    return "all weekend";
  }
  if (sortedDays.length === 2) {
    return `${sortedDays[0]} + ${sortedDays[1]}`;
  }
  return "all weekend";
}

const DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Address / town phrasing for the lead. Behaviour by property count:
 *   2     → "in [Town A] and [Town B]" (or addresses if same town)
 *   3–4   → "in [Town A], [Town B], and [Town C]"
 *   5–6   → "across [Town A], [Town B], and [Town C]" (top 3 unique towns)
 *   7+    → "across [Town A], [Town B], and [Town C]" (top 3 unique towns)
 *
 * Returns "" when no towns are populated. "Across South Jersey" is the
 * fallback when there are too many distinct towns to list cleanly (4+
 * unique towns inside the property set).
 *
 * Judgment call: for the 7+ case we don't enumerate every town — Larissa
 * doesn't want a wall-of-text lead. The numbered bullet block below
 * still lists every address, so nothing is lost.
 */
function describeTowns(
  properties: readonly MultiOHEventProperty[],
): string {
  const towns = properties
    .map((p) => p.city?.trim() ?? "")
    .filter((c) => c.length > 0);
  if (towns.length === 0) return "";
  const uniqueTowns = uniqueStrings(towns);
  if (uniqueTowns.length === 1) {
    return `in ${uniqueTowns[0]}`;
  }
  if (uniqueTowns.length === 2) {
    return `in ${uniqueTowns[0]} and ${uniqueTowns[1]}`;
  }
  if (uniqueTowns.length === 3) {
    const verb = properties.length >= 5 ? "across" : "in";
    return `${verb} ${uniqueTowns[0]}, ${uniqueTowns[1]}, and ${uniqueTowns[2]}`;
  }
  // 4+ unique towns — list the first three and fall back to a broad
  // South Jersey framing for the rest. Hashtag pool still surfaces the
  // full set via the MLS tags downstream.
  return `across ${uniqueTowns[0]}, ${uniqueTowns[1]}, and ${uniqueTowns[2]}`;
}

/**
 * Returns the single hosting-agent name when every property in the
 * event is hosted by the same person. Returns "" otherwise (mixed
 * hosts, or no hosts set). Used for the "Hosted by [name] across all
 * stops" line — we only show that when it's truthful for the whole
 * event.
 */
function describeBulkHost(
  properties: readonly MultiOHEventProperty[],
): string {
  const hosts = properties
    .map((p) => p.hosting_agent_name?.trim() ?? "")
    .filter((h) => h.length > 0);
  if (hosts.length === 0) return "";
  if (hosts.length !== properties.length) return "";
  const first = hosts[0];
  for (const h of hosts) {
    if (h !== first) return "";
  }
  return first;
}

/** Capitalize the first letter of a string. Leaves the rest untouched
 *  so existing PascalCase / proper-noun casing survives. */
function capFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Deterministic 32-bit hash of a string (FNV-1a). Used to pick variant
 * indices so the same event always synthesizes the same caption but
 * different events feel different. Not cryptographic — just stable.
 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Trim a synthesized caption to a per-platform character ceiling
 * without breaking mid-word. Used as a defensive backstop — the
 * variant pool is sized to comfortably fit under each platform's
 * limit, but a 9-property event with very long addresses could in
 * principle nudge close to IG's 2200. We trim on a word boundary and
 * append "..." so the truncation is obvious.
 */
function clampBody(body: string, max: number): string {
  if (body.length <= max) return body;
  const slice = body.slice(0, max - 3);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.8 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}...`;
}

/**
 * "Sat · 11 AM–1 PM" style time label for the per-property caption
 * bullets. Returns empty string when start_at is missing or unparseable
 * so the caller can drop the segment cleanly.
 *
 * 2026-05-22 — dropped the month/day portion (was "Sat May 23 · 11 AM");
 * the event_title already carries the date, so repeating it on every
 * row was noisy. Also pinned to America/New_York so timestamps render in
 * ET regardless of where the server runs (Vercel functions otherwise
 * format in UTC, which made 11 AM ET look like 3 PM in the caption).
 */
const CAPTION_TZ = "America/New_York";

function formatCaptionTime(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso) return "";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const dayName = start.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: CAPTION_TZ,
  });
  const startHour = formatCaptionHour(start);
  if (!endIso) {
    return `${dayName} · ${startHour}`;
  }
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) {
    return `${dayName} · ${startHour}`;
  }
  const endHour = formatCaptionHour(end);
  return `${dayName} · ${startHour}–${endHour}`;
}

/**
 * "11 AM" / "1:30 PM" — minutes only when non-zero, rendered in ET.
 *
 * why: minute detection uses ET-aware formatting via a probe with
 * minute:"2-digit" first. Day-level timezones (NJ is straight UTC-4/-5)
 * don't shift minutes so checking `getUTCMinutes()` would also work,
 * but using the localized output keeps the logic resilient to future
 * timezone edge cases.
 */
function formatCaptionHour(d: Date): string {
  // Probe the minute value through the same timezone the hour will use.
  const probe = d.toLocaleString("en-US", {
    timeZone: CAPTION_TZ,
    hour12: false,
    minute: "2-digit",
  });
  const minutes = parseInt(probe, 10);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: CAPTION_TZ,
    hour: "numeric",
    hour12: true,
    ...(minutes === 0 ? {} : { minute: "2-digit" }),
  };
  return d.toLocaleTimeString("en-US", opts);
}

/**
 * De-dupes a string array while preserving the FIRST occurrence's order.
 * Used to keep canonical MLS hashtags unique even if the wizard ever
 * submits the same listing twice (defensive — shouldn't happen).
 */
function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Inline canonical MLS hashtag generator. Duplicated from captions.ts to
 * keep this route self-contained (and avoid pulling the full AI module
 * into a route that doesn't otherwise need it). If both copies drift,
 * the auto-linker will silently miss multi-OH rows for one of the MLS
 * conventions — keep them in sync.
 */
function canonicalMlsHashtag(
  mls_number: string,
  source_mls: SourceMls,
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (!normalized) return "";
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}
