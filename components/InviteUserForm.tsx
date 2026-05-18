"use client";

import { useActionState, useState } from "react";
import { inviteUserAction, type ActionResult } from "@/app/(app)/users/actions";

const initial: ActionResult = { ok: false };

/**
 * Admin-side new-user invitation form. Submits to inviteUserAction; on success
 * we keep the password the admin typed visible until they explicitly clear it,
 * since they need to copy it to a side channel (text, email, password manager)
 * to share with the new user.
 */
export default function InviteUserForm() {
  const [state, formAction, isPending] = useActionState(inviteUserAction, initial);
  const [showPassword, setShowPassword] = useState(false);
  const [lastPassword, setLastPassword] = useState<string | null>(null);

  function handleSubmit(form: FormData) {
    const pw = String(form.get("password") ?? "");
    setLastPassword(pw);
    return formAction(form);
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="invite-full-name" className="label">
            Full name
          </label>
          <input
            id="invite-full-name"
            name="full_name"
            type="text"
            className="input"
            placeholder="Larissa Crumb"
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
            placeholder="larissa@c21alliance.com"
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
          <p className="mt-1 text-xs text-neutral-500">
            Admins can manage users, feeds, and credentials. Users can view and
            classify but not configure.
          </p>
        </div>

        <div>
          <label htmlFor="invite-password" className="label">
            Initial password
          </label>
          <div className="flex items-center gap-2">
            <input
              id="invite-password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              className="input flex-1"
              placeholder="At least 8 characters"
              disabled={isPending}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="btn-secondary text-xs px-3 py-2"
              disabled={isPending}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Share this password with the user via a private channel. They can
            change it after signing in at <code>/settings/security</code>.
          </p>
        </div>
      </div>

      {state.ok ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
        >
          User created. {lastPassword ? (
            <>
              Initial password:{" "}
              <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded">
                {lastPassword}
              </code>{" "}
              — copy and share it now; we don't store it visibly.
            </>
          ) : (
            "Share the password you set with the user."
          )}
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

      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Creating…" : "Create user"}
        </button>
        {state.ok ? (
          <button
            type="button"
            onClick={() => {
              setLastPassword(null);
              const form = document.querySelector(
                "form",
              ) as HTMLFormElement | null;
              form?.reset();
            }}
            className="btn-secondary text-sm"
          >
            Add another
          </button>
        ) : null}
      </div>
    </form>
  );
}
