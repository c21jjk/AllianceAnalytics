"use client";

import { useActionState } from "react";
import { inviteUserAction, type ActionResult } from "@/app/(app)/users/actions";

const initial: ActionResult = { ok: false };

/**
 * Admin-side new-user invitation form. Creates the account and emails the
 * invite immediately; the person creates their own password from the link.
 */
export default function InviteUserForm() {
  const [state, formAction, isPending] = useActionState(inviteUserAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="invite-full-name" className="label">
            Full name
          </label>
          <input
            id="invite-full-name"
            name="full_name"
            type="text"
            className="input"
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="invite-email" className="label">
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            className="input"
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="label">
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            className="input"
            defaultValue="user"
            disabled={isPending}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      {state.ok && state.message ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
        >
          {state.message}
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
        {isPending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
