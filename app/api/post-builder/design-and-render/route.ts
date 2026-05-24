/**
 * POST /api/post-builder/design-and-render
 *
 * Studio AI Design — Phase 2's user-facing endpoint. Combines the Phase 1
 * design pipeline (composition → strategy → layout → critique) with the
 * existing Chromium-based render pipeline so the user sees a fully
 * Claude-designed PNG instead of the factory template.
 *
 * Flow:
 *   1. Resolve the factory CanvasTemplateSchema for the requested
 *      (post_type, variant, format) tuple via findCanvasTemplate.
 *   2. Run `runDesignPipeline` against (schema, listing, format, photos),
 *      streaming progress events to the client as NDJSON.
 *   3. Cache the AI-generated schema in `render_schema_cache` with a
 *      10-minute TTL.
 *   4. Sign a render token referencing the cache row + listing UUID,
 *      hand the resulting URL to headless Chromium (same path used by
 *      DB-template renders today).
 *   5. Upload the screenshot to Supabase Storage; emit a final
 *      `result` NDJSON event carrying image_url, image_path, ai_schema
 *      (for the client to stash in `layer_tree`), mood, critique result,
 *      and token-usage telemetry.
 *
 * Why NDJSON (vs SSE / JSON-only):
 *   The full pipeline takes ~60-90 seconds — long enough that the user
 *   wants a progress indicator. NDJSON gives one line per progress event,
 *   parseable by a simple line-buffered reader on the client. Mirrors the
 *   shape of the existing `/api/post-builder/design` Phase 1 route, so
 *   the client can share the same NDJSON consumer.
 *
 * Failure modes:
 *   • Auth / validation errors → JSON 4xx body (no stream).
 *   • Pipeline failure (any pass) → `failed` event on the stream + 200
 *     status. Client surfaces a "AI Design unavailable, try regular
 *     Generate" toast. We do NOT fall back to a factory render here —
 *     the user can hit Generate themselves. Keeping the two paths fully
 *     decoupled avoids hiding pipeline regressions.
 *
 * Phase 2 (2026-05-23) — first cut. Caller is the AI Design button in
 * PostBuilderClient.tsx (built in the same task series).
 */
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenshotHtml } from "@/lib/post-builder/chromium";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
import { runDesignPipeline } from "@/lib/post-builder/canvas-editor/ai/design-pipeline";
import { signRenderToken } from "@/lib/template-builder/render-token";
import type { Json } from "@/lib/supabase/types";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
} from "@/lib/post-builder/types";
import type {
  DesignMood,
  DesignPipelineInput,
  PipelineProgress,
} from "@/lib/post-builder/canvas-editor/ai/types";

// why: the underlying pipeline is up to four Claude calls (two Opus).
// Empirical worst case is ~90s end-to-end; Chromium render adds another
// 10-30s on cold-start. 180s is a comfortable ceiling without sitting on
// a stuck function forever.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

const STORAGE_BUCKET = "post-builder-renders";

interface DesignAndRenderBody {
  post_type?: PostType;
  variant?: PostVariant;
  format?: PostFormat;
  listing?: PostBuilderListing;
  /** Ordered photo URLs; index 0 is the hero (handed to Claude vision in Pass 1). */
  photo_urls?: string[];
  /** Optional free-text intent forwarded to the pipeline ("more luxury", etc.). */
  intent?: string;
  /** Optional pin: force a specific DesignMood for the strategy pass. */
  force_mood?: DesignMood;
}

interface FinalResultEvent {
  type: "result";
  ok: true;
  image_url: string;
  image_path: string;
  /** Original factory template id we started from. Persisted on the post
   *  row as `original_template_id` so the Studio "Revert" link can find it. */
  original_template_id: string;
  /** AI-redesigned schema — client should pass this back to the save
   *  action as `layer_tree` so Studio opens to the AI design. */
  ai_schema: unknown;
  ai_mood: DesignMood;
  ai_critique_passed: boolean;
  ai_critique_issues: ReadonlyArray<string>;
  duration_ms: number;
  tokens_used: { input: number; output: number };
}

/**
 * Resolve the absolute base URL for the headless render landing page.
 * Mirrors the helper inside `lib/template-builder/renderer.ts` — kept
 * duplicated here to avoid pulling that whole module's render path into
 * this route just for one helper. If a third caller appears, lift this.
 */
function resolveBaseUrl(): string {
  if (process.env.RENDER_BASE_URL) {
    return process.env.RENDER_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/** Validate the request body. Returns either { ok: true, ... } or an error message. */
function validate(
  body: DesignAndRenderBody,
):
  | {
      ok: true;
      post_type: PostType;
      variant: PostVariant;
      format: PostFormat;
      listing: PostBuilderListing;
      photo_urls: string[];
      intent: string | undefined;
      force_mood: DesignMood | undefined;
    }
  | { ok: false; error: string } {
  if (!body.post_type || typeof body.post_type !== "string") {
    return { ok: false, error: "post_type required" };
  }
  if (!body.variant || typeof body.variant !== "string") {
    return { ok: false, error: "variant required" };
  }
  if (!body.format || typeof body.format !== "string") {
    return { ok: false, error: "format required" };
  }
  if (!body.listing || typeof body.listing !== "object") {
    return { ok: false, error: "listing required" };
  }
  if (!body.listing.id || typeof body.listing.id !== "string") {
    return { ok: false, error: "listing.id (UUID) required" };
  }
  if (!Array.isArray(body.photo_urls) || body.photo_urls.length === 0) {
    return { ok: false, error: "photo_urls (non-empty array) required" };
  }
  if (!body.photo_urls.every((u) => typeof u === "string" && u.length > 0)) {
    return { ok: false, error: "photo_urls must contain non-empty strings" };
  }
  return {
    ok: true,
    post_type: body.post_type,
    variant: body.variant,
    format: body.format,
    listing: body.listing,
    photo_urls: body.photo_urls,
    intent: typeof body.intent === "string" ? body.intent : undefined,
    force_mood: body.force_mood,
  };
}

export async function POST(request: Request): Promise<Response> {
  // ---- Auth ----
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ---- Body parse + validate ----
  let body: DesignAndRenderBody;
  try {
    body = (await request.json()) as DesignAndRenderBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const v = validate(body);
  if (!v.ok) {
    return NextResponse.json(
      { ok: false, error: v.error },
      { status: 400 },
    );
  }

  // ---- Resolve the factory canvas template for this variant ----
  // why: AI Design hydrates from the existing factory canvas templates
  // (the same ones Studio uses). If a variant has no canvas template
  // (currently all 6 active variants do, but be defensive), fail fast.
  const factorySchema = findCanvasTemplate(v.post_type, v.variant, v.format);
  if (!factorySchema) {
    return NextResponse.json(
      {
        ok: false,
        error: `no canvas template for ${v.post_type}/${v.variant}/${v.format} — AI Design not supported for this variant`,
      },
      { status: 400 },
    );
  }

  // ---- NDJSON streaming setup ----
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const writeLine = async (obj: unknown): Promise<void> => {
    try {
      await writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
    } catch {
      // Client disconnected — the pipeline keeps running server-side
      // (we can't safely cancel mid-Anthropic-call), but we stop emitting.
    }
  };

  // why: factory schema id is e.g. "just_listed_portrait_v2" — that's
  // the canonical "original" we need to remember so the Studio revert
  // link can re-hydrate later. The token's template_id field is required
  // by the existing payload shape but ignored when ai_schema_cache_id is
  // set on the render-page side.
  const originalTemplateId = factorySchema.id;

  // ---- Kick off pipeline + render asynchronously ----
  // The response returns immediately with the stream; the heavy lifting
  // runs in this background block and emits events through writeLine.
  (async () => {
    try {
      const pipelineInput: DesignPipelineInput = {
        currentSchema: factorySchema,
        listing: mapListingToPayload(v.listing, { photos: v.photo_urls }),
        format: v.format,
        photoUrls: v.photo_urls,
        intent: v.intent,
        forceMood: v.force_mood,
      };

      // why: the pipeline emits its own "started" / "pass_*" / "completed"
      // events; we forward them all so the client sees a single coherent
      // event stream covering both phases.
      const pipelineResult = await runDesignPipeline(
        pipelineInput,
        (evt: PipelineProgress) => {
          void writeLine(evt);
        },
      );

      if (!pipelineResult.ok) {
        // The pipeline already emitted a `failed` event before returning.
        // Nothing more to do; close the stream.
        return;
      }

      const { output } = pipelineResult;
      // The pipeline output's plan is the post-critique LayoutPlan. For
      // Phase 2 the layout pass returns `full_replacement` — sanity-check
      // because a `mutations` plan here would mean the pipeline drifted
      // from the documented Phase 2 contract.
      if (output.plan.kind !== "full_replacement") {
        await writeLine({
          type: "failed",
          error: `pipeline returned ${output.plan.kind} plan; Phase 2 expects full_replacement`,
          ts: Date.now(),
        });
        return;
      }

      const aiSchema = output.plan.schema;

      // ---- Cache the AI schema for the render page to pick up ----
      await writeLine({ type: "render_started", ts: Date.now() });
      const supabase = createAdminClient();
      const { data: cacheRow, error: cacheErr } = await supabase
        .from("render_schema_cache")
        .insert({
          // why: cast through unknown — the row's `schema` column is jsonb;
          // CanvasTemplateSchema is a typed shape that serializes cleanly
          // to JSON. The DB column accepts any JSON.
          schema: aiSchema as unknown as Json,
          listing_id: v.listing.id,
          format: v.format,
        })
        .select("id")
        .maybeSingle();

      if (cacheErr || !cacheRow) {
        await writeLine({
          type: "failed",
          error: `cache insert failed: ${cacheErr?.message ?? "no row returned"}`,
          ts: Date.now(),
        });
        return;
      }

      // ---- Sign a render token + hit Chromium ----
      let token: string;
      try {
        token = signRenderToken({
          // Synthetic template_id — the render page ignores this field
          // when ai_schema_cache_id is set, but the payload shape requires
          // a non-empty string here for back-compat with DB-template tokens.
          template_id: `ai_design:${originalTemplateId}`,
          listing_id: v.listing.id,
          format: v.format,
          ai_schema_cache_id: cacheRow.id,
        });
      } catch (e) {
        await writeLine({
          type: "failed",
          error: `token sign failed: ${e instanceof Error ? e.message : String(e)}`,
          ts: Date.now(),
        });
        return;
      }

      const url = `${resolveBaseUrl()}/render/template/${encodeURIComponent(token)}`;
      const dims = { width: aiSchema.width, height: aiSchema.height };

      let pngBytes: Buffer;
      try {
        pngBytes = await screenshotHtml({
          url,
          width: dims.width,
          height: dims.height,
          log_label: `ai-design:${originalTemplateId}`,
        });
      } catch (e) {
        await writeLine({
          type: "failed",
          error: `chromium render failed: ${e instanceof Error ? e.message : String(e)}`,
          ts: Date.now(),
        });
        return;
      }

      // ---- Upload PNG to Storage ----
      const renderedAt = Date.now();
      const storagePath = `${originalTemplateId}/${v.listing.mls_number}/ai-${renderedAt}.png`;
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, pngBytes, {
          contentType: "image/png",
          upsert: false,
          cacheControl: "31536000",
        });
      if (uploadErr) {
        await writeLine({
          type: "failed",
          error: `upload failed: ${uploadErr.message}`,
          ts: Date.now(),
        });
        return;
      }

      const { data: pub } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      const finalEvent: FinalResultEvent = {
        type: "result",
        ok: true,
        image_url: pub.publicUrl,
        image_path: storagePath,
        original_template_id: originalTemplateId,
        ai_schema: aiSchema,
        ai_mood: output.strategy.mood,
        ai_critique_passed: output.critique.passed,
        ai_critique_issues: output.critique.issues,
        duration_ms: output.totalDurationMs + (Date.now() - renderedAt),
        tokens_used: output.tokensUsed,
      };
      await writeLine(finalEvent);
    } catch (e) {
      // Defensive — any unexpected throw past the pipeline / render
      // try/catch boundaries lands here. Surface as a final `failed`
      // event so the client never hangs on a silent stream close.
      const msg = e instanceof Error ? e.message : String(e);
      await writeLine({
        type: "failed",
        error: `unexpected error: ${msg}`,
        ts: Date.now(),
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
