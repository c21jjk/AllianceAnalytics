import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import { listTemplatesForPostType } from "@/lib/template-builder";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllianceCompanyAgentNames } from "@/lib/data/alliance-dash-agents";
import MultiOHWizardClient from "./MultiOHWizardClient";

// why: requireUser is still called here even though we no longer thread
// the user's full_name into the wizard (event-level agent attribution was
// removed 2026-05-21). The auth gate itself is the contract — anonymous
// users shouldn't be hitting this surface.

export const metadata = { title: "Multi-property Open House — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Multi-property Open House — wizard entrypoint.
 *
 * Server component. Gates on auth, pre-fetches the eligible Open House
 * listings (active + upcoming open_houses row within the standard 14-day
 * window), then hands off to the client wizard.
 *
 * The wizard is intentionally a SIBLING route to /post-builder rather than
 * a tab inside it. The flow is event-shaped (pick MANY listings + event-
 * level details), so mixing it into the single-listing chip strip would
 * complicate that surface and make the multi-OH happy path harder to find.
 * On success, the wizard redirects back to /post-builder?gp=<id> so the
 * standard editor/resume flow takes over.
 */
export default async function MultiOHPage() {
  await requireUser();

  // why: same fetcher Post Builder uses for open_house. Returns active
  // listings with the soonest upcoming open_houses row attached as
  // oh_start_at / oh_end_at. Empty array is a valid state — the wizard
  // handles the zero/one cases inline.
  const listings = await fetchListingsForPostBuilder({ post_type: "open_house" });

  // Phase 2E (2026-05-22) — DB-defined templates tagged for Open House
  // surface in the wizard's Step 2 variant grid alongside the legacy
  // v2/v3/v6/v8 cards. When the user picks a DB card, the multi-OH
  // generate route renders every per-property slide via the DB template
  // (the event hero keeps its dedicated multi-property layout). See
  // docs/adr/0001-template-builder.md.
  const [squareTemplates, storyTemplates] = await Promise.all([
    listTemplatesForPostType("open_house", "square_1x1"),
    listTemplatesForPostType("open_house", "story_9x16"),
  ]);
  // 2026-05-24 — square_1x1 replaced portrait_4x5 as the feed default.
  // portrait_4x5 retained as a key with empty list to satisfy the
  // Record<PostFormat, TemplateMeta[]> shape for legacy posts.
  const dbTemplatesByFormat = {
    square_1x1: squareTemplates,
    story_9x16: storyTemplates,
  };

  // 2026-08-06 (John) — the "already promoted" coverage query that lived here
  // is gone, along with the Step 1 badges and the duplicate-promotion confirm
  // it fed. It scoped coverage to the PROPERTY over a rolling 7 days, which
  // mislabels every property that holds an open house each weekend as already
  // handled. See the tombstone in MultiOHWizardClient.tsx.

  // 2026-07-17 — hosting-agent roster for the Step 1 combobox. Free-hand
  // host names broke attribution (phone/photo lookups match by EXACT name),
  // so the selector offers a roster instead: the app's mls_agents table (all
  // 8 offices) + everyone currently listing with the company.
  //
  // 2026-08-21 (John) — plus the Alliance Dash MLS-membership rosters
  // (cmc/sjsr/bright active agents). The two sources above are both
  // listing-derived, so a new agent with no listings yet — Susan Roselli,
  // hosting 508 E 7th Ave's Saturday OH — was unfindable in the typeahead.
  // MLS membership starts on day one, and it's the same data the phone
  // lookup reads, so every added name resolves attribution.
  //
  // Same day, second pass: those Dash reads were being truncated to 1,000
  // rows apiece by PostgREST, which is why Susan stayed missing after the
  // first fix. Paging them properly (see fetchAllRows) takes the roster from
  // ~2,400 names to ~5,400 — and because cmc/sjsr are whole-BOARD tables,
  // most of the new arrivals work for other brokerages. So the roster now
  // ships in two parts: `agentRoster` is everyone the combobox will accept,
  // and `priorityAgents` is the Alliance subset the dropdown ranks first.
  // Ranking, never filtering — being wrong about who is ours should cost a
  // few dropdown places, not make somebody unpickable.
  let agentRoster: string[] = [];
  let priorityAgents: string[] = [];
  try {
    const supabase = createAdminClient();
    const [{ data: rosterRows }, { data: listingAgents }, dashRoster] =
      await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("mls_agents")
          .select("full_name")
          .eq("is_active", true),
        supabase.from("properties").select("agent_name").not("agent_name", "is", null),
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
    for (const r of rosterRows ?? []) add(r.full_name, true);
    for (const r of listingAgents ?? [])
      add((r as { agent_name: string | null }).agent_name, true);
    for (const name of dashRoster.all) add(name, false);
    for (const name of dashRoster.priority) add(name, true);
    agentRoster = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    priorityAgents = Array.from(priority.values());
  } catch (e) {
    console.warn("[multi-oh] agent roster fetch failed:", e);
  }

  return (
    <div>
      <MultiOHWizardClient
        listings={listings}
        agentRoster={agentRoster}
        priorityAgents={priorityAgents}
        defaultOfficeName="Century 21 Alliance"
        dbTemplatesByFormat={dbTemplatesByFormat}
      />
    </div>
  );
}
