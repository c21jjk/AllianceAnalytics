/**
 * Morning Briefing — Phase 7 dashboard summary line.
 *
 * One quiet card above the milestones grid that answers "what happened
 * overnight" in a single glance. Each highlighted number is a soft link
 * that scrolls Larissa to the corresponding milestone card below.
 *
 * Hides entirely when nothing happened in the last 24h AND nothing is
 * scheduled this week — keeps the dashboard light on slow mornings.
 */
interface Props {
  newListingsFresh: number;
  underContractFresh: number;
  recentlySoldFresh: number;
  /** 2026-08-05 — price reductions recorded in the last 24h. */
  priceChangesFresh?: number;
  openHousesThisWeek: number;
  storyViewsLast24h: number;
}

export default function MorningBriefingCard({
  newListingsFresh,
  underContractFresh,
  recentlySoldFresh,
  priceChangesFresh = 0,
  openHousesThisWeek,
  storyViewsLast24h,
}: Props) {
  // Build the sentence fragments only when there's actually something to
  // say. Empty days collapse to nothing so the card doesn't sit there
  // displaying zeros.
  const parts: Array<{ count: number; label: string; anchor: string }> = [];
  if (newListingsFresh > 0) {
    parts.push({
      count: newListingsFresh,
      label:
        newListingsFresh === 1
          ? "new listing synced"
          : "new listings synced",
      anchor: "recently-listed",
    });
  }
  if (underContractFresh > 0) {
    parts.push({
      count: underContractFresh,
      label: underContractFresh === 1 ? "went under contract" : "went under contract",
      anchor: "under-contract",
    });
  }
  if (recentlySoldFresh > 0) {
    parts.push({
      count: recentlySoldFresh,
      label: recentlySoldFresh === 1 ? "closed" : "closed",
      anchor: "recently-sold",
    });
  }
  if (priceChangesFresh > 0) {
    parts.push({
      count: priceChangesFresh,
      label:
        priceChangesFresh === 1 ? "price reduction" : "price reductions",
      anchor: "price-changes",
    });
  }
  if (openHousesThisWeek > 0) {
    parts.push({
      count: openHousesThisWeek,
      label:
        openHousesThisWeek === 1
          ? "open house this week"
          : "open houses this week",
      anchor: "open-houses",
    });
  }
  if (storyViewsLast24h > 0) {
    parts.push({
      count: storyViewsLast24h,
      label:
        storyViewsLast24h === 1
          ? "story opened by a seller"
          : "stories opened by sellers",
      anchor: "owner-stories",
    });
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Morning briefing"
      className="rounded-xl border border-neutral-200 bg-white shadow-card px-4 py-3 md:px-5 md:py-4"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-700 shrink-0">
          This morning
        </div>
        <div className="text-sm md:text-base text-neutral-700 leading-relaxed">
          {parts.map((p, idx) => (
            <span key={p.anchor}>
              {idx > 0 ? (
                <span className="text-neutral-400"> · </span>
              ) : null}
              <a
                href={`#${p.anchor}`}
                className="font-semibold text-neutral-900 tabular-nums hover:text-gold-700 transition-colors"
              >
                {p.count}
              </a>{" "}
              <span className="text-neutral-600">{p.label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
