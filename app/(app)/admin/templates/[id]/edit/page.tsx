import { notFound } from "next/navigation";
import { getTemplateById } from "@/lib/template-builder";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import type { PostBuilderListing } from "@/lib/post-builder/types";
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
  const { id } = await params;
  const template = await getTemplateById(id);
  if (!template) notFound();

  // why: pick ANY active listing — the editor uses it only as visual
  // context (a real photo to render against, a real address to bind into
  // placeholder text). The choice doesn't affect the saved template.
  // Just Listed is the broadest bucket so we use it; if it's empty we
  // walk through the other post-type buckets as fallback.
  const sampleListing = await pickSampleListing();

  return (
    <TemplateEditorClient template={template} sampleListing={sampleListing} />
  );
}

/**
 * Pull one active listing to serve as the visual context inside the
 * editor. Returns null when no listings exist anywhere — the editor
 * handles that case by falling back to placeholder-only rendering.
 */
async function pickSampleListing(): Promise<PostBuilderListing | null> {
  // Order matters — pick the bucket most likely to have a recent
  // listing with a real hero photo. Just Listed is fresh-inventory;
  // the others are fallbacks.
  const buckets = [
    "just_listed",
    "open_house",
    "under_contract",
    "just_sold",
    "price_reduction",
  ] as const;
  for (const post_type of buckets) {
    const listings = await fetchListingsForPostBuilder({
      post_type,
      limit: 1,
    });
    if (listings.length > 0) return listings[0];
  }
  return null;
}
