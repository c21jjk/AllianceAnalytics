"use client";

import { useActionState } from "react";
import Link from "next/link";
import { setPasswordAction, type SetPasswordResult } from "./actions";

const initial: SetPasswordResult = { ok: false };

export default function SetPasswordForm({
  token,
  email,
  isInvite,
}: {
  token: string;
  email: string;
  isInvite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    setPasswordAction,
    initial,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="sp-email" className="label">
          Email
        </label>
        {/* Read-only, but present so password managers save the right pair. */}
        <input
          id="sp-email"
          name="email"
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          className="input bg-neutral-50 text-neutral-600"
        />
      </div>

      <div>
        <label htmlFor="sp-password" className="label">
          {isInvite ? "Create a password" : "New password"}
        </label>
        <input
          id="sp-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          placeholder="At least 8 characters"
          disabled={isPending}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="sp-confirm" className="label">
          Type it again
        </label>
        <input
          id="sp-confirm"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          disabled={isPending}
        />
      </div>

      {!state.ok && state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {state.error}{" "}
          <Link href="/forgot-password" className="underline font-medium">
            Get a new link
          </Link>
        </div>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-primary w-full">
        {isPending
          ? "Saving…"
          : isInvite
            ? "Activate my account"
            : "Save new password"}
      </button>
    </form>
  );
}
