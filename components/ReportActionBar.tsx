"use client";

import { useState } from "react";
import clsx from "clsx";

interface ReportActionBarProps {
  shareToken: string;
  className?: string;
}

/**
 * Action toolbar for property reports. Only the "Copy shareable link" action is live.
 * "Download PDF" and "Send to client" are Phase 2.
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
      {/* Download PDF — disabled for Phase 2 */}
      <button
        disabled
        title="PDF generation lands in Phase 2"
        className={clsx(
          "px-4 py-2 rounded-lg font-medium text-sm transition-all",
          "bg-gold-500 text-white",
          "opacity-50 cursor-not-allowed",
        )}
      >
        Download PDF
      </button>

      {/* Send to client — disabled for Phase 2 */}
      <button
        disabled
        title="Email sending lands in Phase 2"
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
