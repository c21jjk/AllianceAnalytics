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
import {
  resolveAgentHeadshotUrl,
  resolveBrandLogoUrl,
} from "@/lib/data/brand-asset-resolver";
import { EXCELLENCE_PRICE_THRESHOLD } from "@/lib/post-builder/excellence-collection";
import {
  applyOverridesToSchema,
  parseCarouselLayoutOverrides,
} from "@/lib/post-builder/canvas-editor/layout-delta";
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

/**
 * True when the schema has any image layer bound to `agent_photo` — i.e. the
 * template expects a listing-agent headshot. Drives the brand_assets lookup +
 * flag-for-review. Defensive against malformed schemas.
 */
function schemaBindsAgentPhoto(
  schema: CanvasTemplateSchema | null | undefined,
): boolean {
  if (!schema || !Array.isArray(schema.layers)) return false;
  return schema.layers.some(
    (layer) =>
      layer.kind === "image" && layer.boundField === "agent_photo",
  );
}

/**
 * True when the schema has any image layer bound to a brokerage/office logo —
 * i.e. the template expects the C21 Alliance / Excellence Collection lockup.
 * Drives the brand_assets logo lookup so re-uploaded logos flow at render
 * without a code edit. Defensive against malformed schemas.
 */
function schemaBindsBrandLogo(
  schema: CanvasTemplateSchema | null | undefined,
): boolean {
  if (!schema || !Array.isArray(schema.layers)) return false;
  return schema.layers.some(
    (layer) =>
      layer.kind === "image" &&
      (layer.boundField === "office_logo" ||
        layer.boundField === "brokerage_logo"),
  );
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

  // Carousel re-render (2026-05-28) — when the token carries a gp_id, merge
  // that post's `carousel_layout_overrides` onto the schema BEFORE the canvas
  // mounts. This is how a "Apply layout to all slides" push reaches the
  // re-rendered PNG: the same overrides bag the editor applies on slide-open
  // (PostBuilderClient.handleSlideEditClick) is applied here for the headless
  // render. Layout-only deltas — per-slide listing/host data still resolves
  // from the bound fields below, so each slide stays distinct. Empty / absent
  // overrides → no-op pass-through.
  if (payload.gp_id) {
    const overrides = await fetchCarouselLayoutOverrides(payload.gp_id);
    if (overrides) {
      schema = applyOverridesToSchema(schema, overrides);
    }
  }

  const listing = await fetchListingById(payload.listing_id);
  if (!listing) notFound();

  // Map V1 PostBuilderListing → MLSListingPayload (the canvas-editor's
  // internal listing shape). The headless renderer consumes this shape
  // exactly like the editor does, so identical bound-field resolution.
  const mlsPayload = mapListingToPayload(listing);

  // 2026-05-30 — Agent-photo placeholder resolution. When a template binds
  // `agent_photo`, fill the LISTING agent's headshot from the Studio "Agents"
  // library (brand_assets) by name match, so the placeholder populates per
  // listing. Skipped when a hosting agent overrides below (OH renders set
  // their own photo via hosting_agent_photo). Flag-for-review: if the schema
  // binds agent_photo but no headshot matches, we log a clear warning (visible
  // in Vercel runtime logs) and leave the frame empty rather than failing the
  // render.
  if (!payload.hosting_agent_name && schemaBindsAgentPhoto(schema)) {
    if (!mlsPayload.agentPhotoUrl) {
      const headshot = await resolveAgentHeadshotUrl(mlsPayload.agentName);
      if (headshot) {
        mlsPayload.agentPhotoUrl = headshot;
      } else {
        console.warn(
          `[render][FLAG-FOR-REVIEW] agent_photo placeholder is unfilled — no active brand_assets headshot matched agent "${
            mlsPayload.agentName ?? "(unknown)"
          }" for listing ${payload.listing_id}. Add the agent's photo to the Agents library.`,
        );
      }
    }
  }

  // 2026-05-30 — Brand-logo placeholder resolution. When a template binds
  // office_logo / brokerage_logo, resolve the canonical logo from the
  // brand_assets library (kind='logo') by its price-tier label so a
  // re-uploaded/re-cropped logo flows automatically without editing
  // brand-logos.ts. Tier rule mirrors fabric-factory: Excellence Collection
  // wordmark at-or-above $949k, standard C21 Alliance lockup below.
  // Flag-for-review: if the schema binds a logo but no active row carries the
  // canonical label, we log a warning and fall through to the frozen
  // brand-logos.ts constant (resolveImageField does that when the payload URL
  // is null) so the render never fails.
  if (schemaBindsBrandLogo(schema)) {
    const isExcellence =
      (mlsPayload.priceList ?? 0) >= EXCELLENCE_PRICE_THRESHOLD;
    const canonicalLabel = isExcellence
      ? "Excellence Collection - 2"
      : "C21 ALLIANCE White";
    const logoUrl = await resolveBrandLogoUrl(canonicalLabel);
    if (logoUrl) {
      mlsPayload.brokerageLogoUrl = logoUrl;
      // office_logo prefers a real per-office override; only fill from the
      // library when the listing didn't carry its own office logo.
      if (!mlsPayload.officeLogoUrl) {
        mlsPayload.officeLogoUrl = logoUrl;
      }
    } else {
      console.warn(
        `[render][FLAG-FOR-REVIEW] brand logo placeholder unresolved — no active brand_assets logo labeled "${canonicalLabel}" for listing ${payload.listing_id}. Falling back to the frozen brand-logos.ts constant.`,
      );
    }
  }

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

  // Override the listing's stored OH window with the multi-OH wizard's
  // session selection. Properties.oh_start_at is not 100% populated in
  // production data; the wizard captured the exact session the user
  // picked, so we prefer that over whatever stale column value exists.
  // Truthy check (not just `in payload`) so an explicit null override
  // doesn't blow away a non-null value the listing already had.
  if (payload.open_house_start_utc) {
    mlsPayload.openHouseStartUtc = payload.open_house_start_utc;
  }
  if (payload.open_house_end_utc) {
    mlsPayload.openHouseEndUtc = payload.open_house_end_utc;
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

/**
 * Carousel re-render (2026-05-28) — load the `carousel_layout_overrides`
 * JSONB for a generated_posts row and coerce it to a safe overrides map.
 * Returns null when the row is missing, the column is null, or the JSON
 * parses to an empty map (so the caller can skip the schema walk entirely).
 *
 * No ownership check here — the signed token already gates access (the
 * server-side re-render route minted it with this gp_id), same trust model
 * as the ai_schema_cache_id path above.
 */
async function fetchCarouselLayoutOverrides(
  gpId: string,
): Promise<ReturnType<typeof parseCarouselLayoutOverrides> | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("generated_posts")
    .select("carousel_layout_overrides")
    .eq("id", gpId)
    .maybeSingle();
  if (error || !data) return null;
  const overrides = parseCarouselLayoutOverrides(data.carousel_layout_overrides);
  return Object.keys(overrides).length > 0 ? overrides : null;
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
