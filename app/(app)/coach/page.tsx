import { requireUser } from "@/lib/auth";
import {
  RECOMMENDATIONS,
  BUDGET_ALLOCATIONS,
  TREND_NOTES,
} from "@/lib/fixtures/strategy";
import { findProperty } from "@/lib/fixtures/posts";
import { listOffices } from "@/lib/data/offices";
import CoachIntroCard from "@/components/CoachIntroCard";
import RecommendationCard from "@/components/RecommendationCard";
import BudgetSplitChart from "@/components/BudgetSplitChart";
import TrendNoteList from "@/components/TrendNoteList";
import PlanGenerator from "@/components/PlanGenerator";

export const metadata = { title: "Coach — Alliance Social" };

export default async function CoachPage() {
  await requireUser();
  const offices = await listOffices({ active_only: true });
  const officeOptions = offices.map((o) => ({
    short_code: o.short_code,
    display_name: o.display_name ?? o.name,
  }));

  // Sort recs by priority so high-priority surfaces float to the top.
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedRecs = [...RECOMMENDATIONS].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return (
    <div className="space-y-6">
      <CoachIntroCard />

      {/* AI plan generator (Claude Opus) */}
      <PlanGenerator offices={officeOptions} />

      {/* Spend recommendations */}
      <section className="space-y-3" aria-labelledby="recs-heading">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2
              id="recs-heading"
              className="text-lg font-semibold tracking-tight text-neutral-900"
            >
              Spend recommendations
            </h2>
            <p className="text-sm text-neutral-500 max-w-2xl">
              Where Claude thinks your next dollar should go. Each rec ties
              back to a specific post or property and shows the projected
              lift.
            </p>
          </div>
          <span className="text-xs text-neutral-400">
            {sortedRecs.length} recommendations
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sortedRecs.map((rec) => {
            const propertyAddress = rec.mls
              ? findProperty(rec.mls)?.address
              : undefined;
            return (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                propertyAddress={propertyAddress}
              />
            );
          })}
        </div>
      </section>

      {/* Per-property budget allocations */}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {BUDGET_ALLOCATIONS.map((alloc) => {
            const property = findProperty(alloc.mls);
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
                    {property?.address ?? "Property"}
                  </div>
                </header>
                <BudgetSplitChart allocation={alloc} />
              </article>
            );
          })}
        </div>
      </section>

      {/* Trend watch */}
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
            you should know about them.
          </p>
        </div>

        <TrendNoteList notes={TREND_NOTES} />
      </section>
    </div>
  );
}
