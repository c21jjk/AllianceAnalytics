import clsx from "clsx";

interface AskAiButtonProps {
  /** Optional text label override */
  label?: string;
  /** Disable interaction; renders the "coming soon" affordance */
  disabled?: boolean;
  className?: string;
}

/**
 * Placeholder affordance for "Ask Claude" — a future natural-language
 * query bar that will let users filter posts with prompts like
 * "show me my top 5 video posts in Cherry Hill last quarter".
 *
 * Currently disabled; renders styled like an input so users see where
 * the feature will live.
 */
export default function AskAiButton({
  label = "Ask Claude about your posts…",
  disabled = true,
  className,
}: AskAiButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={
        disabled
          ? "Natural-language search is coming soon — Claude will summarize and filter your posts."
          : undefined
      }
      className={clsx(
        "group inline-flex items-center gap-2 rounded-lg pl-2.5 pr-3 py-2",
        "bg-white border border-neutral-200 text-sm text-neutral-500",
        "hover:border-gold-300 hover:text-neutral-700",
        "transition cursor-not-allowed disabled:cursor-not-allowed",
        className,
      )}
    >
      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gold-50 text-gold-700">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
          <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
        </svg>
      </span>
      <span className="truncate">{label}</span>
      <span className="ml-1 hidden sm:inline-flex items-center gap-1 rounded-full bg-gold-50 ring-1 ring-gold-100 px-1.5 py-0.5 text-[10px] font-medium text-gold-700">
        Soon
      </span>
    </button>
  );
}
