/**
 * lib/data/alliance-agent-recipient.ts (2026-09-25)
 * ---------------------------------------------------------------------------
 *
 * Single gate for "who, if anyone, gets the agent email for this property."
 *
 * WHY: on 2026-09-25 the instant "your listing is live" email went to the
 * Keller Williams listing agent of 313 E Glenwood, a buyer-side Just Sold
 * (alliance_role = 'buyer'). The outbox copied `properties.agent_email`
 * blind, which is always the LISTING agent whoever they work for. John's
 * rule: agent emails go to Alliance agents only, never to another
 * brokerage. This helper is the one place that rule lives.
 *
 * Rules:
 *   • listing / both (or NULL, which pre-Phase-8 rows coerce to listing
 *     side): the listing agent, but only when the listing office is an
 *     Alliance office. A non-Alliance office means the row is mislabeled
 *     co-op; skip it.
 *   • buyer: the Alliance buyer agent, resolved by name against the Darwin
 *     roster (mls_agents). No roster match = no recipient. The listing
 *     agent on a buyer-side row is never used.
 *
 * Returns null when nobody should be emailed. Callers must treat null as
 * "skip", never fall back to the property's raw agent fields.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { nameKeyFromFullName, normalizeNamePart } from "@/lib/data/agent-email-resolver";

export interface AllianceRecipient {
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  /** Which side of the deal the recipient is on. */
  side: "listing" | "buyer";
}

export interface RecipientPropertyRow {
  alliance_role: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  buyer_agent_name: string | null;
}

export const RECIPIENT_PROPERTY_COLUMNS =
  "alliance_role, listing_office_name, agent_name, agent_email, agent_phone, buyer_agent_name";

/** True when the office string reads as a Century 21 Alliance office. NULL
 *  is allowed through (older rows) because the role check still applies. */
export function isAllianceOffice(office: string | null | undefined): boolean {
  if (office === null || office === undefined) return true;
  const o = office.trim();
  if (o === "") return true;
  return /alliance/i.test(o);
}

/** Skip reason for logs + the admin Outbox view. */
export function coopSkipReason(row: RecipientPropertyRow): string | null {
  const role = (row.alliance_role ?? "listing").toLowerCase();
  if (role === "buyer") {
    return `buyer-side listing (office: ${row.listing_office_name ?? "unknown"})`;
  }
  if (!isAllianceOffice(row.listing_office_name)) {
    return `non-Alliance listing office (${row.listing_office_name})`;
  }
  return null;
}

interface RosterAgent {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  phone_override: string | null;
}

let rosterCache: { loadedAt: number; agents: RosterAgent[] } | null = null;
const ROSTER_TTL_MS = 5 * 60_000;

async function loadRoster(): Promise<RosterAgent[]> {
  if (rosterCache && Date.now() - rosterCache.loadedAt < ROSTER_TTL_MS) {
    return rosterCache.agents;
  }
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("mls_agents")
    .select("first_name, last_name, full_name, email, phone, phone_override")
    .eq("is_active", true);
  const agents = (data ?? []) as unknown as RosterAgent[];
  rosterCache = { loadedAt: Date.now(), agents };
  return agents;
}

function rosterKey(a: RosterAgent): string | null {
  if (a.first_name && a.last_name) {
    return `${normalizeNamePart(a.first_name)}|${normalizeNamePart(a.last_name)}`;
  }
  if (a.full_name) return nameKeyFromFullName(a.full_name);
  return null;
}

/** Find an Alliance roster agent by display name (first|last key). Returns
 *  null on no match or an ambiguous match (two roster agents, same key). */
export async function findRosterAgentByName(
  name: string | null | undefined,
): Promise<RosterAgent | null> {
  if (!name) return null;
  const key = nameKeyFromFullName(name);
  if (!key) return null;
  const roster = await loadRoster();
  const hits = roster.filter((a) => rosterKey(a) === key && !!a.email?.trim());
  if (hits.length !== 1) return null;
  return hits[0];
}

/**
 * Resolve the Alliance recipient for a property row, or null to skip.
 * `agent_email` may still be null for a listing-side row with no known
 * address; callers keep their existing "no email = row created, nothing
 * sent" behavior for that case.
 */
export async function resolveAllianceRecipient(
  row: RecipientPropertyRow,
): Promise<AllianceRecipient | null> {
  const role = (row.alliance_role ?? "listing").toLowerCase();

  if (role === "buyer") {
    const buyer = await findRosterAgentByName(row.buyer_agent_name);
    if (!buyer) return null;
    return {
      agent_name: row.buyer_agent_name,
      agent_email: buyer.email,
      agent_phone: buyer.phone_override ?? buyer.phone ?? null,
      side: "buyer",
    };
  }

  if (!isAllianceOffice(row.listing_office_name)) return null;

  let email = row.agent_email?.trim() || null;
  let phone = row.agent_phone ?? null;
  if (!email) {
    const hit = await findRosterAgentByName(row.agent_name);
    if (hit) {
      email = hit.email;
      phone = phone ?? hit.phone_override ?? hit.phone ?? null;
    }
  }
  return {
    agent_name: row.agent_name,
    agent_email: email,
    agent_phone: phone,
    side: "listing",
  };
}
