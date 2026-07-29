/**
 * POST /api/post-builder/render
 *
 * Renders a Post Builder template to a PNG via headless Chromium and uploads
 * to Supabase Storage. Returns the public image URL.
 *
 * Two render paths, tried in order (legacy V1 HTML primitives were removed
 * 2026-05-30):
 *
 *   1. **DB-authored templates** (`renderDbTemplate`) — fires when
 *      `template_id` looks like a UUID. Used by the "Choose a template"
 *      picker (any approved library template).
 *   2. **Library/factory canvas templates** (`resolveTemplateForStatus` ??
 *      `findCanvasTemplate` + `renderCanvasSchema`) — the default
 *      Generate-button path. Requires `post_type` + `format`; resolves the
 *      approved library default, falling back to the hidden current-code
 *      factory schema when no approved design defines the format.
 *
 * Auth: requires a signed-in Alliance user (any role).
 *
 * Long-running: Chromium spin-up + render is 4-10s typical. maxDuration
 * 300s for cold-start safety on the chromium-min binary download.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { renderDbTemplate } from "@/lib/template-builder";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { resolveTemplateRowForStatus } from "@/lib/data/custom-templates-db";
import { renderCanvasSchema } from "@/lib/post-builder/canvas-editor/render-canvas-schema";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * 2026-07-29: validate a caller-supplied OH window value as a parseable
 * ISO timestamp string. Anything else (wrong type, empty, unparseable)
 * collapses to null so a buggy client degrades to the DB fallback below
 * instead of poisoning the render token with garbage.
 */
function normalizeIsoUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

/**
 * 2026-07-29: resolve the Open House window for a render.
 *
 * Precedence:
 *   1. Body-supplied open_house_start_utc / end_utc (validated ISO strings).
 *   2. Fallback for older clients that don't send a window: the property's
 *      NEXT open_houses row (end_at > now, earliest start_at) via the admin
 *      client. This is what keeps date/time layers rendering on OH posts
 *      created from clients that predate the window fields.
 *
 * Non-OH post types skip the lookup entirely and just echo the validated
 * body values (normally null). Lookup failures degrade to nulls; a missed
 * window must never fail the render; hide-if-empty handles blank layers.
 */
async function resolveOpenHouseWindow(
  body: RenderRequestBody,
): Promise<{ start: string | null; end: string | null }> {
  const start = normalizeIsoUtc(body.open_house_start_utc);
  const end = normalizeIsoUtc(body.open_house_end_utc);
  if (start || end) return { start, end };
  if (body.post_type !== "open_house") return { start: null, end: null };

  const propertyId = body.listing?.id;
  if (
    !propertyId ||
    typeof propertyId !== "string" ||
    !looksLikeUuid(propertyId)
  ) {
    return { start: null, end: null };
  }

  try {
    const supabase = createAdminClient();
    // end_at is nullable in the schema (see oh-publish-guard.ts); filter
    // NULLs out so a windowless row can't shadow a real upcoming session.
    const { data, error } = await supabase
      .from("open_houses")
      .select("start_at, end_at")
      .eq("property_id", propertyId)
      .not("end_at", "is", null)
      .gt("end_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return { start: null, end: null };
    return {
      start: typeof data.start_at === "string" ? data.start_at : null,
      end: typeof data.end_at === "string" ? data.end_at : null,
    };
  } catch (e) {
    console.warn(
      "[post-builder/render] open_houses window fallback failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { start: null, end: null };
  }
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

  // ---- Branch 1: DB-authored templates (UUID template_ids) ----
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
    // 2026-07-29: OH window threading. This branch never forwarded the
    // session window into renderDbTemplate (unlike multi-oh-generate,
    // rerender-carousel, and mobile QuickCreate), so single-listing OH
    // renders through library templates dropped their date/time layers
    // whenever properties.oh_start_at was NULL. Validated body values win;
    // older clients fall back to the property's next open_houses row.
    const ohWindow = await resolveOpenHouseWindow(body);
    const dbResult = await renderDbTemplate({
      template_id: body.template_id,
      listing: body.listing,
      format: body.format,
      hosting_agent_name: hosting?.name ?? body.hosting_agent_name ?? null,
      hosting_agent_phone: hosting?.phone ?? null,
      hosting_agent_photo_url: hosting?.photo_url ?? null,
      oh_window: body.oh_window ?? null,
      open_house_start_utc: ohWindow.start,
      open_house_end_utc: ohWindow.end,
      // 2026-07-29: photo threading: the Post Builder photo picker's
      // selection (index 0 = hero) rides the token so DB-template renders
      // stop ignoring the pick. renderDbTemplate caps + sanitizes.
      photo_urls: Array.isArray(body.hero_image_urls)
        ? body.hero_image_urls
        : body.hero_image_url
          ? [body.hero_image_url]
          : null,
    });
    if (!dbResult.ok) {
      return NextResponse.json(dbResult, { status: 500 });
    }
    return NextResponse.json(dbResult);
  }

  // ---- Branch 2: library/factory canvas template (default path) ----
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

  // why: prefer a user-authored DEFAULT custom template for this
  // (post_type, format, variant) tuple. When the team has saved a tuned
  // layout and marked it default, single-listing renders pick up THAT
  // schema with fresh listing data on each render. Falls back to the
  // factory placeholder when no default custom template exists or its
  // schema_json is null. (Variant pinned to "v1" — see the soft-
  // deprecation note above.)
  // 2026-07-29: resolve the library row WITH its UUID. The response's
  // template_id must be the template_definitions row id when the schema
  // came from a DB row: the inner schema.id can be a stale copy of a
  // different template (e.g. open_house_square_v1 inside a just_listed
  // row), and echoing it stamped wrong ids onto generated_posts.
  const resolvedLibrary = await resolveTemplateRowForStatus(
    body.post_type,
    body.format,
  );
  const schema =
    resolvedLibrary?.schema ??
    findCanvasTemplate(body.post_type, "v1", body.format);
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
  // 2026-07-29: same window resolution as the DB-template branch:
  // validated body values first, open_houses fallback for OH posts from
  // older clients. properties.oh_start_at is commonly NULL in prod, so
  // relying on the listing row alone silently dropped date/time layers.
  const factoryOhWindow = await resolveOpenHouseWindow(body);
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
    openHouseStartUtc: factoryOhWindow.start,
    openHouseEndUtc: factoryOhWindow.end,
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
    // 2026-07-29: when the schema came from a template_definitions row,
    // echo THAT row's UUID (the id the client stores as
    // renderResult.template_id and persists on generated_posts). schema.id
    // only survives for the in-code factory fallback, where no DB row
    // exists. Field name unchanged for client back-compat.
    template_id: resolvedLibrary?.template_row_id ?? schema.id,
    width: rendered.width,
    height: rendered.height,
    rendered_at: new Date().toISOString(),
    hero_image_source_url: heroSourceUrl,
  });
}
