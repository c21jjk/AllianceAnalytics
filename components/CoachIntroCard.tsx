import clsx from "clsx";

interface CoachIntroCardProps {
  className?: string;
}

/**
 * Hero/intro card for the top of /coach.
 *
 * Explains the Coach experience: Claude reviews your last 30 days,
 * analyzes across all platforms, and gives spend recommendations.
 * Uses the AI-tinted gold gradient treatment.
 *
 * Includes an optional disclosure about data requirements.
 */
export default function CoachIntroCard({ className }: CoachIntroCardProps) {
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

      <div className="relative p-5 md:p-6">
        {/* Header row: eyebrow + coming soon pill */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
            <SparkleIcon />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
            Powered by Claude AI
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
            <PulseDot />
            Coming soon
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900 mb-3">
          Your social media coach
        </h1>

        {/* Body */}
        <p className="text-base text-neutral-600 leading-relaxed max-w-2xl mb-6">
          Claude reviews your last 30 days of posts, looks across Facebook,
          Instagram, and TikTok, and tells you exactly where to put your next
          marketing dollar. Recommendations refresh weekly — and on demand once
          we go live.
        </p>

        {/* Disclosure section */}
        <div className="rounded-lg border border-neutral-200 bg-white/70 p-4">
          <div className="text-xs font-semibold text-neutral-800 mb-2">
            What we'll need
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed">
            To make recommendations real, we'll wire in ad-spend data from Meta
            and TikTok Ads, plus lead and conversion tracking. Until then, this
            surface previews the experience with example data.
          </p>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
      <path
        d="M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14z"
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
