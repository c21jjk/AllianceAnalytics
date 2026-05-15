"use client";

import { useState, useTransition } from "react";
import { updateAgentContactAction } from "@/app/(app)/properties/[mls]/actions";

interface Props {
  mls: string;
  agentName: string | null;
}

/**
 * Inline warning + fix UI shown on /properties/[mls] when the listing is
 * missing agent_email. Phase 5 makes the agent_email value load-bearing —
 * without it the auto-send-on-publish flow (mailto today, Resend in
 * Phase 6) silently no-ops. So Larissa needs to be reminded + given a
 * 5-second fix path without leaving the page.
 */
export default function NullAgentEmailWarning({ mls, agentName }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();

  const firstName = agentName?.split(" ")[0] ?? null;

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startSave(async () => {
      const result = await updateAgentContactAction(mls, {
        agent_email: email,
        agent_phone: phone || null,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn’t save.");
        return;
      }
      setSaved(true);
      setOpen(false);
      // Page revalidates via the server action; the warning will disappear
      // on the next render because agent_email is now non-null.
    });
  }

  if (saved) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
        <CheckIcon />
        Agent contact saved — the next post about this listing will trigger
        the notification automatically.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <WarningIcon />
          <div className="min-w-0">
            <div className="font-medium text-amber-900">
              {firstName ? (
                <>Email missing for {firstName}</>
              ) : (
                <>Listing agent email is missing</>
              )}
            </div>
            <div className="text-xs text-amber-800 leading-relaxed mt-0.5">
              Auto-notify-on-publish and the &ldquo;Email Owner Story to
              agent&rdquo; button both rely on this. Fill it in and every
              future post about this listing pings{" "}
              {firstName ?? "the agent"} automatically.
            </div>
          </div>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5"
          >
            Fill in
          </button>
        ) : null}
      </div>
      {open ? (
        <form
          onSubmit={handleSave}
          className="mt-3 pt-3 border-t border-amber-200 flex flex-col md:flex-row md:items-center gap-2"
        >
          <input
            type="email"
            required
            placeholder="agent@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <input
            type="tel"
            placeholder="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="md:w-48 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            type="submit"
            disabled={pending || !email.trim()}
            className="inline-flex items-center justify-center rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-2 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="text-xs text-amber-800 hover:text-amber-900 underline"
          >
            Cancel
          </button>
        </form>
      ) : null}
      {error ? (
        <div className="mt-2 text-xs font-medium text-rose-700">{error}</div>
      ) : null}
    </section>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 shrink-0 mt-0.5 text-amber-700"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        d="M12 9v4M12 17h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 shrink-0 text-emerald-700"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        d="M5 13l4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
