"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { MlsFeedRow } from "@/lib/data/mls-feeds";

interface ActionState {
  ok: boolean;
  error?: string;
}

interface Props {
  feed: MlsFeedRow;
  action: (
    prev: ActionState | null,
    form: FormData,
  ) => Promise<ActionState>;
}

/**
 * Full edit form for one mls_feeds row. Used in
 * /settings/feeds/[short_code]/edit. Renders different field sets
 * depending on feed_type (rets vs reso_web_api).
 *
 * Secret fields (password, api_key, api_secret): empty submission means
 * "leave the existing value untouched". Only non-empty values are persisted
 * server-side.
 */
export default function MlsFeedForm({ feed, action }: Props) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="space-y-6">
      {state?.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {state.error}
        </div>
      ) : null}

      <Section title="Identity">
        <Field
          label="Display name"
          name="name"
          required
          defaultValue={feed.name}
          full
        />
        <Field
          label="Description"
          name="description"
          defaultValue={feed.description ?? ""}
          placeholder="One-line description shown on the index card"
          full
        />
        <ReadonlyField label="Short code" value={feed.short_code} mono />
        <ReadonlyField
          label="Feed type"
          value={feed.feed_type === "rets" ? "RETS" : "RESO Web API"}
        />
      </Section>

      {feed.feed_type === "rets" ? (
        <Section title="RETS connection">
          <Field
            label="RETS URL"
            name="rets_url"
            defaultValue={feed.rets_url ?? ""}
            placeholder="https://rets.example.com/rets/login"
            full
            mono
          />
          <Field
            label="Username"
            name="username"
            defaultValue={feed.username ?? ""}
          />
          <SecretField
            label="Password"
            name="password"
            hasExisting={!!feed.password}
          />
          <Field
            label="RETS Version"
            name="rets_version"
            defaultValue={feed.rets_version ?? ""}
            placeholder="RETS/1.7.2"
          />
          <Field
            label="Max Records"
            name="max_records"
            type="number"
            defaultValue={
              feed.max_records !== null ? String(feed.max_records) : ""
            }
            placeholder="2500"
          />
        </Section>
      ) : (
        <Section title="RESO Web API connection">
          <Field
            label="Base URL"
            name="base_url"
            defaultValue={feed.base_url ?? ""}
            placeholder="https://api.example.com/v2"
            full
            mono
          />
          <SecretField
            label="API Key"
            name="api_key"
            hasExisting={!!feed.api_key}
          />
          <SecretField
            label="API Secret"
            name="api_secret"
            hasExisting={!!feed.api_secret}
          />
          <Field
            label="Max Records"
            name="max_records"
            type="number"
            defaultValue={
              feed.max_records !== null ? String(feed.max_records) : ""
            }
            placeholder="2500"
          />
        </Section>
      )}

      <Section title="Filters & notes">
        <Field
          label="Office filter"
          name="office_filter"
          defaultValue={feed.office_filter ?? ""}
          placeholder="C21ALLIANCE"
          help="Optional MLS-side filter (e.g. office id) applied at sync time."
        />
        <Field
          label="Status filter"
          name="status_filter"
          defaultValue={feed.status_filter ?? ""}
          placeholder="Active,Pending"
        />
        <Field
          label="Notes"
          name="notes"
          defaultValue={feed.notes ?? ""}
          placeholder="Internal notes — not visible outside admin"
          full
        />
      </Section>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        <span className="font-medium text-neutral-700">
          Validate connection
        </span>{" "}
        — coming soon. Live RETS / RESO probe is deferred to the next sprint.
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-neutral-200">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href="/settings" className="btn-secondary text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  required,
  help,
  full,
  mono,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  full?: boolean;
  mono?: boolean;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (full ? "sm:col-span-2" : "")}>
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {required ? <span className="text-rose-600 ml-0.5">*</span> : null}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        type={type}
        placeholder={placeholder}
        required={required}
        className={
          "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 " +
          "shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 " +
          (mono ? "font-mono " : "")
        }
      />
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}

function ReadonlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <input
        value={value}
        readOnly
        className={
          "rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500 cursor-not-allowed " +
          (mono ? "font-mono " : "")
        }
      />
    </label>
  );
}

function SecretField({
  label,
  name,
  hasExisting,
}: {
  label: string;
  name: string;
  hasExisting: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <div className="relative">
        <input
          name={name}
          type={show ? "text" : "password"}
          autoComplete="off"
          placeholder={hasExisting ? "•••••••• (leave blank to keep)" : "Enter value"}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 pr-16 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-neutral-500 hover:text-neutral-700"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <span className="text-xs text-neutral-500">
        {hasExisting
          ? "A value is currently stored. Leave blank to keep it."
          : "Not yet set."}
      </span>
    </label>
  );
}
