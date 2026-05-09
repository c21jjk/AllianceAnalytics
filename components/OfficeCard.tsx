import Link from "next/link";
import type { OfficeRow } from "@/lib/data/offices";
import { isOfficeProfileComplete } from "@/lib/data/offices";

interface Props {
  office: OfficeRow;
}

/**
 * Read-only summary card for one office. Renders inside the
 * /settings/offices index page. Edit button links to
 * /settings/offices/[short_code]/edit.
 */
export default function OfficeCard({ office }: Props) {
  const editHref = `/settings/offices/${encodeURIComponent(
    office.short_code,
  )}/edit`;
  const profileComplete = isOfficeProfileComplete(office);
  const towns = (office.towns_served ?? []).join(", ");
  const truncatedTowns = truncate(towns, 60);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-neutral-900">{office.name}</h3>
              <ActiveBadge active={office.is_active} />
              <ProfileBadge complete={profileComplete} />
            </div>
            {office.display_name ? (
              <p className="mt-1 text-sm text-neutral-500">
                {office.display_name}
              </p>
            ) : null}
          </div>
          <Link
            href={editHref}
            className="btn-secondary text-xs whitespace-nowrap"
          >
            Edit
          </Link>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-y-1.5 text-sm">
          <FieldRow
            label="Towns served"
            value={truncatedTowns.length > 0 ? truncatedTowns : null}
          />
          <FieldRow label="Phone" value={office.phone} />
          <FieldRow
            label="Short code"
            value={office.short_code}
            mono
          />
        </dl>
      </div>

      <div className="border-t border-neutral-100 px-5 py-2.5 text-xs text-neutral-500">
        Last updated{" "}
        <span className="text-neutral-700">{formatDate(office.updated_at)}</span>
      </div>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-[10px]">
        Active
      </span>
    );
  }
  return (
    <span className="badge bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200 text-[10px]">
      Inactive
    </span>
  );
}

function ProfileBadge({ complete }: { complete: boolean }) {
  if (complete) {
    return (
      <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-[10px]">
        Profile complete
      </span>
    );
  }
  return (
    <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px]">
      Profile incomplete
    </span>
  );
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3">
      <dt className="text-neutral-500 text-xs">{label}</dt>
      <dd
        className={
          hasValue
            ? mono
              ? "text-neutral-900 font-mono text-xs break-all"
              : "text-neutral-900 text-sm break-words"
            : "italic text-neutral-400 text-sm"
        }
      >
        {hasValue ? value : "—"}
      </dd>
    </div>
  );
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
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
