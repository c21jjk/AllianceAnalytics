import { requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import AgentsTable from "@/components/AgentsTable";
import { getAgentRoster } from "@/lib/data/agent-roster";

export const metadata = { title: "Agents — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Agent roster: every agent, the headshot and phone we would actually print
 * for them, and a way to fill in whatever is missing.
 *
 * 2026-08-14 (John): "if an Agent doesnt have a head shot or phone # in the
 * database, I need us (me, Cheryl and larissa) to be able to add it somehow
 * and have it save in database."
 *
 * requireUser, not requireAdmin — John asked for this to be visible to all
 * three of them. It is reachable from the account menu rather than the top
 * nav because the nav is deliberately capped at six tabs (see the tombstone
 * in components/nav-config.tsx), and from the open house pre-flight, which is
 * where a missing headshot is usually noticed.
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; inactive?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const includeInactive = params.inactive === "1";
  const filter =
    params.filter === "missing" || params.filter === "missing_photo"
      ? params.filter
      : "all";

  const roster = await getAgentRoster({ includeInactive });

  const rows =
    filter === "missing"
      ? roster.rows.filter((r) => !r.headshot_url || !r.effective_phone)
      : filter === "missing_photo"
        ? roster.rows.filter((r) => !r.headshot_url)
        : roster.rows;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        eyebrow={`Agents · ${roster.counts.total} active`}
        title="Agents"
        description="The headshot and phone number each agent's posts will use. Anything missing here shows up as a blank on an open house slide, so fill it in and it saves straight to the database."
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="On the roster" value={roster.counts.total} />
        <SummaryTile
          label="No headshot"
          value={roster.counts.missingPhoto}
          tone={roster.counts.missingPhoto > 0 ? "warn" : "ok"}
        />
        <SummaryTile
          label={
            roster.phoneLookupAvailable
              ? "No phone number"
              : "Phone check unavailable"
          }
          value={roster.phoneLookupAvailable ? roster.counts.missingPhone : 0}
          tone={
            !roster.phoneLookupAvailable
              ? "neutral"
              : roster.counts.missingPhone > 0
                ? "warn"
                : "ok"
          }
        />
      </div>

      {!roster.phoneLookupAvailable ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The Alliance Dash roster is not reachable right now, so phone numbers
          below only reflect what is stored here. An agent shown without one may
          still have a number that prints fine on a slide.
        </div>
      ) : null}

      <AgentsTable
        rows={rows}
        headshotLabels={roster.headshotLabels}
        activeFilter={filter}
        includeInactive={includeInactive}
        missingCount={roster.counts.missingEither}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "ok"
        ? "text-emerald-700"
        : "text-neutral-900";
  return (
    <div className="card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
