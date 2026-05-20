import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data layer for `email_subscribers` — the single source of truth for who
 * receives which transactional / digest emails sent by Alliance Social
 * Analytics. Replaces the old hardcoded WEEKLY_REPORT_RECIPIENTS constant.
 *
 * Two categories share the table:
 *   - 'leadership' — manually-entered admin/manager rows. mls_agent_id is null.
 *   - 'agent'      — imported from mls_agents (the MLS roster). mls_agent_id
 *                    back-points to the source row so future MLS sync passes
 *                    can keep names/emails fresh.
 *
 * Subscription flags are independent booleans — each row can opt into any
 * combination of receives_weekly_social_report / receives_owner_story /
 * receives_office_post_alerts.
 *
 * All access is gated server-side. The settings UI uses requireAdmin().
 */

export type SubscriberCategory = "leadership" | "agent";

export interface EmailSubscriberRow {
  id: string;
  category: SubscriberCategory;
  name: string;
  email: string;
  mls_agent_id: string | null;
  role: string | null;
  office_id: string | null;
  notes: string | null;
  receives_weekly_social_report: boolean;
  receives_owner_story: boolean;
  receives_office_post_alerts: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriberWithOffice extends EmailSubscriberRow {
  /** Convenience join — `display_name` or `name` from the offices table. */
  office_name: string | null;
}

/**
 * List subscribers, with the linked office's display_name folded in.
 * Sorted: category ('agent' alphabetical, 'leadership' alphabetical).
 */
export async function listSubscribers(): Promise<SubscriberWithOffice[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_subscribers")
    .select(
      "id, category, name, email, mls_agent_id, role, office_id, notes, receives_weekly_social_report, receives_owner_story, receives_office_post_alerts, is_active, created_at, updated_at, offices ( display_name, name )",
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  type Joined = EmailSubscriberRow & {
    offices: { display_name: string | null; name: string | null } | null;
  };
  return (data as unknown as Joined[]).map((row) => ({
    ...row,
    office_name: row.offices?.display_name ?? row.offices?.name ?? null,
  }));
}

/**
 * Just the emails that should receive the weekly social media report.
 * Deduped case-insensitively. Used by the cron + the manual "Send to full
 * distribution" button.
 */
export async function getWeeklySocialReportRecipientEmails(): Promise<
  string[]
> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_subscribers")
    .select("email")
    .eq("is_active", true)
    .eq("receives_weekly_social_report", true);
  if (error || !data) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data) {
    const key = row.email.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(row.email.trim());
  }
  return out;
}

export interface CreateSubscriberInput {
  category: SubscriberCategory;
  name: string;
  email: string;
  role?: string | null;
  office_id?: string | null;
  notes?: string | null;
  mls_agent_id?: string | null;
  receives_weekly_social_report?: boolean;
  receives_owner_story?: boolean;
  receives_office_post_alerts?: boolean;
  is_active?: boolean;
}

export async function createSubscriber(
  input: CreateSubscriberInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_subscribers")
    .insert({
      category: input.category,
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role ?? null,
      office_id: input.office_id ?? null,
      notes: input.notes ?? null,
      mls_agent_id: input.mls_agent_id ?? null,
      receives_weekly_social_report:
        input.receives_weekly_social_report ?? false,
      receives_owner_story: input.receives_owner_story ?? false,
      receives_office_post_alerts: input.receives_office_post_alerts ?? false,
      is_active: input.is_active ?? true,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Insert returned no row." };
  return { ok: true, id: data.id };
}

export interface UpdateSubscriberInput {
  id: string;
  name?: string;
  email?: string;
  role?: string | null;
  office_id?: string | null;
  notes?: string | null;
  receives_weekly_social_report?: boolean;
  receives_owner_story?: boolean;
  receives_office_post_alerts?: boolean;
  is_active?: boolean;
}

export async function updateSubscriber(
  input: UpdateSubscriberInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const patch: {
    name?: string;
    email?: string;
    role?: string | null;
    office_id?: string | null;
    notes?: string | null;
    receives_weekly_social_report?: boolean;
    receives_owner_story?: boolean;
    receives_office_post_alerts?: boolean;
    is_active?: boolean;
  } = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.email !== undefined) patch.email = input.email.trim();
  if (input.role !== undefined) patch.role = input.role;
  if (input.office_id !== undefined) patch.office_id = input.office_id;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.receives_weekly_social_report !== undefined)
    patch.receives_weekly_social_report = input.receives_weekly_social_report;
  if (input.receives_owner_story !== undefined)
    patch.receives_owner_story = input.receives_owner_story;
  if (input.receives_office_post_alerts !== undefined)
    patch.receives_office_post_alerts = input.receives_office_post_alerts;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("email_subscribers")
    .update(patch)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteSubscriber(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("email_subscribers")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Import all active listing-side Alliance agents from properties → mls_agents
 * → email_subscribers. Skips agents already present (matched by lowercase
 * email). Defaults receives_owner_story=true for newly-imported agents —
 * that's the primary reason the agent rows exist.
 *
 * Returns counts so the UI can render "Imported N new agents (M already
 * subscribed)" feedback.
 */
export async function importActiveListingAgents(): Promise<{
  ok: true;
  imported: number;
  skipped: number;
}> {
  const supabase = createAdminClient();

  // Pull distinct (agent_email, agent_name, office_id) tuples from active
  // listings where Alliance owns the listing side. We filter to listing-side
  // only — co-op agents are explicitly out-of-scope per project rules.
  const { data: propRows } = await supabase
    .from("properties")
    .select("agent_email, agent_name, office_id")
    .in("alliance_role", ["listing", "both"])
    .in("status", ["active", "pending"])
    .not("agent_email", "is", null);
  const props = propRows ?? [];

  // Dedupe by lowercase email.
  interface Candidate {
    email: string;
    name: string;
    office_id: string | null;
  }
  const byEmail = new Map<string, Candidate>();
  for (const p of props) {
    if (!p.agent_email) continue;
    const key = p.agent_email.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        email: p.agent_email.trim(),
        name: (p.agent_name ?? p.agent_email).trim(),
        office_id: p.office_id ?? null,
      });
    }
  }

  // Look up matching mls_agents rows for back-pointer + canonical name.
  const { data: mlsRows } = await supabase
    .from("mls_agents")
    .select("id, full_name, email")
    .in("email", Array.from(byEmail.keys()));
  const mlsByEmail = new Map<
    string,
    { id: string; full_name: string; email: string | null }
  >();
  for (const row of mlsRows ?? []) {
    if (row.email) mlsByEmail.set(row.email.trim().toLowerCase(), row);
  }

  // Skip emails already in email_subscribers.
  const { data: existingRows } = await supabase
    .from("email_subscribers")
    .select("email");
  const existing = new Set(
    (existingRows ?? []).map((r) => r.email.trim().toLowerCase()),
  );

  // Build the insert payload.
  const inserts: Array<{
    category: "agent";
    name: string;
    email: string;
    mls_agent_id: string | null;
    role: string;
    office_id: string | null;
    receives_weekly_social_report: boolean;
    receives_owner_story: boolean;
    receives_office_post_alerts: boolean;
    is_active: boolean;
  }> = [];
  let skipped = 0;
  for (const [key, c] of byEmail) {
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    const mls = mlsByEmail.get(key) ?? null;
    inserts.push({
      category: "agent",
      name: mls?.full_name ?? c.name,
      email: c.email,
      mls_agent_id: mls?.id ?? null,
      role: "Listing Agent",
      office_id: c.office_id,
      receives_weekly_social_report: false,
      receives_owner_story: true,
      receives_office_post_alerts: false,
      is_active: true,
    });
  }

  if (inserts.length > 0) {
    await supabase.from("email_subscribers").insert(inserts);
  }

  return { ok: true, imported: inserts.length, skipped };
}
