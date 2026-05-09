import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { findProperty, postsForMls, POSTS } from "@/lib/fixtures/posts";
import {
  findReport,
  deliveriesForReport,
} from "@/lib/fixtures/reports";
import PropertyReportHero from "@/components/PropertyReportHero";
import PropertyKpiRollup from "@/components/PropertyKpiRollup";
import PostThumbnailGrid from "@/components/PostThumbnailGrid";
import AudienceReachRollup from "@/components/AudienceReachRollup";
import ReportNarrativeBlock from "@/components/ReportNarrativeBlock";
import ReportActionBar from "@/components/ReportActionBar";
import DeliveryStatusPill from "@/components/DeliveryStatusPill";
import GenerateReportButton from "@/components/GenerateReportButton";
import SendToAgentButton from "@/components/SendToAgentButton";
import { formatRelativeTime } from "@/lib/format";

interface PageProps {
  params: Promise<{ mls: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { mls } = await params;
  const property = findProperty(mls);
  if (!property) return { title: "Property — Alliance Social" };
  return { title: `${property.address} — Alliance Social` };
}

export default async function PropertyDetailPage({ params }: PageProps) {
  await requireUser();
  const { mls } = await params;

  const property = findProperty(mls);
  const report = findReport(mls);
  if (!property || !report) notFound();

  const posts = report.post_ids
    .map((id) => POSTS.find((p) => p.id === id))
    .filter((p): p is (typeof POSTS)[0] => p !== undefined);

  // Pick the most recent delivery as the "primary" share token for this view
  const deliveries = deliveriesForReport(report.id);
  const sharedDelivery =
    deliveries.find((d) => d.status === "viewed") ??
    deliveries.find((d) => d.status === "sent") ??
    deliveries[0];

  // Compute newest post age (days since the most recent post in the group)
  const NOW = new Date();
  const newestPostAgeDays =
    posts.length > 0
      ? Math.floor(
          (NOW.getTime() -
            posts.reduce(
              (max, p) => Math.max(max, new Date(p.posted_at).getTime()),
              0,
            )) /
            86_400_000,
        )
      : null;

  const flyerUrl = sharedDelivery
    ? `/r/${sharedDelivery.share_token}/flyer`
    : "";
  const pdfUrl = sharedDelivery
    ? `/r/${sharedDelivery.share_token}/flyer.pdf`
    : "";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-800">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/properties" className="hover:text-neutral-800">
          Properties
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 truncate max-w-xs">
          {property.address}
        </span>
      </div>

      {/* Action bar — placeholders for PDF/email + live copy-link */}
      {sharedDelivery ? (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-neutral-500">
            Shareable link:
            <code className="ml-2 px-1.5 py-0.5 text-xs bg-neutral-100 rounded">
              /r/{sharedDelivery.share_token}
            </code>
          </div>
          <ReportActionBar shareToken={sharedDelivery.share_token} />
        </div>
      ) : null}

      {/* Generate + send-to-agent controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-3">
        <GenerateReportButton
          mls={property.mls}
          newestPostAgeDays={newestPostAgeDays}
        />
        <SendToAgentButton
          propertyAddress={property.address}
          flyerUrl={flyerUrl}
          pdfUrl={pdfUrl}
          disabled={!sharedDelivery}
        />
      </div>

      {/* Hero */}
      <PropertyReportHero report={report} property={property} />

      {/* KPIs */}
      <PropertyKpiRollup kpis={report.kpis} />

      {/* Posts in the report */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Posts in this report
          </h2>
          <p className="text-sm text-neutral-500">
            {posts.length} posts that ran for this listing across{" "}
            {report.kpis.platforms_covered}{" "}
            {report.kpis.platforms_covered === 1 ? "platform" : "platforms"}.
          </p>
        </div>
        <PostThumbnailGrid posts={posts} />
      </section>

      {/* Audience rollup */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Who saw this listing
          </h2>
          <p className="text-sm text-neutral-500">
            Aggregated across all posts in the reporting period.
          </p>
        </div>
        <AudienceReachRollup audience={report.audience} />
      </section>

      {/* AI narrative */}
      <ReportNarrativeBlock
        reachSummary={report.narrative.reach_summary}
        closing={report.narrative.closing}
      />

      {/* Delivery history */}
      {deliveries.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Delivery history
            </h2>
            <p className="text-sm text-neutral-500">
              When and how this report has been shared with the seller.
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white shadow-card divide-y divide-neutral-200">
            {deliveries.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900">
                    {d.recipient_name}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {d.recipient_email} · via {d.channel}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-neutral-500">
                    {d.sent_at ? formatRelativeTime(d.sent_at) : "Pending"}
                  </span>
                  <DeliveryStatusPill
                    status={d.status}
                    viewCount={d.view_count}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
