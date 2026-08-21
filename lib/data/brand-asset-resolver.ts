import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentHeadshotUrlShared } from "@/lib/data/agent-headshot-resolver";

/**
 * brand-asset-resolver — resolve per-listing brand assets (agent headshots)
 * out of the `brand_assets` library at render time.
 *
 * The Studio "Agents" library (brand_assets, kind='agent_headshot') stores
 * each agent's photo with their name in `label` and their office in
 * `office_id`. A template that binds the `agent_photo` placeholder needs the
 * LISTING agent's headshot resolved fresh on every post — this module does
 * that name match, the same normalized-name approach the agent-email resolver
 * uses.
 */

/**
 * Normalize an agent name for matching: lowercase, strip punctuation and
 * common non-name noise tokens ("pic", "photo", "headshot", "realtor"),
 * collapse whitespace. So "Mike Wilson Pic" and "mike  wilson" both reduce to
 * "mike wilson".
 */
export function normalizeAgentName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(pic|photo|photos|headshot|headshots|realtor|agent)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve the public URL of an agent's headshot from the brand_assets
 * library.
 *
 * 2026-08-21 (John): "there's a few Agent photos that are not flowing
 * through to the templates, but they are in studio Agent pics."
 *
 * This function was the reason. It matched on the FULL normalized label,
 * token for token, so a middle initial, a generational suffix or a short
 * form was enough to miss: "Jacqueline A Self" ≠ "Jacqueline Self",
 * "Philip Dougherty IV" ≠ "Philip Dougherty", "Charles Meyer" ≠ "Chuck
 * Meyer". It also ignored `mls_agents.headshot_label_override` entirely —
 * so an override set on /agents made the roster page report a match while
 * the template it was supposed to fix carried on rendering nothing.
 *
 * It now delegates to the shared cascade in agent-headshot-resolver.ts,
 * the same one the Open House hosting-agent block runs. On the live library
 * that took template-path resolution from 160 to 206 of 262 active agents.
 *
 * `officeId` still breaks ties between equally-good exact matches. Returns
 * null when no confident match exists — the caller then leaves the frame
 * empty and flags for review, which is the right outcome: see the pass-4
 * guard in the resolver for why a wrong face is worse than no face.
 */
export async function resolveAgentHeadshotUrl(
  agentName: string | null | undefined,
  officeId?: string | null,
): Promise<string | null> {
  return resolveAgentHeadshotUrlShared(agentName, officeId);
}

/**
 * Resolve the public URL of a brand logo from the brand_assets library by
 * EXACT label match (kind='logo', status='active'). Unlike agent headshots,
 * logos are org-wide (office_id is null on every row) and have no per-listing
 * key — the caller picks the canonical label (e.g. "C21 ALLIANCE White" or
 * "Excellence Collection - 2") and this resolves its current URL so a
 * re-uploaded/re-cropped logo flows automatically without editing
 * brand-logos.ts. Returns null when no active row carries that label (the
 * caller then falls back to the frozen brand-logos.ts constant).
 */
export async function resolveBrandLogoUrl(
  label: string | null | undefined,
): Promise<string | null> {
  if (!label) return null;
  const target = label.trim().toLowerCase();
  if (!target) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_assets")
    .select("label, public_url, status")
    .eq("kind", "logo")
    .eq("status", "active");

  if (error || !data) return null;

  const match = data.find(
    (row) =>
      typeof row.label === "string" &&
      typeof row.public_url === "string" &&
      row.public_url.length > 0 &&
      row.label.trim().toLowerCase() === target,
  );
  return match && typeof match.public_url === "string" ? match.public_url : null;
}
