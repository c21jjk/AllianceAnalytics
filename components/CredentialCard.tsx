import Link from "next/link";
import type { PlatformDef } from "@/app/(app)/settings/credentialSchemas";
import type { CredentialSummary } from "@/lib/data/credentials";
import type { FBTokenStatus } from "@/lib/post-builder/publish";

interface Props {
  def: PlatformDef;
  summary: CredentialSummary | null;
  /** Optional — only meaningful for the Meta (facebook/instagram) cards. */
  tokenStatus?: FBTokenStatus | null;
}

/**
 * Read-only summary card for one api_credentials row. Renders inside the
 * /settings landing page. Edit button links to /settings/credentials/[platform]/edit.
 */
export default function CredentialCard({ def, summary, tokenStatus }: Props) {
  const configured = !!summary && summary.has_value && summary.is_active;
  const editHref = `/settings/credentials/${encodeURIComponent(def.platform)}/edit`;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-neutral-900">{def.label}</h3>
              <StatusBadge
                configured={configured}
                active={summary?.is_active ?? true}
                hasRow={!!summary}
              />
              {tokenStatus ? <TokenExpiryBadge status={tokenStatus} /> : null}
            </div>
            <p className="mt-1 text-sm text-neutral-500">{def.description}</p>
          </div>
          <Link
            href={editHref}
            className="btn-secondary text-xs whitespace-nowrap"
          >
            Edit
          </Link>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-y-1.5 text-sm">
          {def.fields.map((field) => {
            const present = summary?.configured_keys.includes(field.key);
            const value = present ? (field.secret ? "••••••••" : "Stored") : null;
            return (
              <FieldRow
                key={field.key}
                label={field.label}
                value={value}
              />
            );
          })}
        </dl>
      </div>

      <div className="border-t border-neutral-100 px-5 py-2.5 text-xs text-neutral-500">
        {summary?.updated_at ? (
          <>
            Last updated{" "}
            <span className="text-neutral-700">
              {formatDate(summary.updated_at)}
            </span>
          </>
        ) : (
          <span>Not yet configured</span>
        )}
        {summary?.last_validated_at ? (
          <>
            {" · last validated "}
            <span className="text-neutral-700">
              {formatDate(summary.last_validated_at)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Token expiry badge for the FB credential card. Color-coded thresholds:
 *   • Red       — token expired OR < 7d remaining.
 *   • Amber     — 7-29d remaining.
 *   • Neutral   — 30+ days OR token never expires.
 *   • Hidden    — debug_token couldn't be reached (status.ok === false).
 *
 * Kept out of the main status badge so an expiring-but-valid token still
 * reads as "Configured" (it IS configured — it just needs rotating soon).
 */
function TokenExpiryBadge({ status }: { status: FBTokenStatus }) {
  if (!status.ok) return null;
  const days = status.days_until_expiry;
  if (days == null) {
    return (
      <span
        className="badge bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 text-[10px]"
        title="Token does not expire"
      >
        No expiry
      </span>
    );
  }
  if (days < 0) {
    return (
      <span
        className="badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 text-[10px]"
        title={status.expires_at_iso ?? ""}
      >
        Token expired
      </span>
    );
  }
  if (days < 7) {
    return (
      <span
        className="badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 text-[10px]"
        title={status.expires_at_iso ?? ""}
      >
        Rotate now · {days}d left
      </span>
    );
  }
  if (days < 30) {
    return (
      <span
        className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px]"
        title={status.expires_at_iso ?? ""}
      >
        Rotate soon · {days}d
      </span>
    );
  }
  return (
    <span
      className="badge bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 text-[10px]"
      title={status.expires_at_iso ?? ""}
    >
      {days}d to expiry
    </span>
  );
}

function StatusBadge({
  configured,
  active,
  hasRow,
}: {
  configured: boolean;
  active: boolean;
  hasRow: boolean;
}) {
  if (hasRow && !active) {
    return (
      <span className="badge bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200 text-[10px]">
        Paused
      </span>
    );
  }
  if (configured) {
    return (
      <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-[10px]">
        Configured
      </span>
    );
  }
  return (
    <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px]">
      Incomplete
    </span>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="grid grid-cols-[160px_1fr] items-baseline gap-3">
      <dt className="text-neutral-500 text-xs">{label}</dt>
      <dd
        className={
          hasValue
            ? "text-neutral-900 text-sm"
            : "italic text-neutral-400 text-sm"
        }
      >
        {hasValue ? value : "Not set"}
      </dd>
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
