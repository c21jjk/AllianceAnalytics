/**
 * Headless render landing page for DB-defined templates.
 *
 * This page exists solely to be loaded by the server-side render pipeline:
 *   1. `lib/template-builder/renderer.ts` signs a short-lived HMAC token
 *      carrying { template_id, listing_id, format }.
 *   2. The renderer launches headless Chromium and navigates to
 *      /render/template/<token>.
 *   3. This page verifies the token, server-fetches the template + listing,
 *      and renders a minimal client component that mounts a Fabric canvas
 *      at the exact format dimensions.
 *   4. The client component sets `data-render-status="ready"` on the
 *      <canvas> element once Fabric finishes drawing.
 *   5. Chromium waits for that attribute, then screenshots the page.
 *
 * The page IS NOT meant to be navigated to by humans — there's no chrome,
 * no navigation, no error UI beyond a bare message when the token is
 * invalid. The route is whitelisted in `lib/supabase/middleware.ts` so
 * Chromium (which has no session cookie) can reach it without bouncing
 * to /login. The token IS the auth.
 */

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
import { verifyRenderToken } from "@/lib/template-builder/render-token";
import { getTemplateById } from "@/lib/template-builder";
import type { PostBuilderListing, PostFormat } from "@/lib/post-builder/types";
import type { CanvasTemplateSchema } from "@/lib/post-builder/canvas-editor/types";
import HeadlessRenderClient from "./HeadlessRenderClient";

// Force dynamic — the token is part of the URL and changes per render.
export const dynamic = "force-dynamic";
// No client-side caching; every render is a one-shot.
export const revalidate = 0;

export const metadata = {
  title: "Render — Alliance Social",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/** Canvas dimensions per format. Mirrors lib/post-builder/canvas-editor/types.ts. */
const FORMAT_DIMS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  story_9x16: { width: 1080, height: 1920 },
};

export default async function HeadlessRenderPage({ params }: PageProps) {
  const { token } = await params;

  // Verify the token. Any failure (malformed, bad signature, expired)
  // collapses to 404 — we don't surface the reason because the caller is
  // always the render pipeline; a real user shouldn't ever see this URL.
  let payload;
  try {
    payload = await verifyRenderToken(token);
  } catch {
    notFound();
  }

  // Phase 2 AI Design: when the token carries an ai_schema_cache_id, the
  // schema lives in `render_schema_cache` instead of in `template_definitions`.
  // Resolve from cache first; fall through to the DB-template path otherwise.
  let schema: CanvasTemplateSchema | null | undefined;
  if (payload.ai_schema_cache_id) {
    schema = await fetchAiSchemaFromCache(payload.ai_schema_cache_id);
    if (!schema) {
      return (
        <pre style={{ padding: 16, color: "#900" }}>
          AI design schema {payload.ai_schema_cache_id} expired or not found.
        </pre>
      );
    }
  } else {
    const template = await getTemplateById(payload.template_id);
    if (!template) notFound();
    schema = template.schema[payload.format] as
      | CanvasTemplateSchema
      | undefined
      | null;
    if (!schema || typeof schema !== "object") {
      return (
        <pre style={{ padding: 16, color: "#900" }}>
          Template {payload.template_id} has no schema for format {payload.format}
        </pre>
      );
    }
  }

  const listing = await fetchListingById(payload.listing_id);
  if (!listing) notFound();

  // Map V1 PostBuilderListing → MLSListingPayload (the canvas-editor's
  // internal listing shape). The headless renderer consumes this shape
  // exactly like the editor does, so identical bound-field resolution.
  const mlsPayload = mapListingToPayload(listing);

  // Inject hosting_agent / oh_window overrides from the token payload.
  // These come from the Multi-OH wizard's per-property context and only
  // apply on Open House renders.
  //
  // Legacy behavior (kept): when the token carries a hosting agent name,
  // overwrite the listing-agent `agentName` so any template binding the
  // older `agent_name` field still surfaces the host. New behavior: also
  // build the structured `hosting_agent` field so the new
  // `hosting_agent_*` bound fields in fabric-factory.ts can read name +
  // phone + photo as a unit. Both shapes coexist; templates can bind to
  // either and the corner-block-aware ones use the new fields.
  if (payload.hosting_agent_name) {
    mlsPayload.agentName = payload.hosting_agent_name;
    mlsPayload.hosting_agent = {
      name: payload.hosting_agent_name,
      phone: payload.hosting_agent_phone ?? null,
      photo_url: payload.hosting_agent_photo_url ?? null,
    };
  }

  const dims = FORMAT_DIMS[payload.format];

  return (
    <>
      {/* Zero-chrome page. The body is set to overflow:hidden so the
          canvas is the only thing in the screenshot frame. */}
      <style
        // eslint-disable-next-line react/no-unknown-property
        dangerouslySetInnerHTML={{
          __html: `
            html, body {
              margin: 0;
              padding: 0;
              background: #fff;
              overflow: hidden;
            }
            body > *:not(.headless-render-root) { display: none !important; }
          `,
        }}
      />
      <HeadlessRenderClient
        schema={schema}
        listing={mlsPayload}
        width={dims.width}
        height={dims.height}
      />
    </>
  );
}

/**
 * Fetch a single listing by its properties.id (UUID). Returns the same
 * PostBuilderListing shape the picker uses so downstream code is identical
 * to the legacy render path.
 *
 * Inlined here (rather than added to lib/post-builder/listings.ts) because
 * this is the only consumer and the field set is straightforward. If a
 * second caller appears, lift this into the listings module.
 */
/**
 * Phase 2 AI Design — load a freshly-generated CanvasTemplateSchema from
 * the short-lived cache table. Returns null when the cache_id is unknown
 * or the row has expired.
 *
 * Lazy-cleans expired rows on every read so the table never grows past
 * its working set without needing pg_cron. Failure to delete is non-fatal
 * (logged silently) — the row will sit until the next read tries again.
 *
 * Token + signature gate access — no extra RLS check needed; possession of
 * a valid signed token containing this cache_id proves the server-side
 * design route just minted it.
 */
async function fetchAiSchemaFromCache(
  cacheId: string,
): Promise<CanvasTemplateSchema | null> {
  const supabase = createAdminClient();

  // why: read first so a slow DELETE doesn't gate the render. The
  // expires_at filter excludes rows that have aged out — those are
  // treated identically to "row not found" from the caller's POV.
  const { data, error } = await supabase
    .from("render_schema_cache")
    .select("schema, expires_at")
    .eq("id", cacheId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data || !data.schema || typeof data.schema !== "object") {
    return null;
  }

  // Best-effort cleanup of any expired rows. Non-blocking on the render —
  // if this DELETE fails (transient connection blip, etc.) the next render
  // tries again. Worst case the table accumulates ~minutes-worth of rows.
  void supabase
    .from("render_schema_cache")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .then(({ error: delError }) => {
      if (delError) {
        console.warn(
          "[render-page] render_schema_cache cleanup failed:",
          delError.message,
        );
      }
    });

  return data.schema as unknown as CanvasTemplateSchema;
}

async function fetchListingById(
  id: string,
): Promise<PostBuilderListing | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date, close_date, unit_number",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  // why: PostBuilderListing has more fields than we strictly need here; we
  // cast through unknown because the canvas-editor binding code only
  // touches the fields above (hero_image_url, address, list_price, etc.).
  // The eslint-disable mirrors what the rest of the codebase does at this
  // shape-narrowing boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any as PostBuilderListing;
}
