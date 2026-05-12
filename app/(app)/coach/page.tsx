import { requireUser } from "@/lib/auth";
import { listOffices } from "@/lib/data/offices";
import { readCachedCoachInsights } from "@/lib/ai/coach-insights";
import { getCoachTrends } from "@/lib/data/coach-trends";
import { createAdminClient } from "@/lib/supabase/admin";
import CoachIntroCard from "@/components/CoachIntroCard";
import RecommendationCard from "@/components/RecommendationCard";
import BudgetSplitChart from "@/components/BudgetSplitChart";
import TrendNoteList from "@/components/TrendNoteList";
import PlanGenerator from "@/components/PlanGenerator";
import CoachRefreshButton from "@/components/CoachRefreshButton";

export const metadata = { title: "Coach — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Coach surface — five sub-surfaces:
 *   1. Intro card                — static (CoachIntroCard)
 *   2. Plan generator            — REAL, Claude Opus per-call (PlanGenerator)
 *   3. Spend recommendations     — REAL, cached daily in coach_insights
 *   4. Per-listing weekly budgets — REAL, cached daily in coach_insights
 *   5. Trend Watch               — REAL, derived from posts + followers (math, no AI)
 *
 * Phase 2 wired surfaces 3–5 against real data. Surfaces 3 + 4 are
 * refreshed daily via Vercel cron hitting /api/cron/coach-refresh, and
 * admins can manually trigger a refresh via the button at the top of
 * the page.
 */
export default async function CoachPage() {
  const profile = await requireUser();
  const isAdmin = profile.role === "admin";
  const offices = await listOffices({ active_only: true });
  const officeOptions = offices.map((o) => ({
    short_code: o.short_code,
    display_name: o.display_name ?? o.name,
  }));

  const [insights, trends] = await Promise.all([
    readCachedCoachInsights("brand_wide"),
    getCoachTrends({ windowDays: 30, comparisonWindowDays: 30 }),
  ]);

  // Sort recs by priority so high-priority surfaces float to the top.
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedRecs = [...insights.recommendations].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  // Resolve property addresses for the budget + recommendation cards.
  // Fetch in one trip when there are MLS refs.
  const referencedMls = Array.from(
    new Set(
      [
        ...sortedRecs.map((r) => r.mls).filter((m): m is string => !!m),
        ...insights.budgets.map((b) => b.mls),
      ],
    ),
  );
  const addressByMls = await lookupAddressesByMls(referencedMls);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <CoachIntroCard />
        </div>
      </div>

      {/* AI plan generator — Phase 1, real */}
      <PlanGenerator offices={officeOptions} />

      {/* Spend recommendations — Phase 2, cached daily */}
      <section className="space-y-3" aria-labelledby="recs-heading">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2
              id="recs-heading"
              className="text-lg font-semibold tracking-tight text-neutral-900"
            >
              Spend recommendations
            </h2>
            <p className="text-sm text-neutral-500 max-w-2xl">
              Where Claude thinks your next dollar should go, based on the
              last 30 days of real performance. Refreshed automatically each
              morning.
            </p>
          </div>
          <CoachRefreshButton
            generatedAt={insights.generated_at}
            isAdmin={isAdmin}
          />
        </div>

        {sortedRecs.length === 0 ? (
          <CoachEmptyState
            heading="No recommendations yet"
            body={
              insights.last_error
                ? `Last refresh failed: ${insights.last_error}. Click "Refresh insights" to try again.`
                : insights.generated_at
                  ? "Claude found no actionable recommendations in the latest run. This usually means the data is too thin — give the brand a couple more weeks of posting and try again."
                  : "The first refresh hasn't run yet. Click \"Refresh insights\" to generate today's recommendations, or wait for the daily 6am ET auto-refresh."
            }
            isAdmin={isAdmin}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sortedRecs.map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                propertyAddress={
                  rec.mls ? addressByMls.get(rec.mls) ?? undefined : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Per-property budget allocations — Phase 2, cached daily */}
      <section className="space-y-3" aria-labelledby="budget-heading">
        <div>
          <h2
            id="budget-heading"
            className="text-lg font-semibold tracking-tight text-neutral-900"
          >
            Per-listing weekly budgets
          </h2>
          <p className="text-sm text-neutral-500 max-w-2xl">
            How Claude would split a weekly marketing budget across platforms
            for each active listing, based on price band, audience fit, and
            what's been working.
          </p>
        </div>

        {insights.budgets.length === 0 ? (
          <CoachEmptyState
            heading="No budget allocations yet"
            body={
              insights.generated_at
                ? "Claude couldn't compute budgets — usually means there are no active listings in the database yet."
                : "The first refresh hasn't run yet. Click \"Refresh insights\" above or wait for the daily 6am ET auto-refresh."
            }
            isAdmin={isAdmin}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {insights.budgets.map((alloc) => {
              const address = addressByMls.get(alloc.mls);
              return (
                <article
                  key={alloc.id}
                  className="rounded-xl border border-neutral-200 bg-white shadow-card p-5"
                >
                  <header className="mb-4">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                      MLS {alloc.mls}
                    </div>
                    <div className="mt-1 text-sm font-medium text-neutral-900">
                      {address ?? "Property"}
                    </div>
                  </header>
                  <BudgetSplitChart allocation={alloc} />
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Trend watch — derived from real metrics */}
      <section className="space-y-3" aria-labelledby="trends-heading">
        <div>
          <h2
            id="trends-heading"
            className="text-lg font-semibold tracking-tight text-neutral-900"
          >
            Trend watch
          </h2>
          <p className="text-sm text-neutral-500 max-w-2xl">
            Patterns across your last 30 days that don't need an action — but
            you should know about them. Computed live from post performance
            and audience data (no AI).
          </p>
        </div>

        {trends.length === 0 ? (
          <CoachEmptyState
            heading="No trends to surface yet"
            body="There isn't enough recent data to compute meaningful trends. Once you have ~10+ posts across the last 60 days, observations will start appearing here."
            isAdmin={isAdmin}
          />
        ) : (
          <TrendNoteList notes={trends} />
        )}
      </section>
    </div>
  );
}

/**
 * Resolve property addresses by MLS number. Used by both the
 * Spend Recommendations and Per-listing Budget surfaces.
 *
 * Returns an empty map when the input list is empty or the query fails.
 */
async function lookupAddressesByMls(
  mlsNumbers: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (mlsNumbers.length === 0) return out;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("properties")
      .select("mls_number, address")
      .in("mls_number", mlsNumbers);
    for (const row of (data ?? []) as Array<{
      mls_number: string;
      address: string | null;
    }>) {
      if (row.address) out.set(row.mls_number, row.address);
    }
  } catch {
    // graceful degrade
  }
  return out;
}

/**
 * Empty state used across the three cached-AI surfaces. Same visual
 * treatment so the page reads consistently when sections are missing.
 */
function CoachEmptyState({
  heading,
  body,
  isAdmin,
}: {
  heading: string;
  body: string;
  isAdmin: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/40 px-5 py-6 text-center">
      <h3 className="text-sm font-medium text-neutral-900">{heading}</h3>
      <p className="mt-1 text-sm text-neutral-600 max-w-xl mx-auto leading-relaxed">
        {body}
      </p>
      {!isAdmin ? (
        <p className="mt-2 text-[11px] text-neutral-500">
          Ask an admin to trigger a refresh from this page.
        </p>
      ) : null}
    </div>
  );
}
