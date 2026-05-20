import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { listSubscribers, type SubscriberWithOffice } from "@/lib/data/email-subscribers";
import { listOffices } from "@/lib/data/offices";
import SubscribersAdminClient from "@/components/SubscribersAdminClient";

export const metadata = { title: "Subscribers — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * /settings/subscribers — admin-only management UI for the email_subscribers
 * table. Replaces the hardcoded WEEKLY_REPORT_RECIPIENTS constant.
 *
 * Layout: two clearly-separated sections.
 *   - Leadership — manually-entered admin / owner / manager rows. Editable
 *     name, email, role, office, subscriptions.
 *   - Agents — imported from MLS via the "Import from MLS" button. Grouped
 *     by office so it's easy to see who covers which market.
 *
 * Mutations go through the server actions in ./actions.ts (admin-gated).
 */
export default async function SubscribersPage() {
  await requireAdmin();

  const [subscribers, offices] = await Promise.all([
    listSubscribers(),
    listOffices({ active_only: false }),
  ]);

  const leadership = subscribers.filter((s) => s.category === "leadership");
  const agents = subscribers.filter((s) => s.category === "agent");

  // Group agents by office for the Agents section. Agents without an
  // office linkage get bucketed into "Unassigned".
  const officesByID = new Map(offices.map((o) => [o.id, o] as const));
  const agentsByOffice = new Map<string, SubscriberWithOffice[]>();
  for (const a of agents) {
    const key = a.office_id ?? "__unassigned__";
    if (!agentsByOffice.has(key)) agentsByOffice.set(key, []);
    agentsByOffice.get(key)!.push(a);
  }

  // Stable ordering: by office display name, then "Unassigned" last.
  const orderedOfficeIds = [...agentsByOffice.keys()].sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const an = officesByID.get(a)?.display_name ?? officesByID.get(a)?.name ?? "";
    const bn = officesByID.get(b)?.display_name ?? officesByID.get(b)?.name ?? "";
    return an.localeCompare(bn);
  });

  const officeOptions = offices
    .filter((o) => o.is_active)
    .map((o) => ({ id: o.id, label: o.display_name ?? o.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-10">
      <PageHeader
        title="Subscribers"
        description="Manage who receives the weekly social media report, Owner Stories, and office post alerts."
      />

      <div className="text-sm text-neutral-600">
        <Link href="/settings" className="text-neutral-500 hover:text-gold-700">
          ← Back to Settings
        </Link>
      </div>

      <SubscribersAdminClient
        leadership={leadership}
        agentsByOffice={orderedOfficeIds.map((officeId) => ({
          officeId,
          officeName:
            officeId === "__unassigned__"
              ? "Unassigned"
              : officesByID.get(officeId)?.display_name ??
                officesByID.get(officeId)?.name ??
                "Unknown office",
          agents: agentsByOffice.get(officeId) ?? [],
        }))}
        officeOptions={officeOptions}
      />
    </div>
  );
}
