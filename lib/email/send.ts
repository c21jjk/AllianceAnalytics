/**
 * lib/email/send.ts
 *
 * Server-side email helper backed by Resend.
 *
 * Centralized so every outbound email — reports, alerts, notifications —
 * flows through one place with consistent From / Reply-To / error handling.
 *
 * From: Alliance Social Analytics <SocialMediaReport@c21anj.com>
 *   (Google Workspace alias on John's primary user; replies land in his inbox.)
 *
 * Domain is verified at Resend; DKIM + SPF + DMARC live in GoDaddy DNS.
 * Server-only — never instantiate in browser code.
 */
import "server-only";
import { Resend } from "resend";

const FROM_ADDRESS = "Alliance Social Analytics <SocialMediaReport@c21anj.com>";

/**
 * 2026-07-17 — John's standing request: BCC him on outbound email so he sees
 * what goes out — ONE copy PER CAMPAIGN, not one per recipient. A "New
 * Listing" announcement blasted to 100 agents loops sendEmail() 100 times
 * with the SAME subject; John gets the FIRST copy only. Dedupe is by
 * normalized subject with a 6-hour window (a batch loop runs inside one
 * invocation, so the module-level map reliably collapses it; the window
 * lets tomorrow's same-subject campaign reach him again). Skipped when he's
 * already a direct recipient (to/cc) of that message.
 */
const GLOBAL_BCC = "jkcrumb@me.com";
const GLOBAL_BCC_WINDOW_MS = 6 * 3600_000;
const bccSeenSubjects = new Map<string, number>();

function withGlobalBcc(
  to: string | string[],
  cc: string | string[] | undefined,
  bcc: string | string[] | undefined,
  subject: string,
): string[] | undefined {
  const norm = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const lower = (s: string) => s.trim().toLowerCase();
  const merged = norm(bcc);

  const alreadyRecipient = [...norm(to), ...norm(cc), ...merged].some((addr) =>
    lower(addr).includes(lower(GLOBAL_BCC)),
  );
  if (alreadyRecipient) return merged.length > 0 ? merged : undefined;

  const key = lower(subject);
  const now = Date.now();
  const lastSent = bccSeenSubjects.get(key);
  if (lastSent !== undefined && now - lastSent < GLOBAL_BCC_WINDOW_MS) {
    // Same campaign, later recipient — John already has his copy.
    return merged.length > 0 ? merged : undefined;
  }
  bccSeenSubjects.set(key, now);
  // Opportunistic cleanup so a long-lived instance doesn't grow the map.
  if (bccSeenSubjects.size > 500) {
    for (const [k, t] of bccSeenSubjects) {
      if (now - t > GLOBAL_BCC_WINDOW_MS) bccSeenSubjects.delete(k);
    }
  }
  return [...merged, GLOBAL_BCC];
}

let _client: Resend | null = null;

function getClient(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "RESEND_API_KEY is not set — cannot send email. Check Vercel env vars."
    );
  }
  _client = new Resend(key);
  return _client;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  /** Free-form tag for grouping in Resend's dashboard, e.g. "weekly-report". */
  tag?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via Resend. Returns a result object rather than throwing
 * so callers can decide whether a failed send should block the caller.
 */
export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  if (!input.html && !input.text) {
    return { ok: false, error: "Either html or text body is required." };
  }

  try {
    const client = getClient();
    const { data, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to: input.to,
      subject: input.subject,
      html: input.html ?? "",
      text: input.text,
      cc: input.cc,
      bcc: withGlobalBcc(input.to, input.cc, input.bcc, input.subject),
      replyTo: input.replyTo,
      tags: input.tag ? [{ name: "category", value: input.tag }] : undefined,
    });

    if (error) {
      return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: true, messageId: data?.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", msg);
    return { ok: false, error: msg };
  }
}
