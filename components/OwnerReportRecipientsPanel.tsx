"use client";

import { useState, useTransition } from "react";
import {
  addOwnerReportRecipientAction,
  removeOwnerReportRecipientAction,
  setOwnerReportCadenceAction,
} from "@/app/(app)/properties/[mls]/actions";
import type {
  OwnerReportCadence,
  OwnerReportRecipient,
} from "@/lib/data/owner-reports-db";
import { formatShortDate } from "@/lib/format";

interface Props {
  reportId: string;
  mls: string;
  initialCadence: OwnerReportCadence;
  initialNextSendAt: string | null;
  initialRecipients: OwnerReportRecipient[];
}

const CADENCE_OPTIONS: Array<{ value: OwnerReportCadence; label: string }> = [
  { value: "none", label: "Manual only" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

/**
 * Subscriber list + send cadence for a single owner report. Renders inside
 * the LivePropertyDetail "Owner Report" panel once a report exists.
 *
 * Nothing on this surface sends email — Phase D's pg_cron job consumes the
 * cadence + next_send_at + recipients triple. Until then this is pure state
 * capture so Larissa can build out the seller list ahead of time.
 */
export default function OwnerReportRecipientsPanel({
  reportId,
  mls,
  initialCadence,
  initialNextSendAt,
  initialRecipients,
}: Props) {
  const [cadence, setCadence] = useState<OwnerReportCadence>(initialCadence);
  const [nextSendAt, setNextSendAt] = useState<string | null>(
    initialNextSendAt,
  );
  const [recipients, setRecipients] =
    useState<OwnerReportRecipient[]>(initialRecipients);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [cadencePending, startCadence] = useTransition();
  const [addPending, startAdd] = useTransition();
  const [removePendingId, setRemovePendingId] = useState<string | null>(null);

  function clearFeedbackSoon() {
    setTimeout(() => setFeedback({ kind: "idle" }), 2200);
  }

  function handleCadenceChange(next: OwnerReportCadence) {
    const previous = cadence;
    const previousNext = nextSendAt;
    setCadence(next);
    // Optimistic next_send_at — Phase D job will re-anchor on actual send.
    const intervalDays =
      next === "weekly"
        ? 7
        : next === "biweekly"
          ? 14
          : next === "monthly"
            ? 30
            : null;
    setNextSendAt(
      intervalDays === null
        ? null
        : new Date(Date.now() + intervalDays * 86_400_000).toISOString(),
    );
    startCadence(async () => {
      const result = await setOwnerReportCadenceAction(reportId, mls, next);
      if (!result.ok) {
        setCadence(previous);
        setNextSendAt(previousNext);
        setFeedback({
          kind: "error",
          message: result.error ?? "Couldn't save cadence.",
        });
        clearFeedbackSoon();
      }
    });
  }

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) {
      setFeedback({ kind: "error", message: "Email is required." });
      clearFeedbackSoon();
      return;
    }
    startAdd(async () => {
      const result = await addOwnerReportRecipientAction(reportId, mls, {
        name,
        email,
        phone,
      });
      if (!result.ok) {
        setFeedback({
          kind: "error",
          message: result.error ?? "Couldn't add recipient.",
        });
        clearFeedbackSoon();
        return;
      }
      // Optimistic local update — append or merge with existing email.
      const normalizedEmail = email.trim().toLowerCase();
      setRecipients((prev) => {
        const without = prev.filter(
          (r) => r.email.toLowerCase() !== normalizedEmail,
        );
        return [
          {
            id: `pending-${Date.now()}`,
            name: name.trim() || null,
            email: normalizedEmail,
            phone: phone.trim() || null,
            created_at: new Date().toISOString(),
          },
          ...without,
        ];
      });
      setName("");
      setEmail("");
      setPhone("");
      setFeedback({ kind: "success", message: "Recipient added." });
      clearFeedbackSoon();
    });
  }

  function handleRemove(recipientId: string) {
    setRemovePendingId(recipientId);
    const previous = recipients;
    setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
    (async () => {
      const result = await removeOwnerReportRecipientAction(recipientId, mls);
      if (!result.ok) {
        setRecipients(previous);
        setFeedback({
          kind: "error",
          message: result.error ?? "Couldn't remove recipient.",
        });
        clearFeedbackSoon();
      }
      setRemovePendingId(null);
    })();
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-4 md:p-5 space-y-5">
      <header>
        <h3 className="text-sm font-semibold text-neutral-900">
          Recipients &amp; cadence
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Build the seller&apos;s subscriber list and choose how often the
          report goes out. Emails will start sending once the email service is
          connected.
        </p>
      </header>

      {/* Cadence selector ----------------------------------------------------- */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="cadence"
            className="text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Send cadence
          </label>
          {cadencePending ? (
            <span className="text-[11px] text-neutral-500">Saving…</span>
          ) : null}
        </div>
        <select
          id="cadence"
          value={cadence}
          onChange={(e) =>
            handleCadenceChange(e.target.value as OwnerReportCadence)
          }
          disabled={cadencePending}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 disabled:opacity-60"
        >
          {CADENCE_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          {cadence === "none" ? (
            <>
              Reports won&apos;t auto-send. Use{" "}
              <span className="font-medium text-neutral-700">Send Now</span>{" "}
              once that&apos;s wired.
            </>
          ) : nextSendAt ? (
            <>
              Next scheduled send:{" "}
              <span className="font-medium text-neutral-700">
                {formatShortDate(nextSendAt)}
              </span>
            </>
          ) : (
            <>Cadence saved — next send will be computed shortly.</>
          )}
        </p>
      </section>

      {/* Add recipient form -------------------------------------------------- */}
      <section>
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Add a recipient
        </div>
        <form onSubmit={handleAdd} className="mt-2 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
            />
            <input
              type="email"
              required
              placeholder="seller@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
            />
            <button
              type="submit"
              disabled={addPending || !email.trim()}
              className="inline-flex items-center justify-center rounded-md bg-gold-500 hover:bg-gold-600 text-white text-xs font-medium px-4 py-2 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addPending ? "Adding…" : "Add recipient"}
            </button>
          </div>
        </form>
      </section>

      {/* Recipient list ------------------------------------------------------- */}
      <section>
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Subscriber list ({recipients.length})
        </div>
        {recipients.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50/60 px-3 py-3 text-xs text-neutral-500">
            No recipients yet. Add the seller (and any co-owners) above so they
            start receiving the report when cadence kicks in.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
            {recipients.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900 truncate">
                    {r.name ?? r.email}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {r.email}
                    {r.phone ? (
                      <>
                        <span className="text-neutral-300"> · </span>
                        {r.phone}
                      </>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(r.id)}
                  disabled={removePendingId === r.id}
                  className="shrink-0 text-xs font-medium text-neutral-500 hover:text-rose-700 disabled:opacity-50"
                  aria-label={`Remove ${r.name ?? r.email}`}
                >
                  {removePendingId === r.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Feedback ------------------------------------------------------------ */}
      {feedback.kind === "success" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✓ {feedback.message}
        </div>
      ) : null}
      {feedback.kind === "error" ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
}
