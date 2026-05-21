"use client";

import { useState } from "react";
import clsx from "clsx";

interface ApiResponse {
  ok: boolean;
  subject?: string;
  recipientCount?: number;
  candidateId?: string;
  message?: string;
}

/**
 * Admin-only "Preview office post announcement" button.
 *
 * POSTs to /api/email/test/office-post-announcement-preview which finds the
 * first eligible group (category='property' + audience scoped to office or
 * division) and sends the rendered announcement to c21jjk@gmail.com. Does
 * NOT mark the group as announced, so it can be re-previewed and the real
 * cron will still fire for it.
 */
export default function SendOfficePostAnnouncementPreviewButton() {
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | { kind: "success"; subject?: string; candidateId?: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleClick() {
    if (isSending) return;
    setIsSending(true);
    setFeedback({ kind: "idle" });
    try {
      const res = await fetch(
        "/api/email/test/office-post-announcement-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (res.ok && body.ok) {
        setFeedback({
          kind: "success",
          subject: body.subject,
          candidateId: body.candidateId,
        });
      } else {
        setFeedback({
          kind: "error",
          message:
            body.message ?? `HTTP ${res.status} — see browser console for details`,
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
            : "border-gold-300 bg-gold-50 text-neutral-800 hover:border-gold-400 hover:bg-gold-100",
        )}
      >
        {isSending ? (
          <>
            <Spinner />
            Building preview…
          </>
        ) : (
          <>Preview office post announcement (sends to c21jjk@gmail.com)</>
        )}
      </button>

      {feedback.kind === "success" ? (
        <p className="text-xs text-emerald-700">
          ✓ Sent.{" "}
          {feedback.subject ? (
            <>
              Subject: <strong>{feedback.subject}</strong>.
            </>
          ) : null}
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
