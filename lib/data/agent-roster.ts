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
import {
  normalizeAgentName,
  firstNameMatches,
} from "@/lib/data/agent-name-match";

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
 * Name matching, shared with the two lookups this page reports on.
 *
 * 2026-08-21 — this file used to carry its own copy, and it had drifted:
 * it split on whitespace only and kept the hyphen inside the word, so
 * "Elvis Ochoa-Rosendo" normalized to "elvis ochoa-rosendo" here but
 * "elvis rosendo" in the renderer. The page was confidently reporting a
 * different answer than production. Now both read
 * lib/data/agent-name-match.ts, so what this page says an agent will
 * render with is what the agent renders with.
 */

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

  // Index by label for the override pass. The normalized/surname indexes
  // that used to live here are gone: the surname pool is now built with the
  // same substring test the resolver's `label ILIKE %surname%` performs, and
  // a prebuilt token index quietly disagreed with it (a "hunt" needle also
  // reaches "Hunter"). 206 labels × 262 agents is a rounding error; being
  // wrong about what the renderer does is not.
  const byLowerLabel = new Map<string, HeadshotAsset>();
  for (const asset of assets) {
    byLowerLabel.set(asset.label.trim().toLowerCase(), asset);
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

  // Every active agent's normalized name, for the pass-4 claim guard below.
  const activeAgentNorms = ((agentData ?? []) as AgentDbRow[])
    .filter((a) => a.is_active !== false)
    .map((a) => normalizeAgentName((a.full_name ?? "").trim()))
    .filter((n): n is string => !!n && n.includes(" "));

  const rows: AgentRosterRow[] = [];
  for (const a of (agentData ?? []) as AgentDbRow[]) {
    const fullName = (a.full_name ?? "").trim();
    if (!fullName) continue;

    const override = a.headshot_label_override?.trim() ?? null;
    let match: HeadshotMatch = "none";
    let asset: HeadshotAsset | null = null;

    // The passes below mirror lib/data/agent-headshot-resolver.ts exactly:
    // override → exact → nickname → guarded sole. This page's whole job is
    // to tell Cheryl what the renderer will do, so a divergence here is not
    // a cosmetic bug — it is the page lying.

    // Pass 1 — explicit override. Always wins.
    if (override) {
      asset = byLowerLabel.get(override.toLowerCase()) ?? null;
      if (asset) match = "override";
    }

    const norm = normalizeAgentName(fullName);
    const first = norm?.split(" ")[0] ?? null;
    const last = norm?.split(" ")[1] ?? first;

    // Candidate pool — active labels CONTAINING the surname. Substring, not
    // token equality, because the resolver's query is `label ILIKE %surname%`
    // and the size of this pool is what gates the sole pass below.
    const candidates =
      !asset && last
        ? assets.filter((x) => x.label.toLowerCase().includes(last))
        : [];

    // Pass 2 — exact normalized first+last.
    if (!asset && norm) {
      const hit = candidates.find((x) => normalizeAgentName(x.label) === norm);
      if (hit) {
        asset = hit;
        match = "exact";
      }
    }

    // Pass 3 — same surname, first name the same by another spelling
    // ("Chuck" ↔ "Charles"). Ahead of the sole pass: a verified first name
    // beats "there was only one row".
    if (!asset && first && last) {
      for (const hit of candidates) {
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

    // Pass 4 — sole surname holder, unless another active agent has a
    // stronger claim on that label. Without the guard this pass gave
    // Dorothy Macquade her colleague Mitchell's face. See the resolver.
    if (!asset && candidates.length === 1 && norm) {
      const only = candidates[0];
      const onlyNorm = normalizeAgentName(only.label);
      const [onlyFirst, onlyLast] = (onlyNorm ?? "").split(" ");
      const claimed =
        !!onlyFirst &&
        !!onlyLast &&
        activeAgentNorms.some((otherNorm) => {
          if (otherNorm === norm) return false;
          const [otherFirst, otherLast] = otherNorm.split(" ");
          if (!otherFirst || otherLast !== onlyLast) return false;
          return otherNorm === onlyNorm || firstNameMatches(otherFirst, onlyFirst);
        });
      if (!claimed) {
        asset = only;
        match = "sole";
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
