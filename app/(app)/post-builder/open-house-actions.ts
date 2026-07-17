"use server";

/**
 * Manual Open House management — server actions.
 *
 * Task 18 (2026-07-17) — Larissa can add a scheduled Open House by hand
 * before building an OH post. Needed because:
 *   • Bright's OpenHouse resource is licensing-blocked on our RETS account
 *     (request pending), so Bright OHs never arrive via feed.
 *   • CMC/SJSR feeds occasionally miss a session the office knows about.
 *
 * Rows land in `public.open_houses` with feed_short_code='manual' (the CHECK
 * constraint was widened 2026-07-17 to allow 'manual'). Every OH surface —
 * the Post Builder open_house bucket (lib/post-builder/listings.ts), the
 * Multi-OH wizard, the dashboard's Upcoming Open Houses row, and caption
 * synthesis — reads this same table, so a manual insert propagates
 * everywhere with zero extra wiring.
 *
 * Deletion is restricted to manual rows: feed-sourced sessions (cmc / sjsr /
 * bright) are owned by their sync and would just reappear on the next run.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OhSearchResult {
  property_id: string;
  mls_number: string;
  source_mls: string | null;
  address: string | null;
  unit_number: string | null;
  city: string | null;
  agent_name: string | null;
  hero_image_url: string | null;
  list_price: number | null;
}

export interface OhSessionRow {
  id: string;
  start_at: string;
  end_at: string | null;
  /** 'manual' rows are deletable; feed rows are read-only. */
  feed_short_code: string;
}

export interface OhActionResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search ACTIVE listings by street address, MLS number, or listing agent.
 * One query string covers all three — we OR the ilike patterns so Larissa
 * doesn't have to say which field she's typing. Capped at 12 results;
 * hero_image_url is NOT required (unlike the post-builder bucket) so a
 * photo-less listing can still get its OH scheduled — the photo problem
 * surfaces later in the builder where it belongs.
 */
export async function searchListingsForOpenHouseAction(
  rawQuery: string,
): Promise<OhSearchResult[]> {
  await requireAdmin();
  // why: strip the characters PostgREST's .or() filter grammar treats as
  // structure (commas split terms, parens group them, % is the wildcard we
  // add ourselves). Keeps a typed "123 Main St, Wildwood" from breaking the
  // filter — the comma just becomes a space.
  const q = rawQuery.replace(/[,()%]/g, " ").trim();
  if (q.length < 2) return [];

  const supabase = createAdminClient();
  const pattern = `%${q}%`;
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, address, unit_number, city, agent_name, hero_image_url, list_price",
    )
    .eq("status", "active")
    .or(
      `address.ilike.${pattern},mls_number.ilike.${pattern},agent_name.ilike.${pattern}`,
    )
    .order("listing_date", { ascending: false })
    .limit(12);

  if (error) {
    console.error("[open-house-actions] search failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    property_id: r.id as string,
    mls_number: r.mls_number as string,
    source_mls: (r.source_mls as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    unit_number: (r.unit_number as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    agent_name: (r.agent_name as string | null) ?? null,
    hero_image_url: (r.hero_image_url as string | null) ?? null,
    list_price: (r.list_price as number | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Existing sessions for a property
// ---------------------------------------------------------------------------

/**
 * Upcoming (and just-passed, 6h grace) OH sessions for one property, so the
 * modal can show what's already scheduled before Larissa adds more —
 * prevents accidental duplicates of a feed-sourced session.
 */
export async function getOpenHouseSessionsForPropertyAction(
  propertyId: string,
): Promise<OhSessionRow[]> {
  await requireAdmin();
  if (!propertyId) return [];
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("open_houses")
    .select("id, start_at, end_at, feed_short_code")
    .eq("property_id", propertyId)
    .gte("start_at", cutoff)
    .order("start_at", { ascending: true });
  if (error) {
    console.error("[open-house-actions] sessions fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as OhSessionRow[];
}

// ---------------------------------------------------------------------------
// Add sessions
// ---------------------------------------------------------------------------

/**
 * Insert one or more manual OH sessions for a property.
 *
 * Sessions arrive as UTC ISO strings (the client converts Larissa's local
 * date+time inputs before calling — same convention as post scheduling).
 * Upsert on (feed_short_code, oh_unique_id) with a deterministic id of
 * `manual-{propertyId}-{startIso}` makes re-submits idempotent: saving the
 * same day/time twice updates rather than duplicates.
 */
export async function addManualOpenHouseSessionsAction(
  propertyId: string,
  sessions: ReadonlyArray<{ start_at: string; end_at: string | null }>,
): Promise<OhActionResult> {
  await requireAdmin();
  if (!propertyId) return { ok: false, error: "Missing property." };
  if (sessions.length === 0) {
    return { ok: false, error: "Add at least one day and time." };
  }
  if (sessions.length > 10) {
    return { ok: false, error: "Too many sessions in one save (max 10)." };
  }

  // Validate each session server-side (the UI validates too, but server
  // actions are a public endpoint — never trust the client alone).
  const nowMs = Date.now();
  for (const s of sessions) {
    const start = Date.parse(s.start_at);
    if (Number.isNaN(start)) {
      return { ok: false, error: "One of the start times is invalid." };
    }
    // Allow up to 12h in the past so a same-day OH entered mid-afternoon
    // (or a quick backfill for a post going out late) isn't rejected.
    if (start < nowMs - 12 * 3600_000) {
      return { ok: false, error: "Open house start must not be in the past." };
    }
    if (s.end_at !== null) {
      const end = Date.parse(s.end_at);
      if (Number.isNaN(end) || end <= start) {
        return { ok: false, error: "End time must be after the start time." };
      }
    }
  }

  const supabase = createAdminClient();

  // Resolve the property's MLS number — open_houses.mls_number is NOT NULL
  // and every downstream join uses it.
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, mls_number")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr || !prop) {
    return { ok: false, error: "Property not found." };
  }

  const nowIso = new Date().toISOString();
  const rows = sessions.map((s) => ({
    feed_short_code: "manual",
    // Deterministic per (property, start) → idempotent re-saves.
    oh_unique_id: `manual-${propertyId}-${s.start_at}`,
    mls_number: prop.mls_number as string,
    property_id: propertyId,
    start_at: s.start_at,
    end_at: s.end_at,
    comments: null,
    last_synced_at: nowIso,
    updated_at: nowIso,
  }));

  const { error: insErr } = await supabase
    .from("open_houses")
    .upsert(rows, { onConflict: "feed_short_code,oh_unique_id" });
  if (insErr) {
    console.error("[open-house-actions] insert failed:", insErr.message);
    return { ok: false, error: `Save failed: ${insErr.message}` };
  }

  // Refresh every surface that lists OHs.
  revalidatePath("/post-builder");
  revalidatePath("/post-builder/multi-oh");
  revalidatePath("/");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete (manual rows only)
// ---------------------------------------------------------------------------

export async function deleteManualOpenHouseAction(
  openHouseId: string,
): Promise<OhActionResult> {
  await requireAdmin();
  if (!openHouseId) return { ok: false, error: "Missing session id." };
  const supabase = createAdminClient();
  // why: the .eq guard on feed_short_code means a feed-sourced row can never
  // be deleted through this action, even with a valid id — those belong to
  // their sync and would resurrect next run anyway.
  const { error } = await supabase
    .from("open_houses")
    .delete()
    .eq("id", openHouseId)
    .eq("feed_short_code", "manual");
  if (error) {
    console.error("[open-house-actions] delete failed:", error.message);
    return { ok: false, error: `Delete failed: ${error.message}` };
  }
  revalidatePath("/post-builder");
  revalidatePath("/post-builder/multi-oh");
  revalidatePath("/");
  return { ok: true };
}
