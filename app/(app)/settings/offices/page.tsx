import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import OfficeCard from "@/components/OfficeCard";
import { requireAdmin } from "@/lib/auth";
import { listOffices } from "@/lib/data/offices";

export const metadata = { title: "Offices — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Admin index for the per-office market profiles. Each card represents
 * one office; clicking Edit opens the long-form editor where John or
 * Larissa fills in the qualitative market data the AI consultant uses.
 */
export default async function OfficesIndexPage() {
  await requireAdmin();

  // Show inactive offices too on the admin index — admins should be able
  // to see and re-activate them.
  const offices = await listOffices({ active_only: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Offices</span>
      </div>

      <PageHeader
        title="Offices"
        description="Each Alliance office is its own market. Fill in the buyer/seller demographics, seasonal pattern, price range, and signature angles so the AI consultant can tailor recommendations per office."
      />

      {offices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
          <p className="text-sm font-medium text-neutral-700">
            No offices configured yet
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Offices are seeded from the database. If you don&apos;t see the
            eight Alliance offices here, run the seed migration.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {offices.map((office) => (
            <OfficeCard key={office.id} office={office} />
          ))}
        </div>
      )}
    </div>
  );
}
