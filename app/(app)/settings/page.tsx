import PageHeader from "@/components/PageHeader";
import MlsFeedCard from "@/components/MlsFeedCard";
import CredentialCard from "@/components/CredentialCard";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMlsFeeds } from "@/lib/data/mls-feeds";
import { listCredentials } from "@/lib/data/credentials";
import { PLATFORMS } from "./credentialSchemas";

export const metadata = { title: "Settings — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();

  const admin = createAdminClient();

  const [feeds, credentials] = await Promise.all([
    listMlsFeeds(),
    listCredentials(),
  ]);

  // Build platform → summary map for the credential cards.
  const credByPlatform = new Map(
    credentials.map((c) => [c.platform, c] as const),
  );

  // Users — unchanged from prior settings page.
  const { data: users } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  // Group platforms into MLS-style and API-style. The new "MLS / RETS Feeds"
  // section is sourced from mls_feeds; the older paragon_mls / bright_mls
  // entries in api_credentials are legacy and not surfaced here unless they
  // already have a row.
  const apiKeyPlatforms = PLATFORMS.filter(
    (p) =>
      p.platform === "facebook" ||
      p.platform === "instagram" ||
      p.platform === "tiktok" ||
      p.platform === "claude",
  );

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings"
        description="Manage MLS feeds, API credentials, and team access."
      />

      <section>
        <SectionHeading
          title="MLS / RETS Feeds"
          subtitle="Source of truth for active listings. Each feed is pulled on a schedule and replicated into the analytics properties table for auto-linking."
        />
        {feeds.length === 0 ? (
          <EmptyState
            title="No feeds configured yet"
            body="MLS feeds are seeded from the database. If you don't see CMC, SJSR, and Bright here, run the seed migration."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {feeds.map((feed) => (
              <MlsFeedCard key={feed.id} feed={feed} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading
          title="API Keys & Tokens"
          subtitle="Credentials are stored encrypted at rest in Supabase and only accessible via server-side service-role calls."
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {apiKeyPlatforms.map((def) => (
            <CredentialCard
              key={def.platform}
              def={def}
              summary={credByPlatform.get(def.platform) ?? null}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          title="Users"
          subtitle="Accounts with access to Alliance Social."
        />
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{body}</p>
    </div>
  );
}
