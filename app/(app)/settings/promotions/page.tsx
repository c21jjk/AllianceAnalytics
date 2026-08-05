import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/PageHeader";
import DismissedListingsTable, {
  type DismissedListingRow,
} from "@/components/DismissedListingsTable";

export const metadata = { title: "Dismissed listings — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Admin audit view for listings that were manually dismissed from the
 * dashboard "needs Larissa's attention" strip. Shows who dismissed each
 * listing, when, and why — with a one-click Restore action that puts the
 * listing back in the strip if it still has no Just Listed post.
 */
export default async function PromotionsPage() {
  await requireAdmin();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("properties")
    .select(
      "id, mls_number, source_mls, address, city, state, list_price, listing_date, hero_image_url, agent_name, promotion_dismissed_at, promotion_dismissed_by, promotion_dismissed_reason",
    )
    .not("promotion_dismissed_at", "is", null)
    .order("promotion_dismissed_at", { ascending: false })
    .limit(200);

  const dismissedRows = (rows ?? []) as Array<{
    id: string;
    mls_number: string;
    source_mls: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    list_price: number | null;
    listing_date: string | null;
    hero_image_url: string | null;
    agent_name: string | null;
    promotion_dismissed_at: string | null;
    promotion_dismissed_by: string | null;
    promotion_dismissed_reason: string | null;
  }>;

  // Resolve dismissed_by uuids → display names + emails.
  const dismisserIds = Array.from(
    new Set(
      dismissedRows
        .map((r) => r.promotion_dismissed_by)
        .filter((x): x is string => !!x),
    ),
  );
  const profilesById = new Map<string, { email: string; full_name: string | null }>();
  if (dismisserIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", dismisserIds);
    for (const p of profileRows ?? []) {
      profilesById.set(p.id, { email: p.email, full_name: p.full_name });
    }
  }

  const tableRows: DismissedListingRow[] = dismissedRows.map((r) => {
    const dismisser = r.promotion_dismissed_by
      ? profilesById.get(r.promotion_dismissed_by) ?? null
      : null;
    return {
      mls_number: r.mls_number,
      source_mls: r.source_mls,
      address: r.address,
      city: r.city,
      state: r.state,
      list_price: r.list_price === null ? null : Number(r.list_price),
      listing_date: r.listing_date,
      hero_image_url: r.hero_image_url,
      agent_name: r.agent_name,
      dismissed_at: r.promotion_dismissed_at,
      dismissed_reason: r.promotion_dismissed_reason,
      dismissed_by_name: dismisser?.full_name ?? dismisser?.email ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Dismissed listings</span>
      </div>

      <PageHeader
        title="Dismissed listings"
        description="Listings staff have removed from the dashboard 'needs Larissa' strip. Restore brings the listing back if it still has no Just Listed post."
      />

      <section>
        <DismissedListingsTable rows={tableRows} />
      </section>
    </div>
  );
}
