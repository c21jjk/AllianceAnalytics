import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/test
 *
 * Smoke-test endpoint. Sends a Resend round-trip to one of the allowlisted
 * admin addresses so we can verify deliverability end-to-end without needing
 * to wire up a real notification path first.
 *
 * Admin-gated to prevent ad-hoc triggering. Recipient is selected via the
 * POST body `{ to?: string }` but MUST match an entry in ALLOWED_RECIPIENTS;
 * anything else returns 400. This keeps the endpoint from being repurposed
 * to mail arbitrary addresses while still letting us pick which admin
 * inbox to target from the settings UI.
 *
 * If `to` is omitted, defaults to the first entry in ALLOWED_RECIPIENTS so
 * curl-based smoke tests still work with no body.
 */

const ALLOWED_RECIPIENTS = new Set<string>([
  "c21jjk@gmail.com",
  "larissa@c21anj.com",
]);

const DEFAULT_RECIPIENT = "c21jjk@gmail.com";

export async function POST(request: Request) {
  await requireAdmin();

  // Tolerate an empty body for curl-based smoke testing.
  let toRaw: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { to?: unknown };
    if (typeof body.to === "string") toRaw = body.to.trim();
  } catch {
    // No body — fall through to default recipient.
  }

  const recipient = toRaw && toRaw.length > 0 ? toRaw : DEFAULT_RECIPIENT;
  if (!ALLOWED_RECIPIENTS.has(recipient)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Recipient ${recipient} is not in the allowlist.`,
      },
      { status: 400 },
    );
  }

  const env = process.env.VERCEL_ENV ?? "local";
  const sentAt = new Date().toISOString();

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:24px;background:#f5f5f5;font-family:'Barlow',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#252526;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
          <div style="background:#252526;padding:20px 24px;">
            <div style="color:#C9A84C;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">
              Alliance Social Analytics
            </div>
            <div style="color:#ffffff;font-size:18px;font-weight:600;margin-top:4px;">
              Resend smoke test
            </div>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#252526;">
              If you can read this, Resend is wired correctly and emails are flowing from
              <strong>SocialMediaReport@c21anj.com</strong>.
            </p>
            <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;color:#3f3f46;">
              <tr>
                <td style="padding:6px 0;width:120px;color:#71717a;">Environment</td>
                <td style="padding:6px 0;font-weight:600;">${env}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#71717a;">Sent at</td>
                <td style="padding:6px 0;font-weight:600;">${sentAt}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#71717a;">Recipient</td>
                <td style="padding:6px 0;font-weight:600;">${recipient}</td>
              </tr>
            </table>
            <p style="margin:20px 0 0 0;font-size:12px;color:#71717a;line-height:1.5;">
              Triggered from /settings → Email diagnostics. Reply to this email to verify
              that the alias forwards to John's inbox.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = [
    "Alliance Social Analytics — Resend smoke test",
    "",
    "If you can read this, Resend is wired correctly and emails are flowing",
    "from SocialMediaReport@c21anj.com.",
    "",
    `Environment: ${env}`,
    `Sent at:     ${sentAt}`,
    `Recipient:   ${recipient}`,
    "",
    "Triggered from /settings → Email diagnostics. Reply to this email to",
    "verify that the alias forwards to John's inbox.",
  ].join("\n");

  const result = await sendEmail({
    to: recipient,
    subject: "Resend smoke test — Alliance Social Analytics",
    html,
    text,
    tag: "smoke-test",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
