import Link from "next/link";
import { requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export const metadata = { title: "Security — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const me = await requireUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Security</span>
      </div>

      <PageHeader
        title="My account"
        description="Change your password. Two-factor authentication is not yet enabled — keep your password strong."
      />

      <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-6 space-y-1">
        <h2 className="text-base font-semibold text-neutral-900">
          Account details
        </h2>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">
              Name
            </dt>
            <dd className="text-neutral-900">{me.full_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">
              Email
            </dt>
            <dd className="text-neutral-900 font-mono text-xs">{me.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">
              Role
            </dt>
            <dd className="capitalize text-neutral-900">{me.role}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <h2 className="text-base font-semibold text-neutral-900 mb-3">
          Change password
        </h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
