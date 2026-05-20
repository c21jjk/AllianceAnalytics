"use client";

import { useState } from "react";

/**
 * Per-post share chip used inside the Owner Story's "Help Spread the Word"
 * section. Tapping fires the native share sheet (iOS / Android) when
 * available — much better UX than clipboard copy — and falls back to
 * copying the post permalink on desktop with a brief "Copied!" hint.
 *
 * Distinct from `ShareLinkButton` (which shares the Owner Story page URL).
 * This one shares the actual social-post permalink (FB / IG / TT) so the
 * seller can hand off the platform link directly to their network.
 */
export default function SharePostButton({
  url,
  platformLabel,
  address,
  className,
  style,
}: {
  url: string;
  platformLabel: string;
  address: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    if (typeof window === "undefined") return;
    const title = address
      ? `${address} on ${platformLabel}`
      : `${platformLabel} post`;
    // Default message is written in the seller's voice — assumes the share
    // sheet target is a friend or family member, not a real-estate prospect.
    // Platform label is woven in so a seller who shares FB + IG + TT to the
    // same recipient ends up with three distinct messages (and the friend
    // knows immediately which platform to engage on).
    const text = address
      ? `We just listed our home at ${address} — would love your help spreading the word on ${platformLabel}. A quick like or share goes a long way!`
      : `We just listed our home — would love your help spreading the word on ${platformLabel}. A quick like or share goes a long way!`;

    if (
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: unknown }).share === "function"
    ) {
      try {
        await (
          navigator as Navigator & {
            share: (data: {
              title?: string;
              text?: string;
              url?: string;
            }) => Promise<void>;
          }
        ).share({ title, text, url });
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
      // Clipboard blocked (rare). Stay silent rather than alert-spam.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      style={style}
      aria-label={`Share ${platformLabel} post`}
    >
      {copied ? "✓ Copied!" : "↗ Share"}
    </button>
  );
}
