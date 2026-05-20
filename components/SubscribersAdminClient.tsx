"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import {
  addSubscriberAction,
  toggleSubscriberFlagAction,
  deleteSubscriberAction,
  importAllianceRosterAction,
} from "@/app/(app)/settings/subscribers/actions";
import type { SubscriberWithOffice } from "@/lib/data/email-subscribers";

interface OfficeGroup {
  officeId: string;
  officeName: string;
  agents: SubscriberWithOffice[];
}

interface Props {
  leadership: SubscriberWithOffice[];
  agentsByOffice: OfficeGroup[];
  officeOptions: { id: string; label: string }[];
}

type FlagField =
  | "receives_weekly_social_report"
  | "receives_owner_story"
  | "receives_office_post_alerts"
  | "is_active";

/**
 * Admin UI for /settings/subscribers. Two clearly-separated sections:
 *
 *   1. Leadership — manually-entered admin/manager/owner rows. New rows
 *      added via inline "Add subscriber" form. Per-row checkboxes toggle
 *      subscription flags inline (one click → server action → revalidate).
 *
 *   2. Agents — imported from MLS via the "Import from MLS" button. Grouped
 *      by office, with an "Unassigned" bucket for agents whose office_id is
 *      null. Same inline checkbox UX. Per-agent role + email are read-only
 *      since they came from mls_agents.
 */
export default function SubscribersAdminClient({
  leadership,
  agentsByOffice,
  officeOptions,
}: Props) {
  return (
    <div className="space-y-12">
      <LeadershipSection
        leadership={leadership}
        officeOptions={officeOptions}
      />
      <AgentsSection agentsByOffice={agentsByOffice} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Leadership                                                              */
/* ---------------------------------------------------------------------- */

function LeadershipSection({
  leadership,
  officeOptions,
}: {
  leadership: SubscriberWithOffice[];
  officeOptions: { id: string; label: string }[];
}) {
  return (
    <section>
      <SectionHeading
        title="Leadership"
        subtitle="Admins, owners, and office managers. These rows are added manually."
        count={leadership.length}
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <SubscriberTable rows={leadership} showRoleColumn showOfficeColumn />
        <AddLeadershipForm officeOptions={officeOptions} />
      </div>
    </section>
  );
}

function AddLeadershipForm({
  officeOptions,
}: {
  officeOptions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    kind: "idle" | "ok" | "err";
    message?: string;
  }>({ kind: "idle" });

  function handleSubmit(formData: FormData) {
    formData.set("category", "leadership");
    setFeedback({ kind: "idle" });
    startTransition(async () => {
      const result = await addSubscriberAction(formData);
      setFeedback(
        result.ok
          ? { kind: "ok", message: result.info }
          : { kind: "err", message: result.error },
      );
      if (result.ok) setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="border-t border-neutral-100 p-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary text-xs"
        >
          + Add subscriber
        </button>
        {feedback.kind === "ok" && feedback.message ? (
          <span className="ml-3 text-xs text-emerald-700">{feedback.message}</span>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="border-t border-neutral-100 p-4 space-y-3 bg-neutral-50"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LabeledInput name="name" label="Name" required />
        <LabeledInput name="email" label="Email" type="email" required />
        <LabeledInput name="role" label="Role" placeholder="e.g. Office Manager" />
        <LabeledSelect
          name="office_id"
          label="Office (optional)"
          options={[{ id: "", label: "— None —" }, ...officeOptions]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Checkbox
          name="receives_weekly_social_report"
          label="Weekly social report"
          defaultChecked
        />
        <Checkbox name="receives_owner_story" label="Owner Stories" />
        <Checkbox name="receives_office_post_alerts" label="Office post alerts" />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className={clsx(
            "btn-primary text-xs",
            isPending && "opacity-60 cursor-not-allowed",
          )}
        >
          {isPending ? "Saving…" : "Add subscriber"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFeedback({ kind: "idle" });
          }}
          className="btn-secondary text-xs"
        >
          Cancel
        </button>
        {feedback.kind === "err" && feedback.message ? (
          <span className="text-xs text-red-700">{feedback.message}</span>
        ) : null}
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Agents                                                                  */
/* ---------------------------------------------------------------------- */

function AgentsSection({ agentsByOffice }: { agentsByOffice: OfficeGroup[] }) {
  const total = agentsByOffice.reduce((sum, g) => sum + g.agents.length, 0);
  return (
    <section>
      <div className="flex items-end justify-between mb-3 gap-3">
        <SectionHeading
          title="Agents"
          subtitle="Full Alliance roster from Darwin. Grouped by office."
          count={total}
        />
        <ImportRosterButton />
      </div>

      {agentsByOffice.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">
            No agents subscribed yet
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Click <strong>Import full Alliance roster</strong> above to pull in
            every active Century 21 Alliance agent across all 8 offices.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {agentsByOffice.map((group) => (
            <div
              key={group.officeId}
              className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden"
            >
              <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-100 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">
                  {group.officeName}
                </h3>
                <span className="text-[11px] text-neutral-500">
                  {group.agents.length}{" "}
                  {group.agents.length === 1 ? "agent" : "agents"}
                </span>
              </div>
              <SubscriberTable rows={group.agents} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportRosterButton() {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    kind: "idle" | "ok" | "err";
    message?: string;
  }>({ kind: "idle" });

  function handleClick() {
    setFeedback({ kind: "idle" });
    startTransition(async () => {
      const result = await importAllianceRosterAction();
      setFeedback(
        result.ok
          ? { kind: "ok", message: result.info }
          : { kind: "err", message: result.error },
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={clsx(
          "btn-secondary text-xs whitespace-nowrap",
          isPending && "opacity-60 cursor-not-allowed",
        )}
      >
        {isPending ? "Importing…" : "Import full Alliance roster"}
      </button>
      {feedback.kind === "ok" && feedback.message ? (
        <span className="text-[11px] text-emerald-700">{feedback.message}</span>
      ) : null}
      {feedback.kind === "err" && feedback.message ? (
        <span className="text-[11px] text-red-700">{feedback.message}</span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Shared row table                                                        */
/* ---------------------------------------------------------------------- */

function SubscriberTable({
  rows,
  showRoleColumn,
  showOfficeColumn,
}: {
  rows: SubscriberWithOffice[];
  showRoleColumn?: boolean;
  showOfficeColumn?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-neutral-500">
        No subscribers in this group yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">Name</th>
            <th className="text-left px-4 py-2 font-semibold">Email</th>
            {showRoleColumn ? (
              <th className="text-left px-4 py-2 font-semibold">Role</th>
            ) : null}
            {showOfficeColumn ? (
              <th className="text-left px-4 py-2 font-semibold">Office</th>
            ) : null}
            <th className="text-center px-2 py-2 font-semibold" title="Weekly social media report">
              Weekly
            </th>
            <th className="text-center px-2 py-2 font-semibold" title="Owner Stories">
              Story
            </th>
            <th className="text-center px-2 py-2 font-semibold" title="Office post alerts">
              Alerts
            </th>
            <th className="text-center px-2 py-2 font-semibold">Active</th>
            <th className="text-right px-3 py-2 font-semibold sr-only">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <SubscriberRow
              key={r.id}
              row={r}
              showRoleColumn={!!showRoleColumn}
              showOfficeColumn={!!showOfficeColumn}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriberRow({
  row,
  showRoleColumn,
  showOfficeColumn,
}: {
  row: SubscriberWithOffice;
  showRoleColumn: boolean;
  showOfficeColumn: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(field: FlagField, value: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await toggleSubscriberFlagAction(row.id, field, value);
      if (!result.ok) setError(result.error ?? "Update failed.");
    });
  }

  function handleDelete() {
    if (!window.confirm(`Remove ${row.name} (${row.email})?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteSubscriberAction(row.id);
      if (!result.ok) setError(result.error ?? "Delete failed.");
    });
  }

  return (
    <tr className={clsx(isPending && "opacity-50", !row.is_active && "bg-neutral-50")}>
      <td className="px-4 py-2 font-medium text-neutral-900">{row.name}</td>
      <td className="px-4 py-2 text-neutral-600 font-mono text-[11px]">
        {row.email}
      </td>
      {showRoleColumn ? (
        <td className="px-4 py-2 text-neutral-600">{row.role ?? "—"}</td>
      ) : null}
      {showOfficeColumn ? (
        <td className="px-4 py-2 text-neutral-600">
          {row.office_name ?? "—"}
        </td>
      ) : null}
      <td className="text-center px-2 py-2">
        <FlagCheckbox
          checked={row.receives_weekly_social_report}
          onChange={(v) => toggle("receives_weekly_social_report", v)}
        />
      </td>
      <td className="text-center px-2 py-2">
        <FlagCheckbox
          checked={row.receives_owner_story}
          onChange={(v) => toggle("receives_owner_story", v)}
        />
      </td>
      <td className="text-center px-2 py-2">
        <FlagCheckbox
          checked={row.receives_office_post_alerts}
          onChange={(v) => toggle("receives_office_post_alerts", v)}
        />
      </td>
      <td className="text-center px-2 py-2">
        <FlagCheckbox
          checked={row.is_active}
          onChange={(v) => toggle("is_active", v)}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={handleDelete}
          className="text-[11px] text-neutral-400 hover:text-red-600"
          title="Delete subscriber"
        >
          Delete
        </button>
        {error ? (
          <div className="text-[11px] text-red-700 mt-1">{error}</div>
        ) : null}
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------------- */
/* Primitives                                                              */
/* ---------------------------------------------------------------------- */

function SectionHeading({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle?: string;
  count?: number;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="text-xs text-neutral-500">{count}</span>
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-1 text-sm text-neutral-500 max-w-2xl">{subtitle}</p>
      ) : null}
    </div>
  );
}

function LabeledInput({
  name,
  label,
  type = "text",
  required,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-600 mb-1">
        {label}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        className="w-full text-sm rounded-md border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 focus:border-gold-400"
      />
    </label>
  );
}

function LabeledSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-600 mb-1">
        {label}
      </span>
      <select
        name={name}
        className="w-full text-sm rounded-md border border-neutral-300 px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold-300 focus:border-gold-400"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="rounded border-neutral-300 text-gold-600 focus:ring-gold-400"
      />
      <span className="text-neutral-700">{label}</span>
    </label>
  );
}

function FlagCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded border-neutral-300 text-gold-600 focus:ring-gold-400 cursor-pointer"
    />
  );
}
