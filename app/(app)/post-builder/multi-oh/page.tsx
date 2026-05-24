import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import { listTemplatesForPostType } from "@/lib/template-builder";
import PageHeader from "@/components/PageHeader";
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

  return (
    <div>
      <PageHeader
        eyebrow="Event-style carousel post for multiple properties"
        title="Multi-property Open House"
        description="Pick 2-9 open houses happening in the same window. We render an event-overview hero card plus a per-property card for each home, then drop you back into Post Builder as a ready-to-publish carousel."
        phaseTag="Phase 5+"
      />
      <MultiOHWizardClient
        listings={listings}
        defaultOfficeName="Century 21 Alliance"
        dbTemplatesByFormat={dbTemplatesByFormat}
      />
    </div>
  );
}
