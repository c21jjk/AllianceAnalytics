import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getMlsFeed } from "@/lib/data/mls-feeds";
import PageHeader from "@/components/PageHeader";
import MlsFeedForm, { toMlsFeedFormData } from "@/components/MlsFeedForm";
import MlsFeedSyncNow from "@/components/MlsFeedSyncNow";
import { upsertMlsFeed } from "../../../actions";

interface PageProps {
  params: Promise<{ short_code: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  const { short_code } = await params;
  return { title: `Edit ${short_code} feed — Alliance Social` };
}

export default async function EditMlsFeedPage({ params }: PageProps) {
  await requireAdmin();
  const { short_code } = await params;
  const decoded = decodeURIComponent(short_code);
  const feed = await getMlsFeed(decoded);
  if (!feed) notFound();

  const boundAction = upsertMlsFeed.bind(null, decoded);

  // Sync Now is wired to the RETS sync Edge Functions: cmc + sjsr via
  // mls-rets-sync (Paragon), bright via bright-rets-sync (Cornerstone RETS).
  const isRets = feed.feed_type === "rets";
  const isWired =
    decoded === "cmc" || decoded === "sjsr" || decoded === "bright";
  const syncDisabled = !feed.is_active || !isRets || !isWired;
  let syncDisabledReason: string | undefined;
  if (!feed.is_active) {
    syncDisabledReason = "Feed is inactive — toggle it on to enable Sync now.";
  } else if (!isRets) {
    syncDisabledReason = "Sync now is only wired for RETS feeds.";
  } else if (!isWired) {
    syncDisabledReason =
      "Sync now is wired for the cmc, sjsr, and bright feeds only.";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">MLS feeds</span>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 font-mono">{decoded}</span>
      </div>

      <PageHeader
        title={`Edit ${feed.name}`}
        description="Connection details for this MLS feed. Secrets are stored encrypted at rest and only accessible via server-side service-role calls."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <div className="mb-6 pb-6 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-800 mb-3">
            Sync status
          </h3>
          <MlsFeedSyncNow
            shortCode={decoded}
            lastSyncAt={feed.last_sync_at}
            lastValidatedOk={feed.last_validated_ok}
            disabled={syncDisabled}
            disabledReason={syncDisabledReason}
          />
        </div>
        {/* Sanitize before passing to client form — strips raw secret
            values so they don't ship in the RSC payload. */}
        <MlsFeedForm feed={toMlsFeedFormData(feed)} action={boundAction} />
      </div>
    </div>
  );
}
