import clsx from "clsx";

interface ComingSoonBannerProps {
  /** Visual size variant — "sm" for the 48x48 dashboard thumb, "md" for hero photos. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * "COMING SOON" banner overlaid on a listing photo. Bright's feed delivers
 * Coming Soon listings as status=active (so every card keeps working); this
 * banner is the only thing that tells them apart from live listings.
 *
 * Obsessed Grey ground with Relentless Gold text, so it reads as a different
 * thing from the gold POSTED ribbon and both can sit on one thumbnail
 * (POSTED hugs the bottom edge, COMING SOON hugs the top).
 *
 *   "sm"  thin horizontal banner across the TOP of the 48px thumbnail
 *   "md"  diagonal ribbon across the upper-LEFT corner of a hero photo
 *         (upper-right is taken by the POSTED ribbon on /properties)
 */
export default function ComingSoonBanner({
  size = "md",
  className,
}: ComingSoonBannerProps) {
  if (size === "sm") {
    return (
      <div
        className={clsx(
          "absolute inset-x-0 top-0 z-10 text-center text-[7.5px] font-bold uppercase tracking-wide leading-tight py-0.5",
          "bg-neutral-900/85 text-gold-400 backdrop-blur-[1px]",
          className,
        )}
        aria-label="Coming Soon listing"
      >
        Coming Soon
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "absolute top-0 left-0 z-10 pointer-events-none overflow-hidden w-32 h-32",
        className,
      )}
      aria-label="Coming Soon listing"
    >
      <div
        className={clsx(
          "absolute text-center text-[11px] font-bold uppercase tracking-wider shadow-lg",
          "py-1.5 left-[-42px] top-[26px] w-[170px] -rotate-45",
          "bg-neutral-900/90 text-gold-400",
        )}
      >
        Coming Soon
      </div>
    </div>
  );
}
