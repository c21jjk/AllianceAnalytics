import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeAgentName,
  firstNameMatches,
} from "@/lib/data/agent-name-match";

/**
 * The one cascade that decides which Studio headshot an agent renders with.
 *
 * 2026-08-21 (John): "there's a few Agent photos that are not flowing through
 * to the templates, but they are in studio Agent pics."
 *
 * They were in the library. The template just could not see them, because
 * two DIFFERENT resolvers had grown up on two different surfaces:
 *
 *   • `owner-story-db.ts#fetchAgentHeadshotUrl` — used for the Open House
 *     HOSTING agent. Honours `mls_agents.headshot_label_override`, reduces
 *     names to first+last, and falls back through fuzzy passes.
 *
 *   • `brand-asset-resolver.ts#resolveAgentHeadshotUrl` — used for the
 *     `agent_photo` layer on every DB template, i.e. the actual listing
 *     agent on the actual slide. It compared the FULL normalized string,
 *     token for token, and knew nothing about overrides. So "Jacqueline A
 *     Self" never matched "Jacqueline Self", "Philip Dougherty IV" never
 *     matched "Philip Dougherty", and — the part that made this so hard to
 *     believe from the outside — an override that Cheryl set on /agents,
 *     which made the roster page proudly report "matched", changed nothing
 *     about what the template rendered.
 *
 * On the live library that gap was 160 of 262 active agents resolving on the
 * template path versus 206 on the hosting path. This module is the single
 * cascade both now run, so a photo that /agents says an agent has is the
 * photo that comes out of the renderer.
 *
 * Pass order, most trustworthy first:
 *   1. OVERRIDE  — somebody pinned this agent to a label by hand. Always wins.
 *   2. EXACT     — normalized first+last are identical.
 *   3. NICKNAME  — surname identical AND first names are the same name
 *                  ("Chuck" ↔ "Charles", "Ed" ↔ "Edward").
 *   4. SOLE      — exactly one active headshot carries that surname, and
 *                  nobody else has a better claim on it. See the guard below.
 */

/** Where a headshot came from, so callers (and /agents) can explain themselves. */
export type HeadshotMatchKind = "override" | "exact" | "nickname" | "sole";

export interface ResolvedHeadshot {
  url: string;
  label: string;
  match: HeadshotMatchKind;
}

interface HeadshotRow {
  label: string;
  public_url: string | null;
  office_id?: string | null;
}

/**
 * Would a DIFFERENT active agent match this label by name?
 *
 * This is the guard on pass 4, and it exists because pass 4 was quietly
 * handing out the wrong person's face. On the live roster the bare
 * "only one headshot has that surname, take it" rule produced:
 *
 *   Dorothy Macquade → Mitch Macquade's photo  (Mitchell is his own agent)
 *   Jeffrey Turner   → Kimberly Turner's photo (Kimberly is her own agent)
 *   Priscilla Wilson → Michael Wilson's photo  (Michael is his own agent)
 *
 * In every one of those the library was not missing a photo — it had someone
 * else's, and the surname collision was the whole of the "match". A face on a
 * marketing graphic is an attribution claim, so a wrong one is worse than a
 * blank frame: leave the frame empty and let /agents flag it.
 *
 * The check is deliberately narrow. It only fires on the loosest pass, and
 * only when another ACTIVE agent would match that same label by exact or
 * nickname — a strictly stronger claim than the surname coincidence we are
 * about to act on.
 */
async function labelIsClaimedByAnotherAgent(
  label: string,
  selfNorm: string,
): Promise<boolean> {
  const labelNorm = normalizeAgentName(label);
  if (!labelNorm) return false;
  const [labelFirst, labelLast] = labelNorm.split(" ");
  if (!labelFirst || !labelLast) return false;

  try {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("mls_agents")
      .select("full_name")
      .eq("is_active", true);

    for (const row of (data ?? []) as Array<{ full_name: string | null }>) {
      const otherNorm = normalizeAgentName(row.full_name ?? "");
      if (!otherNorm || otherNorm === selfNorm) continue;
      const [otherFirst, otherLast] = otherNorm.split(" ");
      if (!otherFirst || otherLast !== labelLast) continue;
      if (otherNorm === labelNorm || firstNameMatches(otherFirst, labelFirst)) {
        return true;
      }
    }
    return false;
  } catch {
    // Cannot prove the label is free, so do not claim it.
    return true;
  }
}

/**
 * Resolve an agent's Studio headshot.
 *
 * `officeId`, when supplied, only breaks ties between equally-good exact
 * matches — it never promotes a weaker match.
 *
 * Never throws: every failure degrades to null, and the caller leaves the
 * frame empty. A lookup miss must not take down a render.
 */
export async function resolveAgentHeadshot(
  agentName: string | null | undefined,
  officeId?: string | null,
): Promise<ResolvedHeadshot | null> {
  if (!agentName) return null;
  const norm = normalizeAgentName(agentName);
  if (!norm) return null;
  const [first, last] = norm.split(" ");
  if (!first) return null;
  const surname = last ?? first;

  const supabase = createAdminClient();

  // ---- Pass 1: mls_agents.headshot_label_override ----
  // Set by John / Cheryl / Larissa on /agents when a name simply will not
  // match by algorithm ("Nicolette Gorski" → the library's "Nikki Gorski").
  // Checked first so a human decision always beats a heuristic.
  try {
    const { data: agentRow } = await supabase
      .from("mls_agents")
      .select("headshot_label_override")
      .ilike("full_name", agentName.trim())
      .not("headshot_label_override", "is", null)
      .limit(1)
      .maybeSingle();
    const overrideLabel = agentRow?.headshot_label_override?.trim();
    if (overrideLabel) {
      const { data: overrideRow } = await supabase
        .from("brand_assets")
        .select("label, public_url")
        .eq("kind", "agent_headshot")
        .eq("status", "active")
        .ilike("label", overrideLabel)
        .limit(1)
        .maybeSingle();
      if (overrideRow?.public_url) {
        return {
          url: overrideRow.public_url,
          label: overrideRow.label ?? overrideLabel,
          match: "override",
        };
      }
    }
  } catch {
    // Fall through — an unreachable override table must not block matching.
  }

  // ---- Candidates: active headshots whose label carries the surname ----
  let candidates: HeadshotRow[] = [];
  try {
    const { data, error } = await supabase
      .from("brand_assets")
      .select("label, public_url, office_id")
      .eq("kind", "agent_headshot")
      .eq("status", "active")
      .ilike("label", `%${surname}%`)
      .limit(50);
    if (error || !data) return null;
    candidates = (data as HeadshotRow[]).filter(
      (r) => typeof r.label === "string" && !!r.public_url,
    );
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  // ---- Pass 2: exact normalized first+last ----
  const exact = candidates.filter((r) => normalizeAgentName(r.label) === norm);
  if (exact.length > 0) {
    const preferred =
      (officeId != null
        ? exact.find((r) => r.office_id === officeId)
        : undefined) ?? exact[0];
    return {
      url: preferred.public_url as string,
      label: preferred.label,
      match: "exact",
    };
  }

  // ---- Pass 3: same surname, same first name by another spelling ----
  // Runs BEFORE the sole pass on purpose: a first name we actually verified
  // is better evidence than "there was only one row".
  for (const row of candidates) {
    const labelNorm = normalizeAgentName(row.label);
    if (!labelNorm) continue;
    const [labelFirst, labelLast] = labelNorm.split(" ");
    if (!labelFirst || !labelLast) continue;
    if (labelLast === surname && firstNameMatches(first, labelFirst)) {
      return {
        url: row.public_url as string,
        label: row.label,
        match: "nickname",
      };
    }
  }

  // ---- Pass 4: sole surname holder, if nobody else has a better claim ----
  if (candidates.length === 1) {
    const only = candidates[0];
    if (!(await labelIsClaimedByAnotherAgent(only.label, norm))) {
      return {
        url: only.public_url as string,
        label: only.label,
        match: "sole",
      };
    }
  }

  return null;
}

/** URL-only convenience wrapper — the shape both legacy call sites want. */
export async function resolveAgentHeadshotUrlShared(
  agentName: string | null | undefined,
  officeId?: string | null,
): Promise<string | null> {
  const hit = await resolveAgentHeadshot(agentName, officeId);
  return hit?.url ?? null;
}
