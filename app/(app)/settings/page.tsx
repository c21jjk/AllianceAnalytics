import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import MlsFeedCard from "@/components/MlsFeedCard";
import CredentialCard from "@/components/CredentialCard";
import ListtracSyncCard from "@/components/ListtracSyncCard";
import OfficeCard from "@/components/OfficeCard";
import TestModeBanner from "@/components/TestModeBanner";
import SendTestEmailButton from "@/components/SendTestEmailButton";
import SendWeeklyReportPreviewButton from "@/components/SendWeeklyReportPreviewButton";
import SendWeeklyReportDistributionButton from "@/components/SendWeeklyReportDistributionButton";
import SendOfficePostAnnouncementPreviewButton from "@/components/SendOfficePostAnnouncementPreviewButton";
import { getWeeklySocialReportRecipientEmails } from "@/lib/data/email-subscribers";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMlsFeeds } from "@/lib/data/mls-feeds";
import { listCredentials } from "@/lib/data/credentials";
import { listOffices } from "@/lib/data/offices";
import { loadSystemConfig } from "@/lib/data/system-config";
import {
  getFBTokenStatus,
  loadMetaCredentials,
  type FBTokenStatus,
} from "@/lib/post-builder/publish";
import { PLATFORMS } from "./credentialSchemas";
import { setPublishTestModeAction } from "./actions";

export const metadata = { title: "Settings — Alliance Social" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();

  const admin = createAdminClient();

  const [feeds, credentials, offices, systemConfig, weeklyRecipients] =
    await Promise.all([
      listMlsFeeds(),
      listCredentials(),
      listOffices({ active_only: false }),
      loadSystemConfig(),
      getWeeklySocialReportRecipientEmails(),
    ]);

  // Build platform → summary map for the credential cards.
  const credByPlatform = new Map(
    credentials.map((c) => [c.platform, c] as const),
  );

  // why: surface the real FB Page token expiry on the facebook + instagram
  // credential cards. debug_token is a single Graph call; we only fire it
  // when at least one Meta credential is configured so unconfigured
  // installs don't pay the round-trip. Failure is non-fatal — the card
  // just renders without the expiry badge.
  let fbTokenStatus: FBTokenStatus | null = null;
  const metaRowConfigured =
    !!credByPlatform.get("facebook")?.has_value &&
    credByPlatform.get("facebook")?.is_active;
  if (metaRowConfigured) {
    try {
      const metaCreds = await loadMetaCredentials();
      if (metaCreds) {
        fbTokenStatus = await getFBTokenStatus(metaCreds);
      }
    } catch (e) {
      console.warn("[settings] FB token status fetch failed:", e);
    }
  }

  // Dismissed-listings count for the audit card.
  const { count: dismissedCount } = await admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .not("promotion_dismissed_at", "is", null);

  // ListTrac last-validated timestamp powers the ListtracSyncCard pill.
  // why: cast through unknown — "listtrac" was added to the credential_platform
  // enum in 20260526_003 but the generated Database types haven't been
  // regenerated to include it yet. Regenerate Supabase types after this
  // change lands to drop the cast.
  const { data: listtracCred } = await (admin as unknown as {
    from: (rel: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data: { last_validated_at: string | null } | null;
          }>;
        };
      };
    };
  })
    .from("api_credentials")
    .select("last_validated_at")
    .eq("platform", "listtrac")
    .maybeSingle();

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

  // why: pass the server action through to the client banner so the
  // "Switch global default to Live" button can flip the flag without a
  // separate route. Wrapped in a thin closure so the client doesn't need
  // to know the function name.
  async function toggleTestMode(nextValue: boolean) {
    "use server";
    await setPublishTestModeAction(nextValue);
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings"
        description="Manage MLS feeds, API credentials, and team access."
      />

      <TestModeBanner
        testModeOn={systemConfig.publish_test_mode}
        onToggle={toggleTestMode}
      />

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Offices
            </h2>
            <p className="mt-1 text-sm text-neutral-500 max-w-2xl">
              Each office is its own market. Fill in market profiles so the AI
              consultant tailors recommendations to the office that owns each
              post.
            </p>
          </div>
          <Link
            href="/settings/offices"
            className="btn-secondary text-xs whitespace-nowrap"
          >
            Manage offices
          </Link>
        </div>
        {offices.length === 0 ? (
          <EmptyState
            title="No offices configured yet"
            body="Offices are seeded from the database. Run the seed migration if missing."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {offices.slice(0, 4).map((office) => (
              <OfficeCard key={office.id} office={office} />
            ))}
          </div>
        )}
      </section>

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
          title="Portal traffic — ListTrac"
          subtitle="Golden Ruler portal-traffic ingestion. Pulls Zillow, Realtor.com, Trulia, CIH brand sites, and IDX feeds for every active, pending, and recently sold listing."
        />
        <ListtracSyncCard
          lastSyncAt={listtracCred?.last_validated_at ?? null}
        />
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
              tokenStatus={
                def.platform === "facebook" || def.platform === "instagram"
                  ? fbTokenStatus
                  : null
              }
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          title="Account & access"
          subtitle="Update your own password and audit listings you've removed from the dashboard prompt strip."
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Link
            href="/settings/security"
            className="group rounded-xl border border-neutral-200 bg-white shadow-card hover:border-gold-200 hover:shadow-card-hover transition p-5 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-neutral-900 group-hover:text-gold-700">
                My account
              </h3>
              <span className="text-xs text-neutral-400 group-hover:text-gold-600">
                Open →
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Change your password and view your account details.
            </p>
          </Link>

          <Link
            href="/settings/promotions"
            className="group rounded-xl border border-neutral-200 bg-white shadow-card hover:border-gold-200 hover:shadow-card-hover transition p-5 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-neutral-900 group-hover:text-gold-700">
                Dismissed listings
              </h3>
              <span className="text-xs text-neutral-400 group-hover:text-gold-600">
                Open →
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Listings staff have removed from the dashboard prompt strip.
              Restore brings a listing back if it still has missing platforms.
            </p>
            <div className="mt-2 text-xs text-neutral-600">
              <span className="font-semibold text-neutral-900">
                {dismissedCount ?? 0}
              </span>{" "}
              dismissed
            </div>
          </Link>
        </div>
      </section>

      <section>
        <SectionHeading
          title="Email diagnostics"
          subtitle="Verify the Resend integration end-to-end. Sends a hardcoded test email from SocialMediaReport@c21anj.com."
        />
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 space-y-5">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
              Smoke test
            </h3>
            <div className="flex flex-col gap-3">
              <SendTestEmailButton recipient="c21jjk@gmail.com" />
              <SendTestEmailButton recipient="larissa@c21anj.com" />
            </div>
            <p className="mt-3 text-[11px] text-neutral-500">
              Confirms Resend is wired. On success you&apos;ll see a Resend
              message id. Failures surface the underlying error (missing key,
              unverified domain, etc.) inline.
            </p>
          </div>

          <div className="border-t border-neutral-100 pt-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Weekly social media report — design preview
              </h3>
              <Link
                href="/settings/preview/weekly-report"
                className="text-[11px] text-gold-700 hover:text-gold-800 whitespace-nowrap"
              >
                Open in browser →
              </Link>
            </div>
            <SendWeeklyReportPreviewButton />
            <p className="mt-3 text-[11px] text-neutral-500">
              Builds the full weekly recap with the prior Mon&ndash;Sun&apos;s
              real data and emails it to c21jjk@gmail.com only. Or use{" "}
              <strong className="text-neutral-700">Open in browser</strong> to
              see the same render inline without an inbox round-trip.
            </p>
          </div>

          <div className="border-t border-neutral-100 pt-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Weekly social media report — full distribution
              </h3>
              <Link
                href="/settings/subscribers"
                className="text-[11px] text-gold-700 hover:text-gold-800 whitespace-nowrap"
              >
                Manage subscribers →
              </Link>
            </div>
            <SendWeeklyReportDistributionButton
              recipientCount={weeklyRecipients.length}
            />
            <p className="mt-3 text-[11px] text-neutral-500">
              Sends to{" "}
              <strong className="text-neutral-700">
                {weeklyRecipients.length}
              </strong>{" "}
              {weeklyRecipients.length === 1 ? "subscriber" : "subscribers"}{" "}
              with <em>Weekly social report</em> opted in. A confirmation dialog
              appears before the send fires. The Monday-morning cron uses the
              same list automatically.
            </p>
          </div>

          <div className="border-t border-neutral-100 pt-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Office post announcement — design preview
              </h3>
              <div className="flex items-center gap-3 whitespace-nowrap">
                <Link
                  href="/settings/preview/office-post-announcement"
                  className="text-[11px] text-gold-700 hover:text-gold-800"
                >
                  Open in browser →
                </Link>
                <Link
                  href="/settings/announcements"
                  className="text-[11px] text-gold-700 hover:text-gold-800"
                >
                  Recent sends →
                </Link>
              </div>
            </div>
            <SendOfficePostAnnouncementPreviewButton />
            <p className="mt-3 text-[11px] text-neutral-500">
              Picks the first eligible group (category &ldquo;Property
              Promotion&rdquo; with an office or division audience) and sends
              the rendered email to{" "}
              <strong className="text-neutral-700">c21jjk@gmail.com</strong>{" "}
              only. Or use{" "}
              <strong className="text-neutral-700">Open in browser</strong> for
              the same render inline. The real cron fires every morning at
              8&nbsp;AM ET and emails the roster one message per new campaign.
            </p>
          </div>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{body}</p>
    </div>
  );
}
