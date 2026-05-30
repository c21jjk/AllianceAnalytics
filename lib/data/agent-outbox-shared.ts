/**
 * Client-safe outbox helpers and types.
 *
 * Lives separately from `agent-outbox-db.ts` (which is `server-only` because
 * it talks to the Supabase admin client) so client components like
 * AgentOutboxTable can import the row type + the mailto-template builder
 * without dragging the server-only guard into a "use client" bundle.
 *
 * Pure functions only — no I/O, no env vars, no Supabase. If you find
 * yourself reaching for those, the new code belongs in agent-outbox-db.ts.
 */

export type OutboxNotificationType = "post_published" | "status_flip";

export interface AgentOutboxRow {
  id: string;
  notification_type: OutboxNotificationType;
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
  /** status_flip only: which status the property flipped TO. */
  flip_to_status: "pending" | "sold" | null;
  /** status_flip only: timestamp of the flip from properties.status_changed_at. */
  flip_at: string | null;
  last_error: string | null;
}

export interface OutboxCounts {
  total_pending: number;
  total_acknowledged: number;
  /** Pending and missing the email needed to deliver. */
  blocked_no_email: number;
}

/**
 * Build the mailto template (subject + body) for an outbox row. Pure
 * function so the client component can call it without an extra round-trip.
 * Branches by notification_type:
 *   - post_published → "we just posted, please reshare"
 *   - status_flip    → "your listing flipped, here's the seller link"
 */
export function buildOutboxMailto(row: AgentOutboxRow): {
  href: string | null;
  subject: string;
  body: string;
} {
  const firstName = row.agent_name?.split(" ")[0] ?? "there";
  const addressLabel =
    row.property_address ?? row.property_mls ?? "your listing";

  let subject: string;
  const lines: string[] = [`Hey ${firstName},`, ""];

  if (row.notification_type === "status_flip") {
    const flipLabel =
      row.flip_to_status === "sold" ? "SOLD" : "Under Contract";
    subject = `${addressLabel} just went ${flipLabel}`;
    lines.push(
      row.flip_to_status === "sold"
        ? `Congratulations — ${addressLabel} just closed. That's a real win.`
        : `Great news — ${addressLabel} just went under contract. Big step.`,
    );
    lines.push("");
    lines.push(
      "Here's the Owner Story page for your seller — feel free to forward it. The page automatically reframes for the new status:",
    );
    if (row.story_url_path) {
      lines.push(
        `  https://www.alliancesocialanalytics.com${row.story_url_path}`,
      );
    }
    lines.push("");
    lines.push(
      row.flip_to_status === "sold"
        ? "We'll keep the page live as the final campaign recap. Nice work."
        : "We'll keep posting through closing — let us know if you want anything specific.",
    );
  } else {
    subject = `Just posted — ${addressLabel}`;
    lines.push(
      `Wanted to give you a heads up — Alliance Social just put a fresh post out for ${addressLabel}.`,
    );
    lines.push("");
    lines.push(
      "If you can, please reshare it on your own story so it gets in front of your sphere too:",
    );
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
        `  https://www.alliancesocialanalytics.com${row.story_url_path}`,
      );
    }
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
