"use client";

/**
 * Discoverability shortcut for the seller-report flow. Rendered at the top of
 * the post detail body when no listing is attached. Clicking it smooth-scrolls
 * to the Classify panel and dispatches a window event the panel listens for
 * to pre-select "Property Promotion" and focus the search input — so the user
 * lands on a primed search box, not a category dropdown.
 *
 * Event contract: dispatches `attach-listing:focus` on `window`. The matching
 * listener lives in PropertyClassifyPanel.
 */
export default function AttachListingCta() {
  function onClick() {
    const target = document.getElementById("classify-panel");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Defer the event by one frame so the scroll is in flight before the
    // panel re-renders with category=property; otherwise the layout shift
    // can outrun the smooth scroll.
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("attach-listing:focus"));
    });
  }

  return (
    <section
      aria-label="Attach a listing"
      className="rounded-xl border border-gold-200 bg-gradient-to-br from-gold-50/80 via-white to-white shadow-card p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
    >
      <div className="flex items-start md:items-center gap-3 flex-1 min-w-0">
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gold-100 text-gold-700 shrink-0"
        >
          <PinIcon />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-900">
            No listing attached yet
          </div>
          <p className="text-xs text-neutral-600 mt-0.5 leading-snug">
            Link this campaign to a property so it rolls into the seller&apos;s
            owner report.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md bg-gold-500 hover:bg-gold-600 text-white text-xs font-medium px-3 py-2 shadow-sm transition-colors"
      >
        Attach a listing
        <ArrowDownIcon />
      </button>
    </section>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-7.4-7-12a7 7 0 1 1 14 0c0 4.6-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}
