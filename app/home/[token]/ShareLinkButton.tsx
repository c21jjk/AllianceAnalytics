"use client";

import { useState } from "react";

/**
 * Copy-current-URL-to-clipboard button for the owner story page. Lives as a
 * tiny client island so the rest of the story page can stay a server
 * component. Uses `navigator.share()` when available (mobile) for the proper
 * iOS / Android share sheet, falling back to clipboard copy on desktop.
 */
export default function ShareLinkButton({
  style,
  address,
}: {
  style: React.CSSProperties;
  address: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const title = address
      ? `${address} — marketing campaign`
      : "Marketing campaign";
    const text = "Take a look at how Alliance is marketing this home.";

    // Prefer native share sheet on mobile — much better UX than clipboard.
    if (
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: unknown }).share === "function"
    ) {
      try {
        await (navigator as Navigator & {
          share: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
        }).share({ title, text, url });
        return;
      } catch {
        // User cancelled the share sheet — fall through to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked (rare). No-op rather than alert spam.
    }
  }

  return (
    <button type="button" onClick={handleShare} style={style}>
      {copied ? "Link copied" : "Share this page with family"}
    </button>
  );
}
