import { requireUser } from "@/lib/auth";
import {
  fetchOutboxCounts,
  fetchOutboxRows,
} from "@/lib/data/agent-outbox-db";
import PageHeader from "@/components/PageHeader";
import AgentOutboxTable from "@/components/AgentOutboxTable";

export const metadata = { title: "Agent Outbox — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Agent Outbox — Phase 5 admin surface.
 *
 * Every time a post is published about a listing, a row lands here. Each
 * row is a one-click mailto to the listing agent, asking them to reshare.
 * Clicking marks the row acknowledged so it falls off the pending list.
 *
 * Phase 6 will wire Resend so rows auto-send, and this page flips to a
 * read-only audit view (which posts went out to which agents and when).
 */
export default async function OutboxPage() {
  await requireUser();
  const [rows, counts] = await Promise.all([
    fetchOutboxRows({ onlyPending: true, limit: 100 }),
    fetchOutboxCounts(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Outbox"
        description="Every published post that should ping the listing agent to reshare. Click Email agent to send via your mail client — Phase 6 will auto-send via Resend."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile
          label="Pending"
          value={counts.total_pending}
          tone={counts.total_pending > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Acknowledged"
          value={counts.total_acknowledged}
          tone="ok"
        />
        <StatTile
          label="Blocked — no email"
          value={counts.blocked_no_email}
          tone={counts.blocked_no_email > 0 ? "alert" : "neutral"}
        />
      </div>

      <AgentOutboxTable rows={rows} />
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "alert" | "neutral";
}) {
  const toneClass: Record<typeof tone, string> = {
    ok: "ring-emerald-200 bg-emerald-50/40",
    warn: "ring-amber-200 bg-amber-50/40",
    alert: "ring-rose-200 bg-rose-50/40",
    neutral: "ring-neutral-200 bg-white",
  };
  const numberToneClass: Record<typeof tone, string> = {
    ok: "text-emerald-800",
    warn: "text-amber-800",
    alert: "text-rose-800",
    neutral: "text-neutral-900",
  };
  return (
    <div
      className={`rounded-xl ring-1 px-4 py-3 ${toneClass[tone]}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${numberToneClass[tone]}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
