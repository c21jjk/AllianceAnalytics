import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getTemplateById } from "@/lib/template-builder";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import type { PostBuilderListing, PostType } from "@/lib/post-builder/types";
import TemplateEditorClient from "./TemplateEditorClient";

export const metadata = {
  title: "Editing template — Admin — Alliance Social",
};
export const dynamic = "force-dynamic";

/**
 * Template visual editor.
 *
 * Session A (this file): replaces the JSON textarea with the Fabric.js
 * canvas surface via CanvasEditorOverlay. The editor needs a SAMPLE
 * LISTING for visual context — text placeholders render with realistic
 * data, photos render with a real listing's photos — so we fetch the
 * most-recent active listing server-side and pass it down. At template
 * render time (Phase 2C), placeholders re-resolve against whatever
 * listing the post is being generated for; the sample is purely for
 * authoring vibes.
 *
 * See docs/adr/0001-template-builder.md.
 */
export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // why: layouts and pages render in parallel, so the admin layout's gate
  // alone does not stop this page's data fetch. Gate here too.
  await requireAdmin();

  const { id } = await params;
  const template = await getTemplateById(id);
  if (!template) notFound();

  // why: pick an active listing — the editor uses it only as visual
  // context (a real photo to render against, a real address to bind into
  // placeholder text). The choice doesn't affect the saved template.
  // 2026-08-04 (John): the template's OWN post types go first. Editing an
  // Open House template against a just_listed sample left open_house_date /
  // open_house_time / hosting_agent_phone empty (no OH row → no data), which
  // tripped the amber "no data" strip on every open even though the template
  // was fine. Sampling from the template's bucket gives those fields real
  // data; the old fixed order remains as the fallback chain.
  const sampleListing = await pickSampleListing(template.post_types);

  return (
    <TemplateEditorClient template={template} sampleListing={sampleListing} />
  );
}

/**
 * Pull one active listing to serve as the visual context inside the
 * editor. Returns null when no listings exist anywhere — the editor
 * handles that case by falling back to placeholder-only rendering.
 */
async function pickSampleListing(
  preferredTypes: readonly PostType[],
): Promise<PostBuilderListing | null> {
  // Order matters — the template's own post types lead so bound fields
  // specific to that type (OH date/time/host) resolve with real data;
  // then the generic chain, Just Listed first (fresh inventory, most
  // likely to have a recent listing with a real hero photo).
  const fallbackBuckets = [
    "just_listed",
    "open_house",
    "under_contract",
    "just_sold",
    "price_reduction",
  ] as const;
  const buckets: PostType[] = [
    ...preferredTypes,
    ...fallbackBuckets.filter((b) => !preferredTypes.includes(b)),
  ];
  for (const post_type of buckets) {
    const listings = await fetchListingsForPostBuilder({
      post_type,
      limit: 1,
    });
    if (listings.length > 0) return listings[0];
  }
  return null;
}
