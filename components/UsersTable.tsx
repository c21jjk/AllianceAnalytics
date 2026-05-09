"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import {
  adminResetPasswordAction,
  deleteUserAction,
  setUserActiveAction,
  updateUserRoleAction,
  type UserRole,
} from "@/app/(app)/settings/users/actions";

export interface UsersTableRow {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  /** True when this row represents the current admin viewing the page. */
  is_self: boolean;
}

interface UsersTableProps {
  rows: UsersTableRow[];
}

export default function UsersTable({ rows }: UsersTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
        <p className="text-sm font-medium text-neutral-700">No users yet.</p>
        <p className="mt-1 text-xs text-neutral-500">
          Use the invite form above to add the first one.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-100">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <UserRowEditor key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRowEditor({ row }: { row: UsersTableRow }) {
  const [role, setRole] = useState<UserRole>(row.role);
  const [active, setActive] = useState(row.is_active);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  function changeRole(next: UserRole) {
    if (next === role) return;
    setError(null);
    setRole(next); // optimistic
    startTransition(async () => {
      const r = await updateUserRoleAction(row.id, next);
      if (!r.ok) {
        setError(r.error ?? "Update failed");
        setRole(row.role); // revert
      }
    });
  }

  function toggleActive() {
    setError(null);
    const next = !active;
    setActive(next);
    startTransition(async () => {
      const r = await setUserActiveAction(row.id, next);
      if (!r.ok) {
        setError(r.error ?? "Update failed");
        setActive(!next);
      }
    });
  }

  function deleteUser() {
    setError(null);
    if (
      !window.confirm(
        `Delete ${row.email}? This removes their auth account and profile permanently.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await deleteUserAction(row.id);
      if (!r.ok) setError(r.error ?? "Delete failed");
    });
  }

  function submitReset() {
    setResetMsg(null);
    if (resetPw.length < 8) {
      setResetMsg("Password must be at least 8 characters.");
      return;
    }
    startTransition(async () => {
      const r = await adminResetPasswordAction(row.id, resetPw);
      if (!r.ok) {
        setResetMsg(r.error ?? "Reset failed");
        return;
      }
      setResetMsg("Password reset. Share the new one with the user.");
    });
  }

  const created = new Date(row.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? "—"
    : created.toLocaleDateString();

  return (
    <>
      <tr
        className={clsx(
          "border-b border-neutral-50 last:border-0",
          !active && "bg-neutral-50/60",
        )}
      >
        <td className="px-4 py-3 text-neutral-900">
          {row.full_name ?? "—"}
          {row.is_self ? (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-400">
              you
            </span>
          ) : null}
        </td>
        <td className="px-4 py-3 text-neutral-700 font-mono text-xs">
          {row.email}
        </td>
        <td className="px-4 py-3">
          <select
            value={role}
            onChange={(e) => changeRole(e.target.value as UserRole)}
            disabled={isPending}
            className={clsx(
              "rounded-md border border-neutral-300 bg-white text-xs px-2 py-1",
              "focus:outline-none focus:ring-2 focus:ring-gold-400",
            )}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </td>
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={toggleActive}
            disabled={isPending || row.is_self}
            title={
              row.is_self
                ? "You cannot disable your own account."
                : active
                  ? "Disable this account"
                  : "Re-enable this account"
            }
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
              active
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : "bg-neutral-100 text-neutral-600 ring-neutral-200",
              row.is_self && "opacity-60 cursor-not-allowed",
              !row.is_self && "hover:opacity-80",
            )}
          >
            <span
              className={clsx(
                "inline-block w-1.5 h-1.5 rounded-full",
                active ? "bg-emerald-500" : "bg-neutral-400",
              )}
            />
            {active ? "Active" : "Disabled"}
          </button>
        </td>
        <td className="px-4 py-3 text-neutral-500 text-xs">{createdLabel}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setResetOpen((v) => !v);
                setResetPw("");
                setResetMsg(null);
              }}
              disabled={isPending}
              className="text-xs text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
            >
              Reset password
            </button>
            <span className="text-neutral-300" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              onClick={deleteUser}
              disabled={isPending || row.is_self}
              className={clsx(
                "text-xs text-rose-600 hover:text-rose-800 underline-offset-2 hover:underline",
                (isPending || row.is_self) && "opacity-50 cursor-not-allowed",
              )}
              title={
                row.is_self
                  ? "You cannot delete your own account."
                  : "Permanently delete this account"
              }
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {resetOpen ? (
        <tr className="bg-neutral-50/80 border-b border-neutral-100">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-neutral-700">
                New password for {row.email}:
              </span>
              <input
                type="text"
                value={resetPw}
                onChange={(e) => setResetPw(e.target.value)}
                placeholder="Min 8 characters"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-gold-400"
                autoFocus
              />
              <button
                type="button"
                onClick={submitReset}
                disabled={isPending || resetPw.length < 8}
                className="btn-primary text-xs px-3 py-1.5"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                disabled={isPending}
                className="btn-ghost text-xs px-2 py-1.5"
              >
                Cancel
              </button>
              {resetMsg ? (
                <span
                  className={clsx(
                    "text-xs",
                    resetMsg.startsWith("Password reset")
                      ? "text-emerald-700"
                      : "text-rose-600",
                  )}
                >
                  {resetMsg}
                </span>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
      {error ? (
        <tr className="bg-rose-50 border-b border-rose-100">
          <td colSpan={6} className="px-4 py-2 text-xs text-rose-700">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
