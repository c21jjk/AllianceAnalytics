import clsx from "clsx";

interface ReportNarrativeBlockProps {
  reachSummary: string;
  closing: string;
  className?: string;
}

/**
 * AI-tinted narrative block showing reach summary and closing paragraphs.
 * Currently marked as "Coming soon" since auto-generation happens in Phase 2.
 */
export default function ReportNarrativeBlock({
  reachSummary,
  closing,
  className,
}: ReportNarrativeBlockProps) {
  return (
    <div
      className={clsx(
        "relative rounded-xl border border-gold-200 overflow-hidden",
        "bg-gradient-to-br from-gold-50 via-white to-white",
        "shadow-card",
        "p-6 md:p-8",
        className,
      )}
    >
      {/* Decorative corner glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative space-y-6">
        {/* Header + coming soon pill */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
            <SparkleIcon />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
            Written by Claude AI
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
            <PulseDot />
            Coming soon
          </span>
        </div>

        {/* Paragraphs — side by side on md+, stacked on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 md:border-l md:border-l-gold-200 md:pl-6">
          <p className="text-sm text-neutral-600 leading-relaxed">
            {reachSummary}
          </p>
          <p className="text-sm text-neutral-600 leading-relaxed">
            {closing}
          </p>
        </div>

        {/* Footer note */}
        <div className="pt-4 border-t border-gold-200/60 text-[11px] text-neutral-500 leading-relaxed">
          This narrative will be auto-generated from the post performance once Claude is wired up. The current text is a representative example.
        </div>
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
