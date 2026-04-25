"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { saveCredentials } from "./actions";
import type { PlatformDef } from "./credentialSchemas";

export interface ConnectionSnapshot {
  platform: PlatformDef["platform"];
  is_active: boolean;
  last_validated_at: string | null;
  configured_keys: string[]; // which credential keys are stored — VALUES NEVER SENT
}

export default function ApiConnectionCard({
  def,
  snapshot,
}: {
  def: PlatformDef;
  snapshot: ConnectionSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status = computeStatus(snapshot);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveCredentials(formData);
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-neutral-900">{def.label}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">{def.description}</p>
        </div>
      </div>

      <dl className="mt-4 space-y-1.5 text-xs">
        <Row
          label="Last validated"
          value={
            snapshot?.last_validated_at
              ? new Date(snapshot.last_validated_at).toLocaleString()
              : "Never"
          }
        />
        {snapshot && snapshot.configured_keys.length > 0 ? (
          <Row
            label="Stored fields"
            value={
              <span className="font-mono text-neutral-700">
                {snapshot.configured_keys.length} field
                {snapshot.configured_keys.length === 1 ? "" : "s"} ·{" "}
                <span className="text-neutral-500">••••••••</span>
              </span>
            }
          />
        ) : null}
      </dl>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className={snapshot ? "btn-secondary" : "btn-primary"}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {snapshot ? "Update" : "Configure"}
        </button>
      </div>

      {open ? (
        <div className="mt-5 border-t border-neutral-100 pt-5">
          <form action={onSubmit} className="space-y-3">
            <input type="hidden" name="platform" value={def.platform} />
            {def.fields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`f-${def.platform}-${field.key}`} className="label">
                  {field.label}
                  {field.required ? (
                    <span className="text-rose-600 ml-1">*</span>
                  ) : null}
                </label>
                <input
                  id={`f-${def.platform}-${field.key}`}
                  name={`field_${field.key}`}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  required={field.required}
                  placeholder={field.secret ? "••••••••" : field.placeholder}
                  className="input"
                  disabled={pending}
                />
                {field.helper ? (
                  <p className="mt-1 text-xs text-neutral-500">{field.helper}</p>
                ) : null}
              </div>
            ))}

            {snapshot ? (
              <p className="text-xs text-neutral-500">
                Existing values are not shown. Submitting replaces all stored
                fields for this platform.
              </p>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? "Saving…" : "Save credentials"}
              </button>
              <button
                type="button"
                disabled={pending}
                className="btn-secondary"
                onClick={() => {
                  setError(null);
                  setOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type Status = "not_connected" | "configured" | "connected" | "disabled";

function computeStatus(snapshot: ConnectionSnapshot | null): Status {
  if (!snapshot) return "not_connected";
  if (!snapshot.is_active) return "disabled";
  if (snapshot.last_validated_at) return "connected";
  return "configured";
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    not_connected: { label: "Not connected", cls: "badge-neutral" },
    configured: { label: "Configured", cls: "badge bg-gold-50 text-gold-700 ring-1 ring-gold-100" },
    connected: { label: "Connected", cls: "badge-success" },
    disabled: { label: "Paused", cls: "badge-neutral" },
  };
  const m = map[status];
  return <span className={clsx(m.cls, "text-[10px]")}>{m.label}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-700 text-right">{value}</dd>
    </div>
  );
}
