import "server-only";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { fetchAgentHeadshotUrl } from "./owner-story-db";
import { formatPhone } from "./phone-format";

// Re-export so callers can grab both the lookup helpers and the formatter
// from this module's surface without a second import line.
export { formatPhone };

/**
 * Cross-project agent lookups against the Alliance Dash Supabase instance.
 *
 * Alliance Dash is the company's source-of-truth roster (Darwin-fed) and
 * carries phone numbers that the AllianceAnalytics database does not. This
 * module's job: resolve the hosting agent's phone (here) + headshot (via
 * the existing `fetchAgentHeadshotUrl` in owner-story-db.ts) so per-property
 * Open House carousel slides can render a "hosted by" corner block.
 *
 * STRICT RULE: Alliance Dash is READ-ONLY-FOR-REFERENCE. This module never
 * writes to the Alliance Dash project. Every query is a SELECT.
 *
 * Failure mode: helpers return null on any error rather than throwing — a
 * missing phone or photo degrades to "name only" on the rendered slide,
 * which is acceptable. Throwing here would take down the whole multi-OH
 * generate flow over a single agent lookup miss.
 */

type AllianceDashClient = SupabaseClient;

let cached: AllianceDashClient | null = null;

/**
 * Lazy module-level singleton for the Alliance Dash anon client. The anon
 * key is fine here because every call is a SELECT against a public-readable
 * table (agents); we never need RLS bypass on this project.
 *
 * Returns null when env vars are missing — caller falls back to "phone
 * unavailable" rather than failing loud. This keeps local dev usable even
 * when the Alliance Dash credentials aren't set in .env.local.
 */
function getAllianceDashClient(): AllianceDashClient | null {
  if (cached) return cached;

  const url = process.env.ALLIANCE_DASH_SUPABASE_URL;
  const anonKey = process.env.ALLIANCE_DASH_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // why: log once at first call so the absence is visible in prod logs
    // without spamming. Subsequent calls in the same process land in the
    // `cached` branch and stay silent.
    console.warn(
      "[alliance-dash-agents] Alliance Dash credentials not configured — agent phone lookup disabled",
    );
    return null;
  }

  cached = createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}

/**
 * Normalize an MLS agent name for matching: lowercased, punctuation
 * stripped, first + last word only. Mirrors `normalizeAgentName` in
 * `owner-story-db.ts` so headshot + phone lookups apply identical logic
 * — "John J. Koch" normalizes to "john koch" in both directions.
 *
 * Returns null when the input has no usable letters (empty, whitespace-
 * only, or all punctuation).
 */
function normalizeAgentName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const parts = trimmed
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z'-]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Resolve an agent's phone number against the Alliance Dash roster.
 *
 * Three-pass strategy (mirrors the photo matcher's spirit):
 *
 *   1. EXACT — query `agents` where `is_active = true` and `full_name`
 *      matches the trimmed input case-insensitively. Handles the common
 *      case where Darwin's `full_name` matches the MLS feed verbatim.
 *
 *   2. LAST-NAME — `ilike full_name '%${last}%'` limit 50, then
 *      normalize-compare each result against the input. Catches
 *      "John J. Koch" ↔ "John Koch" style mismatches.
 *
 *   3. SINGLE-RESULT — if the last-name query returned exactly 1 row,
 *      accept it as a best-effort match. Handles minor first-name
 *      mismatches like "Bob" / "Robert" where the last name is unique
 *      enough to confirm identity. Mirrors the photo matcher's
 *      `data.length === 1` branch.
 *
 * Returns the raw phone string from Darwin as-stored — formatting is the
 * caller's responsibility via `formatPhone()`. Returns null when no match
 * or any failure (network blip, missing env vars, etc.).
 */
export async function fetchAgentPhone(
  agentName: string,
): Promise<string | null> {
  const norm = normalizeAgentName(agentName);
  if (!norm) return null;
  const [first, last] = norm.split(" ");
  if (!first) return null;

  const supabase = getAllianceDashClient();
  if (!supabase) return null;

  // 1) Exact match — Darwin frequently stores the same canonical name MLS uses.
  try {
    const { data: exactRow } = await supabase
      .from("agents")
      .select("phone")
      .eq("is_active", true)
      .ilike("full_name", agentName.trim())
      .limit(1)
      .maybeSingle();
    const exactPhone =
      typeof exactRow?.phone === "string" ? exactRow.phone.trim() : "";
    if (exactPhone) return exactPhone;
  } catch {
    // Fall through to the last-name fallback path on any failure.
  }

  // 2) Last-name fallback — fetch up to 50 candidates and normalize-match in memory.
  try {
    const lastNeedle = last ?? first;
    const { data, error } = await supabase
      .from("agents")
      .select("full_name, phone")
      .eq("is_active", true)
      .ilike("full_name", `%${lastNeedle}%`)
      .limit(50);
    if (error || !data) return null;

    for (const row of data as Array<{
      full_name: string | null;
      phone: string | null;
    }>) {
      if (!row.full_name) continue;
      const rowNorm = normalizeAgentName(row.full_name);
      if (!rowNorm) continue;
      if (rowNorm === norm) {
        const p = typeof row.phone === "string" ? row.phone.trim() : "";
        if (p) return p;
      }
    }

    // 3) Single-result — if exactly one row's last name hit, accept it as
    //    a best-effort match. Same spirit as the photo matcher's tail branch.
    if (data.length === 1) {
      const only = data[0] as { phone: string | null };
      const p = typeof only.phone === "string" ? only.phone.trim() : "";
      if (p) return p;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolved hosting-agent attribution — what the per-property carousel
 * slide needs to render the "hosted by" corner block. All three fields
 * round-trip into the canvas-editor MLSListingPayload via the render
 * token; the bound-field resolvers in `fabric-factory.ts` read them.
 */
export interface AgentAttribution {
  name: string;
  phone: string | null;
  photo_url: string | null;
}

/**
 * Resolve name + phone + photo for an agent in a single fan-out. Photo +
 * phone lookups run in parallel via `Promise.all` to keep the per-agent
 * latency at max(photo, phone) rather than their sum.
 *
 * The `cache` parameter is an in-request memoization Map keyed by the
 * normalized name. The multi-OH route passes one cache for the whole
 * batch so 9 slides that share a hosting agent only resolve once. Pass
 * a fresh `new Map()` for one-off lookups.
 *
 * Returns the bare `{ name }` shape with nulls for phone/photo when the
 * input name doesn't normalize (e.g., empty string). Never throws —
 * underlying helpers swallow their own failures.
 */
export async function getAgentAttribution(
  agentName: string,
  cache: Map<string, Promise<AgentAttribution>> = new Map(),
): Promise<AgentAttribution> {
  const norm = normalizeAgentName(agentName);
  if (!norm) {
    return { name: agentName, phone: null, photo_url: null };
  }
  const cached = cache.get(norm);
  if (cached) return cached;

  const resolving: Promise<AgentAttribution> = (async () => {
    const [photoUrl, rawPhone] = await Promise.all([
      fetchAgentHeadshotUrl(agentName),
      fetchAgentPhone(agentName),
    ]);
    return {
      name: agentName,
      phone: formatPhone(rawPhone),
      photo_url: photoUrl,
    };
  })();

  cache.set(norm, resolving);
  return resolving;
}
