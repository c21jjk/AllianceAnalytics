/**
 * Agent roster: who we have a headshot and a phone number for, and who we
 * don't.
 *
 * 2026-08-14 (John): "if an Agent doesnt have a head shot or phone # in the
 * database, I need us (me, Cheryl and larissa) to be able to add it somehow
 * and have it save in database."
 *
 * The write side already existed and nobody could reach it. `mls_agents` has
 * carried `phone_override` and `headshot_label_override` for months, and the
 * render path already honours both — `fetchAgentPhone` reads phone_override
 * as its very first pass, `fetchAgentHeadshotUrl` resolves a headshot through
 * headshot_label_override before it tries name matching, and the render route
 * even logs "Add an mls_agents.phone_override row" when a phone comes back
 * empty. There was simply no screen that wrote either column. This module is
 * the read side of that screen.
 *
 * WHY A BULK RESOLVER RATHER THAN CALLING fetchAgentHeadshotUrl PER AGENT:
 * that function issues two to three queries per name. Over a ~200 agent
 * roster that is several hundred round trips for one page load. Here we pull
 * the whole headshot table once (~205 active rows) and run the same matching
 * passes in memory. The passes below are deliberately a mirror of
 * lib/data/owner-story-db.ts — if you change the matching there, change it
 * here, or the page will confidently tell Cheryl an agent has a photo that
 * the renderer cannot find.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { loadAllianceDashPhoneIndex } from "@/lib/data/alliance-dash-agents";

/**
 * mls_agents.phone_override is absent from the generated Database type and
 * headshot_label_override is missing from its Insert shape, so anything that
 * writes them needs the escape hatch. Same idiom as
 * app/(app)/settings/buildings/actions.ts. Regenerate types after this lands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;
function untyped(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

/** How an agent's headshot was found, so the page can explain itself. */
export type HeadshotMatch =
  | "override" // headshot_label_override pointed at a brand_assets label
  | "exact" // normalized first+last matched a label
  | "sole" // only one headshot carried that last name
  | "prefix" // "Ed" matched "Edward"
  | "none"; // nothing found — this is the row Cheryl needs to fix

/** Where the phone we would print came from. */
export type PhoneSource =
  | "override" // somebody set it on this page
  | "feed" // mls_agents.phone, straight from the RETS roster sync
  | "roster" // matched in the Alliance Dash CMC/SJSR roster
  | "none" // genuinely nowhere to be found
  | "unknown"; // Alliance Dash unreachable, so we cannot claim it is missing

export interface AgentRosterRow {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  source: string | null;
  source_office_id: string | null;
  office_label: string | null;
  is_active: boolean;

  /** Raw feed phone, untouched by us. */
  feed_phone: string | null;
  /** What somebody typed on this page, if anything. */
  phone_override: string | null;
  /** What we would actually print today. */
  effective_phone: string | null;
  phone_source: PhoneSource;

  /** The label somebody pinned this agent to, if anything. */
  headshot_label_override: string | null;
  /** The image we would actually print today. */
  headshot_url: string | null;
  headshot_match: HeadshotMatch;
  /** brand_assets.label the photo came from, for display. */
  headshot_label: string | null;
  /** True when the photo came from an in-app upload rather than Drive. */
  headshot_is_manual: boolean;
}

export interface AgentRoster {
  rows: AgentRosterRow[];
  /**
   * False when the Alliance Dash env vars are missing, so the page can say
   * "cannot check" instead of libelling 260 agents as phoneless.
   */
  phoneLookupAvailable: boolean;
  /** Every active headshot label, for the override picker. */
  headshotLabels: string[];
  counts: {
    total: number;
    missingPhoto: number;
    missingPhone: number;
    missingEither: number;
  };
}

/**
 * Normalize to "first last", lowercased, punctuation stripped.
 *
 * Copied deliberately from lib/data/owner-story-db.ts rather than imported:
 * that one is module-private, and lib/data/brand-asset-resolver.ts exports a
 * DIFFERENT normalizer that also strips noise words like "headshot". Pulling
 * in the wrong one would silently change which agents look matched.
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

/** "Ed" ↔ "Edward". Mirrors owner-story-db.ts firstNameMatches. */
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

interface HeadshotAsset {
  label: string;
  public_url: string | null;
  source: string | null;
}

/**
 * Load every agent plus the resolved headshot each one would render with.
 *
 * `includeInactive` exists because the roster carries agents who have left;
 * the page defaults to active only so the missing-photo count means
 * something.
 */
export async function getAgentRoster(
  opts: { includeInactive?: boolean } = {},
): Promise<AgentRoster> {
  const supabase = untyped();

  const agentQuery = supabase
    .from("mls_agents")
    .select(
      "id, full_name, first_name, last_name, phone, phone_override, headshot_label_override, source, source_office_id, is_active",
    )
    .order("full_name", { ascending: true });
  if (!opts.includeInactive) agentQuery.eq("is_active", true);

  // why the phone index: `mls_agents.phone` is NULL for 261 of 262 active
  // agents — the RETS feeds simply do not carry it, and the number that
  // actually prints on a slide comes from the Alliance Dash roster at render
  // time. Reading only this table would tell Cheryl that almost everybody is
  // missing a phone, which is both wrong and the fastest way to make her stop
  // trusting the page.
  const [{ data: agentData, error: agentErr }, { data: assetData }, phoneIndex] =
    await Promise.all([
      agentQuery,
      supabase
        .from("brand_assets")
        .select("label, public_url, source")
        .eq("kind", "agent_headshot")
        .eq("status", "active"),
      loadAllianceDashPhoneIndex(),
    ]);

  if (agentErr) {
    console.error("[agent-roster] mls_agents fetch failed:", agentErr.message);
    return {
      rows: [],
      phoneLookupAvailable: phoneIndex !== null,
      headshotLabels: [],
      counts: { total: 0, missingPhoto: 0, missingPhone: 0, missingEither: 0 },
    };
  }

  const assets = ((assetData ?? []) as HeadshotAsset[]).filter(
    (a) => typeof a.label === "string" && a.label.trim().length > 0,
  );

  // Index the headshots once, three ways, so each agent is a map lookup
  // rather than a scan of 205 rows.
  const byLowerLabel = new Map<string, HeadshotAsset>();
  const byNormalized = new Map<string, HeadshotAsset[]>();
  const byLastName = new Map<string, HeadshotAsset[]>();
  for (const asset of assets) {
    byLowerLabel.set(asset.label.trim().toLowerCase(), asset);
    const norm = normalizeAgentName(asset.label);
    if (!norm) continue;
    const list = byNormalized.get(norm) ?? [];
    list.push(asset);
    byNormalized.set(norm, list);
    const last = norm.split(" ")[1] ?? norm;
    const lastList = byLastName.get(last) ?? [];
    lastList.push(asset);
    byLastName.set(last, lastList);
  }

  interface AgentDbRow {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    phone_override: string | null;
    headshot_label_override: string | null;
    source: string | null;
    source_office_id: string | null;
    is_active: boolean | null;
  }

  const rows: AgentRosterRow[] = [];
  for (const a of (agentData ?? []) as AgentDbRow[]) {
    const fullName = (a.full_name ?? "").trim();
    if (!fullName) continue;

    const override = a.headshot_label_override?.trim() ?? null;
    let match: HeadshotMatch = "none";
    let asset: HeadshotAsset | null = null;

    // Pass 1 — explicit override. Same as owner-story-db pass 1.
    if (override) {
      asset = byLowerLabel.get(override.toLowerCase()) ?? null;
      if (asset) match = "override";
    }

    const norm = normalizeAgentName(fullName);
    const first = norm?.split(" ")[0] ?? null;
    const last = norm?.split(" ")[1] ?? first;

    // Pass 2 — exact normalized first+last.
    if (!asset && norm) {
      const hits = byNormalized.get(norm);
      if (hits && hits.length > 0) {
        asset = hits[0];
        match = "exact";
      }
    }

    // Pass 3 — exactly one headshot carries that last name. Mirrors the
    // "data.length === 1" branch, which exists to catch label junk like
    // "Jeanne Gibbons2" that survives normalization.
    if (!asset && last) {
      const hits = byLastName.get(last);
      if (hits && hits.length === 1) {
        asset = hits[0];
        match = "sole";
      }
    }

    // Pass 4 — abbreviated first name against the same last name.
    if (!asset && first && last) {
      const hits = byLastName.get(last) ?? [];
      for (const hit of hits) {
        const hitNorm = normalizeAgentName(hit.label);
        if (!hitNorm) continue;
        const [hitFirst, hitLast] = hitNorm.split(" ");
        if (!hitFirst || !hitLast) continue;
        if (hitLast === last && firstNameMatches(first, hitFirst)) {
          asset = hit;
          match = "prefix";
          break;
        }
      }
    }

    const phoneOverride = a.phone_override?.trim() || null;
    const feedPhone = a.phone?.trim() || null;
    const rosterPhone = phoneOverride || feedPhone
      ? null
      : (phoneIndex?.lookup(fullName)?.phone ?? null);
    const effectivePhone = phoneOverride ?? feedPhone ?? rosterPhone;
    const phoneSource: PhoneSource = phoneOverride
      ? "override"
      : feedPhone
        ? "feed"
        : rosterPhone
          ? "roster"
          : phoneIndex
            ? "none"
            : "unknown";

    rows.push({
      id: a.id,
      full_name: fullName,
      first_name: a.first_name,
      last_name: a.last_name,
      source: a.source,
      source_office_id: a.source_office_id,
      office_label: null,
      is_active: a.is_active !== false,
      feed_phone: feedPhone,
      phone_override: phoneOverride,
      effective_phone: effectivePhone,
      phone_source: phoneSource,
      headshot_label_override: override,
      headshot_url: asset?.public_url ?? null,
      headshot_match: asset ? match : "none",
      headshot_label: asset?.label ?? null,
      headshot_is_manual: asset?.source === "manual",
    });
  }

  const missingPhoto = rows.filter((r) => !r.headshot_url).length;
  // "unknown" is deliberately not counted as missing — see phoneLookupAvailable.
  const missingPhone = rows.filter((r) => r.phone_source === "none").length;
  const missingEither = rows.filter(
    (r) => !r.headshot_url || r.phone_source === "none",
  ).length;

  return {
    rows,
    phoneLookupAvailable: phoneIndex !== null,
    headshotLabels: assets
      .map((a) => a.label.trim())
      .sort((x, y) => x.localeCompare(y)),
    counts: {
      total: rows.length,
      missingPhoto,
      missingPhone,
      missingEither,
    },
  };
}
