import clsx from "clsx";

interface AiInsightCardProps {
  /** Headline of the insight, e.g. "Reels are outpacing image posts 2.4x" */
  headline: string;
  /** Optional supporting copy underneath */
  body?: string;
  /** Optional list of bullet observations */
  bullets?: string[];
  /** When true, render with a subtle "Coming soon" affordance instead of an action */
  isPlaceholder?: boolean;
  className?: string;
}

/**
 * Surface for Claude-AI–powered insights. Currently a placeholder; once the
 * Claude API is wired up, it will display rolling weekly summaries, top
 * post analyses, and recommended next-post ideas.
 *
 * Design intent: visually distinct from regular cards (gradient gold tint,
 * sparkle glyph) so users learn to associate this surface with AI output.
 */
export default function AiInsightCard({
  headline,
  body,
  bullets,
  isPlaceholder = false,
  className,
}: AiInsightCardProps) {
  return (
    <div
      className={clsx(
        "relative rounded-xl border border-gold-200 overflow-hidden",
        "bg-gradient-to-br from-gold-50 via-white to-white",
        "shadow-card",
        className,
      )}
    >
      {/* Decorative corner glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative p-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
            <SparkleIcon />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
            Claude AI insight
          </span>
          {isPlaceholder ? (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
              <PulseDot />
              Coming soon
            </span>
          ) : null}
        </div>

        <h3 className="mt-2.5 text-base md:text-lg font-semibold tracking-tight text-neutral-900">
          {headline}
        </h3>
        {body ? (
          <p className="mt-1.5 text-sm text-neutral-600 leading-relaxed max-w-2xl">
            {body}
          </p>
        ) : null}

        {bullets && bullets.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {bullets.map((b, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-neutral-700"
              >
                <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14zM5 16l.5 1.3L7 18l-1.5.4L5 20l-.5-1.6L3 18l1.5-.4L5 16z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

function PulseDot() {
  return (
    <span className="relative inline-flex w-1.5 h-1.5">
      <span className="absolute inset-0 rounded-full bg-gold-500 animate-ping opacity-60" />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-gold-500" />
    </span>
  );
}
