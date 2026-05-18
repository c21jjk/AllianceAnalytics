import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { requireUser } from "@/lib/auth";
import { listAllCustomTemplatesAction } from "@/app/(app)/post-builder/actions";
import CustomTemplatesTable from "./CustomTemplatesTable";

export const metadata = { title: "Custom Templates — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Manage Templates UI — full library view of user-authored canvas templates.
 *
 * Rows show preview thumbnail, name, slot tuple (post_type · format ·
 * based_on_variant), default badge, and inline actions (rename, toggle
 * default, archive). Grouped by post_type for scannability.
 *
 * Auth: any signed-in Alliance user can view + manage their own templates.
 * RLS on the table allows authenticated reads/writes; we don't gate to
 * admin here because each agent may eventually want their own template
 * library. If an org-wide gate becomes necessary, switch requireUser →
 * requireAdmin.
 */
export default async function ManageTemplatesPage() {
  await requireUser();

  const res = await listAllCustomTemplatesAction();
  const templates = res.ok ? res.templates : [];
  const errorMessage = res.ok ? null : res.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom Templates"
        description="Manage canvas templates you've saved from the Post Builder Studio. Mark one as the default for a slot and it replaces the factory variant card for everyone."
      />

      <div className="mb-2">
        <Link
          href="/settings"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to Settings
        </Link>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Failed to load custom templates: {errorMessage}
        </div>
      ) : null}

      <CustomTemplatesTable initialTemplates={templates} />
    </div>
  );
}
