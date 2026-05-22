/**
 * POST /api/post-builder/render
 * Body: { template_id: string, listing: PostBuilderListing, hero_image_url: string }
 *
 * Renders a Post Builder template to a PNG via headless Chromium and uploads
 * to Supabase Storage. Returns the public image URL.
 *
 * Long-running by design — Chromium spin-up + render is 4-10s typical. Vercel
 * function timeout bumped to 60s in vercel.json (or maxDuration export below).
 *
 * Auth: requires a signed-in Alliance user (any role).
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { renderTemplate } from "@/lib/post-builder/render";
import { getTemplate } from "@/lib/post-builder/templates/registry";
import { renderDbTemplate } from "@/lib/template-builder";
import type { PostBuilderListing, PostCustomizations, PostFormat } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
// 300s ceiling for cold-start safety — the @sparticuz/chromium-min binary
// downloads from GitHub release (~50MB) on first invocation per function
// instance, which we measured at 90s+ on production. Once Path B (Supabase-
// hosted binary, same region) lands this can drop back to 60s. Fluid Compute
// on Pro allows up to 800s; 300 is a safety belt.
export const maxDuration = 300;
export const runtime = "nodejs";

interface RenderRequestBody {
  template_id?: string;
  listing?: PostBuilderListing;
  hero_image_url?: string;
  /** Multi-photo variants (v4/v5) send an ordered list. Single-photo variants can still send hero_image_url. */
  hero_image_urls?: string[];
  /** Path A — optional user customizations baked into this render. */
  customizations?: PostCustomizations;
  /** DB-template renders need the format + (optional) hosting agent overrides
   *  — the renderer pulls schema[format] and bakes hosting_agent into the
   *  bound-field resolution. Legacy primitive renders ignore both fields
   *  because the legacy template_id already encodes format + variant. */
  format?: PostFormat;
  hosting_agent_name?: string | null;
  oh_window?: string | null;
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

  if (!body.template_id || typeof body.template_id !== "string") {
    return NextResponse.json(
      { ok: false, error: "template_id required" },
      { status: 400 },
    );
  }
  if (!body.listing || typeof body.listing !== "object") {
    return NextResponse.json(
      { ok: false, error: "listing required" },
      { status: 400 },
    );
  }
  // Branch — DB-defined templates vs. legacy hand-coded primitives.
  //
  // The legacy registry keys are deterministic strings like
  // "just_listed_portrait_v2"; DB template ids are UUIDs. Try the legacy
  // lookup first (synchronous, in-memory) and fall through to the DB
  // renderer if the legacy registry doesn't know the id.
  const legacy = getTemplate(body.template_id);

  if (legacy) {
    // Legacy primitive path — hero photo URL is required.
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

  // DB-template path — `format` is required so the renderer can pick
  // the right schema entry. (Legacy primitive ids encode format in the
  // string, but DB templates are format-agnostic at the id level.)
  if (!body.format) {
    return NextResponse.json(
      { ok: false, error: "format required for DB template render" },
      { status: 400 },
    );
  }

  const dbResult = await renderDbTemplate({
    template_id: body.template_id,
    listing: body.listing,
    format: body.format,
    hosting_agent_name: body.hosting_agent_name ?? null,
    oh_window: body.oh_window ?? null,
  });

  if (!dbResult.ok) {
    return NextResponse.json(dbResult, { status: 500 });
  }
  return NextResponse.json(dbResult);
}
