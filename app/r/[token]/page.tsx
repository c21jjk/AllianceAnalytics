import { notFound } from "next/navigation";
import {
  findDeliveryByToken,
  findReportById,
} from "@/lib/fixtures/reports";
import { findProperty, POSTS } from "@/lib/fixtures/posts";
import PropertyReportHero from "@/components/PropertyReportHero";
import PropertyKpiRollup from "@/components/PropertyKpiRollup";
import PostThumbnailGrid from "@/components/PostThumbnailGrid";
import AudienceReachRollup from "@/components/AudienceReachRollup";
import ReportNarrativeBlock from "@/components/ReportNarrativeBlock";

export const metadata = {
  title: "Property Report — Century 21 Alliance",
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Public, no-auth, brand-wrapped property report.
 *
 * This is the URL the seller receives. Same content as the in-app property
 * detail, but framed in Alliance branding — no nav, no Coach card, just
 * the report.
 *
 * Phase 2 will swap the share_token lookup for a signed token check with
 * an expiration window.
 */
export default async function PublicReportPage({ params }: PageProps) {
  const { token } = await params;
  const delivery = findDeliveryByToken(token);
  if (!delivery) notFound();

  const report = findReportById(delivery.report_id);
  const property = report ? findProperty(report.mls) : undefined;
  if (!report || !property) notFound();

  const posts = report.post_ids
    .map((id) => POSTS.find((p) => p.id === id))
    .filter((p): p is (typeof POSTS)[0] => p !== undefined);

  return (
    <div className="min-h-screen bg-neutral-25">
      {/* Alliance brand header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gold-500 text-white font-semibold text-sm">
              A
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-neutral-900">
                Century 21 Alliance
              </div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                Property Performance Report
              </div>
            </div>
          </div>
          <div className="hidden sm:block text-xs text-neutral-500">
            Prepared for {delivery.recipient_name}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">
        <PropertyReportHero report={report} property={property} />
        <PropertyKpiRollup kpis={report.kpis} />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Every post we put behind your home
          </h2>
          <PostThumbnailGrid posts={posts} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Who saw your listing
          </h2>
          <AudienceReachRollup audience={report.audience} />
        </section>

        <ReportNarrativeBlock
          reachSummary={report.narrative.reach_summary}
          closing={report.narrative.closing}
        />
      </main>

      {/* Alliance brand footer */}
      <footer className="border-t border-neutral-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 text-center">
          <div className="text-sm text-neutral-700">
            Thank you for trusting Century 21 Alliance with your home.
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Questions? Reply directly to the email this report came from, or
            reach out to your Alliance agent.
          </div>
        </div>
      </footer>
    </div>
  );
}
