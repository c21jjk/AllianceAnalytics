import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import { listTemplatesForPostType } from "@/lib/template-builder";
import QuickCreateClient from "./QuickCreateClient";

export const metadata = { title: "Create — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Mobile Quick Create — the phone-first "create, post and track on the
 * fly" flow (built for Larissa's iPhone, July 2026).
 *
 * Five thumb-sized steps: post type + listing → template → photos →
 * caption → exact server-rendered preview → publish/schedule. All heavy
 * lifting reuses the desktop machinery: fetchListingsForPostBuilder,
 * the DB-template registry, /api/post-builder/render (pixel-identical
 * to what publishes), /api/post-builder/caption, and the existing
 * save/schedule/post actions. No canvas editor ships to the phone.
 *
 * The default post type's listings + templates are prefetched here so
 * the first paint is instant; switching post type or format re-fetches
 * through /api/mobile/listings and /api/mobile/templates.
 */
export default async function MobileCreatePage() {
  const profile = await requireUser();

  const [initialListings, initialTemplates] = await Promise.all([
    fetchListingsForPostBuilder({ post_type: "just_listed" }),
    listTemplatesForPostType("just_listed", "square_1x1"),
  ]);

  return (
    <QuickCreateClient
      isAdmin={profile.role === "admin"}
      initialListings={initialListings}
      initialTemplates={initialTemplates}
    />
  );
}
