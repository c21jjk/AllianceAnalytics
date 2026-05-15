import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  AgentOutboxRow,
  OutboxCounts,
  OutboxNotificationType,
} from "./agent-outbox-shared";

/**
 * Server-only data layer for the agent-notification outbox (Phase 5).
 *
 * The outbox is the staging table between "Larissa publishes a post" and
 * "the listing agent gets pinged to reshare it." Pure types and the mailto
 * template builder live in `agent-outbox-shared.ts` so client components
 * can import them safely.
 *
 * Read side: list pending rows, count for badge UI.
 * Write side: `createOutboxRowForPost` (idempotent per generated_post_id),
 * plus `markOutboxAcknowledged` for the mailto-click handshake, plus
 * `backfillStatusFlipOutbox` for the status-flip auto-detection path.
 */

// Re-export the client-safe types so existing imports keep working without
// every consumer needing to switch to the shared file directly.
export type { AgentOutboxRow, OutboxCounts, OutboxNotificationType };
export { buildOutboxMailto } from "./agent-outbox-shared";

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
      "id, notification_type, generated_post_id, property_id, agent_name, agent_email, agent_phone, created_at, sent_at, delivery_method, acknowledged_at, caption_snippet, post_urls, thumbnail_url, story_url_path, flip_to_status, flip_at, last_error, properties(mls_number, address)",
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
    const ntype: OutboxNotificationType =
      r.notification_type === "status_flip" ? "status_flip" : "post_published";
    const flipTo =
      r.flip_to_status === "pending" || r.flip_to_status === "sold"
        ? r.flip_to_status
        : null;
    out.push({
      id: r.id,
      notification_type: ntype,
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
      flip_to_status: flipTo,
      flip_at: r.flip_at,
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
 * Detect listings that have flipped to pending/sold within the lookback
 * window and drop a status_flip outbox row for any that don't already
 * have one. Idempotent per (property_id, flip_at) via the unique index
 * — safe to call repeatedly from dashboard load or a cron.
 *
 * Returns the number of new rows inserted.
 */
export async function backfillStatusFlipOutbox(opts: {
  daysBack?: number;
} = {}): Promise<number> {
  const daysBack = opts.daysBack ?? 3;
  const cutoffIso = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const supabase = createAdminClient();

  // Pull recent flips. Same query shape as recent-status-flips.ts; we
  // re-query here to keep the helper self-contained (this function will
  // also be the entry point for an eventual Vercel cron).
  const { data: flips, error: flipErr } = await supabase
    .from("properties")
    .select(
      "id, mls_number, status, status_changed_at, agent_name, agent_email, agent_phone, hero_image_url",
    )
    .in("status", ["pending", "sold"])
    .gte("status_changed_at", cutoffIso);
  if (flipErr || !flips || flips.length === 0) return 0;

  // Pull the story tokens for those properties in one go.
  const propertyIds = flips.map((f) => f.id);
  const { data: reports } = await supabase
    .from("reports")
    .select("property_id, report_token")
    .in("property_id", propertyIds);
  const tokenByProp = new Map<string, string>();
  for (const r of (reports ?? []) as Array<{
    property_id: string;
    report_token: string;
  }>) {
    tokenByProp.set(r.property_id, r.report_token);
  }

  let inserted = 0;
  for (const f of flips) {
    const flipAt = f.status_changed_at;
    const flipTo = f.status === "sold" ? "sold" : "pending";
    const token = tokenByProp.get(f.id);
    const storyPath = token ? `/home/${token}` : null;

    // Insert; rely on the unique partial index for idempotency. We swallow
    // duplicate-key errors so re-running this is safe and silent.
    const { error: insErr } = await supabase
      .from("agent_post_outbox")
      .insert({
        notification_type: "status_flip",
        property_id: f.id,
        generated_post_id: null,
        agent_name: f.agent_name,
        agent_email: f.agent_email,
        agent_phone: f.agent_phone,
        caption_snippet:
          flipTo === "sold"
            ? `Listing closed on ${formatIsoShort(flipAt)}.`
            : `Listing went under contract on ${formatIsoShort(flipAt)}.`,
        post_urls: [] as unknown as Json,
        thumbnail_url: f.hero_image_url,
        story_url_path: storyPath,
        flip_to_status: flipTo,
        flip_at: flipAt,
      });
    if (!insErr) inserted += 1;
    else if (
      insErr.message &&
      !insErr.message.toLowerCase().includes("duplicate")
    ) {
      console.error("[outbox] status_flip insert error:", insErr.message);
    }
  }
  return inserted;
}

function formatIsoShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
