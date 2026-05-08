import clsx from "clsx";

interface AiAnalysisPanelProps {
  className?: string;
}

/**
 * Placeholder for per-post AI analysis on /posts/[id].
 *
 * Once the Claude API is wired up, this panel will produce:
 *   - A 2-sentence summary of why this post performed the way it did
 *   - Suggested captions for cross-posting to other platforms
 *   - Ideas for follow-up content tied to the same property
 */
export default function AiAnalysisPanel({ className }: AiAnalysisPanelProps) {
  return (
    <section
      className={clsx(
        "relative rounded-xl border border-gold-200 overflow-hidden",
        "bg-gradient-to-br from-gold-50 via-white to-white",
        "shadow-card",
        className,
      )}
      aria-labelledby="ai-analysis-heading"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-10 w-44 h-44 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative p-5 md:p-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
              <path
                d="M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14z"
                opacity="0.6"
              />
            </svg>
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
            Claude AI analysis
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />
            Coming soon
          </span>
        </div>

        <h2
          id="ai-analysis-heading"
          className="mt-2.5 text-base md:text-lg font-semibold tracking-tight text-neutral-900"
        >
          What Claude will tell you about this post
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600 max-w-2xl leading-relaxed">
          Once Claude is wired up, this panel will summarize why the post
          performed the way it did, suggest captions to repurpose it on the
          other platforms, and recommend follow-up content tied to the linked
          property.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <PlaceholderTile
            title="Performance summary"
            body="A two-sentence read on why reach, engagement, and saves landed where they did."
          />
          <PlaceholderTile
            title="Cross-platform captions"
            body="Reword this post for Facebook + TikTok in the right voice for each platform."
          />
          <PlaceholderTile
            title="Next post ideas"
            body="Three follow-up angles tied to the same property and audience."
          />
          <PlaceholderTile
            title="Should I put money behind this?"
            body="A boost recommendation with projected reach lift, suggested spend, and the right audience to target."
          />
        </div>
      </div>
    </section>
  );
}

function PlaceholderTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white/70 p-3">
      <div className="text-xs font-semibold text-neutral-800">{title}</div>
      <p className="mt-1 text-xs text-neutral-500 leading-relaxed">{body}</p>
    </div>
  );
}
