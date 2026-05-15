"use client";

import clsx from "clsx";

interface SendToAgentButtonProps {
  /** Property address — used in the email subject and body */
  propertyAddress: string;
  /** Listing agent's email, if known */
  agentEmail?: string | null;
  /** Listing agent's name, if known */
  agentName?: string | null;
  /** Owner Story public URL (absolute or relative `/home/[token]`). */
  storyUrl: string;
  /**
   * Render in the small-and-quiet style instead of the primary CTA style.
   * Used inside the demoted legacy Compass block to keep it secondary.
   */
  variant?: "primary" | "quiet";
  disabled?: boolean;
  className?: string;
}

/**
 * Mailto-driven "send Owner Story to listing agent" button.
 *
 * Phase 5 — re-pointed from the legacy /r/[token] flyer to the new
 * /home/[token] Owner Story page. The agent forwards the link to the
 * seller; Larissa stays out of the email thread.
 *
 * No actual email is sent here — the user's mail client opens with the
 * draft. Phase 6 will swap this for a Resend-driven send via the outbox.
 */
export default function SendToAgentButton({
  propertyAddress,
  agentEmail,
  agentName,
  storyUrl,
  variant = "primary",
  disabled,
  className,
}: SendToAgentButtonProps) {
  const subject = `Owner Story page for ${propertyAddress}`;
  const greeting = `Hi ${agentName ? agentName.split(" ")[0] : "there"},`;
  const body =
    `${greeting}\n\n` +
    `Here's the Owner Story page for ${propertyAddress}. It's the live, ` +
    `seller-facing view of every social post we've put behind this listing — ` +
    `updates automatically as the campaign progresses. Please share it with ` +
    `your seller; they can keep it bookmarked.\n\n` +
    `${storyUrl}\n\n` +
    `— Alliance Social`;

  const href = disabled
    ? "#"
    : `mailto:${encodeURIComponent(agentEmail ?? "")}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(body)}`;

  const primaryStyle =
    "border-transparent bg-neutral-900 hover:bg-neutral-800 text-white";
  const quietStyle =
    "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50";

  return (
    <a
      href={href}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2",
        "text-xs font-medium transition-colors border",
        disabled
          ? "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed"
          : variant === "primary"
            ? primaryStyle
            : quietStyle,
        className,
      )}
      title={
        disabled
          ? "Owner Story not ready yet."
          : agentEmail
            ? `Send to ${agentEmail}`
            : "Open a new email draft (recipient blank — fill in agent email)"
      }
    >
      <MailIcon />
      {variant === "primary"
        ? "Email Owner Story to agent"
        : "Send legacy report"}
    </a>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
      <path
        d="M3 7.5A2.5 2.5 0 015.5 5h13A2.5 2.5 0 0121 7.5v9A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M3.5 7l7.4 5.6a2 2 0 002.2 0L20.5 7"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
