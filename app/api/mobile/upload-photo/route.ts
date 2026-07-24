import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mobile quick-create — camera-roll photo upload.
 *
 * POST /api/mobile/upload-photo  (multipart/form-data: mls, source_mls?, file)
 *
 * Stores the photo in the same public `property-photos` bucket the MLS
 * sync uses and registers it as a `listing_photos` row with
 * source="storage", so it shows up in every photo picker (mobile AND
 * desktop Post Builder) alongside the Paragon-imported set.
 *
 * Sequence strategy: uploads start at 1001. The mls-rets-sync edge
 * function upserts on (mls_number, sequence) for sequences 1..pictureCount
 * — Paragon listings never approach 1000 photos, so upload rows can never
 * be clobbered by a feed sync, and sorting by sequence keeps MLS photos
 * first with uploads appended after.
 *
 * The client converts HEIC → JPEG and downscales before uploading (see
 * QuickCreateClient), so files arriving here are web-ready JPEG/PNG.
 */

const PHOTO_BUCKET = "property-photos";
const UPLOAD_SEQUENCE_BASE = 1000;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB — post-downscale this is generous

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const mls = String(form.get("mls") ?? "").trim();
  const sourceMls = String(form.get("source_mls") ?? "").trim() || null;
  const file = form.get("file");
  if (!mls || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "mls and file are required" },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "file is empty or larger than 12MB" },
      { status: 400 },
    );
  }

  const contentType = file.type || "image/jpeg";
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return NextResponse.json(
      {
        ok: false,
        error: `unsupported image type ${contentType} — upload JPEG or PNG`,
      },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Next upload sequence for this listing (1001, 1002, …).
  const { data: existing, error: readError } = await supabase
    .from("listing_photos")
    .select("sequence")
    .eq("mls_number", mls)
    .gt("sequence", UPLOAD_SEQUENCE_BASE)
    .order("sequence", { ascending: false })
    .limit(1);
  if (readError) {
    console.error("[mobile/upload-photo] sequence read failed:", readError.message);
    return NextResponse.json(
      { ok: false, error: "failed to read existing photos" },
      { status: 500 },
    );
  }
  const sequence =
    existing && existing.length > 0
      ? existing[0].sequence + 1
      : UPLOAD_SEQUENCE_BASE + 1;

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `uploads/${mls}/${Date.now()}-${sequence}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, {
      contentType,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    console.error("[mobile/upload-photo] upload failed:", uploadError.message);
    return NextResponse.json(
      { ok: false, error: `upload failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "upload succeeded but no public URL returned" },
      { status: 500 },
    );
  }

  const { error: insertError } = await supabase.from("listing_photos").insert({
    mls_number: mls,
    source_mls: sourceMls,
    sequence,
    url,
    source: "storage",
    storage_path: path,
    caption: "Uploaded from mobile",
  });
  if (insertError) {
    // Roll back the orphaned storage object best-effort.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined);
    console.error("[mobile/upload-photo] row insert failed:", insertError.message);
    return NextResponse.json(
      { ok: false, error: "failed to register photo" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    photo: { url, sequence, source: "storage", caption: "Uploaded from mobile" },
  });
}
