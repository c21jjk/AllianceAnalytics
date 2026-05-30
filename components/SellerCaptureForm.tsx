"use client";

import { useState } from "react";

interface Props {
  token: string;
  address: string;
}

/**
 * Agent-facing capture form on /home/[token]/share. The agent enters their
 * seller's name(s) + email; we store the seller and send them their first
 * Owner Story immediately, then automatically every Monday until the listing
 * leaves "active". Token-gated (no login) — the URL itself is the credential.
 */
export default function SellerCaptureForm({ token, address }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "success" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`/api/owner-story/${token}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && body.ok) {
        setStatus({ kind: "success" });
      } else {
        setStatus({
          kind: "error",
          message: body.error ?? "Something went wrong. Please try again.",
        });
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (status.kind === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <p className="text-base font-semibold text-emerald-800">
          Sent to {email}
        </p>
        <p className="mt-1 text-sm text-emerald-700">
          Your seller just got their Owner Story, and they&apos;ll receive a
          fresh update every Monday while the home is active.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="seller-name"
          className="block text-sm font-medium text-neutral-700"
        >
          Seller name(s)
        </label>
        <input
          id="seller-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. John & Jane Smith"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
        />
      </div>
      <div>
        <label
          htmlFor="seller-email"
          className="block text-sm font-medium text-neutral-700"
        >
          Seller email
        </label>
        <input
          id="seller-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seller@email.com"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
        />
      </div>

      {status.kind === "error" ? (
        <p className="text-sm text-red-700">{status.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="w-full rounded-lg bg-gold-400 px-4 py-3 text-base font-bold text-neutral-900 transition-colors hover:bg-gold-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === "sending"
          ? "Sending…"
          : "Send it & sign them up for weekly updates"}
      </button>
      <p className="text-center text-xs text-neutral-500">
        We&apos;ll email your seller the live Owner Story for {address} now, then
        again every Monday until the listing closes. They can unsubscribe any
        time.
      </p>
    </form>
  );
}
