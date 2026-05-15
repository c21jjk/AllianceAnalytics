"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { AgentOutboxRow } from "@/lib/data/agent-outbox-shared";
import { buildOutboxMailto } from "@/lib/data/agent-outbox-shared";
import { acknowledgeOutboxRowAction } from "@/app/(app)/outbox/actions";
import { formatRelativeTime } from "@/lib/format";

interface Props {
  rows: AgentOutboxRow[];
}

/**
 * Pending agent notifications — admin view.
 *
 * Phase 5 surfaces every published post that should have triggered an
 * agent notification but hasn't been delivered yet. Each row gives Larissa
 * a one-click "Email agent" mailto with a pre-filled body. Clicking marks
 * the row acknowledged so it falls off the pending list.
 *
 * Rows missing an agent_email render disabled with a "Fill in agent email"
 * deep-link to the property detail page (where NullAgentEmailWarning has
 * the inline editor).
 *
 * Phase 6 will replace the mailto path with a Resend auto-send and this
 * table flips to a read-only audit view.
 */
export default function AgentOutboxTable({ rows }: Props) {
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(
    new Set(),
  );
  const [pending, startTransition] = useTransition();
  const [errorRow, setErrorRow] = useState<{ id: string; message: string } | null>(
    null,
  );

  function handleSend(row: AgentOutboxRow) {
    const { href } = buildOutboxMailto(row);
    if (!href) return;
    // Open mailto in a new tab so the user's mail client launches, then
    // acknowledge the row server-side so it falls off the pending list.
    window.open(href, "_blank");
    startTransition(async () => {
      const result = await acknowledgeOutboxRowAction(row.id);
      if (!result.ok) {
        setErrorRow({
          id: row.id,
          message: result.error ?? "Couldn’t acknowledge — try refresh.",
        });
        return;
      }
      setAcknowledgedIds((s) => {
        const next = new Set(s);
        next.add(row.id);
        return next;
      });
    });
  }

  const visibleRows = rows.filter((r) => !acknowledgedIds.has(r.id));

  if (visibleRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-10 text-center text-sm text-neutral-500">
        Nothing pending — every recent post about a property has been routed
        to its listing agent.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
      <div className="hidden md:grid md:grid-cols-[64px_minmax(0,_2.5fr)_minmax(0,_1.5fr)_minmax(0,_1fr)_auto] gap-3 px-4 py-2 bg-neutral-50 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
        <div></div>
        <div>Post / Listing</div>
        <div>Agent</div>
        <div>Published</div>
        <div className="text-right">Action</div>
      </div>
      <ul className="divide-y divide-neutral-200">
        {visibleRows.map((row) => {
          const hasEmail = !!row.agent_email;
          const isError = errorRow?.id === row.id;
          return (
            <li
              key={row.id}
              className="grid grid-cols-1 md:grid-cols-[64px_minmax(0,_2.5fr)_minmax(0,_1.5fr)_minmax(0,_1fr)_auto] gap-3 px-4 py-3 items-center"
            >
              <div className="w-12 h-12 shrink-0 rounded bg-neutral-100 overflow-hidden">
                {row.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.thumbnail_url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <Link
                  href={
                    row.property_mls
                      ? `/properties/${row.property_mls}`
                      : "#"
                  }
                  className="block text-sm font-medium text-neutral-900 hover:text-gold-700 truncate"
                >
                  {row.property_address ?? row.property_mls ?? "Unknown listing"}
                </Link>
                {row.notification_type === "status_flip" ? (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 ring-1 " +
                        (row.flip_to_status === "sold"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                          : "bg-amber-50 text-amber-800 ring-amber-200")
                      }
                    >
                      {row.flip_to_status === "sold"
                        ? "Sold"
                        : "Under contract"}
                    </span>
                    <span className="text-neutral-500 normal-case font-normal tracking-normal">
                      Status-flip notification
                    </span>
                  </div>
                ) : null}
                {row.caption_snippet ? (
                  <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">
                    {row.caption_snippet}
                  </p>
                ) : null}
                {row.post_urls.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                    {row.post_urls.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-neutral-800 underline-offset-2 hover:underline"
                      >
                        {extractPlatformLabel(url)}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 text-xs">
                {row.agent_name ? (
                  <div className="font-medium text-neutral-900 truncate">
                    {row.agent_name}
                  </div>
                ) : null}
                {hasEmail ? (
                  <div className="text-neutral-500 truncate">
                    {row.agent_email}
                  </div>
                ) : (
                  <div className="text-rose-700 font-medium">
                    No email on file
                  </div>
                )}
              </div>
              <div className="text-xs text-neutral-500">
                {formatRelativeTime(row.created_at)}
              </div>
              <div className="flex items-center gap-2 justify-end">
                {hasEmail ? (
                  <button
                    type="button"
                    onClick={() => handleSend(row)}
                    disabled={pending}
                    className="inline-flex items-center rounded-md bg-gold-500 hover:bg-gold-600 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-60"
                  >
                    Email agent
                  </button>
                ) : (
                  <Link
                    href={
                      row.property_mls
                        ? `/properties/${row.property_mls}`
                        : "#"
                    }
                    className="inline-flex items-center rounded-md ring-1 ring-rose-300 bg-white text-rose-700 text-xs font-medium px-3 py-1.5 hover:bg-rose-50"
                  >
                    Fill in email
                  </Link>
                )}
                {isError ? (
                  <span className="text-[10px] text-rose-700 font-medium">
                    {errorRow?.message}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function extractPlatformLabel(url: string): string {
  if (url.includes("facebook.com")) return "Facebook";
  if (url.includes("instagram.com")) return "Instagram";
  if (url.includes("tiktok.com")) return "TikTok";
  return "Open";
}
