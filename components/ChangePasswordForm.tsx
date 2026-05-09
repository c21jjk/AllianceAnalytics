"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  changeOwnPasswordAction,
  type ChangePasswordResult,
} from "@/app/(app)/settings/security/actions";

const initial: ChangePasswordResult = { ok: false };

export default function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(
    changeOwnPasswordAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // On success, blank the form so leftover values aren't sitting around.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 max-w-md">
      <div>
        <label htmlFor="current_password" className="label">
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
          disabled={isPending}
        />
      </div>

      <div>
        <label htmlFor="new_password" className="label">
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          disabled={isPending}
        />
        <p className="mt-1 text-xs text-neutral-500">
          At least 8 characters. Pick something memorable to you and not used
          elsewhere.
        </p>
      </div>

      <div>
        <label htmlFor="confirm_password" className="label">
          Confirm new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          disabled={isPending}
        />
      </div>

      {state.ok ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
        >
          Password updated. Future sign-ins will use the new password.
        </div>
      ) : null}

      {!state.ok && state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {state.error}
        </div>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-primary">
        {isPending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
