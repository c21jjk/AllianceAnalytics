/**
 * POST /api/post-builder/preview-html
 *
 * Returns the rendered HTML for a Post Builder template *without* running
 * Chromium or uploading to Storage. Used by the client-side variant preview
 * thumbnails (an iframe rendered at full size and scaled down via CSS
 * transform). Cheap, fast, no cold start — just template string assembly.
 *
 * The template's <img> tags get the raw RETS URLs directly (no data URI
 * inlining) since iframes can load images normally via the browser.
 *
 * Auth: signed-in user only (same gate as /render).
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getTemplate } from "@/lib/post-builder/templates/registry";
import type { PostBuilderListing, PostCustomizations } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  template_id?: string;
  listing?: PostBuilderListing;
  hero_image_url?: string;
  hero_image_urls?: string[];
  /** Path A — apply user customizations to the preview HTML. */
  customizations?: PostCustomizations;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body.template_id || !body.listing) {
    return NextResponse.json(
      { ok: false, error: "template_id and listing required" },
      { status: 400 },
    );
  }

  const tpl = getTemplate(body.template_id);
  if (!tpl) {
    return NextResponse.json(
      { ok: false, error: `Unknown template: ${body.template_id}` },
      { status: 404 },
    );
  }

  const requestedUrls: string[] = (body.hero_image_urls?.length
    ? body.hero_image_urls
    : body.hero_image_url
      ? [body.hero_image_url]
      : []
  ).filter((u): u is string => typeof u === "string" && u.length > 0);

  // Pad to the template's photo_count by repeating the last URL if needed
  // (preview-only; render endpoint does the same so the visual matches).
  const wanted = tpl.meta.photo_count;
  const sourceUrls: string[] = [];
  for (let i = 0; i < wanted; i++) {
    if (requestedUrls.length === 0) {
      sourceUrls.push(PLACEHOLDER_IMG);
    } else {
      sourceUrls.push(requestedUrls[Math.min(i, requestedUrls.length - 1)]);
    }
  }

  const html = tpl.render({
    listing: body.listing,
    heroImageDataUri: sourceUrls[0],
    heroImageDataUris: sourceUrls,
    customizations: body.customizations,
  });

  // Cache aggressively — the same (template_id, listing, photo_urls)
  // combination always produces the same HTML. Browser cache keeps the
  // iframe instant on re-render. Vary by template_id+listing.id is implicit
  // via the URL & body — but POST responses don't normally cache. We send
  // a short s-maxage anyway in case a proxy decides to honor it.
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=300",
      // Allow embedding in our own iframes (same origin).
      "x-frame-options": "SAMEORIGIN",
    },
  });
}

// 1x1 grey PNG. Used when the listing has no hero photo to show — the
// template still renders, just without imagery. Better than a broken img.
const PLACEHOLDER_IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
