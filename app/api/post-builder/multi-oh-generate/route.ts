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
 *   2. N per-property cards (rendered by the existing V1 Open House
 *      pipeline — `renderTemplate`). These are slides 1..N.
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
 *   • We render N+1 images in parallel; a route handler gives us a clean
 *     POST shape, JSON in/out, and the same call-and-redirect pattern the
 *     wizard already wires up for `/api/post-builder/render`.
 *   • Error semantics: a route can return a partial-progress payload via
 *     `MultiOHGenerateErr.partial` so the wizard can resume without
 *     re-rendering everything. Wrapping that in a server action would
 *     leak the error envelope into the action's normal return path.
 *
 * Auth: requires a signed-in Alliance user.
 *
 * Body (JSON): `MultiOHEventInput` — see lib/post-builder/types.ts.
 *
 * Response (200): `MultiOHGenerateOk`.
 * Response (4xx/5xx): `MultiOHGenerateErr` — sometimes with `partial`
 * populated so the wizard can offer a resume.
 */

import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import {
  renderMultiOHEventOverview,
  type MultiOHRenderResult,
} from "@/lib/post-builder/multi-oh-render";
import { renderTemplate } from "@/lib/post-builder/render";
import { formatShortName } from "@/lib/post-builder/templates/registry";
import {
  MULTI_OH_MAX_PROPERTIES,
  MULTI_OH_MIN_PROPERTIES,
  type MultiOHEventInput,
  type MultiOHEventProperty,
  type MultiOHGenerateErr,
  type MultiOHGenerateOk,
  type PostBuilderListing,
  type PostFormat,
  type SlideMetadata,
  type SourceMls,
} from "@/lib/post-builder/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

// why: the V1 render pipeline launches headless Chromium, which only runs on
// the Node.js runtime — Edge is a hard nope. force-dynamic keeps Next from
// trying to cache responses; this route mutates Storage + DB on every call.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// why: Chromium renders run 5-15s each in the worst case. We render hero +
// up to 9 per-property cards, capped at 5-in-flight, so a worst-case timing
// budget is roughly two batches of ~15s plus the hero plus DB/Storage I/O.
// 60s gives comfortable headroom; the V1 render route uses 300s because of
// cold-start binary download, which by the time we hit this route is already
// warm (the wizard pings /render-warmup first). If we ever see timeouts in
// prod, bump this to 300s to match.
export const maxDuration = 60;

// why: cap parallelism so we don't blow past the function's memory ceiling
// when all 9 Chromium instances + hero spin up at once. 5 in flight is a
// gentle number — 9 properties takes 2 batches max, and total wall time is
// roughly 2 × (worst per-property render), which is well inside maxDuration.
const RENDER_CONCURRENCY = 5;

// why: the three valid PostFormat literals. Pulled into a tuple so we can do
// a typed runtime check without importing the type-only PostFormat alias.
const VALID_FORMATS = [
  "square_1x1",
  "portrait_4x5",
  "story_9x16",
] as const satisfies readonly PostFormat[];

// why: only v1/v2/v3 are valid per-property variants in the multi-OH flow
// today. v6/v7/v8 weren't designed for the dense data plus shared event
// branding the carousel needs — they read as standalone hero posts. If we
// add them later, just widen this tuple.
const VALID_PER_PROPERTY_VARIANTS = ["v1", "v2", "v3"] as const;
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
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
}

/**
 * Slim parser for the raw POST body. We accept `unknown` and narrow defensively
 * — there's no zod here, and TypeScript can't trust JSON at the boundary.
 */
function parseBody(raw: unknown):
  | { ok: true; value: MultiOHEventInput }
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

  const per_property_variant = r.per_property_variant;
  if (
    typeof per_property_variant !== "string" ||
    !VALID_PER_PROPERTY_VARIANTS.includes(
      per_property_variant as ValidPerPropertyVariant,
    )
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
    });
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
      properties,
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
      "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date",
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
  return {
    id: row?.id ?? prop.listing_id ?? prop.mls_number,
    mls_number: prop.mls_number,
    source_mls: prop.source_mls,
    address: prop.address ?? row?.address ?? null,
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
  };
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
 * Render N per-property cards with bounded parallelism. Returns whichever
 * succeeded plus a list of failures — caller decides whether to fail the
 * whole flow or surface a partial-progress error.
 */
async function renderPerPropertyCards(
  input: MultiOHEventInput,
  listingByMls: Map<string, PropertyRow>,
): Promise<{
  successes: PerPropertyRenderResult[];
  failures: PerPropertyRenderFailure[];
}> {
  const successes: PerPropertyRenderResult[] = [];
  const failures: PerPropertyRenderFailure[] = [];
  const formatShort = formatShortName(input.format);
  const template_id = `open_house_${formatShort}_${input.per_property_variant}`;

  // why: simple windowed parallelism — process the properties in chunks of
  // RENDER_CONCURRENCY. Promise.all on chunks is good enough for ≤9 inputs;
  // a real semaphore would be overkill.
  for (let start = 0; start < input.properties.length; start += RENDER_CONCURRENCY) {
    const chunk = input.properties.slice(start, start + RENDER_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (prop, offset) => {
        const idx = start + offset;
        const row = listingByMls.get(prop.mls_number);
        const listing = toRenderListing(prop, row);
        if (!listing.hero_image_url) {
          return {
            kind: "err" as const,
            failure: {
              index: idx,
              mls_number: prop.mls_number,
              error: "no hero_image_url for property",
            },
          };
        }
        const result = await renderTemplate({
          template_id,
          listing,
          hero_image_url: listing.hero_image_url,
        });
        if (!result.ok) {
          return {
            kind: "err" as const,
            failure: {
              index: idx,
              mls_number: prop.mls_number,
              error: result.error,
            },
          };
        }
        return {
          kind: "ok" as const,
          success: {
            index: idx,
            mls_number: prop.mls_number,
            image_url: result.image_url,
            image_path: result.image_path,
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
      variant: input.per_property_variant,
      format: input.format,
      hosting_agent_name: prop.hosting_agent_name ?? null,
      layer_tree: null,
    };
  });
  return out as unknown as Json;
}

/**
 * The handler. Wraps the whole flow in try/catch so any unexpected throw
 * surfaces as a clean 500 with a `MultiOHGenerateErr` envelope rather than
 * a Next.js stack trace dump.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json<MultiOHGenerateErr>(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }

    // ---- Parse + validate body ----
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
    const input = parsed.value;

    // ---- Render the event-overview hero ----
    // why: `renderMultiOHEventOverview` throws on failure (Chromium / Storage)
    // rather than returning a tagged-result envelope — opposite convention from
    // `renderTemplate`. Wrap in try/catch to convert thrown errors into the
    // `MultiOHGenerateErr` envelope this route's API contract expects.
    let hero: MultiOHRenderResult;
    try {
      hero = await renderMultiOHEventOverview(input);
    } catch (err) {
      return NextResponse.json<MultiOHGenerateErr>(
        {
          ok: false,
          error: `hero_render_failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 500 },
      );
    }

    // ---- Fetch full listing rows for the per-property render path ----
    const mlsNumbers = input.properties.map((p) => p.mls_number);
    const listingByMls = await fetchListingRows(mlsNumbers);

    // ---- Render per-property cards (bounded parallelism) ----
    const { successes, failures } = await renderPerPropertyCards(
      input,
      listingByMls,
    );

    if (failures.length > 0) {
      // why: surface partial progress so the wizard can offer a retry on
      // just the failed slides instead of forcing a full re-render. The
      // hero is the most expensive single render, so it's worth keeping
      // even when one card flunks.
      return NextResponse.json<MultiOHGenerateErr>(
        {
          ok: false,
          error: `per_property_render_failed: ${failures
            .map((f) => `[${f.index}/${f.mls_number}] ${f.error}`)
            .join("; ")}`,
          partial: {
            hero_image_url: hero.image_url,
            per_property_urls: successes.map((s) => s.image_url),
          },
        },
        { status: 500 },
      );
    }

    // ---- Insert the generated_posts row ----
    const supabase = createAdminClient();
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
        // why: persist as v1 for now. The existing PostVariant union doesn't
        // have a multi-OH-specific code, and we deliberately aren't widening
        // it tonight to keep scope tight. The synthetic `template_id` below
        // (`multi_oh_event_*`) is the marker future code uses to detect
        // "this row is a multi-OH event" — variant + post_type alone aren't
        // enough.
        variant: "v1",
        format: input.format,
        // why: synthetic template id that won't collide with the V1 registry.
        // Future "edit in Studio" code reads this prefix to decide whether
        // to rehydrate the multi-OH wizard vs. open the standard editor.
        template_id: `multi_oh_event_${formatShort}`,
        image_url: hero.image_url,
        image_path: hero.image_path,
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
        status: "draft",
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json<MultiOHGenerateErr>(
        {
          ok: false,
          error: `insert_failed: ${insertError.message}`,
          partial: {
            hero_image_url: hero.image_url,
            per_property_urls: successes.map((s) => s.image_url),
          },
        },
        { status: 500 },
      );
    }
    if (!inserted || typeof inserted.id !== "string") {
      return NextResponse.json<MultiOHGenerateErr>(
        {
          ok: false,
          error: "insert returned no row",
          partial: {
            hero_image_url: hero.image_url,
            per_property_urls: successes.map((s) => s.image_url),
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json<MultiOHGenerateOk>({
      ok: true,
      generated_post_id: inserted.id,
      hero_image_url: hero.image_url,
      per_property_urls: successes.map((s) => s.image_url),
    });
  } catch (err) {
    // why: top-level guard for any unexpected throw — keeps the wizard's
    // error toast meaningful rather than rendering a Next.js stack page.
    return NextResponse.json<MultiOHGenerateErr>(
      {
        ok: false,
        error: `threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
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
  const agentName = input.agent_name?.trim() || "our team";

  // Anchor the auto-linker on the first property's MLS. Multi-OH posts
  // can only deep-link to one listing, so we pick the first by wizard
  // order (which Larissa controls). The per-property cards in the
  // carousel slides carry the other listings' MLS hashtags inside
  // their image text — separate path.
  const firstProp = input.properties[0];
  const mlsHashtag = canonicalMlsHashtag(
    firstProp?.mls_number ?? "",
    firstProp?.source_mls ?? null,
  );

  // Per-platform caption bodies — lightly tuned for each platform's
  // voice (matches the AI-prompt style guidance in captions.ts).
  const igBody =
    `${eventTitle}. ${count} homes open this weekend with ${agentName}. ` +
    `Each slide has the address, time, and a quick look — swipe through and ` +
    `DM if any of them are right for you.`;
  const fbBody =
    `${eventTitle}. ${count} open houses with ${agentName} this weekend — ` +
    `addresses and times in the slides. Reach out if you want to see one.`;
  const ttBody = `${count} open houses. One weekend. ${agentName} hosting.`;

  // Brand + post-type tags. Per-platform caps mirror captions.ts.
  const brand = ["#Century21Alliance", "#C21Alliance", "#SouthJerseyRealEstate"];
  const postType = ["#OpenHouse", "#OpenHouseWeekend"];
  const baseTags = [...postType, ...brand, mlsHashtag].filter(
    (t) => t.length > 1,
  );

  // Per-platform cap with the canonical MLS hashtag preserved (matches
  // ensuredMls logic in captions.ts).
  const cap = (
    tags: readonly string[],
    limit: number,
  ): string[] => {
    const slice = tags.slice(0, limit);
    return slice.includes(mlsHashtag)
      ? slice
      : [mlsHashtag, ...slice.slice(0, limit - 1)];
  };

  const igTags = cap(baseTags, 30);
  const fbTags = cap(baseTags, 6);
  const ttTags = cap(baseTags, 5);

  return {
    legacy: {
      // why: legacy single-caption mirrors the IG variant — that's the
      // platform the auto-linker and OG-tag preview both key on.
      caption: igBody,
      hashtags: igTags,
      mls_hashtag: mlsHashtag,
    },
    captions: {
      instagram: { caption: igBody, hashtags: igTags },
      facebook: { caption: fbBody, hashtags: fbTags },
      tiktok: { caption: ttBody, hashtags: ttTags },
    },
  };
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
