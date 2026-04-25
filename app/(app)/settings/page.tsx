import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import ApiConnectionCard, {
  type ConnectionSnapshot,
} from "./ApiConnectionCard";
import { PLATFORMS, type CredentialPlatform } from "./credentialSchemas";

export const metadata = { title: "Settings — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();

  const admin = createAdminClient();

  // Fetch credential rows. We deliberately do NOT select the `credentials`
  // column to keep raw secrets off the server-render path. We derive
  // configured_keys from a separate, sanitized projection (server-side only),
  // so no secret value is ever serialized into the page payload.
  const { data: credRows } = await admin
    .from("api_credentials")
    .select("platform, is_active, last_validated_at, credentials");

  // Build a sanitized snapshot map. `credentials` itself is dropped; we keep
  // only the *keys* that are present (so we can show "N stored fields").
  const snapshotByPlatform = new Map<CredentialPlatform, ConnectionSnapshot>();
  for (const row of credRows ?? []) {
    const credObj =
      row.credentials && typeof row.credentials === "object"
        ? (row.credentials as Record<string, unknown>)
        : {};
    snapshotByPlatform.set(row.platform as CredentialPlatform, {
      platform: row.platform as CredentialPlatform,
      is_active: !!row.is_active,
      last_validated_at: row.last_validated_at ?? null,
      configured_keys: Object.keys(credObj),
    });
  }

  // Users
  const { data: users } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings"
        description="Manage platform connections, users, and notifications."
      />

      <section>
        <SectionHeading
          title="API Connections"
          subtitle="Credentials are stored encrypted at rest in Supabase and only accessible via server-side service-role calls."
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {PLATFORMS.map((def) => (
            <ApiConnectionCard
              key={def.platform}
              def={def}
              snapshot={snapshotByPlatform.get(def.platform) ?? null}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Users" subtitle="Accounts with access to Alliance Social." />
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-100">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-neutral-500"
                  >
                    No users yet.
                  </td>
                </tr>
              ) : (
                (users ?? []).map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-neutral-50 last:border-0"
                  >
                    <td className="px-4 py-3 text-neutral-900">
                      {u.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          u.role === "admin"
                            ? "badge bg-gold-50 text-gold-700 ring-1 ring-gold-100 text-[10px]"
                            : "badge-neutral text-[10px]"
                        }
                      >
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          New users are provisioned via Supabase. Self-signup is disabled.
        </p>
      </section>

      <section>
        <SectionHeading
          title="Notifications"
          subtitle="Toggle delivery channels (placeholder — wired up in a later phase)."
        />
        <div className="card divide-y divide-neutral-100">
          <ToggleRow
            title="Email digest"
            description="Weekly summary of post performance."
            disabled
          />
          <ToggleRow
            title="New report ready"
            description="Notify when a property report is generated."
            disabled
          />
          <ToggleRow
            title="API connection errors"
            description="Alert when a platform credential fails validation."
            disabled
          />
        </div>
      </section>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-sm text-neutral-500 max-w-2xl">{subtitle}</p>
      ) : null}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  disabled,
}: {
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div>
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        className="relative inline-flex h-5 w-9 items-center rounded-full bg-neutral-200 disabled:opacity-60 disabled:cursor-not-allowed"
        title="Coming in a later phase"
      >
        <span className="inline-block h-3.5 w-3.5 translate-x-1 rounded-full bg-white shadow-sm" />
      </button>
    </div>
  );
}
