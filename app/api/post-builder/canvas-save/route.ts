/**
 * POST /api/post-builder/canvas-save
 * ------------------------------------
 *
 * Uploads a PNG produced by the canvas editor (Path C) to Supabase Storage
 * and returns the public URL. Separate endpoint from /render because:
 *   • The render route invokes headless Chromium — irrelevant here, we
 *     already have the PNG bytes from the client's `canvas.toDataURL()`.
 *   • Different content-type (multipart/form-data here, JSON there).
 *   • Different access pattern — render is server-side render+upload,
 *     this is client-side render → server-side upload only.
 *
 * Body (multipart/form-data):
 *   • file: Blob (the rendered PNG)
 *   • template_id: string ("canvas_just_listed_v1_square")
 *   • mls_number:  string
 *
 * Response (200):
 *   { ok: true, image_url: string, image_path: string, saved_at: string }
 * Response (4xx/5xx):
 *   { ok: false, error: string }
 *
 * Auth: requires a signed-in Alliance user. Storage is bucketed by
 * (template_id, mls_number) so the path matches the V1 render naming
 * convention — listing detail pages can list all assets for an MLS number
 * regardless of which Path generated them.
 */

import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// why: 30s ceiling — the PNG payload is at most a few MB, upload is fast.
// Bumped above the Vercel default 10s to be safe against cold-start spikes.
export const maxDuration = 30;
export const runtime = "nodejs";

// Mirrors lib/post-builder/render.ts — same bucket so V1 + Path C assets
// live side-by-side. The listing detail page already enumerates this bucket.
const STORAGE_BUCKET = "post-builder-renders";

// why: cap the file size to a reasonable PNG ceiling. A 1080×1920 retina
// PNG (2160×3840) is typically 3-5 MB; 12 MB is a comfortable headroom that
// also blocks accidental gigantic uploads from a bug somewhere upstream.
const MAX_PNG_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // why: parse multipart/form-data. Next.js Web Request supports formData()
  // natively in Node runtime. Wrap in try/catch — malformed multipart is a
  // 400, not a 500.
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `invalid_form_data: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const templateId = form.get("template_id");
  const mlsNumber = form.get("mls_number");

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, error: "file required (multipart Blob)" },
      { status: 400 },
    );
  }
  if (typeof templateId !== "string" || templateId.length === 0) {
    return NextResponse.json(
      { ok: false, error: "template_id required" },
      { status: 400 },
    );
  }
  if (typeof mlsNumber !== "string" || mlsNumber.length === 0) {
    return NextResponse.json(
      { ok: false, error: "mls_number required" },
      { status: 400 },
    );
  }

  if (file.size > MAX_PNG_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `file too large (${file.size} bytes > ${MAX_PNG_BYTES} bytes max)`,
      },
      { status: 413 },
    );
  }
  if (file.type !== "image/png") {
    return NextResponse.json(
      {
        ok: false,
        error: `unexpected content-type (${file.type || "missing"}) — expected image/png`,
      },
      { status: 400 },
    );
  }

  // why: convert Blob → ArrayBuffer → Buffer. Supabase's storage SDK accepts
  // any of (Buffer, Uint8Array, Blob, File, ArrayBuffer), but Buffer is the
  // canonical Node form and pairs cleanly with @supabase/supabase-js.
  const arrayBuffer = await file.arrayBuffer();
  const pngBytes = Buffer.from(arrayBuffer);

  // why: mirror the V1 path structure — {template_id}/{mls_number}/{timestamp}.png.
  // Same bucket, same convention, so a future listing-asset enumerator
  // doesn't have to special-case Path C uploads.
  const savedAt = new Date().toISOString();
  const path = `${templateId}/${mlsNumber}/${Date.now()}.png`;

  const supabase = createAdminClient();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pngBytes, {
      contentType: "image/png",
      upsert: false,
      // why: 1-year browser cache. Storage URLs are immutable (we always
      // generate a new path on save), so caching aggressively is safe.
      cacheControl: "31536000",
    });

  if (uploadError) {
    return NextResponse.json(
      { ok: false, error: `upload_failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    image_url: pub.publicUrl,
    image_path: path,
    saved_at: savedAt,
  });
}
