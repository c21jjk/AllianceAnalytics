/**
 * lib/data/autoreel-db.ts — AutoReel (autoreelapp.com) project tracking
 * ---------------------------------------------------------------------------
 *
 * AutoReel is the third-party reel maker John's team uses for listings that
 * don't get a Larissa live video. It has NO public API (confirmed 2026-08-05
 * against learn.autoreelapp.com), so the integration is link-based:
 *
 *   - the launch prep sheet saves the project URL Larissa pastes back,
 *   - the video-import route records the finished render it pulled in.
 *
 * One tracked project per listing (unique mls_number). Everything goes
 * through the admin client — the table is RLS-locked to service role.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AutoReelProjectStatus = "project_created" | "video_imported";

export interface AutoReelProject {
  id: string;
  mls_number: string;
  source_mls: string | null;
  project_url: string | null;
  status: AutoReelProjectStatus;
  source_video_url: string | null;
  generated_post_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Hostnames a saved project link may live on. */
const PROJECT_HOSTS = ["www.autoreelapp.com", "autoreelapp.com", "app.autoreelapp.com"];

/**
 * True when the URL is a plausible AutoReel project page
 * (https://www.autoreelapp.com/listings/146884 or /project/146884).
 */
export function isValidAutoReelProjectUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (!PROJECT_HOSTS.includes(u.hostname)) return false;
    return /^\/(listings|project)\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * True when the URL is a direct AutoReel render — the public, unauthenticated
 * MP4 on their CDN (https://media.autoreelapp.com/renders/{id}/out.mp4).
 * This is the ONLY AutoReel URL our server can download: project/share links
 * bounce to their sign-in page for anyone without a browser session.
 */
export function isAutoReelRenderUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      u.hostname === "media.autoreelapp.com" &&
      /^\/renders\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.mp4$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/** True when the URL is an AutoReel share/project link (needs sign-in). */
export function isAutoReelShareLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return PROJECT_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export async function getAutoReelProject(
  mlsNumber: string,
): Promise<AutoReelProject | null> {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data, error } = await sbAny
    .from("autoreel_projects")
    .select(
      "id, mls_number, source_mls, project_url, status, source_video_url, generated_post_id, created_at, updated_at",
    )
    .eq("mls_number", mlsNumber)
    .maybeSingle();
  if (error) {
    console.error("[autoreel-db] project lookup failed:", error.message);
    return null;
  }
  return (data as AutoReelProject | null) ?? null;
}

/**
 * Create-or-update the tracked project for a listing. Fields left undefined
 * are not touched on update, so saving a project link never clobbers an
 * import record and vice versa.
 */
export async function upsertAutoReelProject(args: {
  mls_number: string;
  source_mls?: string | null;
  project_url?: string | null;
  status?: AutoReelProjectStatus;
  source_video_url?: string | null;
  generated_post_id?: string | null;
  created_by?: string | null;
}): Promise<AutoReelProject | null> {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;

  const existing = await getAutoReelProject(args.mls_number);
  if (existing) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (args.project_url !== undefined) patch.project_url = args.project_url;
    if (args.status !== undefined) patch.status = args.status;
    if (args.source_video_url !== undefined)
      patch.source_video_url = args.source_video_url;
    if (args.generated_post_id !== undefined)
      patch.generated_post_id = args.generated_post_id;
    const { data, error } = await sbAny
      .from("autoreel_projects")
      .update(patch)
      .eq("id", existing.id)
      .select(
        "id, mls_number, source_mls, project_url, status, source_video_url, generated_post_id, created_at, updated_at",
      )
      .maybeSingle();
    if (error) {
      console.error("[autoreel-db] project update failed:", error.message);
      return null;
    }
    return (data as AutoReelProject | null) ?? null;
  }

  const { data, error } = await sbAny
    .from("autoreel_projects")
    .insert({
      mls_number: args.mls_number,
      source_mls: args.source_mls ?? null,
      project_url: args.project_url ?? null,
      status: args.status ?? "project_created",
      source_video_url: args.source_video_url ?? null,
      generated_post_id: args.generated_post_id ?? null,
      created_by: args.created_by ?? null,
    })
    .select(
      "id, mls_number, source_mls, project_url, status, source_video_url, generated_post_id, created_at, updated_at",
    )
    .maybeSingle();
  if (error) {
    console.error("[autoreel-db] project insert failed:", error.message);
    return null;
  }
  return (data as AutoReelProject | null) ?? null;
}
