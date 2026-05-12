"use client";

import { useState } from "react";
import clsx from "clsx";

interface ReportActionBarProps {
  shareToken: string;
  className?: string;
}

/**
 * Action toolbar for property reports. Only renders once a report exists
 * (the parent gates on `existingReport`), so every button below is meaningful.
 *
 * - Download PDF       → live, hits /r/[token]/flyer.pdf (react-pdf renderer)
 * - Copy shareable link → live, copies https://alliancesocial.app/r/[token]
 * - Send to client     → disabled until Phase D (Resend) lands; tooltip says so
 */
export default function ReportActionBar({
  shareToken,
  className,
}: ReportActionBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const shareUrl = `https://alliancesocial.app/r/${shareToken}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div
      className={clsx(
        "flex flex-col sm:flex-row items-center gap-3",
        className,
      )}
    >
      {/* Download PDF — live. Opens the react-pdf renderer at /r/[token]/flyer.pdf */}
      <a
        href={`/r/${shareToken}/flyer.pdf`}
        target="_blank"
        rel="noopener noreferrer"
        title="Download the branded PDF for this report"
        className={clsx(
          "px-4 py-2 rounded-lg font-medium text-sm transition-all",
          "bg-gold-500 text-white",
          "hover:bg-gold-600 active:ring-2 active:ring-gold-200",
        )}
      >
        Download PDF
      </a>

      {/* Send to client — disabled until Resend is connected (Phase D). */}
      <button
        disabled
        title="Email delivery — wiring up Resend"
        className={clsx(
          "px-4 py-2 rounded-lg font-medium text-sm transition-all",
          "border border-neutral-200 text-neutral-700 bg-white",
          "opacity-50 cursor-not-allowed",
        )}
      >
        Send to client
      </button>

      {/* Copy shareable link — live */}
      <button
        onClick={handleCopy}
        className={clsx(
          "px-4 py-2 rounded-lg font-medium text-sm transition-all",
          "border border-neutral-200 text-neutral-700 bg-white",
          "hover:border-gold-300 hover:bg-gold-50",
          "active:ring-2 active:ring-gold-200",
        )}
      >
        {copied ? "Copied!" : "Copy shareable link"}
      </button>
    </div>
  );
}
