import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getOffice } from "@/lib/data/offices";
import PageHeader from "@/components/PageHeader";
import OfficeForm from "@/components/OfficeForm";
import { upsertOfficeAction } from "../../actions";

interface PageProps {
  params: Promise<{ short_code: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  const { short_code } = await params;
  return { title: `Edit ${short_code} office — Alliance Social` };
}

export default async function EditOfficePage({ params }: PageProps) {
  await requireAdmin();
  const { short_code } = await params;
  const decoded = decodeURIComponent(short_code);
  const office = await getOffice(decoded);
  if (!office) notFound();

  const boundAction = upsertOfficeAction.bind(null, decoded);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/settings/offices" className="hover:text-neutral-800">
          Offices
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 font-mono">{decoded}</span>
      </div>

      <PageHeader
        title={`Edit ${office.name}`}
        description="Per-office market profile. The AI consultant uses these fields to keep recommendations specific to this office's market — never generalized across all eight."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <OfficeForm office={office} action={boundAction} />
      </div>
    </div>
  );
}
