/**
 * Template Builder — render pipeline (Phase 2C).
 *
 * Bridges DB-defined templates (rows in `template_definitions`) into the
 * same render-to-PNG-on-Supabase-Storage contract the legacy hand-coded
 * primitives use. From the API route's POV, both render paths look
 * identical; the differentiator is just which template_id was picked.
 *
 * Flow:
 *   1. Resolve the template + verify the requested format is defined.
 *   2. Sign a short-lived HMAC token carrying { template_id, listing_id,
 *      format, hosting_agent_name? }.
 *   3. Compute the absolute URL for /render/template/<token>.
 *   4. Hand the URL to `screenshotHtml()` in URL mode — headless Chromium
 *      navigates, the page mounts a Fabric canvas client-side, and the
 *      screenshot snaps once the canvas signals ready.
 *   5. Upload the PNG to the `post-builder-renders` bucket (same bucket
 *      legacy renders use) and return image_url + image_path.
 *
 * The return shape matches `RenderTemplateResult` from lib/post-builder/
 * render.ts intentionally — the API route can branch on which renderer to
 * call without translating shapes.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicAppUrl } from "@/lib/app-url";
import { screenshotHtml } from "@/lib/post-builder/chromium";
import { getTemplateById } from "./registry";
import { signRenderToken } from "./render-token";
import type {
  PostFormat,
  PostBuilderListing,
} from "@/lib/post-builder/types";

const STORAGE_BUCKET = "post-builder-renders";

const FORMAT_DIMS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  // why: portrait_4x5 retained during the 2026-05-24 transition so existing
  // saved posts continue to render. Removed once zero live references remain.
  story_9x16: { width: 1080, height: 1920 },
};

export interface RenderResult {
  ok: true;
  image_url: string;
  image_path: string;
  template_id: string;
  width: number;
  height: number;
  rendered_at: string;
}

export interface RenderError {
  ok: false;
  error: string;
}

export type RenderOutcome = RenderResult | RenderError;

export interface RenderInput {
  template_id: string;
  /** A listing already loaded by the caller. We need .id for the token
   *  payload + .mls_number for the storage path key. */
  listing: PostBuilderListing;
  format: PostFormat;
  /** Hosting agent override for Open House posts. Forwarded to the
   *  render-page route via the token payload. */
  hosting_agent_name?: string | null;
  /**
   * Pre-formatted hosting-agent phone — resolved upstream against the
   * Alliance Dash roster and formatted via `formatPhone`. Forwarded to
   * the render-page route via the token payload so the canvas
   * MLSListingPayload's `hosting_agent.phone` field is populated.
   */
  hosting_agent_phone?: string | null;
  /**
   * Hosting-agent headshot URL — resolved upstream via
   * `fetchAgentHeadshotUrl`. Forwarded to the render-page route via the
   * token payload so the canvas MLSListingPayload's `hosting_agent.photo_url`
   * field is populated.
   */
  hosting_agent_photo_url?: string | null;
  /** Pre-formatted OH window label. Forwarded to the render-page route. */
  oh_window?: string | null;
}

/**
 * Render a DB-defined template. Called by /api/post-builder/render when
 * the legacy registry lookup returns null (= template_id is a UUID, not
 * a legacy variant identifier).
 */
export async function renderDbTemplate(
  input: RenderInput,
): Promise<RenderOutcome> {
  const template = await getTemplateById(input.template_id);
  if (!template) {
    return { ok: false, error: `Unknown template: ${input.template_id}` };
  }

  const dims = FORMAT_DIMS[input.format];
  if (!dims) {
    return { ok: false, error: `Unsupported format: ${input.format}` };
  }

  const schema = template.schema[input.format];
  if (!schema) {
    return {
      ok: false,
      error: `Template "${template.name}" has no schema defined for ${input.format}`,
    };
  }

  if (!input.listing.id) {
    return { ok: false, error: "listing missing id (uuid required for render)" };
  }

  // Sign the token. Short TTL — render is typically <30s; 5 min is
  // comfortable headroom for cold Chromium starts.
  let token: string;
  try {
    token = await signRenderToken({
      template_id: input.template_id,
      listing_id: input.listing.id,
      format: input.format,
      hosting_agent_name: input.hosting_agent_name ?? null,
      hosting_agent_phone: input.hosting_agent_phone ?? null,
      hosting_agent_photo_url: input.hosting_agent_photo_url ?? null,
      oh_window: input.oh_window ?? null,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Failed to sign render token: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const url = `${await getPublicAppUrl()}/render/template/${encodeURIComponent(token)}`;

  // Screenshot the rendered canvas. URL mode polls for
  // data-render-status="ready" on the canvas element before snapping.
  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      url,
      width: dims.width,
      height: dims.height,
      log_label: `db-template:${input.template_id.slice(0, 8)}`,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Render failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Upload to Storage — same bucket + key shape as the legacy renderer
  // so downstream code (post creation, owner-story lookups) doesn't have
  // to branch.
  const supabase = createAdminClient();
  const renderedAt = new Date().toISOString();
  const path = `${input.template_id}/${input.listing.mls_number}/${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pngBytes, {
      contentType: "image/png",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return {
    ok: true,
    image_url: pub.publicUrl,
    image_path: path,
    template_id: input.template_id,
    width: dims.width,
    height: dims.height,
    rendered_at: renderedAt,
  };
}
