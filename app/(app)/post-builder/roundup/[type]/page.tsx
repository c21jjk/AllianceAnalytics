import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fetchRoundupListings } from "@/lib/post-builder/roundup-listings";
import { listTemplatesForPostType } from "@/lib/template-builder";
import type { RoundupType } from "@/lib/post-builder/types";
import MultiOHWizardClient from "../../multi-oh/MultiOHWizardClient";

export const dynamic = "force-dynamic";

/**
 * 2026-08-19 — weekly milestone roundup wizard entrypoints (John:
 * company-wide multi-property posts for Under Contract + Price Reduced,
 * replacing the per-property singles for those milestones).
 *
 *   /post-builder/roundup/under-contract
 *   /post-builder/roundup/price-reduced
 *
 * Reuses the multi-OH wizard component with a roundupType flag — the
 * FinalReviewStage lesson (2026-08-08): generalize the existing flow, do
 * NOT build a lookalike sibling that drifts. Server-side we fetch the
 * WEEK'S occurrences (7-day rolling window, company-wide) plus the
 * milestone metadata the hero card and captions need, and the DB
 * templates published for this milestone's bucket (the same single-listing
 * UC/PR templates double as the per-property slide templates).
 *
 * On success the wizard redirects to /post-builder?gp=<id> and the
 * standard Final Review flow takes over, exactly like multi-OH.
 */

const SLUG_TO_KIND: Record<string, Exclude<RoundupType, "open_house">> = {
  "under-contract": "under_contract",
  "price-reduced": "price_reduction",
};

const KIND_TITLES: Record<Exclude<RoundupType, "open_house">, string> = {
  under_contract: "Under Contract Roundup — Alliance Social",
  price_reduction: "Price Improvement Roundup — Alliance Social",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const kind = SLUG_TO_KIND[type];
  return { title: kind ? KIND_TITLES[kind] : "Roundup — Alliance Social" };
}

export default async function RoundupPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  await requireUser();

  const { type } = await params;
  const kind = SLUG_TO_KIND[type];
  if (!kind) notFound();

  const [{ listings, metaByMls }, squareTemplates, storyTemplates] =
    await Promise.all([
      fetchRoundupListings(kind),
      listTemplatesForPostType(kind, "square_1x1"),
      listTemplatesForPostType(kind, "story_9x16"),
    ]);

  return (
    <div>
      <MultiOHWizardClient
        listings={listings}
        defaultOfficeName="Century 21 Alliance"
        dbTemplatesByFormat={{
          square_1x1: squareTemplates,
          story_9x16: storyTemplates,
        }}
        roundupType={kind}
        roundupMeta={metaByMls}
        basePath={`/post-builder/roundup/${type}`}
      />
    </div>
  );
}
