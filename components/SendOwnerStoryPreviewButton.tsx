"use client";

import { useState } from "react";
import clsx from "clsx";

interface ApiResponse {
  ok: boolean;
  address?: string;
  error?: string;
}

/**
 * Admin-only "Preview Owner Story email" button.
 *
 * POSTs to /api/email/test/owner-story-preview, which renders the real weekly
 * Owner Story email for the first currently-eligible listing and sends it to a
 * hardcoded preview recipient (c21jjk@gmail.com). Does not consume the
 * listing's real Monday send slot.
 */
export default function SendOwnerStoryPreviewButton() {
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | { kind: "success"; address?: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleClick() {
    if (isSending) return;
    setIsSending(true);
    setFeedback({ kind: "idle" });
    try {
      const res = await fetch("/api/email/test/owner-story-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (res.ok && body.ok) {
        setFeedback({ kind: "success", address: body.address });
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
            : "border-gold-300 bg-gold-50 text-neutral-800 hover:border-gold-400 hover:bg-gold-100",
        )}
      >
        {isSending ? (
          <>
            <Spinner />
            Building Owner Story…
          </>
        ) : (
          <>Preview Owner Story email (sends to c21jjk@gmail.com)</>
        )}
      </button>

      {feedback.kind === "success" ? (
        <p className="text-xs text-emerald-700">
          ✓ Sent
          {feedback.address ? (
            <>
              {" "}
              for <strong>{feedback.address}</strong>
            </>
          ) : null}
          .
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
