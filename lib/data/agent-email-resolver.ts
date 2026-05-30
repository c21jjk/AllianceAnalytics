import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared listing-agent email resolver.
 *
 * `properties.agent_email` is unreliable — the RETS property sync writes NULL,
 * so it's empty on virtually all active listings. The real emails live in
 * `mls_agents` (joined only by NAME, since properties carries no agent id).
 * Names are formatted differently on each side ("John J. Koch" vs "John Koch",
 * "Kathleen(Kathy) Elwell" vs "Kathleen Elwell"), so we normalize and match on
 * first+last, using ONLY unambiguous matches (exactly one distinct non-null
 * email for a name) so we never email the wrong agent.
 *
 * Used by every agent-facing email (weekly Owner Story, office/division post
 * alerts). Always try `properties.agent_email` first, then fall back to this.
 */

export interface MlsAgentRow {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
}

/** Lowercase, drop parenthetical nicknames, strip punctuation, collapse space. */
export function normalizeNamePart(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[.,]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Build a "first|last" key from a full name, or null if it can't be parsed. */
export function nameKeyFromFullName(fullName: string): string | null {
  const cleaned = normalizeNamePart(fullName);
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}|${parts[parts.length - 1]}`;
}

function keyForAgent(a: MlsAgentRow): string | null {
  if (a.first_name && a.last_name) {
    return `${normalizeNamePart(a.first_name)}|${normalizeNamePart(a.last_name)}`;
  }
  if (a.full_name) return nameKeyFromFullName(a.full_name);
  return null;
}

/**
 * Build a resolver from a set of mls_agents rows. Returns a function mapping a
 * property's agent_name → the unambiguous email, or null when the name doesn't
 * resolve or maps to multiple distinct emails.
 */
export function buildAgentEmailResolver(
  agents: MlsAgentRow[],
): (agentName: string | null) => string | null {
  const keyToEmails = new Map<string, Set<string>>();
  for (const a of agents) {
    const email = a.email?.trim();
    if (!email) continue;
    const key = keyForAgent(a);
    if (!key || key === "|") continue;
    const set = keyToEmails.get(key) ?? new Set<string>();
    set.add(email.toLowerCase());
    keyToEmails.set(key, set);
  }

  // One representative original-case email per unambiguous key.
  const keyToEmail = new Map<string, string>();
  for (const a of agents) {
    const email = a.email?.trim();
    if (!email) continue;
    const key = keyForAgent(a);
    if (!key) continue;
    if ((keyToEmails.get(key)?.size ?? 0) === 1 && !keyToEmail.has(key)) {
      keyToEmail.set(key, email);
    }
  }

  return (agentName: string | null): string | null => {
    if (!agentName) return null;
    const key = nameKeyFromFullName(agentName);
    if (!key) return null;
    return keyToEmail.get(key) ?? null;
  };
}

/** Load mls_agents and return a ready-to-use resolver. */
export async function loadAgentEmailResolver(): Promise<
  (agentName: string | null) => string | null
> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("mls_agents")
    .select("first_name, last_name, full_name, email");
  return buildAgentEmailResolver((data ?? []) as MlsAgentRow[]);
}
