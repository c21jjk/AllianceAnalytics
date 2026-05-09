"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { PlatformDef } from "@/app/(app)/settings/credentialSchemas";

interface ActionState {
  ok: boolean;
  error?: string;
}

interface Props {
  def: PlatformDef;
  /** Sanitized echo of which non-secret values are currently stored. Secrets
   *  are never sent to the client; only their presence is signaled. */
  initialNonSecret: Record<string, string>;
  /** Map of secret-key → boolean indicating whether a value is on file. */
  hasSecret: Record<string, boolean>;
  isActive: boolean;
  action: (
    prev: ActionState | null,
    form: FormData,
  ) => Promise<ActionState>;
}

/**
 * Full edit form for one api_credentials row. Used in
 * /settings/credentials/[platform]/edit.
 *
 * Secret fields (password / api_key / token / etc): empty submission means
 * "leave the existing value untouched". Only non-empty values are persisted
 * server-side. This lets the admin update individual non-secret fields
 * without having to re-paste long-lived tokens.
 */
export default function CredentialForm({
  def,
  initialNonSecret,
  hasSecret,
  isActive,
  action,
}: Props) {
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

      {def.setup_note ? (
        <div className="rounded-lg border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-neutral-700">
          {def.setup_note}
        </div>
      ) : null}

      <Section title="Connection details">
        {def.fields.map((field) =>
          field.secret ? (
            <SecretField
              key={field.key}
              label={field.label}
              name={`field_${field.key}`}
              hasExisting={!!hasSecret[field.key]}
              required={field.required}
              helper={field.helper}
            />
          ) : (
            <Field
              key={field.key}
              label={field.label}
              name={`field_${field.key}`}
              defaultValue={initialNonSecret[field.key] ?? ""}
              placeholder={field.placeholder}
              required={field.required}
              help={field.helper}
            />
          ),
        )}
      </Section>

      <Section title="Status">
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            type="checkbox"
            name="is_active"
            value="1"
            defaultChecked={isActive}
            className="h-4 w-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
          />
          <span className="text-sm text-neutral-700">
            Active — credentials are used by sync jobs and AI features
          </span>
        </label>
      </Section>

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
  placeholder,
  required,
  help,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {required ? <span className="text-rose-600 ml-0.5">*</span> : null}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        type="text"
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
      />
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}

function SecretField({
  label,
  name,
  hasExisting,
  required,
  helper,
}: {
  label: string;
  name: string;
  hasExisting: boolean;
  required?: boolean;
  helper?: string;
}) {
  const [show, setShow] = useState(false);
  // If a value is on file, blanks-mean-keep. We only enforce required on
  // first-time setup.
  const reallyRequired = required && !hasExisting;
  return (
    <label className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {reallyRequired ? <span className="text-rose-600 ml-0.5">*</span> : null}
      </span>
      <div className="relative">
        <input
          name={name}
          type={show ? "text" : "password"}
          autoComplete="off"
          required={reallyRequired}
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
        {helper}
        {helper ? " " : ""}
        {hasExisting ? (
          <em className="not-italic text-neutral-600">
            A value is currently stored — leave blank to keep it.
          </em>
        ) : null}
      </span>
    </label>
  );
}
