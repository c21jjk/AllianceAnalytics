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
      bcc: input.bcc,
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
