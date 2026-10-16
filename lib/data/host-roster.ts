import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllianceCompanyAgentNames } from "@/lib/data/alliance-dash-agents";

/**
 * Hosting-agent roster for the open-house host pickers (Multi-OH wizard
 * Step 1 and, since 2026-10-16, the dashboard Open Houses card).
 *
 * `roster` is everyone a picker will accept; `priority` is the Alliance
 * subset ranked first. Ranking, never filtering. History of the sources
 * (mls_agents + listing agents + Alliance Dash MLS membership) lives in the
 * comment above the call in app/(app)/post-builder/multi-oh/page.tsx.
 */
export interface HostRoster {
  roster: string[];
  priority: string[];
}

export async function getHostRoster(): Promise<HostRoster> {
  try {
    const supabase = createAdminClient();
    const [{ data: rosterRows }, { data: listingAgents }, dashRoster] =
      await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("mls_agents")
          .select("full_name")
          .eq("is_active", true),
        supabase
          .from("properties")
          .select("agent_name")
          .not("agent_name", "is", null),
        listAllianceCompanyAgentNames(),
      ]);
    const seen = new Map<string, string>();
    const priority = new Map<string, string>();
    const add = (raw: unknown, isOurs: boolean) => {
      if (typeof raw !== "string") return;
      const name = raw.trim();
      if (name.length < 2) return;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
      if (isOurs && !priority.has(key)) priority.set(key, name);
    };
    // Our own two sources are Alliance by definition, so both feed the
    // priority tier. The Dash roster splits itself — see CompanyAgentRoster.
    for (const r of (rosterRows ?? []) as Array<{ full_name: unknown }>)
      add(r.full_name, true);
    for (const r of listingAgents ?? [])
      add((r as { agent_name: string | null }).agent_name, true);
    for (const name of dashRoster.all) add(name, false);
    for (const name of dashRoster.priority) add(name, true);
    return {
      roster: Array.from(seen.values()).sort((a, b) => a.localeCompare(b)),
      priority: Array.from(priority.values()),
    };
  } catch (e) {
    console.warn("[host-roster] agent roster fetch failed:", e);
    return { roster: [], priority: [] };
  }
}
