/**
 * Visual "TEST" badge for a post that's flagged test_mode=true.
 *
 * Rendered wherever a post surface is visible:
 *   - saved-posts list cards
 *   - post detail drawer header
 *   - Post Now / Schedule result toasts
 *
 * Color: amber on white — same family as the "Rotate soon" credential
 * badge so the testing UI feels coherent. Compact size so it doesn't
 * crowd dense cards.
 */
export default function TestModeChip({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span
      className={
        "badge bg-amber-100 text-amber-800 ring-1 ring-amber-300 text-[10px] font-semibold tracking-wide uppercase " +
        className
      }
      title="This post is in test mode — drafts only, not visible to the public"
    >
      Test
    </span>
  );
}
