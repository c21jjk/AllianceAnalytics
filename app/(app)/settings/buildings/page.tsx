import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import BuildingsAdminPanel, {
  type AdminBuilding,
} from "@/components/BuildingsAdminPanel";
import { requireAdmin } from "@/lib/auth";
import { listBuildings } from "@/lib/data/buildings-db";

export const metadata = { title: "Buildings — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Admin page for Building Consolidation. Lets staff merge/split/move MLS unit-
 * listings between buildings so Owner Stories and metrics report the whole-
 * building picture even when the automated address backfill gets membership
 * wrong (e.g. "Avenue" vs "Street" drift).
 */
export default async function BuildingsSettingsPage() {
  await requireAdmin();

  const records = await listBuildings();
  const buildings: AdminBuilding[] = records.map((b) => ({
    id: b.id,
    display_address: b.display_address,
    display_city: b.display_city,
    member_count: b.members.length,
    members: b.members.map((m) => ({
      id: m.id,
      mls_number: m.mls_number,
      source_mls: m.source_mls,
      address: m.address,
      city: m.city,
      status: m.status,
      list_price: m.list_price,
      listing_date: m.listing_date,
      is_primary: m.id === b.primary_property_id,
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Buildings</span>
      </div>

      <PageHeader
        title="Buildings"
        description="Consolidate multiple MLS unit-listings at one physical address into a single logical building. Owner Stories and metrics then report the whole-building picture instead of per-unit."
      />

      <BuildingsAdminPanel buildings={buildings} />
    </div>
  );
}
