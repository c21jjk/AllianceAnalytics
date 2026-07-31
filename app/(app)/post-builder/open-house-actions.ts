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
import { createListingsAdminClient } from "@/lib/supabase/listings-admin";

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

  // 2026-07-24 — best-effort mirror to the Alliance Listings project. The
  // Matrix-portal syncs dual-write open_houses to BOTH projects; manual
  // in-app entries previously landed only here, so any Listings-project
  // consumer never saw them. Property ids differ across projects, so the
  // mirror re-resolves by mls_number over there; a missing property or
  // missing env config logs and moves on — the primary save above already
  // succeeded and must never be rolled back by a mirror hiccup.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listingsDb = createListingsAdminClient() as any;
    const { data: remoteProp } = await listingsDb
      .from("properties")
      .select("id")
      .eq("mls_number", prop.mls_number as string)
      .maybeSingle();
    if (remoteProp?.id) {
      const mirrorRows = rows.map((r) => ({
        ...r,
        property_id: remoteProp.id as string,
      }));
      const { error: mirrorErr } = await listingsDb
        .from("open_houses")
        .upsert(mirrorRows, { onConflict: "feed_short_code,oh_unique_id" });
      if (mirrorErr) {
        console.warn(
          "[open-house-actions] listings-project mirror failed (primary saved):",
          mirrorErr.message,
        );
      }
    } else {
      console.warn(
        `[open-house-actions] mls ${prop.mls_number} not found in listings project; mirror skipped`,
      );
    }
  } catch (e) {
    console.warn(
      "[open-house-actions] listings-project mirror unavailable (primary saved):",
      e instanceof Error ? e.message : e,
    );
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
  // 2026-07-24 — capture oh_unique_id BEFORE deleting so the mirror row in
  // the Listings project (same unique id, different property_id) can be
  // removed too. Best-effort: mirror failures log and never block.
  const { data: doomed } = await supabase
    .from("open_houses")
    .select("oh_unique_id")
    .eq("id", openHouseId)
    .eq("feed_short_code", "manual")
    .maybeSingle();
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
  if (doomed?.oh_unique_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listingsDb = createListingsAdminClient() as any;
      const { error: mirrorErr } = await listingsDb
        .from("open_houses")
        .delete()
        .eq("feed_short_code", "manual")
        .eq("oh_unique_id", doomed.oh_unique_id);
      if (mirrorErr) {
        console.warn(
          "[open-house-actions] listings-project delete mirror failed:",
          mirrorErr.message,
        );
      }
    } catch (e) {
      console.warn(
        "[open-house-actions] listings-project delete mirror unavailable:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  revalidatePath("/post-builder");
  revalidatePath("/post-builder/multi-oh");
  revalidatePath("/");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// On-demand feed sync (2026-07-31)
// ---------------------------------------------------------------------------

/**
 * Per-feed outcome of a manual Open House sync.
 */
export interface OhFeedSyncReport {
  feed: "cmc" | "sjsr";
  /** Human label for the UI ("Cape May County", "South Jersey Shore"). */
  label: string;
  ok: boolean;
  /** Open House rows upserted this run (not "new" — upserts include updates). */
  synced: number;
  duration_ms: number;
  error?: string;
}

/**
 * Bright's slice of the report. Bright is NOT syncable from a server button —
 * see the note on syncOpenHousesNowAction — so instead of pretending, we
 * report how fresh the Bright data on file actually is and let Larissa decide
 * whether it's current enough.
 */
export interface OhBrightStatus {
  /** Bright OHs currently on file whose window hasn't closed yet. */
  upcoming: number;
  /** When the Bright portal rows were last refreshed. */
  last_synced_at: string | null;
  /** Why it can't run from this button, in one sentence, for the UI. */
  note: string;
}

export interface OhSyncReport {
  ok: boolean;
  feeds: OhFeedSyncReport[];
  bright: OhBrightStatus;
  /** Total OH rows upserted across CMC + SJSR. */
  total_synced: number;
  /** Upcoming OH count across ALL sources after the sync — what Larissa cares about. */
  upcoming_total: number;
  finished_at: string;
}

const OH_FEED_LABELS: Record<"cmc" | "sjsr", string> = {
  cmc: "Cape May County",
  sjsr: "South Jersey Shore",
};

/**
 * Invoke the mls-rets-sync Edge Function in OH-only mode for one feed.
 *
 * Same service-role auth as every other Edge Function call in the app
 * (lib/sync/actions.ts). Never throws — a feed that's down shouldn't take the
 * other feed's results with it, so failures come back as a report row.
 */
async function invokeOpenHouseSync(
  feed: "cmc" | "sjsr",
): Promise<OhFeedSyncReport> {
  const base: OhFeedSyncReport = {
    feed,
    label: OH_FEED_LABELS[feed],
    ok: false,
    synced: 0,
    duration_ms: 0,
  };
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      ...base,
      error: "Supabase URL / service role key not configured on the server.",
    };
  }
  try {
    const res = await fetch(`${url}/functions/v1/mls-rets-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      // mode="open_houses" selects the Edge Function's OH-only fast path
      // (~2-4s). Older deployed versions of the function don't know the key
      // and simply ignore it, falling through to the full listing+photo sync
      // — slower (~15s) but it still refreshes open houses, so this button
      // degrades to "correct but sluggish" rather than breaking if the app
      // ships ahead of the function.
      body: JSON.stringify({ feed_short_code: feed, mode: "open_houses" }),
      cache: "no-store",
    });
    const raw = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      open_houses_synced?: number;
      duration_ms?: number;
      errors?: unknown[];
    };
    if (!res.ok && !raw.errors) {
      return { ...base, error: `Sync service returned HTTP ${res.status}.` };
    }
    const errs = (raw.errors ?? [])
      .map((e) =>
        typeof e === "string" ? e : ((e as { message?: string })?.message ?? ""),
      )
      .filter(Boolean);
    return {
      ...base,
      ok: Boolean(raw.ok),
      synced: Number(raw.open_houses_synced) || 0,
      duration_ms: Number(raw.duration_ms) || 0,
      error: errs.length > 0 ? errs[0] : undefined,
    };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

/**
 * "Sync Open Houses" — the on-demand refresh Larissa runs right before she
 * builds a multi-property Open House post.
 *
 * WHAT THIS DOES SYNC
 *   CMC and SJSR (Paragon RETS). Both run server-side, in parallel, through
 *   the Edge Function's OH-only fast path. ~2-4s each.
 *
 * WHAT THIS CANNOT SYNC, AND WHY
 *   Bright. Two independent blocks, either one of which is sufficient:
 *     1. Bright's RETS account 3399514 carries a `Bright Restrict Open House`
 *        group — the OpenHouse resource answers 20201 (access denied). There
 *        is no server-side Bright OH feed to call. Removing that group is a
 *        request open with Bright; the day it clears, this action gains a
 *        third feed and nothing else changes.
 *     2. The stopgap we use today — Larissa's Matrix client portal — is a
 *        browser-session-scoped page that robots.txt disallows, so it can't
 *        be fetched from a server at all. It's driven by hand through Claude.
 *   Rather than ship a button that silently covers two of three MLSs, we
 *   report Bright's actual freshness so the gap is visible at the moment it
 *   matters. Bright portal rows are stored as feed_short_code='manual' with
 *   an oh_unique_id prefixed 'portal-', which is what distinguishes them from
 *   Larissa's hand-typed entries.
 */
export async function syncOpenHousesNowAction(): Promise<OhSyncReport> {
  await requireAdmin();
  const supabase = createAdminClient();

  const [cmc, sjsr] = await Promise.all([
    invokeOpenHouseSync("cmc"),
    invokeOpenHouseSync("sjsr"),
  ]);
  const feeds = [cmc, sjsr];

  const nowIso = new Date().toISOString();

  // Bright freshness — read AFTER the sync so the counts below reflect one
  // consistent view of the table.
  let brightUpcoming = 0;
  let brightLastSynced: string | null = null;
  try {
    const { data } = await supabase
      .from("open_houses")
      .select("end_at, last_synced_at")
      .eq("feed_short_code", "manual")
      .like("oh_unique_id", "portal-%")
      .order("last_synced_at", { ascending: false });
    const rows = (data ?? []) as Array<{
      end_at: string | null;
      last_synced_at: string | null;
    }>;
    brightUpcoming = rows.filter(
      (r) => r.end_at !== null && r.end_at > nowIso,
    ).length;
    brightLastSynced = rows[0]?.last_synced_at ?? null;
  } catch (e) {
    console.warn(
      "[open-house-actions] bright freshness read failed:",
      e instanceof Error ? e.message : e,
    );
  }

  // Everything upcoming, all sources — the number that actually tells Larissa
  // whether she has enough to build with.
  let upcomingTotal = 0;
  try {
    const { count } = await supabase
      .from("open_houses")
      .select("id", { count: "exact", head: true })
      .gt("end_at", nowIso);
    upcomingTotal = count ?? 0;
  } catch (e) {
    console.warn(
      "[open-house-actions] upcoming count failed:",
      e instanceof Error ? e.message : e,
    );
  }

  revalidatePath("/post-builder");
  revalidatePath("/post-builder/multi-oh");
  revalidatePath("/");

  return {
    ok: feeds.every((f) => f.ok),
    feeds,
    bright: {
      upcoming: brightUpcoming,
      last_synced_at: brightLastSynced,
      note:
        "Bright's Open House feed is still licence-restricted on our RETS account, so it can't be pulled from here. Bright open houses are loaded separately — ask Claude to run the Matrix portal sync, or add one by hand.",
    },
    total_synced: feeds.reduce((s, f) => s + f.synced, 0),
    upcoming_total: upcomingTotal,
    finished_at: nowIso,
  };
}
