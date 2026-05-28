/**
 * POST /api/post-builder/render
 *
 * Renders a Post Builder template to a PNG via headless Chromium and uploads
 * to Supabase Storage. Returns the public image URL.
 *
 * Three render paths, tried in order:
 *
 *   1. **Legacy V1 HTML primitives** (`getTemplate`) — always returns null
 *      after the 2026-05-24 V1 purge but kept in the dispatcher as a
 *      defensive first check in case a stale client passes a legacy id.
 *   2. **DB-authored templates** (`renderDbTemplate`) — fires when
 *      `template_id` looks like a UUID. Used by the admin-authored
 *      templates flow.
 *   3. **Factory canvas templates** (`findCanvasTemplate` +
 *      `renderCanvasSchema`) — the default Generate-button path post-
 *      2026-05-24. Requires `post_type` + `format` in the body; ignores
 *      `template_id` (which now lives only for legacy / DB paths).
 *
 * Auth: requires a signed-in Alliance user (any role).
 *
 * Long-running: Chromium spin-up + render is 4-10s typical. maxDuration
 * 300s for cold-start safety on the chromium-min binary download.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { renderTemplate } from "@/lib/post-builder/render";
import { getTemplate } from "@/lib/post-builder/templates/registry";
import { renderDbTemplate } from "@/lib/template-builder";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { renderCanvasSchema } from "@/lib/post-builder/canvas-editor/render-canvas-schema";
import {
  getAgentAttribution,
  type AgentAttribution,
} from "@/lib/data/alliance-dash-agents";
import type {
  PostBuilderListing,
  PostCustomizations,
  PostFormat,
  PostType,
  PostVariant,
} from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

interface RenderRequestBody {
  /** Legacy V1 / DB-template id. Optional after 2026-05-24 — the
   *  factory-canvas branch uses post_type + format instead. */
  template_id?: string;
  listing?: PostBuilderListing;
  hero_image_url?: string;
  hero_image_urls?: string[];
  customizations?: PostCustomizations;
  format?: PostFormat;
  /** 2026-05-24 — added so the factory-canvas branch can look up the
   *  right placeholder/template via findCanvasTemplate(post_type, "v1",
   *  format). Required for that branch; ignored on legacy / DB paths. */
  post_type?: PostType;
  /** Variant axis is soft-deprecated to "v1" only. Accepted for
   *  back-compat with stale clients; ignored at runtime. */
  variant?: PostVariant;
  hosting_agent_name?: string | null;
  oh_window?: string | null;
  /**
   * Optional OH session window override. Threaded through to the
   * canvas render token so the bound-field resolver can format the
   * date/time even when properties.oh_start_at / oh_end_at are NULL.
   * Single-listing OH today rarely needs this (the columns are usually
   * populated for the listing the user is acting on), but accepting
   * the fields keeps the contract consistent with the multi-OH route
   * and gives a future caller a clean hook.
   */
  open_house_start_utc?: string | null;
  open_house_end_utc?: string | null;
}

/** Loose UUID check — DB template ids are v4 UUIDs (8-4-4-4-12 hex). */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

/**
 * Resolve hosting-agent attribution for a single-listing Open House render.
 * Used by the DB-template and factory-canvas branches below.
 *
 * Decision tree:
 *   • post_type != "open_house"     → return null (skip the lookup entirely)
 *   • explicit body.hosting_agent_name set → use that
 *   • otherwise → use listing.agent_name (single-listing OH where the host
 *     IS the listing agent — the common case)
 *   • no usable name on either path → return null
 *
 * Failures (missing Alliance Dash creds, network blip, etc.) yield a
 * partial attribution — the bound-field resolvers fall back to the
 * listing-agent fields, so a missed phone or photo never breaks the
 * render. This mirrors the multi-OH route's behavior.
 */
async function maybeResolveHostingAttribution(
  postType: PostType | undefined,
  listing: PostBuilderListing,
  explicitName: string | null | undefined,
): Promise<AgentAttribution | null> {
  if (postType !== "open_house") return null;
  const name = (explicitName ?? listing.agent_name ?? "").trim();
  if (!name) return null;
  return getAgentAttribution(name);
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RenderRequestBody;
  try {
    body = (await request.json()) as RenderRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body.listing || typeof body.listing !== "object") {
    return NextResponse.json(
      { ok: false, error: "listing required" },
      { status: 400 },
    );
  }

  // ---- Branch 1: legacy V1 HTML primitives ----
  // why: getTemplate returns null for everything after the 2026-05-24
  // V1 purge, but the lookup is cheap and lets the rare stale client
  // get a clean 404-style error rather than silently falling through.
  if (body.template_id && typeof body.template_id === "string") {
    const legacy = getTemplate(body.template_id);
    if (legacy) {
      const hasArray =
        Array.isArray(body.hero_image_urls) && body.hero_image_urls.length > 0;
      const hasSingle =
        typeof body.hero_image_url === "string" && body.hero_image_url.length > 0;
      if (!hasArray && !hasSingle) {
        return NextResponse.json(
          { ok: false, error: "hero_image_url or hero_image_urls required" },
          { status: 400 },
        );
      }
      const result = await renderTemplate({
        template_id: body.template_id,
        listing: body.listing,
        hero_image_url: body.hero_image_url,
        hero_image_urls: body.hero_image_urls,
        customizations: body.customizations,
      });
      if (!result.ok) {
        return NextResponse.json(result, { status: 500 });
      }
      return NextResponse.json(result);
    }
  }

  // ---- Branch 2: DB-authored templates (UUID template_ids) ----
  // why: DB template ids are v4 UUIDs. Only invoke renderDbTemplate when
  // the template_id matches that pattern, otherwise we'd waste a Supabase
  // lookup on every factory-canvas render.
  if (
    body.template_id &&
    typeof body.template_id === "string" &&
    looksLikeUuid(body.template_id)
  ) {
    if (!body.format) {
      return NextResponse.json(
        { ok: false, error: "format required for DB template render" },
        { status: 400 },
      );
    }
    // Resolve hosting-agent attribution for OH renders. On non-OH posts
    // this is a no-op (returns null) so we don't pay the Alliance Dash
    // round-trip on every just-listed render.
    const hosting = await maybeResolveHostingAttribution(
      body.post_type,
      body.listing,
      body.hosting_agent_name,
    );
    const dbResult = await renderDbTemplate({
      template_id: body.template_id,
      listing: body.listing,
      format: body.format,
      hosting_agent_name: hosting?.name ?? body.hosting_agent_name ?? null,
      hosting_agent_phone: hosting?.phone ?? null,
      hosting_agent_photo_url: hosting?.photo_url ?? null,
      oh_window: body.oh_window ?? null,
    });
    if (!dbResult.ok) {
      return NextResponse.json(dbResult, { status: 500 });
    }
    return NextResponse.json(dbResult);
  }

  // ---- Branch 3: factory canvas template (default post-2026-05-24) ----
  // why: every non-UUID template_id falls through here. We resolve the
  // schema via findCanvasTemplate(post_type, "v1", format) — variant is
  // pinned to "v1" because the variant axis was soft-deprecated.
  if (!body.post_type) {
    return NextResponse.json(
      { ok: false, error: "post_type required for canvas template render" },
      { status: 400 },
    );
  }
  if (!body.format) {
    return NextResponse.json(
      { ok: false, error: "format required for canvas template render" },
      { status: 400 },
    );
  }
  if (!body.listing.id || typeof body.listing.id !== "string") {
    return NextResponse.json(
      { ok: false, error: "listing.id (UUID) required for canvas template render" },
      { status: 400 },
    );
  }

  const schema = findCanvasTemplate(body.post_type, "v1", body.format);
  if (!schema) {
    return NextResponse.json(
      {
        ok: false,
        error: `no canvas template found for ${body.post_type}/${body.format}`,
      },
      { status: 404 },
    );
  }

  // Same OH attribution path as the DB-template branch above. On non-OH
  // post types this returns null and the render runs unchanged.
  const factoryHosting = await maybeResolveHostingAttribution(
    body.post_type,
    body.listing,
    body.hosting_agent_name,
  );
  const rendered = await renderCanvasSchema({
    schema,
    listingId: body.listing.id,
    mlsNumber: body.listing.mls_number,
    format: body.format,
    logLabel: `factory:${schema.id}`,
    hostingAgentName:
      factoryHosting?.name ?? body.hosting_agent_name ?? null,
    hostingAgentPhone: factoryHosting?.phone ?? null,
    hostingAgentPhotoUrl: factoryHosting?.photo_url ?? null,
    // Pass through if the client provides them; today single-listing
    // OH usually relies on the listing's stored oh_start_at / oh_end_at,
    // but the contract mirror with the multi-OH route is intentional.
    openHouseStartUtc: body.open_house_start_utc ?? null,
    openHouseEndUtc: body.open_house_end_utc ?? null,
  });

  if (!rendered.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `${rendered.stage} failed: ${rendered.error}`,
      },
      { status: 500 },
    );
  }

  // why: shape the response to match the legacy V1 + DB-template result
  // contracts so existing PostBuilderClient code paths (handleRender,
  // setRenderResult) don't need to special-case the canvas path.
  // hero_image_source_url is filled with the first hero_image_url the
  // client sent (when present) so the saved post row can store the
  // photo provenance.
  const heroSourceUrl =
    (Array.isArray(body.hero_image_urls) && body.hero_image_urls[0]) ||
    body.hero_image_url ||
    body.listing.hero_image_url ||
    "";
  return NextResponse.json({
    ok: true,
    image_url: rendered.image_url,
    image_path: rendered.image_path,
    template_id: schema.id,
    width: rendered.width,
    height: rendered.height,
    rendered_at: new Date().toISOString(),
    hero_image_source_url: heroSourceUrl,
  });
}
