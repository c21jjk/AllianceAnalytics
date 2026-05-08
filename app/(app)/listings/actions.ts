"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createListing, updateListing } from "@/lib/listings";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ActiveListingInsert,
  ListingStatus,
  MlsSource,
} from "@/lib/supabase/listings-types";

const VALID_STATUS: ListingStatus[] = [
  "active",
  "pending",
  "sold",
  "expired",
  "withdrawn",
];
const VALID_SOURCE: MlsSource[] = ["cmc", "sjsr", "bright", "manual"];

function readString(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPrice(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function readEnum<T extends string>(
  form: FormData,
  key: string,
  allowed: T[],
  fallback: T,
): T {
  const v = form.get(key);
  if (typeof v === "string" && (allowed as string[]).includes(v)) {
    return v as T;
  }
  return fallback;
}

interface ActionState {
  ok: boolean;
  error?: string;
}

/**
 * Replicate one listing into AllianceAnalytics' `properties` table.
 *
 * Best-effort: we want the analytics-side properties row to exist as soon as
 * the admin creates a listing in the Listings DB, so the auto-linker has
 * something to match against. Errors are logged but not fatal.
 */
async function replicateToAnalytics(
  listing: {
    mls_number: string;
    address: string;
    city: string | null;
    state: string | null;
    zip: string | null;
    list_price: number | null;
    listing_date: string | null;
    list_agent_name: string | null;
    list_agent_email: string | null;
    hero_image_url: string | null;
    status: ListingStatus;
  },
): Promise<void> {
  try {
    const supabase = createAdminClient();
    // Map the listings_status (5 values) onto property_status (4 values) —
    // 'withdrawn' collapses into 'expired' for analytics purposes.
    const propertyStatus =
      listing.status === "withdrawn" ? "expired" : listing.status;
    const { error } = await supabase
      .from("properties")
      .upsert(
        {
          mls_number: listing.mls_number,
          address: listing.address,
          city: listing.city,
          state: listing.state,
          zip: listing.zip,
          list_price: listing.list_price,
          listing_date: listing.listing_date,
          agent_name: listing.list_agent_name,
          agent_email: listing.list_agent_email,
          hero_image_url: listing.hero_image_url,
          status: propertyStatus,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "mls_number" },
      );
    if (error) {
      console.error("replicateToAnalytics:", error);
    }
  } catch (e) {
    console.error("replicateToAnalytics threw:", e);
  }
}

export async function createListingAction(
  _prev: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const mls = readString(form, "mls_number");
  const address = readString(form, "address");
  if (!mls) return { ok: false, error: "MLS number is required" };
  if (!address) return { ok: false, error: "Address is required" };

  const insert: ActiveListingInsert = {
    mls_number: mls.toUpperCase(),
    address,
    city: readString(form, "city"),
    state: readString(form, "state"),
    zip: readString(form, "zip"),
    list_price: readPrice(form, "list_price"),
    listing_date: readString(form, "listing_date"),
    list_agent_name: readString(form, "list_agent_name"),
    list_agent_email: readString(form, "list_agent_email"),
    list_office_id: readString(form, "list_office_id"),
    hero_image_url: readString(form, "hero_image_url"),
    status: readEnum(form, "status", VALID_STATUS, "active"),
    source_mls: readEnum(form, "source_mls", VALID_SOURCE, "manual"),
  };

  const result = await createListing(insert);
  if (!result.ok) return { ok: false, error: result.error };

  // Best-effort cross-project replication.
  await replicateToAnalytics({
    mls_number: result.row.mls_number,
    address: result.row.address,
    city: result.row.city,
    state: result.row.state,
    zip: result.row.zip,
    list_price: result.row.list_price,
    listing_date: result.row.listing_date,
    list_agent_name: result.row.list_agent_name,
    list_agent_email: result.row.list_agent_email,
    hero_image_url: result.row.hero_image_url,
    status: result.row.status,
  });

  // Best-effort: run the auto-linker so any unlinked posts mentioning this
  // listing's MLS# or address attach immediately. Errors are swallowed.
  try {
    const supabase = createAdminClient();
    await supabase.rpc("run_auto_linker");
  } catch (e) {
    console.error("run_auto_linker (post-create):", e);
  }

  revalidatePath("/listings");
  revalidatePath("/properties");
  redirect("/listings");
}

export async function updateListingAction(
  mlsNumber: string,
  _prev: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const patch = {
    address: readString(form, "address") ?? undefined,
    city: readString(form, "city"),
    state: readString(form, "state"),
    zip: readString(form, "zip"),
    list_price: readPrice(form, "list_price"),
    listing_date: readString(form, "listing_date"),
    list_agent_name: readString(form, "list_agent_name"),
    list_agent_email: readString(form, "list_agent_email"),
    list_office_id: readString(form, "list_office_id"),
    hero_image_url: readString(form, "hero_image_url"),
    status: readEnum(form, "status", VALID_STATUS, "active"),
    source_mls: readEnum(form, "source_mls", VALID_SOURCE, "manual"),
  };

  const result = await updateListing(mlsNumber, patch);
  if (!result.ok) return { ok: false, error: result.error };

  await replicateToAnalytics({
    mls_number: result.row.mls_number,
    address: result.row.address,
    city: result.row.city,
    state: result.row.state,
    zip: result.row.zip,
    list_price: result.row.list_price,
    listing_date: result.row.listing_date,
    list_agent_name: result.row.list_agent_name,
    list_agent_email: result.row.list_agent_email,
    hero_image_url: result.row.hero_image_url,
    status: result.row.status,
  });

  revalidatePath("/listings");
  revalidatePath("/properties");
  redirect("/listings");
}

/**
 * Server action used by the per-post Classify panel — sets a post's
 * property_id (or clears it) and stamps category + link_method.
 */
export async function classifyPostAction(form: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  await requireAdmin();

  const postId = readString(form, "post_id");
  if (!postId) return { ok: false, error: "Missing post id" };

  const category = readString(form, "category");
  const validCats = ["property", "educational", "marketing", "community", "sold", "other"];
  if (category && !validCats.includes(category)) {
    return { ok: false, error: `Invalid category: ${category}` };
  }

  const mlsForLink = readString(form, "mls_number"); // empty → unlink
  let propertyId: string | null = null;
  if (mlsForLink) {
    const supabase = createAdminClient();
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("mls_number", mlsForLink.toUpperCase())
      .maybeSingle();
    if (!prop) {
      return {
        ok: false,
        error:
          `No analytics property row exists for ${mlsForLink}. ` +
          "Add it on the Listings tab first.",
      };
    }
    propertyId = prop.id;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("posts")
    .update({
      property_id: propertyId,
      // Manual classification always overrides whatever the auto-linker did.
      link_method: propertyId ? "manual" : null,
      category:
        (category as
          | "property"
          | "educational"
          | "marketing"
          | "community"
          | "sold"
          | "other") ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/posts/${postId}`);
  revalidatePath("/posts");
  return { ok: true };
}
