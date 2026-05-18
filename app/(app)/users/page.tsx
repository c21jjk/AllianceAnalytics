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
    .select(
      "id, email, full_name, role, is_active, created_at, last_active_at",
    )
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  // Last sign-in lives in auth.users (not profiles). Pull via the admin
  // SDK so we get the timestamp without exposing the rest of the auth row.
  // listUsers() paginates; v1 just grabs the first page (1000 users) since
  // Alliance has at most ~50 admins/users.
  const lastSignInById = new Map<string, string | null>();
  try {
    const { data: authList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authList?.users ?? []) {
      lastSignInById.set(u.id, u.last_sign_in_at ?? null);
    }
  } catch (e) {
    console.error("UsersPage: auth.admin.listUsers failed —", e);
  }

  const rows: UsersTableRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    is_active: p.is_active,
    created_at: p.created_at,
    last_active_at: p.last_active_at ?? null,
    last_sign_in_at: lastSignInById.get(p.id) ?? null,
    is_self: p.id === me.id,
  }));

  return (
    <div className="space-y-6">
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
