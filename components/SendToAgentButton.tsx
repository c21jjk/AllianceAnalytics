"use client";

import clsx from "clsx";

interface SendToAgentButtonProps {
  /** Property address — used in the email subject and body */
  propertyAddress: string;
  /** Listing agent's email, if known */
  agentEmail?: string | null;
  /** Listing agent's name, if known */
  agentName?: string | null;
  /** Public flyer URL (relative or absolute) */
  flyerUrl: string;
  /** PDF download URL (relative or absolute) */
  pdfUrl: string;
  /**
   * Disable the button when no flyer is generated yet. Renders a muted, inert link.
   */
  disabled?: boolean;
  className?: string;
}

/**
 * Mailto-driven "send to listing agent" button. Pre-fills a friendly note
 * with the flyer link and the PDF link.
 *
 * No actual email is sent — the user's mail client opens with the draft.
 */
export default function SendToAgentButton({
  propertyAddress,
  agentEmail,
  agentName,
  flyerUrl,
  pdfUrl,
  disabled,
  className,
}: SendToAgentButtonProps) {
  const subject = `Alliance Social — Marketing report for ${propertyAddress}`;
  const greeting = `Hi ${agentName ? agentName.split(" ")[0] : "there"},`;
  const body =
    `${greeting}\n\n` +
    `Here's the latest marketing report for ${propertyAddress}. Please share with your seller.\n\n` +
    `View online: ${flyerUrl}\n` +
    `Download PDF: ${pdfUrl}\n\n` +
    `— Alliance Social`;

  const href = disabled
    ? "#"
    : `mailto:${encodeURIComponent(agentEmail ?? "")}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(body)}`;

  return (
    <a
      href={href}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5",
        "text-xs font-medium transition-colors border",
        disabled
          ? "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed"
          : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
        className,
      )}
      title={
        disabled
          ? "Generate a report first."
          : agentEmail
            ? `Send to ${agentEmail}`
            : "Open a new email draft (recipient blank)"
      }
    >
      <MailIcon />
      Send to listing agent
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
