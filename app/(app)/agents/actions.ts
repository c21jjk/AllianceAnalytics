"use server";

/**
 * Write side of the Agents roster page.
 *
 * 2026-08-14 (John): "if an Agent doesnt have a head shot or phone # in the
 * database, I need us (me, Cheryl and larissa) to be able to add it somehow
 * and have it save in database."
 *
 * requireUser, NOT requireAdmin. John asked for this to be visible to all
 * three of them, and Cheryl and Larissa are the ones who actually notice a
 * missing headshot while building a post. Every action re-guards on its own
 * rather than trusting the page or the layout, which is the house convention
 * (see app/(app)/settings/buildings/actions.ts).
 *
 * TYPES NOTE: `mls_agents.phone_override` is absent from the generated
 * Database type and `headshot_label_override` is missing from its Insert
 * shape, and `brand_assets.source` is new as of migration
 * 20260814_001_brand_assets_source. Everything here goes through the untyped
 * escape hatch until types are regenerated.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;
function untyped(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Public URL of a freshly uploaded headshot, so the row can show it. */
  public_url?: string;
}

const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

/**
 * Revalidate everywhere an agent's photo or phone is rendered.
 *
 * why the post-builder paths: a headshot added here has to show up on the
 * next open house slide without a redeploy, and those pages are cached.
 */
function revalidateAgentSurfaces(): void {
  revalidatePath("/agents");
  revalidatePath("/post-builder");
  revalidatePath("/post-builder/multi-oh");
  revalidatePath("/");
}

/** Digits-only length check. Formatting is left alone; formatPhone owns that. */
function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Set or clear `mls_agents.phone_override`.
 *
 * Pass an empty string to clear it and fall back to whatever the MLS feed
 * and Alliance Dash supply. We store the string as typed rather than
 * normalizing: `fetchAgentPhone` runs the result through `formatPhone`
 * downstream, and re-formatting here would fight it.
 */
export async function setAgentPhoneOverrideAction(
  agentId: string,
  value: string,
): Promise<ActionResult> {
  try {
    await requireUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "not signed in" };
  }
  if (!agentId) return { ok: false, error: "missing agent id" };

  const trimmed = value.trim();
  if (trimmed.length > 0 && !looksLikePhone(trimmed)) {
    return {
      ok: false,
      error: "That does not look like a phone number — needs 10 to 15 digits.",
    };
  }

  const supabase = untyped();
  const { error } = await supabase
    .from("mls_agents")
    .update({
      phone_override: trimmed.length > 0 ? trimmed : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);

  if (error) return { ok: false, error: error.message };
  revalidateAgentSurfaces();
  return { ok: true };
}

/**
 * Point an agent at an existing headshot by `brand_assets.label`.
 *
 * This is the cheap fix for the nickname case — MLS says "Nicolette Gorski",
 * the Drive file says "Nikki Gorski" — where the photo already exists and
 * only the matching failed. Re-uploading would work too but leaves a
 * duplicate image in the bucket forever.
 *
 * The label is validated against a real active row so a typo cannot silently
 * point at nothing.
 */
export async function setAgentHeadshotLabelAction(
  agentId: string,
  label: string,
): Promise<ActionResult> {
  try {
    await requireUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "not signed in" };
  }
  if (!agentId) return { ok: false, error: "missing agent id" };

  const supabase = untyped();
  const trimmed = label.trim();

  if (trimmed.length > 0) {
    const { data: asset } = await supabase
      .from("brand_assets")
      .select("id")
      .eq("kind", "agent_headshot")
      .eq("status", "active")
      .ilike("label", trimmed)
      .limit(1)
      .maybeSingle();
    if (!asset?.id) {
      return {
        ok: false,
        error: `No active headshot is labelled "${trimmed}".`,
      };
    }
  }

  const { error } = await supabase
    .from("mls_agents")
    .update({
      headshot_label_override: trimmed.length > 0 ? trimmed : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);

  if (error) return { ok: false, error: error.message };
  revalidateAgentSurfaces();
  return { ok: true };
}

export interface UploadAgentHeadshotInput {
  agent_id: string;
  /** Used as the brand_assets label and as the override we pin the agent to. */
  agent_name: string;
  filename: string;
  content_type: string;
  /** Raw base64, no data: prefix. */
  file_base64: string;
}

/**
 * Upload a headshot for one agent and wire it up so it actually renders.
 *
 * Three things have to happen together or the photo will not appear:
 *   1. the object lands in the `brand-assets` bucket,
 *   2. a `brand_assets` row points at it with kind='agent_headshot' and
 *      status='active', and
 *   3. the agent's `headshot_label_override` points at that row's label.
 *
 * Step 3 is what makes this deterministic. Without it we would be relying on
 * the same fuzzy name matching that failed in the first place — which is
 * precisely why the agent had no photo.
 *
 * `source: 'manual'` is the load-bearing field. sync-brand-assets archives
 * every active row whose drive_file_id it did not see on its nightly walk,
 * and an uploaded row has no drive_file_id. Migration
 * 20260814_001_brand_assets_source added the column and the sweep now
 * filters to source='drive', so these survive. Do not drop it.
 *
 * On DB failure the storage object is removed, matching uploadBrandAssetAction
 * and the mobile photo route.
 */
export async function uploadAgentHeadshotAction(
  input: UploadAgentHeadshotInput,
): Promise<ActionResult> {
  try {
    await requireUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "not signed in" };
  }

  const agentId = input.agent_id?.trim();
  const label = (input.agent_name ?? "").trim();
  if (!agentId) return { ok: false, error: "missing agent id" };
  if (!label) return { ok: false, error: "missing agent name" };

  const ext = MIME_TO_EXT[input.content_type];
  if (!ext) {
    return {
      ok: false,
      error: `Unsupported file type ${input.content_type}. Use JPG, PNG or WebP.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(input.file_base64, "base64"));
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_HEADSHOT_BYTES) {
    return {
      ok: false,
      error: `That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. Max is 5 MB.`,
    };
  }

  const supabase = untyped();
  // `manual/agents/` mirrors the existing manual/{kind}s/ convention and
  // keeps these clear of the Drive walk's `agents/` prefix.
  const storagePath = `manual/agents/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("brand-assets")
    .upload(storagePath, bytes, {
      contentType: input.content_type,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  const { data: pub } = supabase.storage
    .from("brand-assets")
    .getPublicUrl(storagePath);
  const publicUrl: string | null = pub?.publicUrl ?? null;

  // why archive-then-insert: uploading a replacement for an agent who
  // already has a manual photo would otherwise leave two active rows with
  // the same label, and the resolver takes whichever comes back first.
  await supabase
    .from("brand_assets")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("kind", "agent_headshot")
    .eq("status", "active")
    .eq("source", "manual")
    .ilike("label", label);

  const { data: row, error: insertErr } = await supabase
    .from("brand_assets")
    .insert({
      kind: "agent_headshot",
      office_id: null,
      label,
      filename: (input.filename ?? "").trim() || `${label}.${ext}`,
      logo_category: null,
      storage_path: storagePath,
      public_url: publicUrl,
      drive_file_id: null,
      drive_folder_id: null,
      drive_parent_subfolder_name: null,
      drive_modified_at: null,
      synced_at: new Date().toISOString(),
      status: "active",
      source: "manual",
    })
    .select("id")
    .maybeSingle();

  if (insertErr || !row?.id) {
    await supabase.storage.from("brand-assets").remove([storagePath]);
    return {
      ok: false,
      error: `Could not save the photo: ${insertErr?.message ?? "no id returned"}`,
    };
  }

  // Pin the agent to the label we just created. Best effort: the photo is
  // already saved and will still be found by name matching in the common
  // case, so a failure here is worth reporting but not worth rolling back.
  const { error: pinErr } = await supabase
    .from("mls_agents")
    .update({
      headshot_label_override: label,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);
  if (pinErr) {
    console.warn("[agents] headshot uploaded but pin failed:", pinErr.message);
  }

  revalidateAgentSurfaces();
  return { ok: true, public_url: publicUrl ?? undefined };
}
