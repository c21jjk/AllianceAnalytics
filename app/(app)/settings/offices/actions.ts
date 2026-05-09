"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import type { Database } from "@/lib/supabase/types";

interface ActionState {
  ok: boolean;
  error?: string;
}

type OfficeUpdate = Database["public"]["Tables"]["offices"]["Update"];

function readString(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readArray(form: FormData, key: string): string[] | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return [];
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts;
}

function readNumber(form: FormData, key: string): number | null {
  const v = form.get(key);
  if (typeof v !== "string" || v.trim().length === 0) return null;
  const cleaned = v.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Upsert one offices row by short_code. Admin-only.
 *
 * Comma-separated list fields are split into string[] before persisting.
 * Numeric fields are coerced; an empty value clears (sets to null).
 */
export async function upsertOfficeAction(
  shortCode: string,
  _prev: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();

  if (!shortCode) {
    return { ok: false, error: "Missing office short_code." };
  }

  const admin = createAdminClient();

  const { data: existing, error: fetchErr } = await admin
    .from("offices")
    .select("short_code")
    .eq("short_code", shortCode)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, error: `Lookup failed: ${fetchErr.message}` };
  }
  if (!existing) {
    return {
      ok: false,
      error: `No office found with short_code='${shortCode}'.`,
    };
  }

  const name = readString(form, "name");
  if (!name) {
    return { ok: false, error: "Office name is required." };
  }

  const isActiveRaw = form.get("is_active");
  const isActive = typeof isActiveRaw === "string" && isActiveRaw === "1";

  const patch: OfficeUpdate = {
    name,
    display_name: readString(form, "display_name"),
    address: readString(form, "address"),
    city: readString(form, "city"),
    state: readString(form, "state"),
    zip: readString(form, "zip"),
    phone: readString(form, "phone"),
    primary_contact: readString(form, "primary_contact"),
    primary_buyer_demo: readString(form, "primary_buyer_demo"),
    primary_seller_demo: readString(form, "primary_seller_demo"),
    seasonal_pattern: readString(form, "seasonal_pattern"),
    notes: readString(form, "notes"),
    towns_served: readArray(form, "towns_served"),
    zip_codes_served: readArray(form, "zip_codes_served"),
    signature_angles: readArray(form, "signature_angles"),
    price_range_min: readNumber(form, "price_range_min"),
    price_range_median: readNumber(form, "price_range_median"),
    price_range_high: readNumber(form, "price_range_high"),
    is_active: isActive,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("offices")
    .update(patch)
    .eq("short_code", shortCode);

  if (error) {
    return { ok: false, error: `Save failed: ${error.message}` };
  }

  revalidatePath("/settings/offices");
  redirect("/settings/offices");
}

/**
 * Toggle the is_active flag for one office. Admin-only.
 * Form must POST with field "is_active" = "1" | "0".
 */
export async function toggleOfficeActiveAction(
  shortCode: string,
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  if (!shortCode) return;

  const admin = createAdminClient();
  const desired = String(formData.get("is_active") ?? "") === "1";

  const { error } = await admin
    .from("offices")
    .update({ is_active: desired, updated_at: new Date().toISOString() })
    .eq("short_code", shortCode);

  if (error) {
    console.error("toggleOfficeActiveAction:", error);
  }

  revalidatePath("/settings/offices");
}
