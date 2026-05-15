import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/**
 * Data + helper layer for the agent-notification outbox (Phase 5).
 *
 * The outbox is the staging table between "Larissa publishes a post" and
 * "the listing agent gets pinged to reshare it." It exists so that:
 *
 *   1. We capture the notification intent the moment the publish succeeds —
 *      even if delivery (mailto, Resend) happens later or fails.
 *   2. The interim mailto-driven flow has a single source of truth that
 *      Phase 6 can swap in Resend behind without touching consumers.
 *   3. We get an audit trail per published post showing whether the agent
 *      was notified, when, by what method, and whether they acknowledged.
 *
 * Read side: list pending rows, count for badge UI.
 * Write side: `createOutboxRowForPost` (idempotent per generated_post_id),
 * plus `markOutboxAcknowledged` for the mailto-click handshake.
 */

export interface AgentOutboxRow {
  id: string;
  generated_post_id: string | null;
  property_id: string | null;
  property_mls: string | null;
  property_address: string | null;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  created_at: string;
  sent_at: string | null;
  delivery_method: string | null;
  acknowledged_at: string | null;
  caption_snippet: string | null;
  post_urls: string[];
  thumbnail_url: string | null;
  story_url_path: string | null;
  last_error: string | null;
}

export interface OutboxCounts {
  total_pending: number;
  total_acknowledged: number;
  /** Pending and missing the email needed to deliver. */
  blocked_no_email: number;
}

interface PostUrlEntry {
  platform: "facebook" | "instagram" | "tiktok";
  url: string;
}

function parseUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") out.push(entry);
    else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as PostUrlEntry).url === "string"
    ) {
      out.push((entry as PostUrlEntry).url);
    }
  }
  return out;
}

/**
 * Create one outbox row for a freshly-published generated_post. Idempotent
 * per `generated_post_id` — repeated calls (e.g. user re-publishes after a
 * partial failure) update the same row instead of stacking duplicates.
 *
 * Snapshots the agent contact + listing address + post URLs at notification
 * time. If the property has no agent_email, the row still gets created so
 * the admin pending view can surface "agent email missing — fill in".
 */
export async function createOutboxRowForPost(args: {
  generated_post_id: string;
  property_id: string;
  post_urls: PostUrlEntry[];
  caption: string | null;
  thumbnail_url: string | null;
}): Promise<{ id: string } | { error: string }> {
  if (!args.generated_post_id || !args.property_id) {
    return { error: "missing generated_post_id or property_id" };
  }

  const supabase = createAdminClient();

  // Look up the property + its current Owner Story token in parallel.
  const [propRes, reportRes] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, mls_number, address, agent_name, agent_email, agent_phone",
      )
      .eq("id", args.property_id)
      .maybeSingle(),
    supabase
      .from("reports")
      .select("report_token")
      .eq("property_id", args.property_id)
      .order("generated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (propRes.error || !propRes.data) {
    return { error: propRes.error?.message ?? "property not found" };
  }
  const prop = propRes.data;
  const storyToken = reportRes.data?.report_token ?? null;

  const captionSnippet = (args.caption ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);

  // Idempotency: upsert by generated_post_id. If a row already exists for
  // this post we refresh content snapshot + URLs but PRESERVE sent_at /
  // acknowledged_at so we don't lose the delivery history.
  const { data: existing } = await supabase
    .from("agent_post_outbox")
    .select("id")
    .eq("generated_post_id", args.generated_post_id)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await supabase
      .from("agent_post_outbox")
      .update({
        property_id: prop.id,
        agent_name: prop.agent_name,
        agent_email: prop.agent_email,
        agent_phone: prop.agent_phone,
        caption_snippet: captionSnippet,
        // Postgrest typing wants a Json union; the runtime accepts our array
        // of {platform,url} objects without complaint.
        post_urls: args.post_urls as unknown as Json,
        thumbnail_url: args.thumbnail_url,
        story_url_path: storyToken ? `/home/${storyToken}` : null,
      })
      .eq("id", existing.id);
    if (updErr) return { error: updErr.message };
    return { id: existing.id };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("agent_post_outbox")
    .insert({
      generated_post_id: args.generated_post_id,
      property_id: prop.id,
      agent_name: prop.agent_name,
      agent_email: prop.agent_email,
      agent_phone: prop.agent_phone,
      caption_snippet: captionSnippet,
      post_urls: args.post_urls as unknown as Json,
      thumbnail_url: args.thumbnail_url,
      story_url_path: storyToken ? `/home/${storyToken}` : null,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return { error: insErr?.message ?? "insert failed" };
  }
  return { id: inserted.id };
}

/**
 * Mark an outbox row as acknowledged. Called when Larissa clicks the
 * "Notify [Agent]" mailto button — that's our interim proxy for "the
 * notification went out." When Resend lands in Phase 6, sent_at gets set
 * separately and acknowledged_at becomes the post-receipt timestamp.
 */
export async function markOutboxAcknowledged(args: {
  id: string;
  acknowledged_by: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!args.id) return { error: "missing outbox id" };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("agent_post_outbox")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: args.acknowledged_by,
      delivery_method: "mailto",
      sent_at: new Date().toISOString(),
    })
    .eq("id", args.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * List rows for the admin pending-notifications view. Newest first; joins
 * the property's MLS + address so the view doesn't need a second query.
 */
export async function fetchOutboxRows(opts: {
  limit?: number;
  onlyPending?: boolean;
} = {}): Promise<AgentOutboxRow[]> {
  const supabase = createAdminClient();
  const limit = opts.limit ?? 50;

  let query = supabase
    .from("agent_post_outbox")
    .select(
      "id, generated_post_id, property_id, agent_name, agent_email, agent_phone, created_at, sent_at, delivery_method, acknowledged_at, caption_snippet, post_urls, thumbnail_url, story_url_path, last_error, properties(mls_number, address)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.onlyPending) {
    query = query.is("sent_at", null);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  type Row = (typeof data)[number];
  const out: AgentOutboxRow[] = [];
  for (const r of data as Row[]) {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    out.push({
      id: r.id,
      generated_post_id: r.generated_post_id,
      property_id: r.property_id,
      property_mls: prop?.mls_number ?? null,
      property_address: prop?.address ?? null,
      agent_name: r.agent_name,
      agent_email: r.agent_email,
      agent_phone: r.agent_phone,
      created_at: r.created_at,
      sent_at: r.sent_at,
      delivery_method: r.delivery_method,
      acknowledged_at: r.acknowledged_at,
      caption_snippet: r.caption_snippet,
      post_urls: parseUrls(r.post_urls),
      thumbnail_url: r.thumbnail_url,
      story_url_path: r.story_url_path,
      last_error: r.last_error,
    });
  }
  return out;
}

export async function fetchOutboxCounts(): Promise<OutboxCounts> {
  const supabase = createAdminClient();
  try {
    const [pendingRes, ackRes, blockedRes] = await Promise.all([
      supabase
        .from("agent_post_outbox")
        .select("id", { count: "exact", head: true })
        .is("sent_at", null),
      supabase
        .from("agent_post_outbox")
        .select("id", { count: "exact", head: true })
        .not("acknowledged_at", "is", null),
      supabase
        .from("agent_post_outbox")
        .select("id", { count: "exact", head: true })
        .is("sent_at", null)
        .is("agent_email", null),
    ]);
    return {
      total_pending: pendingRes.count ?? 0,
      total_acknowledged: ackRes.count ?? 0,
      blocked_no_email: blockedRes.count ?? 0,
    };
  } catch {
    return { total_pending: 0, total_acknowledged: 0, blocked_no_email: 0 };
  }
}

/**
 * Build the mailto template (subject + body) for an outbox row. Pure
 * function so the client component can call it without an extra round-trip.
 */
export function buildOutboxMailto(row: AgentOutboxRow): {
  href: string | null;
  subject: string;
  body: string;
} {
  const firstName = row.agent_name?.split(" ")[0] ?? "there";
  const addressLabel =
    row.property_address ?? row.property_mls ?? "your listing";
  const subject = `Just posted — ${addressLabel}`;
  const lines: string[] = [
    `Hey ${firstName},`,
    "",
    `Wanted to give you a heads up — Alliance Social just put a fresh post out for ${addressLabel}.`,
    "",
    "If you can, please reshare it on your own story so it gets in front of your sphere too:",
  ];
  if (row.post_urls.length > 0) {
    for (const url of row.post_urls) {
      lines.push(`  • ${url}`);
    }
  } else {
    lines.push(`  • (live post links are attaching shortly)`);
  }
  if (row.story_url_path) {
    lines.push("");
    lines.push(`Owner Story page for the seller (forward this too):`);
    lines.push(
      `  https://alliance-analytics.vercel.app${row.story_url_path}`,
    );
  }
  lines.push("");
  lines.push("— The Alliance Social team");

  const body = lines.join("\n");
  const href = row.agent_email
    ? `mailto:${row.agent_email}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(body)}`
    : null;

  return { href, subject, body };
}
