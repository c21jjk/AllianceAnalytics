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

  // 2026-05-28 — Bug 1 diagnostics: surface env var presence at first
  // call so prod logs make it obvious whether ALLIANCE_DASH_* are wired
  // into the Vercel project. Cached branch on subsequent calls stays
  // silent to avoid log spam.
  console.log("[alliance-dash] env vars:", {
    hasUrl: !!url,
    hasKey: !!anonKey,
  });

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
 * Returns true when two first-name strings have a prefix relationship —
 * either is a case-insensitive prefix of the other AND the shorter string
 * is at least 2 characters long.
 *
 * Catches abbreviation cases like "Ed" ↔ "Edward", "Liz" ↔ "Elizabeth",
 * "Beth" ↔ "Bethany". Does NOT catch nicknames with different roots:
 * "Bob" ↔ "Robert", "Bill" ↔ "William", "Dick" ↔ "Richard" — those still
 * need a manual `headshot_label_override` / `phone_override` row.
 *
 * The min-2-char guard prevents single-letter inputs ("J") from matching
 * every James/John/Judith/Justin in the roster.
 */
function firstNameMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length < y.length ? x : y;
  const longer = x.length < y.length ? y : x;
  if (shorter.length < 2) return false;
  return longer.startsWith(shorter);
}

/**
 * Bright office codes for the 6 C21 Alliance offices on the Bright feed —
 * mirrors `mls_feeds.office_filter` for short_code='bright' (analytics DB).
 * Used ONLY to scope the bulk roster preload; the per-name lookup searches
 * the full Bright roster so co-op hosts resolve too.
 */
const BRIGHT_ALLIANCE_OFFICE_IDS = [
  "YALL02",
  "YALL03",
  "YALL05",
  "YALL06",
  "YALL10",
  "C21ALLWW",
];

/**
 * Resolve an agent's phone number against the Alliance Dash roster.
 *
 * 2026-05-27 — REWRITTEN to query `cmc_active_agents` + `sjsr_active_agents`
 * in parallel. The previous implementation hit the `agents` table whose
 * `.phone` column is 0/259 populated in production. The active-feed tables
 * carry the real data (CMC: 2007/2088 phone1 populated; SJSR: 2655/3321).
 *
 * 2026-08-15 — ADDED `bright_active_agents` as a third source so Open House
 * posts for Bright-feed listings (Gloucester/Burlington/Camden + Manahawkin)
 * get a phone too. Bright's `phone1` is the RETS `Agent:Member` resource's
 * `MemberPreferredPhone` — the same number Market View shows in Alliance
 * Dash (verified live 2026-08-15). CMC/SJSR keep precedence: they carry the
 * agent-entered cell for shore agents, while Bright's preferred slot is
 * occasionally an office line. Bright fills the gap when CMC/SJSR miss.
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
  console.log("[fetchAgentPhone] looking up:", agentName);

  const norm = normalizeAgentName(agentName);
  if (!norm) {
    console.log("[fetchAgentPhone] name didn't normalize, returning null:", agentName);
    return null;
  }
  const [first, last] = norm.split(" ");
  if (!first) {
    console.log("[fetchAgentPhone] no first-name token, returning null:", agentName);
    return null;
  }

  // ---- Pass 0: mls_agents.phone_override (AllianceAnalytics-side) ----
  // 2026-05-27 — an explicit override surface for agents whose phones
  // aren't carried by the MLS feeds (CMC/SJSR `phone1` columns) but DO
  // exist elsewhere (Darwin, manual entry, etc.). Checked first so it
  // wins over MLS-sourced data when both exist. Mirrors the existing
  // `headshot_label_override` pattern on the same table.
  //
  // 2026-05-28 — Bug 1 diagnostics: emit pass-0 outcome explicitly so we
  // can see when the override path fires vs. when it falls through to
  // MLS-sourced lookup. Production logs were silent on this branch
  // before, making it impossible to tell whether the override surface
  // was even being consulted.
  let hasAdminClient = false;
  try {
    const adminClient = createAdminClient();
    hasAdminClient = true;
    const { data: overrideRow, error: overrideError } = await adminClient
      .from("mls_agents")
      .select("phone_override")
      .ilike("full_name", agentName.trim())
      .not("phone_override", "is", null)
      .limit(1)
      .maybeSingle();
    const override = (overrideRow as { phone_override: string | null } | null)
      ?.phone_override?.trim();
    console.log("[fetchAgentPhone] override result:", {
      agentName,
      hasClient: hasAdminClient,
      override: override ?? null,
      error: overrideError?.message ?? null,
    });
    if (override) {
      console.log("[fetchAgentPhone] returning override:", override);
      return override;
    }
  } catch (err) {
    console.error("[fetchAgentPhone] pass 0 failed:", err);
    // Fall through to MLS-sourced lookup on any failure.
  }

  const supabase = getAllianceDashClient();
  if (!supabase) {
    console.log(
      "[fetchAgentPhone] no Alliance Dash client (env vars missing), returning null for:",
      agentName,
    );
    return null;
  }

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

  // ---- Pass 1: EXACT first+last across all three tables, parallel ----
  try {
    const [cmcExact, sjsrExact, brightExact] = await Promise.all([
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
      supabase
        .from("bright_active_agents")
        .select("phone1")
        .ilike("first_name", first)
        .ilike("last_name", lastNeedle)
        .limit(1)
        .maybeSingle(),
    ]);
    console.log("[fetchAgentPhone] pass 1 result:", {
      agentName,
      cmcHasRow: !!cmcExact.data,
      cmcError: cmcExact.error?.message ?? null,
      sjsrHasRow: !!sjsrExact.data,
      sjsrError: sjsrExact.error?.message ?? null,
      brightHasRow: !!brightExact.data,
      brightError: brightExact.error?.message ?? null,
    });
    const cmcPhone = pickPhone(
      cmcExact.data as { phone1: string | null } | null,
    );
    if (cmcPhone) {
      console.log("[fetchAgentPhone] returning pass-1 CMC phone:", cmcPhone);
      return cmcPhone;
    }
    const sjsrPhone = pickPhone(
      sjsrExact.data as { phone1: string | null } | null,
    );
    if (sjsrPhone) {
      console.log("[fetchAgentPhone] returning pass-1 SJSR phone:", sjsrPhone);
      return sjsrPhone;
    }
    const brightPhone = pickPhone(
      brightExact.data as { phone1: string | null } | null,
    );
    if (brightPhone) {
      console.log(
        "[fetchAgentPhone] returning pass-1 Bright phone:",
        brightPhone,
      );
      return brightPhone;
    }
  } catch (err) {
    console.error("[fetchAgentPhone] pass 1 failed:", err);
    // Fall through to the last-name fallback path on any failure.
  }

  // ---- Pass 2 + 3: LAST-NAME fallback + single-result tiebreaker ----
  try {
    const [cmcRes, sjsrRes, brightRes] = await Promise.all([
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
      supabase
        .from("bright_active_agents")
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
    const brightRows: AgentRow[] = (brightRes.data as AgentRow[] | null) ?? [];
    // why this order: CMC/SJSR first so the shore feeds' agent-entered cell
    // wins pass 2 when the same person exists in multiple rosters; Bright
    // (MemberPreferredPhone) fills in when the shore feeds miss.
    const combined: AgentRow[] = [...cmcRows, ...sjsrRows, ...brightRows];
    console.log("[fetchAgentPhone] pass 2/3 row counts:", {
      agentName,
      cmcRows: cmcRows.length,
      cmcError: cmcRes.error?.message ?? null,
      sjsrRows: sjsrRows.length,
      sjsrError: sjsrRes.error?.message ?? null,
      brightRows: brightRows.length,
      brightError: brightRes.error?.message ?? null,
    });

    // Pass 2 — normalize-compare each result's first+last against input.
    for (const row of combined) {
      const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      if (!full) continue;
      const rowNorm = normalizeAgentName(full);
      if (!rowNorm) continue;
      if (rowNorm === norm) {
        const p = pickPhone(row);
        if (p) {
          console.log("[fetchAgentPhone] returning pass-2 phone:", p);
          return p;
        }
      }
    }

    // Pass 3 — single-result tiebreaker. If exactly one row across BOTH
    // tables matched the last-name LIKE, accept it as best-effort.
    if (combined.length === 1) {
      const p = pickPhone(combined[0]);
      if (p) {
        console.log("[fetchAgentPhone] returning pass-3 phone:", p);
        return p;
      }
    }

    // ---- Pass 4: abbreviated first-name match ----
    // 2026-05-28 — when normalize first+last and single-result both miss,
    // walk the combined CMC+SJSR result set looking for a row whose
    // first_name has a prefix relationship with the input's first name.
    // Handles "Ed" ↔ "Edward" and similar abbreviation pairs without
    // requiring a phone_override row.
    for (const row of combined) {
      if (!row.first_name) continue;
      if (firstNameMatches(first, row.first_name)) {
        const p = pickPhone(row);
        if (p) {
          console.log("[fetchAgentPhone] pass 4 prefix match:", {
            input: agentName,
            matched: `${row.first_name} ${row.last_name}`,
            phone: p,
          });
          return p;
        }
      }
    }
    console.log("[fetchAgentPhone] no match found, returning null for:", agentName);
    return null;
  } catch (err) {
    console.error("[fetchAgentPhone] pass 2/3 failed:", err);
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


// ---------------------------------------------------------------------------
// Bulk phone index — for the /agents roster page (2026-08-14)
// ---------------------------------------------------------------------------

/**
 * A phone we could resolve for one agent, and which pass found it.
 */
export interface ResolvedRosterPhone {
  phone: string;
  match: "exact" | "sole" | "prefix";
}

/**
 * Pre-loaded CMC + SJSR + Bright(Alliance offices) rosters, indexed for
 * in-memory matching.
 *
 * why this exists: `fetchAgentPhone` is correct but issues up to four
 * round trips per name. The /agents page asks about ~260 agents at once,
 * and 261 of those 262 have a NULL `mls_agents.phone` because the RETS
 * feeds do not carry it — the real number lives in Alliance Dash. Calling
 * the per-name function in a loop would be a thousand queries, and NOT
 * calling it would make the page claim almost everybody is missing a phone
 * when they are not. So: pull both rosters once, match with exactly the
 * same passes, in memory.
 *
 * The passes below mirror `fetchAgentPhone` passes 1 to 4. If you change
 * the matching there, change it here, or the roster page will disagree with
 * what actually renders on a slide.
 */
export interface AllianceDashPhoneIndex {
  lookup(fullName: string): ResolvedRosterPhone | null;
  /** Row count loaded, for logging. */
  size: number;
}

interface RosterRow {
  first: string;
  last: string;
  phone: string;
}

/**
 * Load both Alliance Dash rosters and return an in-memory matcher.
 *
 * Returns null when the ALLIANCE_DASH_* env vars are absent, which is the
 * same "no client" condition `fetchAgentPhone` already handles by returning
 * null. Callers should treat null as "cannot tell", NOT as "no phone".
 */
export async function loadAllianceDashPhoneIndex(): Promise<AllianceDashPhoneIndex | null> {
  const supabase = getAllianceDashClient();
  if (!supabase) return null;

  const rows: RosterRow[] = [];
  try {
    // 2026-08-15 — bright_active_agents joined the preload. It is scoped to
    // the 6 Alliance office codes because the full Bright roster is ~34k
    // rows (way past the 5000 cap) and the roster page only asks about our
    // own agents anyway. Order matters: CMC/SJSR rows land first so byNorm
    // keeps their (agent-entered cell) number when the same agent also has
    // a Bright row.
    const [cmcRes, sjsrRes, brightRes] = await Promise.all([
      supabase
        .from("cmc_active_agents")
        .select("first_name, last_name, phone1")
        .limit(5000),
      supabase
        .from("sjsr_active_agents")
        .select("first_name, last_name, phone1")
        .limit(5000),
      supabase
        .from("bright_active_agents")
        .select("first_name, last_name, phone1")
        .in("office_id", BRIGHT_ALLIANCE_OFFICE_IDS)
        .limit(5000),
    ]);
    type Row = {
      first_name: string | null;
      last_name: string | null;
      phone1: string | null;
    };
    for (const r of [
      ...(((cmcRes.data as Row[] | null) ?? [])),
      ...(((sjsrRes.data as Row[] | null) ?? [])),
      ...(((brightRes.data as Row[] | null) ?? [])),
    ]) {
      const phone = typeof r.phone1 === "string" ? r.phone1.trim() : "";
      if (!phone) continue;
      const first = (r.first_name ?? "").trim();
      const last = (r.last_name ?? "").trim();
      if (!first && !last) continue;
      rows.push({ first, last, phone });
    }
  } catch (err) {
    console.error("[alliance-dash] roster preload failed:", err);
    return null;
  }

  const byNorm = new Map<string, string>();
  const byLast = new Map<string, RosterRow[]>();
  for (const row of rows) {
    const norm = normalizeAgentName(`${row.first} ${row.last}`.trim());
    if (norm && !byNorm.has(norm)) byNorm.set(norm, row.phone);
    const lastKey = row.last.toLowerCase();
    if (!lastKey) continue;
    const list = byLast.get(lastKey) ?? [];
    list.push(row);
    byLast.set(lastKey, list);
  }

  return {
    size: rows.length,
    lookup(fullName: string): ResolvedRosterPhone | null {
      const norm = normalizeAgentName(fullName);
      if (!norm) return null;
      const [first, last] = norm.split(" ");
      if (!first) return null;

      // Pass 1 + 2 collapse to the same thing once both sides are
      // normalized: exact first+last.
      const exact = byNorm.get(norm);
      if (exact) return { phone: exact, match: "exact" };

      const lastKey = (last ?? first).toLowerCase();
      const candidates = byLast.get(lastKey) ?? [];

      // Pass 3 — exactly one person carries that surname.
      if (candidates.length === 1) {
        return { phone: candidates[0].phone, match: "sole" };
      }

      // Pass 4 — "Ed" matches "Edward".
      for (const row of candidates) {
        if (row.first && firstNameMatches(first, row.first)) {
          return { phone: row.phone, match: "prefix" };
        }
      }
      return null;
    },
  };
}
