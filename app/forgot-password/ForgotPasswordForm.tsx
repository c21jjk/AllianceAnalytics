"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  requestPasswordResetAction,
  type ForgotPasswordResult,
} from "./actions";

const initial: ForgotPasswordResult = { done: false };

export default function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initial,
  );

  if (state.done) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
        >
          If that email has an account, a link is on its way.
        </div>
        <Link
          href="/login"
          className="btn-secondary w-full inline-flex justify-center"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="fp-email" className="label">
          Email
        </label>
        <input
          id="fp-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          placeholder="you@example.com"
          disabled={isPending}
          autoFocus
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {state.error}
        </div>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-primary w-full">
        {isPending ? "Sending…" : "Email me a reset link"}
      </button>

      <p className="text-center text-xs text-neutral-500">
        <Link href="/login" className="hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
