import Link from "next/link";
import type { MlsFeedRow } from "@/lib/data/mls-feeds";
import { isFeedConfigured } from "@/lib/data/mls-feeds";

interface Props {
  feed: MlsFeedRow;
}

/**
 * Read-only summary card for one MLS / RETS feed. Renders inside the
 * /settings landing page. Edit button links to /settings/feeds/[short_code]/edit.
 */
export default function MlsFeedCard({ feed }: Props) {
  const configured = isFeedConfigured(feed);
  const editHref = `/settings/feeds/${encodeURIComponent(feed.short_code)}/edit`;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-neutral-900">{feed.name}</h3>
              <StatusBadge configured={configured} active={feed.is_active} />
              <FeedTypeBadge feedType={feed.feed_type} />
            </div>
            {feed.description ? (
              <p className="mt-1 text-sm text-neutral-500">{feed.description}</p>
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
          {feed.feed_type === "rets" ? (
            <>
              <FieldRow label="RETS URL" value={feed.rets_url} mono />
              <FieldRow label="Username" value={feed.username} />
              <FieldRow
                label="Password"
                value={feed.password ? "••••••••" : null}
              />
              <FieldRow label="RETS Version" value={feed.rets_version} />
              <FieldRow
                label="Max Records"
                value={
                  feed.max_records !== null ? String(feed.max_records) : null
                }
              />
            </>
          ) : (
            <>
              <FieldRow label="Base URL" value={feed.base_url} mono />
              <FieldRow
                label="API Key"
                value={feed.api_key ? "••••••••" : null}
              />
              <FieldRow
                label="API Secret"
                value={feed.api_secret ? "••••••••" : null}
              />
              <FieldRow
                label="Max Records"
                value={
                  feed.max_records !== null ? String(feed.max_records) : null
                }
              />
            </>
          )}
        </dl>
      </div>

      <div className="border-t border-neutral-100 px-5 py-2.5 text-xs text-neutral-500">
        Last updated{" "}
        <span className="text-neutral-700">{formatDate(feed.updated_at)}</span>
        {feed.last_sync_at ? (
          <>
            {" · last sync "}
            <span className="text-neutral-700">
              {formatDate(feed.last_sync_at)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({
  configured,
  active,
}: {
  configured: boolean;
  active: boolean;
}) {
  if (!active) {
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

function FeedTypeBadge({ feedType }: { feedType: "rets" | "reso_web_api" }) {
  const label = feedType === "rets" ? "RETS" : "RESO Web API";
  return (
    <span className="badge bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 text-[10px] uppercase tracking-wide">
      {label}
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
