import "server-only";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
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
 * 2026-05-27 — REWRITTEN to query `cmc_active_agents` + `sjsr_active_agents`
 * in parallel. The previous implementation hit the `agents` table whose
 * `.phone` column is 0/259 populated in production. The active-feed tables
 * carry the real data (CMC: 2007/2088 phone1 populated; SJSR: 2655/3321).
 *
 * Three-pass strategy (per table, in parallel union semantics — return
 * the first non-null phone1 from any pass):
 *
 *   1. EXACT first+last — `LOWER(first_name) ILIKE first` AND
 *      `LOWER(last_name) ILIKE last`. Handles the common case where
 *      Darwin's split-name columns match the MLS feed verbatim.
 *
 *   2. LAST-NAME fallback — `LOWER(last_name) ILIKE '%${last}%'` limit 50
 *      then normalize-compare each row's `first_name + last_name` against
 *      the input. Catches "John J. Koch" ↔ "John Koch" style mismatches.
 *
 *   3. SINGLE-RESULT — if exactly one row matched the last-name LIKE
 *      across both tables combined, accept it as a best-effort match.
 *      Handles minor first-name mismatches like "Bob" / "Robert" where
 *      the last name is unique enough to confirm identity.
 *
 * Returns the raw phone1 string as stored — formatting is the caller's
 * responsibility via `formatPhone()`. Returns null when no match or any
 * failure (network blip, missing env vars, etc.).
 */
export async function fetchAgentPhone(
  agentName: string,
): Promise<string | null> {
  const norm = normalizeAgentName(agentName);
  if (!norm) return null;
  const [first, last] = norm.split(" ");
  if (!first) return null;

  // ---- Pass 0: mls_agents.phone_override (AllianceAnalytics-side) ----
  // 2026-05-27 — an explicit override surface for agents whose phones
  // aren't carried by the MLS feeds (CMC/SJSR `phone1` columns) but DO
  // exist elsewhere (Darwin, manual entry, etc.). Checked first so it
  // wins over MLS-sourced data when both exist. Mirrors the existing
  // `headshot_label_override` pattern on the same table.
  try {
    const adminClient = createAdminClient();
    const { data: overrideRow } = await adminClient
      .from("mls_agents")
      .select("phone_override")
      .ilike("full_name", agentName.trim())
      .not("phone_override", "is", null)
      .limit(1)
      .maybeSingle();
    const override = (overrideRow as { phone_override: string | null } | null)
      ?.phone_override?.trim();
    if (override) return override;
  } catch {
    // Fall through to MLS-sourced lookup on any failure.
  }

  const supabase = getAllianceDashClient();
  if (!supabase) return null;

  // why: a tiny helper to extract a trimmed phone1 string from a row,
  // returning "" when the column is null/undefined/non-string. Used
  // throughout all three passes to keep the branching readable.
  const pickPhone = (
    row: { phone1: string | null } | null | undefined,
  ): string => {
    if (!row) return "";
    return typeof row.phone1 === "string" ? row.phone1.trim() : "";
  };

  const lastNeedle = last ?? first;

  // ---- Pass 1: EXACT first+last across both tables, parallel ----
  try {
    const [cmcExact, sjsrExact] = await Promise.all([
      supabase
        .from("cmc_active_agents")
        .select("phone1")
        .ilike("first_name", first)
        .ilike("last_name", lastNeedle)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("sjsr_active_agents")
        .select("phone1")
        .ilike("first_name", first)
        .ilike("last_name", lastNeedle)
        .limit(1)
        .maybeSingle(),
    ]);
    const cmcPhone = pickPhone(
      cmcExact.data as { phone1: string | null } | null,
    );
    if (cmcPhone) return cmcPhone;
    const sjsrPhone = pickPhone(
      sjsrExact.data as { phone1: string | null } | null,
    );
    if (sjsrPhone) return sjsrPhone;
  } catch {
    // Fall through to the last-name fallback path on any failure.
  }

  // ---- Pass 2 + 3: LAST-NAME fallback + single-result tiebreaker ----
  try {
    const [cmcRes, sjsrRes] = await Promise.all([
      supabase
        .from("cmc_active_agents")
        .select("first_name, last_name, phone1")
        .ilike("last_name", `%${lastNeedle}%`)
        .limit(50),
      supabase
        .from("sjsr_active_agents")
        .select("first_name, last_name, phone1")
        .ilike("last_name", `%${lastNeedle}%`)
        .limit(50),
    ]);

    type AgentRow = {
      first_name: string | null;
      last_name: string | null;
      phone1: string | null;
    };
    const cmcRows: AgentRow[] = (cmcRes.data as AgentRow[] | null) ?? [];
    const sjsrRows: AgentRow[] = (sjsrRes.data as AgentRow[] | null) ?? [];
    const combined: AgentRow[] = [...cmcRows, ...sjsrRows];

    // Pass 2 — normalize-compare each result's first+last against input.
    for (const row of combined) {
      const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      if (!full) continue;
      const rowNorm = normalizeAgentName(full);
      if (!rowNorm) continue;
      if (rowNorm === norm) {
        const p = pickPhone(row);
        if (p) return p;
      }
    }

    // Pass 3 — single-result tiebreaker. If exactly one row across BOTH
    // tables matched the last-name LIKE, accept it as best-effort.
    if (combined.length === 1) {
      const p = pickPhone(combined[0]);
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
