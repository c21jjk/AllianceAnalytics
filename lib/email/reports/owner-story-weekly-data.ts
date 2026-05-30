import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getOrCreateStoryTokenForProperty,
  fetchOwnerStoryByToken,
} from "@/lib/data/owner-story-db";
import { fetchPortalStrip } from "@/lib/data/portal-metrics-db";

/**
 * Data layer for the weekly Owner Story email to listing agents.
 *
 * Rules (per John, 2026-05-29):
 *   - Email the LISTING AGENT every Monday morning.
 *   - Only once the listing has been promoted for AT LEAST one week
 *     (>= 7 days since its first social post).
 *   - Keep re-sending every Monday until the listing leaves "active"
 *     (status flips to pending, sold, or it expires) — at which point it
 *     drops out of the eligible set automatically.
 *
 * Idempotency is enforced by `owner_story_email_sends` (UNIQUE report_id,
 * week_start): a listing gets at most one Owner Story email per Monday.
 *
 * Co-op buyer-side rows (alliance_role NOT IN listing/both) are skipped —
 * Alliance only reports on its own listings.
 */

/** Minimum days since the first post before the first Owner Story email. */
const MIN_DAYS_SINCE_FIRST_POST = 7;

const APP_BASE_URL = "https://alliance-analytics.vercel.app";

/**
 * `owner_story_email_sends` is new and not yet in the generated `Database`
 * type, so reads/writes to it use a permissive client (cast through unknown).
 * Regenerate types via Supabase CLI/MCP after this lands to fold it in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;
function untypedClient(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

export interface OwnerStoryEmailCandidate {
  report_id: string;
  property_id: string;
  token: string;
  story_url: string;
  address: string;
  city: string | null;
  agent_name: string | null;
  agent_email: string;
  hero_image_url: string | null;
  social_reach: number;
  post_count: number;
  portal_views: number;
  days_running: number;
  /** Monday (ET) of the send week, ISO 'YYYY-MM-DD'. */
  week_start: string;
}

/**
 * Monday (America/New_York) of the week containing `now`, as 'YYYY-MM-DD'.
 * Used as the idempotency key so all of a Monday's sends share one week_start.
 */
export function etMondayIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[get("weekday")] ?? 1;
  const base = Date.UTC(y, m - 1, d);
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return new Date(base - daysSinceMonday * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

interface ActivePropertyRow {
  id: string;
  alliance_role: string;
}

interface MlsAgentRow {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
}

/**
 * Normalize a name fragment for matching: lowercase, drop parenthetical
 * nicknames ("Kathleen(Kathy)" → "kathleen"), strip punctuation/middle
 * initials, collapse whitespace.
 */
function normalizeNamePart(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[.,]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Build a "first|last" key from a full name, or null if it can't be parsed. */
function nameKeyFromFullName(fullName: string): string | null {
  const cleaned = normalizeNamePart(fullName);
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}|${parts[parts.length - 1]}`;
}

/**
 * Build a resolver: normalized "first|last" name → the single agent email,
 * but ONLY when that key maps to exactly one distinct non-null email. Names
 * that collide across multiple real emails are treated as unresolvable
 * (skipped) so we never email the wrong agent a seller's story.
 *
 * Exists because properties.agent_email is unreliable (the RETS property sync
 * writes NULL), while mls_agents carries the real emails — but the only bridge
 * between the two tables is the agent's name.
 */
function buildAgentEmailResolver(
  agents: MlsAgentRow[],
): (agentName: string | null) => string | null {
  const keyToEmails = new Map<string, Set<string>>();
  for (const a of agents) {
    const email = a.email?.trim();
    if (!email) continue;
    let key: string | null = null;
    if (a.first_name && a.last_name) {
      key = `${normalizeNamePart(a.first_name)}|${normalizeNamePart(a.last_name)}`;
    } else if (a.full_name) {
      key = nameKeyFromFullName(a.full_name);
    }
    if (!key || key === "|") continue;
    const set = keyToEmails.get(key) ?? new Set<string>();
    set.add(email.toLowerCase());
    keyToEmails.set(key, set);
  }

  // Keep a representative original-case email per unambiguous key.
  const keyToEmail = new Map<string, string>();
  for (const a of agents) {
    const email = a.email?.trim();
    if (!email) continue;
    let key: string | null = null;
    if (a.first_name && a.last_name) {
      key = `${normalizeNamePart(a.first_name)}|${normalizeNamePart(a.last_name)}`;
    } else if (a.full_name) {
      key = nameKeyFromFullName(a.full_name);
    }
    if (!key) continue;
    if ((keyToEmails.get(key)?.size ?? 0) === 1 && !keyToEmail.has(key)) {
      keyToEmail.set(key, email);
    }
  }

  return (agentName: string | null): string | null => {
    if (!agentName) return null;
    const key = nameKeyFromFullName(agentName);
    if (!key) return null;
    return keyToEmail.get(key) ?? null;
  };
}

/**
 * Find every active listing whose Owner Story is due to be emailed to its
 * listing agent this week. Returns fully-resolved candidates; the orchestrator
 * just renders + sends + records.
 */
export async function findEligibleOwnerStoryEmails(
  now: Date = new Date(),
): Promise<OwnerStoryEmailCandidate[]> {
  const supabase = createAdminClient();
  const weekStart = etMondayIso(now);

  // 1) Active, Alliance-listed properties.
  const { data: propRowsRaw, error: propErr } = await supabase
    .from("properties")
    .select("id, alliance_role")
    .eq("status", "active");
  if (propErr || !propRowsRaw) return [];
  const activeProps = (propRowsRaw as ActivePropertyRow[]).filter(
    (p) => p.alliance_role === "listing" || p.alliance_role === "both",
  );
  if (activeProps.length === 0) return [];

  // 2) Already-sent reports for this week → skip.
  const { data: sentRows } = await untypedClient()
    .from("owner_story_email_sends")
    .select("report_id")
    .eq("week_start", weekStart);
  const sentReportIds = new Set(
    ((sentRows ?? []) as Array<{ report_id: string }>).map((r) => r.report_id),
  );

  // 2b) Agent-email resolver (properties.agent_email is unreliable; fall back
  // to an unambiguous name match against mls_agents).
  const { data: agentRows } = await supabase
    .from("mls_agents")
    .select("first_name, last_name, full_name, email");
  const resolveAgentEmail = buildAgentEmailResolver(
    (agentRows ?? []) as MlsAgentRow[],
  );

  // 3) Resolve each property → token → hydrated story → eligibility.
  const candidates: OwnerStoryEmailCandidate[] = [];
  for (const prop of activeProps) {
    let token: string | null = null;
    try {
      token = await getOrCreateStoryTokenForProperty(prop.id);
    } catch {
      token = null;
    }
    if (!token) continue;

    const story = await fetchOwnerStoryByToken(token);
    if (!story) continue;

    // Eligibility gates.
    if (story.listing.status !== "active") continue;
    if (sentReportIds.has(story.report_id)) continue;
    const agentEmail =
      story.listing.agent_email?.trim() ||
      resolveAgentEmail(story.listing.agent_name) ||
      "";
    if (!agentEmail) continue;
    if (
      story.days_since_launch === null ||
      story.days_since_launch < MIN_DAYS_SINCE_FIRST_POST
    ) {
      continue;
    }
    if (story.totals.post_count === 0) continue;

    // Portal views — best-effort headline metric (since first post). Never
    // let a portal-read hiccup drop the listing from the send.
    let portalViews = 0;
    try {
      if (story.listing.source_mls) {
        const strip = await fetchPortalStrip(
          story.listing.mls_number,
          story.listing.source_mls,
          { since: story.first_post_at },
        );
        portalViews = strip.total_views;
      }
    } catch {
      portalViews = 0;
    }

    candidates.push({
      report_id: story.report_id,
      property_id: prop.id,
      token,
      story_url: `${APP_BASE_URL}/home/${token}`,
      address: story.listing.address ?? "your listing",
      city: story.listing.city,
      agent_name: story.listing.agent_name,
      agent_email: agentEmail,
      hero_image_url: story.listing.hero_image_url,
      social_reach: story.totals.reach,
      post_count: story.totals.post_count,
      portal_views: portalViews,
      days_running: story.days_since_launch,
      week_start: weekStart,
    });
  }

  return candidates;
}

/**
 * Record a send (idempotent upsert on report_id + week_start). Writing the row
 * is what makes the next cron pass — or a retry — skip this listing for the
 * week.
 */
export async function recordOwnerStorySend(input: {
  report_id: string;
  property_id: string;
  week_start: string;
  recipient_email: string;
  social_reach: number;
  portal_views: number;
  post_count: number;
  last_error?: string | null;
}): Promise<void> {
  await untypedClient().from("owner_story_email_sends").upsert(
    {
      report_id: input.report_id,
      property_id: input.property_id,
      week_start: input.week_start,
      recipient_email: input.recipient_email,
      social_reach: input.social_reach,
      portal_views: input.portal_views,
      post_count: input.post_count,
      sent_at: new Date().toISOString(),
      last_error: input.last_error ?? null,
    },
    { onConflict: "report_id,week_start" },
  );
}
