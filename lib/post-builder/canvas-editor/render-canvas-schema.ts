/**
 * Shared helper — cache a CanvasTemplateSchema, hand it to Chromium via a
 * signed render token, upload the resulting PNG to Supabase Storage, and
 * return the public URL + storage path.
 *
 * 2026-05-24 — extracted from the inline block that previously lived inside
 * `/api/post-builder/design-and-render/route.ts`. Both that route AND
 * `/api/post-builder/render` (the Generate button) now call this helper, so
 * the schema → PNG mechanics live in exactly one place.
 *
 * Why a shared helper instead of overloading one route with a flag:
 *   Generate and AI Design are two distinct user intents. Routing them
 *   through the same endpoint with a `skip_pipeline` flag would conflate
 *   them at the route layer. Keeping each route focused on its own
 *   user-visible job — and sharing the render mechanics underneath —
 *   keeps each route easy to reason about and forces zero duplication.
 *
 * Pipeline this helper runs:
 *   1. INSERT the schema into `render_schema_cache` with a 10-min TTL.
 *   2. Sign a render token referencing the cache row + listing UUID.
 *   3. Hand the resulting URL to headless Chromium (existing screenshotHtml
 *      pipeline at lib/post-builder/chromium.ts).
 *   4. Upload the PNG to the `post-builder-renders` bucket.
 *   5. Return { ok: true, image_url, image_path, width, height }.
 *
 * Error contract: returns a discriminated `{ ok: false, error, stage }`
 * union when any step fails. The route layer decides how to surface the
 * error (NDJSON event for design-and-render, JSON 500 for /render).
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicAppUrl } from "@/lib/app-url";
import { screenshotHtml } from "@/lib/post-builder/chromium";
import { signRenderToken } from "@/lib/template-builder/render-token";
import type { Json } from "@/lib/supabase/types";
import type { PostFormat } from "@/lib/post-builder/types";
import type { CanvasTemplateSchema } from "./types";

const STORAGE_BUCKET = "post-builder-renders";

/** Stage labels — surface them in the error object so callers can log
 *  WHERE the render failed (cache vs sign vs Chromium vs upload). */
export type RenderCanvasSchemaStage =
  | "cache_insert"
  | "token_sign"
  | "chromium_render"
  | "storage_upload";

export interface RenderCanvasSchemaInput {
  /** The freshly-built or AI-rewritten schema to render. */
  schema: CanvasTemplateSchema;
  /** UUID of the listing this schema was hydrated against. Used in the
   *  token payload so the render page can re-fetch the listing for bound
   *  fields, and in the storage path so renders are grouped by listing. */
  listingId: string;
  /** MLS number, used as part of the storage path for human-friendly
   *  bucket organization. */
  mlsNumber: string;
  /** Output format. The schema already encodes width/height, but format
   *  is passed through to the token payload so the render page can
   *  validate the schema matches the expected dimensions. */
  format: PostFormat;
  /** Optional storage-path prefix tag — e.g., "ai-" so AI renders sort
   *  separately from factory renders in the bucket listing. Defaults to
   *  "" (no prefix). */
  storagePrefix?: string;
  /** Optional log label forwarded to screenshotHtml for diagnostic
   *  tracing in Vercel logs. Falls back to the schema id. */
  logLabel?: string;
}

export interface RenderCanvasSchemaOk {
  ok: true;
  image_url: string;
  image_path: string;
  width: number;
  height: number;
}

export interface RenderCanvasSchemaErr {
  ok: false;
  stage: RenderCanvasSchemaStage;
  error: string;
}

export type RenderCanvasSchemaResult =
  | RenderCanvasSchemaOk
  | RenderCanvasSchemaErr;

/**
 * Run the schema → PNG pipeline. See the module docstring for the full
 * step list. Returns either a public URL + storage path on success, or a
 * staged error object on failure (the caller logs/surfaces the error).
 */
export async function renderCanvasSchema(
  input: RenderCanvasSchemaInput,
): Promise<RenderCanvasSchemaResult> {
  const supabase = createAdminClient();

  // ---- Step 1: cache the schema for the render page to pick up ----
  // why: Chromium navigates to a URL on the user's custom domain; the
  // render page reads the schema from this cache table by id. The token
  // (signed below) carries the cache id. 10-min TTL is set by the
  // `expires_at` DEFAULT on the column; lazy-DELETE on the render-page
  // read sweeps expired rows.
  const { data: cacheRow, error: cacheErr } = await supabase
    .from("render_schema_cache")
    .insert({
      // why: cast through unknown — the row's `schema` column is jsonb,
      // and CanvasTemplateSchema serializes cleanly to JSON.
      schema: input.schema as unknown as Json,
      listing_id: input.listingId,
      format: input.format,
    })
    .select("id")
    .maybeSingle();
  if (cacheErr || !cacheRow) {
    return {
      ok: false,
      stage: "cache_insert",
      error: cacheErr?.message ?? "cache insert returned no row",
    };
  }

  // ---- Step 2: sign a render token referencing the cache id ----
  // why: the render page at /render/template/[token] verifies the token
  // signature, then loads schema by ai_schema_cache_id. Same pattern as
  // the AI Design path — the field is named ai_schema_cache_id but it
  // works for any cached schema (factory or AI-rewritten); the column
  // name is historical from when only AI Design used it.
  let token: string;
  try {
    token = await signRenderToken({
      // Synthetic template_id — the render page ignores this when
      // ai_schema_cache_id is set. We embed the schema's id for
      // diagnostic tracing in token-decode logs.
      template_id: `canvas:${input.schema.id}`,
      listing_id: input.listingId,
      format: input.format,
      ai_schema_cache_id: cacheRow.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, stage: "token_sign", error: msg };
  }

  // ---- Step 3: hand the URL to Chromium ----
  const baseUrl = await getPublicAppUrl();
  const url = `${baseUrl}/render/template/${encodeURIComponent(token)}`;

  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      url,
      width: input.schema.width,
      height: input.schema.height,
      log_label: input.logLabel ?? `canvas:${input.schema.id}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, stage: "chromium_render", error: msg };
  }

  // ---- Step 4: upload to Supabase Storage ----
  // Path shape: <prefix><schema-id>/<mls>/<timestamp>.png
  // The schema-id grouping makes it trivial to look at "every render of
  // this template" in the bucket browser.
  const renderedAt = Date.now();
  const storagePath = `${input.storagePrefix ?? ""}${input.schema.id}/${input.mlsNumber}/${renderedAt}.png`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pngBytes, {
      contentType: "image/png",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadErr) {
    return { ok: false, stage: "storage_upload", error: uploadErr.message };
  }

  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    ok: true,
    image_url: pub.publicUrl,
    image_path: storagePath,
    width: input.schema.width,
    height: input.schema.height,
  };
}
