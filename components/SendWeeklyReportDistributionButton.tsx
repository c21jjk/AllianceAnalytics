"use client";

import { useState } from "react";
import clsx from "clsx";

interface ApiResponse {
  ok: boolean;
  messageId?: string;
  subject?: string;
  recipientCount?: number;
  error?: string;
}

/**
 * Admin-only "Send weekly report to full distribution" button.
 *
 * POSTs to /api/email/test/weekly-social-distribute which loads the
 * server-side recipient constant (11 names), renders the full weekly email
 * with last week's real data, and sends. Browser-native confirm() prompts
 * before firing so an accidental click can't blast everyone.
 *
 * The recipient list is displayed by the parent component (settings page)
 * so John can eyeball who's about to receive it before clicking.
 */
export default function SendWeeklyReportDistributionButton({
  recipientCount,
}: {
  recipientCount: number;
}) {
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | {
        kind: "success";
        messageId: string;
        subject?: string;
        sentTo?: number;
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleClick() {
    if (isSending) return;
    const confirmed = window.confirm(
      `Send the weekly report to all ${recipientCount} recipients?\n\n` +
        `This will email John, Larissa, Chuck, and the office managers ` +
        `the full weekly social media recap built from last week's real data.\n\n` +
        `Cancel if you wanted the preview-only button instead.`,
    );
    if (!confirmed) return;

    setIsSending(true);
    setFeedback({ kind: "idle" });
    try {
      const res = await fetch("/api/email/test/weekly-social-distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (res.ok && body.ok) {
        setFeedback({
          kind: "success",
          messageId: body.messageId ?? "(no id returned)",
          subject: body.subject,
          sentTo: body.recipientCount,
        });
      } else {
        setFeedback({
          kind: "error",
          message:
            body.error ?? `HTTP ${res.status} — see browser console for details`,
        });
      }
    } catch (e) {
      setFeedback({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isSending}
        className={clsx(
          "inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
          isSending
            ? "border-neutral-200 bg-neutral-100 text-neutral-400 cursor-not-allowed"
            : "border-gold-500 bg-gold-500 text-white hover:bg-gold-600 hover:border-gold-600",
        )}
      >
        {isSending ? (
          <>
            <Spinner />
            Sending to {recipientCount} recipients…
          </>
        ) : (
          <>Send weekly report to all {recipientCount} recipients</>
        )}
      </button>

      {feedback.kind === "success" ? (
        <p className="text-xs text-emerald-700">
          ✓ Sent to {feedback.sentTo ?? "all"} recipients.{" "}
          {feedback.subject ? (
            <>
              Subject: <strong>{feedback.subject}</strong>.{" "}
            </>
          ) : null}
          Message id:{" "}
          <code className="font-mono text-[11px] bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100">
            {feedback.messageId}
          </code>
        </p>
      ) : null}

      {feedback.kind === "error" ? (
        <p className="text-xs text-red-700">✗ {feedback.message}</p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="w-3 h-3 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
