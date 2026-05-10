"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createListing, updateListing } from "@/lib/listings";
import {
  extractMlsNumber,
  parseCanonicalMls,
} from "@/lib/linker/auto-linker";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ActiveListingInsert,
  ListingStatus,
  MlsSource,
} from "@/lib/supabase/listings-types";
import type { Database } from "@/lib/supabase/types";

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
    source_mls: MlsSource;
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
          source_mls: listing.source_mls,
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
    source_mls: result.row.source_mls,
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
    source_mls: result.row.source_mls,
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
  const validCats = [
    "property",
    "agent",
    "educational",
    "marketing",
    "community",
    "sold",
    "other",
  ];
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

  // Agent name: only persist when category is 'agent'; otherwise clear.
  const agentNameRaw = readString(form, "agent_name");
  const agentName = category === "agent" ? agentNameRaw : null;

  // Office: empty string -> null (brand-wide). Otherwise we expect a uuid;
  // we trust the form value since it's selected from a server-rendered list.
  const officeIdRaw = form.get("office_id");
  const officeId =
    typeof officeIdRaw === "string" && officeIdRaw.trim().length > 0
      ? officeIdRaw.trim()
      : null;

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
          | "agent"
          | "educational"
          | "marketing"
          | "community"
          | "sold"
          | "other") ?? null,
      agent_name: agentName,
      office_id: officeId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/posts/${postId}`);
  revalidatePath("/posts");
  return { ok: true };
}

/**
 * Set or clear the MLS number on a single post.
 *
 * Accepts any of the three hashtag conventions:
 *   - Bright: NJBL2078123 (with or without `#`)
 *   - CMC:    CMC230456   (with or without `#`)
 *   - SJSR:   SJSR571832  (with or without `#`)
 *
 * Behavior:
 *   - Stores the canonical form in posts.mls_number_parsed.
 *   - Looks up the matching properties row by (source_mls, raw mls_number);
 *     if found, sets posts.property_id + link_method='manual'.
 *   - If a property row is found AND posts.category IN (NULL, 'other'), flips
 *     category to 'property'. (Never overrides an admin's deliberate choice.)
 *   - If no property row exists yet (e.g., RETS hasn't synced this listing
 *     today), the MLS# is still stored on the post — the next RETS sync's
 *     run_auto_linker call will attach the property_id.
 *   - Empty input clears: mls_number_parsed, property_id, link_method.
 *
 * Used by the inline `MlsNumberInline` chip on PostListRow + the post detail
 * page header.
 */
export interface SetPostMlsResult {
  ok: boolean;
  error?: string;
  /** Canonical MLS form stored on the post (e.g. "CMC230456"), or null when cleared. */
  canonical_mls?: string | null;
  /** Property uuid when a matching row was found; null when only the text was stored. */
  property_id?: string | null;
  /** True when category was auto-flipped to 'property' as part of this save. */
  category_flipped?: boolean;
  /** True when a property row WAS found and linked. */
  linked?: boolean;
}

export async function setPostMlsNumber(
  postId: string,
  rawInput: string,
): Promise<SetPostMlsResult> {
  await requireAdmin();
  if (!postId) return { ok: false, error: "Missing post id" };

  const trimmed = (rawInput ?? "").trim();
  const supabase = createAdminClient();

  // Empty → clear everything MLS-related on the post.
  if (trimmed.length === 0) {
    const { error } = await supabase
      .from("posts")
      .update({
        mls_number_parsed: null,
        property_id: null,
        link_method: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/posts");
    revalidatePath("/");
    revalidatePath("/properties");
    return {
      ok: true,
      canonical_mls: null,
      property_id: null,
      linked: false,
      category_flipped: false,
    };
  }

  // Parse into canonical form. Reuse the linker's regex so admin entry behaves
  // identically to caption parsing.
  const canonical = extractMlsNumber(trimmed);
  if (!canonical) {
    return {
      ok: false,
      error:
        `"${trimmed}" doesn't look like a recognized MLS#. Use NJBL2078123 ` +
        "(Bright), CMC230456, or SJSR571832 — with or without the # prefix.",
    };
  }

  const parsed = parseCanonicalMls(canonical);
  if (!parsed) {
    // extractMlsNumber and parseCanonicalMls are mirror images; this branch
    // should be unreachable, but TypeScript needs the narrowing.
    return { ok: false, error: "Could not parse MLS number." };
  }

  // Look up the matching properties row (best-effort — non-fatal if missing).
  let propertyId: string | null = null;
  let linked = false;

  if (parsed.source_mls === "bright") {
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("mls_number", parsed.mls_number)
      .maybeSingle();
    if (prop) {
      propertyId = prop.id;
      linked = true;
    }
  } else {
    // CMC/SJSR: match on (source_mls, mls_number) pair.
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("source_mls", parsed.source_mls)
      .eq("mls_number", parsed.mls_number)
      .maybeSingle();
    if (prop) {
      propertyId = prop.id;
      linked = true;
    }
  }

  // Determine if we should flip category to 'property'.
  let categoryFlipped = false;
  let categoryUpdate: "property" | undefined = undefined;
  if (linked) {
    const { data: existing } = await supabase
      .from("posts")
      .select("category")
      .eq("id", postId)
      .maybeSingle();
    const cur = existing?.category ?? null;
    if (cur === null || cur === "other") {
      categoryUpdate = "property";
      categoryFlipped = true;
    }
  }

  const patch: Database["public"]["Tables"]["posts"]["Update"] = {
    mls_number_parsed: canonical,
    updated_at: new Date().toISOString(),
  };
  if (propertyId) {
    patch.property_id = propertyId;
    patch.link_method = "manual";
    if (categoryUpdate) patch.category = categoryUpdate;
  }

  const { error } = await supabase
    .from("posts")
    .update(patch)
    .eq("id", postId);
  if (error) return { ok: false, error: error.message };

  // Re-run the post grouper so the newly-linked post folds into any existing
  // (date+property) group. Best-effort.
  if (propertyId) {
    try {
      await supabase.rpc("run_post_grouper");
    } catch (e) {
      console.error("run_post_grouper (post-set-mls):", e);
    }
  }

  revalidatePath(`/posts/${postId}`);
  revalidatePath("/posts");
  revalidatePath("/");
  revalidatePath("/properties");
  return {
    ok: true,
    canonical_mls: canonical,
    property_id: propertyId,
    linked,
    category_flipped: categoryFlipped,
  };
}

/* ------------------------------------------------------------------------- */
/* Promotion-dismissal actions — drive the dashboard "needs Larissa" strip   */
/* ------------------------------------------------------------------------- */

export interface DismissPromotionResult {
  ok: boolean;
  error?: string;
}

const DISMISS_REASON_VALUES = [
  "low_price",
  "condition",
  "owner_request",
  "other",
] as const;
type DismissReasonChip = (typeof DISMISS_REASON_VALUES)[number];

function normalizeDismissReason(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if ((DISMISS_REASON_VALUES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  // Free text — cap at 200 chars to avoid runaway notes.
  return trimmed.slice(0, 200);
}

/**
 * Mark a property as "Alliance won't promote this one" — pulls it out of the
 * dashboard "needs posts" strip and the morning digest. Idempotent: re-running
 * with a new reason refreshes the timestamp + reason fields.
 *
 * Reason can be a chip slug (`low_price` / `condition` / `owner_request` /
 * `other`) or free text (truncated to 200 chars).
 */
export async function dismissListingPromotionAction(
  mlsNumber: string,
  reason?: DismissReasonChip | string | null,
): Promise<DismissPromotionResult> {
  const profile = await requireAdmin();
  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();
  const normalizedReason = normalizeDismissReason(reason ?? null);

  const { error } = await supabase
    .from("properties")
    .update({
      promotion_dismissed_at: new Date().toISOString(),
      promotion_dismissed_by: profile.id,
      promotion_dismissed_reason: normalizedReason,
      updated_at: new Date().toISOString(),
    })
    .eq("mls_number", mlsNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath("/settings/promotions");
  return { ok: true };
}

/**
 * Manual "yes, posts have been made for this listing" override. Sets
 * posts_confirmed_at/by — the dashboard listing strip then surfaces a
 * "POSTED ✓" ribbon and stops asking about it. Idempotent.
 *
 * Auto-detection of posted state still works via posts.property_id; this
 * action is for cases where Larissa posted without the MLS hashtag and the
 * auto-linker missed it, so manually flag the listing as handled.
 */
export async function confirmListingPostsAction(
  mlsNumber: string,
): Promise<DismissPromotionResult> {
  const profile = await requireAdmin();
  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("properties")
    .update({
      posts_confirmed_at: new Date().toISOString(),
      posts_confirmed_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("mls_number", mlsNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath(`/properties/${encodeURIComponent(mlsNumber)}`);
  return { ok: true };
}

/**
 * Clear the manual "posted" confirmation. The listing returns to whatever
 * state it would be in based on auto-detected posts + dismissal flags.
 */
export async function unconfirmListingPostsAction(
  mlsNumber: string,
): Promise<DismissPromotionResult> {
  await requireAdmin();
  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("properties")
    .update({
      posts_confirmed_at: null,
      posts_confirmed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("mls_number", mlsNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath(`/properties/${encodeURIComponent(mlsNumber)}`);
  return { ok: true };
}

/**
 * Re-instate a previously-dismissed property — clears all three dismissal
 * fields. The listing reappears on the dashboard if it still has missing
 * platform coverage and is within the recency window.
 */
export async function undismissListingPromotionAction(
  mlsNumber: string,
): Promise<DismissPromotionResult> {
  await requireAdmin();
  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("properties")
    .update({
      promotion_dismissed_at: null,
      promotion_dismissed_by: null,
      promotion_dismissed_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("mls_number", mlsNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath("/settings/promotions");
  return { ok: true };
}
