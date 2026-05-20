"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  createSubscriber,
  updateSubscriber,
  deleteSubscriber,
  bulkToggleFlag,
  importAllianceRoster,
  type SubscriberCategory,
  type BulkToggleField,
} from "@/lib/data/email-subscribers";

/**
 * Server actions for /settings/subscribers. All admin-gated. Each action
 * revalidates the page so the rendered table refreshes on the next render.
 *
 * Pattern matches /settings/offices/actions.ts — return a result object
 * rather than throwing, so the UI can show inline error feedback.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  info?: string;
}

function revalidate() {
  revalidatePath("/settings/subscribers");
  revalidatePath("/settings");
}

export async function addSubscriberAction(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const categoryRaw = String(formData.get("category") ?? "").trim();
  if (categoryRaw !== "leadership" && categoryRaw !== "agent") {
    return { ok: false, error: "Invalid category." };
  }
  const category = categoryRaw as SubscriberCategory;
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() || null;
  const office_id = String(formData.get("office_id") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name || !email) {
    return { ok: false, error: "Name and email are required." };
  }
  if (!/^.+@.+\..+$/.test(email)) {
    return { ok: false, error: `Email "${email}" looks invalid.` };
  }

  const result = await createSubscriber({
    category,
    name,
    email,
    role,
    office_id,
    notes,
    receives_weekly_social_report:
      formData.get("receives_weekly_social_report") === "on",
    receives_owner_story: formData.get("receives_owner_story") === "on",
    receives_office_post_alerts:
      formData.get("receives_office_post_alerts") === "on",
    is_active: formData.get("is_active") !== "off",
  });

  if (!result.ok) return { ok: false, error: result.error };
  revalidate();
  return { ok: true, info: `Added ${name}.` };
}

export async function updateSubscriberAction(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing subscriber id." };

  const result = await updateSubscriber({
    id,
    name: formData.get("name") !== null
      ? String(formData.get("name") ?? "").trim()
      : undefined,
    email: formData.get("email") !== null
      ? String(formData.get("email") ?? "").trim()
      : undefined,
    role: formData.get("role") !== null
      ? String(formData.get("role") ?? "").trim() || null
      : undefined,
    office_id: formData.get("office_id") !== null
      ? String(formData.get("office_id") ?? "").trim() || null
      : undefined,
    notes: formData.get("notes") !== null
      ? String(formData.get("notes") ?? "").trim() || null
      : undefined,
    receives_weekly_social_report:
      formData.get("receives_weekly_social_report") === "on",
    receives_owner_story: formData.get("receives_owner_story") === "on",
    receives_office_post_alerts:
      formData.get("receives_office_post_alerts") === "on",
    is_active: formData.get("is_active") === "on",
  });

  if (!result.ok) return { ok: false, error: result.error };
  revalidate();
  return { ok: true };
}

/** Targeted single-flag toggle — used by inline checkbox click handlers. */
export async function toggleSubscriberFlagAction(
  id: string,
  field:
    | "receives_weekly_social_report"
    | "receives_owner_story"
    | "receives_office_post_alerts"
    | "is_active",
  value: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing subscriber id." };
  const result = await updateSubscriber({ id, [field]: value });
  if (!result.ok) return { ok: false, error: result.error };
  revalidate();
  return { ok: true };
}

/**
 * Bulk "select all / deselect all" header toggle. Sets a single subscription
 * flag to a fixed value across the supplied subscriber ids. Powers the
 * indeterminate-aware checkboxes at the top of each Leadership / Agents
 * (per-office) table on /settings/subscribers.
 */
export async function bulkToggleSubscriberFlagAction(
  ids: string[],
  field: BulkToggleField,
  value: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  if (ids.length === 0) return { ok: true };
  const result = await bulkToggleFlag(ids, field, value);
  if (!result.ok) return { ok: false, error: result.error };
  revalidate();
  return {
    ok: true,
    info: `Updated ${result.count} ${result.count === 1 ? "row" : "rows"}.`,
  };
}

export async function deleteSubscriberAction(
  id: string,
): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing subscriber id." };
  const result = await deleteSubscriber(id);
  if (!result.ok) return { ok: false, error: result.error };
  revalidate();
  return { ok: true };
}

export async function importAllianceRosterAction(): Promise<ActionResult> {
  await requireAdmin();
  const result = await importAllianceRoster();
  revalidate();
  return {
    ok: true,
    info: `Imported ${result.imported} new agent${
      result.imported === 1 ? "" : "s"
    } (${result.skipped} already subscribed).`,
  };
}
