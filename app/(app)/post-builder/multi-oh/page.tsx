import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import PageHeader from "@/components/PageHeader";
import MultiOHWizardClient from "./MultiOHWizardClient";

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
  const profile = await requireUser();

  // why: same fetcher Post Builder uses for open_house. Returns active
  // listings with the soonest upcoming open_houses row attached as
  // oh_start_at / oh_end_at. Empty array is a valid state — the wizard
  // handles the zero/one cases inline.
  const listings = await fetchListingsForPostBuilder({ post_type: "open_house" });

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
        defaultAgentName={profile.full_name ?? ""}
      />
    </div>
  );
}
