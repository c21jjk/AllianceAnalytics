/**
 * POST /api/post-builder/rerender-carousel
 * -----------------------------------------
 *
 * Re-render the per-slide PNGs of a multi-OH carousel so the published
 * `additional_images` reflect a layout the user just pushed from one slide
 * to all siblings via "Apply layout to all slides".
 *
 * Why this route exists (2026-05-28):
 *   `propagateCarouselLayoutAction` writes a `carousel_layout_overrides`
 *   bag onto the row, and `handleSlideEditClick` merges it onto the schema
 *   when a slide is RE-OPENED in Studio — so the EDITOR shows the new
 *   layout. But the slide PNGs are pre-rendered server-side at generation
 *   time and were never re-rendered, so Final Review + the posted carousel
 *   kept showing the OLD layout. This route closes that gap: it re-renders
 *   every sibling slide's PNG with the stored overrides applied (via the
 *   render token's new `gp_id` field → the render page fetches + applies
 *   the overrides before screenshotting) and rewrites each
 *   `additional_images[i].url`.
 *
 * The date/time wrinkle:
 *   `oh_window` is NOT persisted on the generated_posts row — it was
 *   computed from the wizard input at generation time. A naive re-render
 *   would show the raw `{open_house_date}` / `{open_house_time}` tokens.
 *   So per slide we re-resolve the open-house window from the `open_houses`
 *   table (by the slide's property) and forward it as
 *   `open_house_start_utc` / `open_house_end_utc` into the render token —
 *   the render page stamps those onto the listing payload before the
 *   bound-field resolvers run.
 *
 * NDJSON streaming (mirrors multi-oh-generate): one JSON event per line.
 *   `started`       — totalSlides.
 *   `slide_started` — before each slide's re-render; carries index.
 *   `slide_done`    — slide PNG re-rendered + url updated; index + url.
 *   `slide_failed`  — that slide's re-render threw; index + error. The
 *                     slide keeps its OLD url; the stream continues.
 *   `completed`     — final event after the row's additional_images was
 *                     updated; carries the full new additional_images array
 *                     so the client can swap every tile at once.
 *   `fatal`         — pre-render failure (row gone, etc.); no `completed`.
 *
 * Deliberately does NOT call `revalidatePath("/post-builder")` — that would
 * tear down the open Studio overlay mid-flow (same reason
 * propagateCarouselLayoutAction / reorderCarouselSlidesAction skip it).
 */

import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderDbTemplate } from "@/lib/template-builder";
import { getOpenHousesForProperty } from "@/lib/data/open-houses";
import type {
  PostBuilderListing,
  PostFormat,
  SlideMetadata,
} from "@/lib/post-builder/types";
import type { Json } from "@/lib/supabase/types";

// Headless Chromium → Node runtime only. force-dynamic: mutates Storage + DB.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Up to 9 slides × ~5-15s each, capped at RERENDER_CONCURRENCY in flight.
// 120s mirrors multi-oh-generate's ceiling.
export const maxDuration = 120;

// Bounded parallelism — same rationale as multi-oh-generate's RENDER_CONCURRENCY.
const RERENDER_CONCURRENCY = 4;

const VALID_FORMATS: readonly PostFormat[] = ["square_1x1", "story_9x16"];

/** One slide's entry in `generated_posts.additional_images`. */
interface AdditionalImage {
  id: string;
  url: string;
  source: string;
  listingPhotoSequence: number;
}

/** One entry in `generated_posts.hosting_agents_by_index`. */
interface HostingAgentEntry {
  index: number;
  name: string | null;
  phone: string | null;
  photo_url: string | null;
}

export type RerenderStreamEvent =
  | { type: "started"; totalSlides: number }
  | { type: "slide_started"; index: number }
  | { type: "slide_done"; index: number; url: string }
  | { type: "slide_failed"; index: number; error: string }
  | {
      type: "completed";
      generatedPostId: string;
      additional_images: AdditionalImage[];
      failedIndices: number[];
    }
  | { type: "fatal"; error: string };

interface RerenderBody {
  generated_post_id: string;
}

function parseBody(raw: unknown): RerenderBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r.generated_post_id;
  if (typeof id !== "string" || id.trim().length === 0) return null;
  return { generated_post_id: id.trim() };
}

export async function POST(request: Request): Promise<Response> {
  // ---- Auth (pre-stream) ----
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ---- Parse body (pre-stream) ----
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `invalid_json: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ ok: false, error: "generated_post_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ---- Load + ownership-check the row (pre-stream → clean HTTP errors) ----
  const { data: existing, error: fetchError } = await supabase
    .from("generated_posts")
    .select(
      "id, created_by, format, additional_images, slide_metadata, hosting_agents_by_index, carousel_layout_overrides",
    )
    .eq("id", body.generated_post_id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { ok: false, error: `lookup_failed: ${fetchError.message}` },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: "row not found" }, { status: 404 });
  }
  if (existing.created_by !== profile.id) {
    return NextResponse.json({ ok: false, error: "not owner" }, { status: 403 });
  }

  const oldImages: AdditionalImage[] = Array.isArray(existing.additional_images)
    ? (existing.additional_images as unknown as AdditionalImage[])
    : [];
  const slideMeta: SlideMetadata[] = Array.isArray(existing.slide_metadata)
    ? (existing.slide_metadata as unknown as SlideMetadata[])
    : [];
  const hostsByIndex: HostingAgentEntry[] = Array.isArray(existing.hosting_agents_by_index)
    ? (existing.hosting_agents_by_index as unknown as HostingAgentEntry[])
    : [];

  if (oldImages.length < 2) {
    return NextResponse.json(
      { ok: false, error: "this post has fewer than 2 slides — nothing to re-render" },
      { status: 400 },
    );
  }
  // why: re-render keys each slide on its slide_metadata entry (listing_mls,
  // db_template_id, format). If the two arrays drifted, we can't reliably
  // map slide → source. Bail rather than render the wrong listing onto a slide.
  if (slideMeta.length !== oldImages.length) {
    return NextResponse.json(
      { ok: false, error: "slide_metadata / additional_images length mismatch — refusing to re-render" },
      { status: 409 },
    );
  }

  const rowFormat = VALID_FORMATS.includes(existing.format as PostFormat)
    ? (existing.format as PostFormat)
    : "square_1x1";

  // ---- NDJSON streaming setup (mirrors multi-oh-generate) ----
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const writeLine = async (evt: RerenderStreamEvent): Promise<void> => {
    try {
      await writer.write(encoder.encode(JSON.stringify(evt) + "\n"));
    } catch {
      // Client disconnected — keep server work running so additional_images
      // still lands; the user just re-opens the post to see the result.
    }
  };

  void (async () => {
    try {
      await writeLine({ type: "started", totalSlides: oldImages.length });

      // newImages starts as a copy of the existing array; each successful
      // re-render swaps in a fresh url (preserving id/source/sequence).
      // Failed slides keep their old url.
      const newImages: AdditionalImage[] = oldImages.map((img) => ({ ...img }));
      const failedIndices: number[] = [];

      const allIndexes = oldImages.map((_, i) => i);
      for (let start = 0; start < allIndexes.length; start += RERENDER_CONCURRENCY) {
        const chunk = allIndexes.slice(start, start + RERENDER_CONCURRENCY);
        await Promise.all(
          chunk.map(async (i) => {
            await writeLine({ type: "slide_started", index: i });
            try {
              const url = await rerenderSlide({
                supabase,
                gpId: body.generated_post_id,
                index: i,
                meta: slideMeta[i],
                hostsByIndex,
                rowFormat,
              });
              newImages[i] = { ...newImages[i], url };
              await writeLine({ type: "slide_done", index: i, url });
            } catch (err) {
              failedIndices.push(i);
              await writeLine({
                type: "slide_failed",
                index: i,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
      }

      // ---- Persist the updated url array. NO revalidatePath. ----
      const { error: updError } = await supabase
        .from("generated_posts")
        .update({
          additional_images: newImages as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.generated_post_id)
        .eq("created_by", profile.id);
      if (updError) {
        await writeLine({ type: "fatal", error: `update_failed: ${updError.message}` });
        return;
      }

      await writeLine({
        type: "completed",
        generatedPostId: body.generated_post_id,
        additional_images: newImages,
        failedIndices: failedIndices.sort((a, b) => a - b),
      });
    } catch (err) {
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
 * Re-render a single carousel slide's PNG with the row's stored layout
 * overrides applied (forwarded via the token's `gp_id`) and the open-house
 * window re-resolved from the `open_houses` table. Returns the new image
 * url. Throws on any unrecoverable per-slide condition; the caller turns
 * that into a `slide_failed` event and keeps the slide's old url.
 */
async function rerenderSlide(args: {
  supabase: ReturnType<typeof createAdminClient>;
  gpId: string;
  index: number;
  meta: SlideMetadata | undefined;
  hostsByIndex: HostingAgentEntry[];
  rowFormat: PostFormat;
}): Promise<string> {
  const { supabase, gpId, index, meta, hostsByIndex, rowFormat } = args;

  if (!meta || !meta.listing_mls) {
    throw new Error("slide has no listing_mls in slide_metadata");
  }
  if (!meta.db_template_id) {
    // why: only DB-template slides flow through renderDbTemplate. Legacy
    // variant-only slides have no admin template to re-render against;
    // re-rendering them isn't in scope for the layout-propagation fix.
    throw new Error("slide has no db_template_id — re-render only supports DB-template slides");
  }

  // Resolve the slide's property. mls_number is globally unique today; once
  // the Phase-4 composite (mls_number, source_mls) key lands, narrow this by
  // source_mls too (slide_metadata doesn't carry source today).
  // TODO(phase-4): add source_mls to SlideMetadata + filter here.
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, mls_number")
    .eq("mls_number", meta.listing_mls)
    .maybeSingle();
  if (propErr) throw new Error(`property lookup failed: ${propErr.message}`);
  if (!prop || typeof prop.id !== "string") {
    throw new Error(`no property found for mls ${meta.listing_mls}`);
  }

  // Re-resolve the open-house window. The wizard's original selection wasn't
  // persisted, so we take the property's earliest upcoming/just-ended OH
  // session as the window. Empty → leave null (the listing row's own
  // oh_start_at, if any, still resolves on the render page).
  const ohs = await getOpenHousesForProperty(prop.id);
  const earliest = ohs.length > 0 ? ohs[0] : null;

  // Host attribution is already persisted per slide index — reuse it rather
  // than re-querying Alliance Dash.
  const host = hostsByIndex.find((h) => h.index === index) ?? null;

  // renderDbTemplate only reads listing.id (token) + listing.mls_number
  // (storage path). The render page re-fetches the full listing by id.
  const listing = {
    id: prop.id,
    mls_number: prop.mls_number ?? meta.listing_mls,
  } as unknown as PostBuilderListing;

  const result = await renderDbTemplate({
    template_id: meta.db_template_id,
    listing,
    format: meta.format ?? rowFormat,
    hosting_agent_name: host?.name ?? meta.hosting_agent_name ?? null,
    hosting_agent_phone: host?.phone ?? null,
    hosting_agent_photo_url: host?.photo_url ?? null,
    open_house_start_utc: earliest?.start_at ?? null,
    open_house_end_utc: earliest?.end_at ?? null,
    // The key bit: gp_id tells the render page to fetch + apply this row's
    // carousel_layout_overrides onto the schema before screenshotting.
    gp_id: gpId,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.image_url;
}
