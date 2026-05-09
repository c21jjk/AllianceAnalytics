import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/PageHeader";
import InviteUserForm from "@/components/InviteUserForm";
import UsersTable, { type UsersTableRow } from "@/components/UsersTable";

export const metadata = { title: "Users — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdmin();

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at")
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  const rows: UsersTableRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    is_active: p.is_active,
    created_at: p.created_at,
    is_self: p.id === me.id,
  }));

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Users</span>
      </div>

      <PageHeader
        title="Users"
        description="Add new accounts and manage existing access. Email is the username — there is no email-verification round-trip; you set the initial password and share it with the user."
      />

      <section className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <h2 className="text-base font-semibold text-neutral-900 mb-3">
          Invite a new user
        </h2>
        <InviteUserForm />
      </section>

      <section>
        <h2 className="text-base font-semibold text-neutral-900 mb-3">
          Existing users
        </h2>
        <UsersTable rows={rows} />
      </section>
    </div>
  );
}
