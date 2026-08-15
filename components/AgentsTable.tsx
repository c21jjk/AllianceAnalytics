"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgentRosterRow, HeadshotMatch } from "@/lib/data/agent-roster";
import {
  setAgentPhoneOverrideAction,
  setAgentHeadshotLabelAction,
  uploadAgentHeadshotAction,
} from "@/app/(app)/agents/actions";

interface Props {
  rows: AgentRosterRow[];
  headshotLabels: string[];
  activeFilter: string;
  includeInactive: boolean;
  missingCount: number;
}

/**
 * How the photo was found, in plain language. Worth showing because a fuzzy
 * match is not the same promise as an explicit one: "matched on name" can
 * quietly attach the wrong Gorski to a slide, and seeing that is what
 * prompts somebody to pin it properly.
 */
const MATCH_LABELS: Record<HeadshotMatch, string> = {
  override: "Pinned",
  exact: "Matched on name",
  sole: "Only match on last name",
  prefix: "Matched on short first name",
  none: "None found",
};

const MAX_BYTES = 5 * 1024 * 1024;

export default function AgentsTable({
  rows,
  headshotLabels,
  activeFilter,
  includeInactive,
  missingCount,
}: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <FilterLink
          label="Everyone"
          filter="all"
          activeFilter={activeFilter}
          includeInactive={includeInactive}
        />
        <FilterLink
          label={`Needs something (${missingCount})`}
          filter="missing"
          activeFilter={activeFilter}
          includeInactive={includeInactive}
        />
        <FilterLink
          label="No headshot"
          filter="missing_photo"
          activeFilter={activeFilter}
          includeInactive={includeInactive}
        />
        <div className="ml-auto">
          <Link
            href={`/agents?filter=${activeFilter}${includeInactive ? "" : "&inactive=1"}`}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
          >
            {includeInactive ? "Hide former agents" : "Show former agents"}
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-neutral-500">
          Nothing to show here. Everyone in this view has a headshot and a
          phone number.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((row) => (
            <AgentRow key={row.id} row={row} headshotLabels={headshotLabels} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterLink({
  label,
  filter,
  activeFilter,
  includeInactive,
}: {
  label: string;
  filter: string;
  activeFilter: string;
  includeInactive: boolean;
}) {
  const isActive = activeFilter === filter;
  return (
    <Link
      href={`/agents?filter=${filter}${includeInactive ? "&inactive=1" : ""}`}
      className={[
        "rounded-full px-3 py-1 text-xs font-medium transition",
        isActive
          ? "bg-neutral-900 text-white"
          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function AgentRow({
  row,
  headshotLabels,
}: {
  row: AgentRosterRow;
  headshotLabels: string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const [photoUrl, setPhotoUrl] = useState<string | null>(row.headshot_url);
  const [matchKind, setMatchKind] = useState<HeadshotMatch>(row.headshot_match);
  const [phone, setPhone] = useState<string>(row.effective_phone ?? "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function flash(message: string) {
    setSaved(message);
    setError(null);
    window.setTimeout(() => setSaved(null), 2500);
  }

  function savePhone() {
    const next = phone.trim();
    setEditingPhone(false);
    startTransition(async () => {
      const result = await setAgentPhoneOverrideAction(row.id, next);
      if (!result.ok) {
        setError(result.error ?? "Could not save that.");
        setPhone(row.effective_phone ?? "");
        return;
      }
      flash(next ? "Phone saved" : "Phone cleared");
      router.refresh();
    });
  }

  function pinLabel(label: string) {
    setPinning(false);
    startTransition(async () => {
      const result = await setAgentHeadshotLabelAction(row.id, label);
      if (!result.ok) {
        setError(result.error ?? "Could not pin that photo.");
        return;
      }
      setMatchKind(label ? "override" : "none");
      flash(label ? "Photo pinned" : "Pin removed");
      router.refresh();
    });
  }

  function onFilePicked(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max is 5 MB.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Could not read that file.");
    reader.onload = () => {
      const dataUri = String(reader.result ?? "");
      const comma = dataUri.indexOf(",");
      if (comma < 0) {
        setError("Could not read that file.");
        return;
      }
      const base64 = dataUri.slice(comma + 1);
      startTransition(async () => {
        const result = await uploadAgentHeadshotAction({
          agent_id: row.id,
          agent_name: row.full_name,
          filename: file.name,
          content_type: file.type,
          file_base64: base64,
        });
        if (!result.ok) {
          setError(result.error ?? "Upload failed.");
          return;
        }
        if (result.public_url) setPhotoUrl(result.public_url);
        setMatchKind("override");
        flash("Headshot saved");
        router.refresh();
      });
    };
    reader.readAsDataURL(file);
  }

  const needsPhoto = !photoUrl;
  const needsPhone = !phone.trim();

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Headshot */}
        <div className="flex-none">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={row.full_name}
              className="h-12 w-12 rounded-full object-cover ring-1 ring-neutral-200"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-amber-300 bg-amber-50 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              None
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900">
              {row.full_name}
            </span>
            {!row.is_active ? (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Former
              </span>
            ) : null}
            <span
              className={[
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                needsPhoto
                  ? "bg-amber-100 text-amber-800"
                  : matchKind === "override"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-neutral-100 text-neutral-500",
              ].join(" ")}
              title={
                row.headshot_label
                  ? `Photo file: ${row.headshot_label}`
                  : undefined
              }
            >
              {MATCH_LABELS[matchKind]}
            </span>
            {row.headshot_is_manual ? (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                Uploaded here
              </span>
            ) : null}
          </div>

          {/* Phone */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {editingPhone ? (
              <>
                <input
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") savePhone();
                    if (e.key === "Escape") {
                      setPhone(row.effective_phone ?? "");
                      setEditingPhone(false);
                    }
                  }}
                  placeholder="609-555-0123"
                  className="w-44 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-gold-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={savePhone}
                  disabled={isPending}
                  className="rounded-md bg-gold-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-gold-600 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhone(row.effective_phone ?? "");
                    setEditingPhone(false);
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span
                  className={
                    needsPhone ? "text-amber-700" : "font-mono text-neutral-700"
                  }
                >
                  {phone.trim() ||
                    (row.phone_source === "unknown"
                      ? "Cannot check right now"
                      : "No phone on file")}
                </span>
                {row.phone_source === "override" ? (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    set here
                  </span>
                ) : row.phone_source === "feed" ? (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    from MLS
                  </span>
                ) : row.phone_source === "roster" ? (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    from Alliance Dash
                  </span>
                ) : row.phone_source === "unknown" ? (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    cannot check
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setEditingPhone(true)}
                  className="text-xs text-gold-700 underline underline-offset-2 hover:text-gold-800"
                >
                  {needsPhone ? "Add phone" : "Edit"}
                </button>
              </>
            )}
          </div>

          {/* Photo controls */}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFilePicked(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              className="text-gold-700 underline underline-offset-2 hover:text-gold-800 disabled:opacity-50"
            >
              {needsPhoto ? "Upload headshot" : "Replace headshot"}
            </button>

            {pinning ? (
              <span className="flex items-center gap-2">
                <select
                  autoFocus
                  defaultValue={row.headshot_label_override ?? ""}
                  onChange={(e) => pinLabel(e.target.value)}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-gold-400 focus:outline-none"
                >
                  <option value="">Not pinned</option>
                  {headshotLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setPinning(false)}
                  className="text-neutral-500 hover:text-neutral-800"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setPinning(true)}
                disabled={isPending}
                className="text-neutral-500 underline underline-offset-2 hover:text-neutral-800 disabled:opacity-50"
              >
                {row.headshot_label_override
                  ? "Change which photo"
                  : "Use an existing photo"}
              </button>
            )}

            {isPending ? (
              <span className="text-neutral-400">Saving…</span>
            ) : null}
            {saved ? <span className="text-emerald-700">{saved}</span> : null}
          </div>

          {error ? (
            <div className="mt-1 text-xs text-red-600">{error}</div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
