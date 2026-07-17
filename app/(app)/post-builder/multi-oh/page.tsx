import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import { listTemplatesForPostType } from "@/lib/template-builder";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // 2026-07-17 — "already promoted" coverage. Larissa posted the morning's
  // multi-OH with 9 properties; 2 more OHs arrived; she couldn't tell which
  // were outstanding. Derive coverage from PUBLISHED open_house posts in the
  // last 7 days (linked_property_ids carries every property in a multi-OH
  // carousel; property_id covers single-listing OH posts) and badge those
  // rows in Step 1. Auto-derived — nothing for her to mark off.
  const postedCoverage: Record<string, string> = {};
  try {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: covRows } = await (supabase as any)
      .from("generated_posts")
      .select("posted_at, property_id, linked_property_ids")
      .eq("post_type", "open_house")
      .not("posted_at", "is", null)
      .gte(
        "posted_at",
        new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
      );
    for (const r of covRows ?? []) {
      const at = r.posted_at as string;
      const ids: string[] = [];
      if (typeof r.property_id === "string") ids.push(r.property_id);
      if (Array.isArray(r.linked_property_ids)) {
        for (const id of r.linked_property_ids) {
          if (typeof id === "string") ids.push(id);
        }
      }
      for (const id of ids) {
        // Keep the LATEST posted_at per property.
        if (!postedCoverage[id] || postedCoverage[id] < at) {
          postedCoverage[id] = at;
        }
      }
    }
  } catch (e) {
    // Coverage is decoration — never block the wizard on it.
    console.warn("[multi-oh] posted-coverage fetch failed:", e);
  }

  // 2026-07-17 — hosting-agent roster for the Step 1 combobox. Free-hand
  // host names broke attribution (phone/photo lookups match by EXACT name),
  // so the selector now offers the company roster: the app's mls_agents
  // table (all 8 offices) + everyone currently listing with the company.
  // ~250 names — small enough to ship once and filter client-side.
  let agentRoster: string[] = [];
  try {
    const supabase = createAdminClient();
    const [{ data: rosterRows }, { data: listingAgents }] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("mls_agents")
        .select("full_name")
        .eq("is_active", true),
      supabase.from("properties").select("agent_name").not("agent_name", "is", null),
    ]);
    const seen = new Map<string, string>();
    const add = (raw: unknown) => {
      if (typeof raw !== "string") return;
      const name = raw.trim();
      if (name.length < 2) return;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    };
    for (const r of rosterRows ?? []) add(r.full_name);
    for (const r of listingAgents ?? []) add((r as { agent_name: string | null }).agent_name);
    agentRoster = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    console.warn("[multi-oh] agent roster fetch failed:", e);
  }

  return (
    <div>
      <MultiOHWizardClient
        listings={listings}
        postedCoverage={postedCoverage}
        agentRoster={agentRoster}
        defaultOfficeName="Century 21 Alliance"
        dbTemplatesByFormat={dbTemplatesByFormat}
      />
    </div>
  );
}
