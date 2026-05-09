import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getMlsFeed } from "@/lib/data/mls-feeds";
import PageHeader from "@/components/PageHeader";
import MlsFeedForm from "@/components/MlsFeedForm";
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
        <MlsFeedForm feed={feed} action={boundAction} />
      </div>
    </div>
  );
}
