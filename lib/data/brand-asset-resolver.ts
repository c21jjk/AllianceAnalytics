import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

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
 * library by normalized-name match. Prefers an active row in the same office
 * when `officeId` is supplied. Returns null when no confident match exists
 * (the caller then leaves the frame empty / flags for review).
 */
export async function resolveAgentHeadshotUrl(
  agentName: string | null | undefined,
  officeId?: string | null,
): Promise<string | null> {
  if (!agentName) return null;
  const target = normalizeAgentName(agentName);
  if (!target) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_assets")
    .select("label, public_url, office_id, status")
    .eq("kind", "agent_headshot")
    .eq("status", "active");

  if (error || !data) return null;

  const matches = data.filter(
    (row) =>
      typeof row.label === "string" &&
      typeof row.public_url === "string" &&
      row.public_url.length > 0 &&
      normalizeAgentName(row.label) === target,
  );
  if (matches.length === 0) return null;

  const sameOffice =
    officeId != null
      ? matches.find((m) => m.office_id === officeId)
      : undefined;
  const chosen = sameOffice ?? matches[0];
  return typeof chosen.public_url === "string" ? chosen.public_url : null;
}
