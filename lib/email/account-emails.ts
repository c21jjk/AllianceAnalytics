/**
 * lib/email/account-emails.ts
 *
 * Account invite + password reset emails. Both carry a one-time link minted
 * by lib/auth-links/account-links.ts and land on /set-password.
 *
 * 2026-09-19 (John): "remove all the additional wording... Minimal verbiage."
 * Header, one line, one button. Nothing else.
 *
 * Both send with skipGlobalBcc: the link IS the credential until it's used,
 * so it goes to the account holder's inbox and nowhere else.
 */
import "server-only";
import { sendEmail, type SendEmailResult } from "@/lib/email/send";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName: string | null | undefined): string | null {
  const n = (fullName ?? "").trim().split(/\s+/)[0];
  return n ? n : null;
}

function shell(a: { headline: string; buttonLabel: string; url: string }): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#FCFCFB;font-family:Barlow,Helvetica,Arial,sans-serif;color:#18181B;">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E5E2;border-radius:12px;overflow:hidden;">
      <div style="background:#252526;padding:22px 24px;border-bottom:3px solid #C9A84C;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#C9A84C;">
          Century 21 Alliance
        </div>
        <div style="margin-top:4px;font-size:20px;font-weight:600;color:#FFFFFF;">
          Alliance Social Analytics
        </div>
      </div>
      <div style="padding:28px 24px 30px;">
        <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#18181B;">
          ${a.headline}
        </p>
        <a href="${a.url}" style="display:inline-block;background:#C9A84C;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">
          ${a.buttonLabel}
        </a>
      </div>
    </div>
  </body>
</html>`;
}

export async function sendInviteEmail(args: {
  to: string;
  fullName: string | null;
  inviterName: string | null;
  url: string;
}): Promise<SendEmailResult> {
  const name = firstName(args.fullName);
  const inviter = firstName(args.inviterName);
  const headline = name
    ? `Hi ${name}, your account is ready.`
    : "Your account is ready.";

  return sendEmail({
    to: args.to,
    subject: inviter
      ? `${inviter} invited you to Alliance Social Analytics`
      : "Your Alliance Social Analytics account is ready",
    html: shell({
      headline: escapeHtml(headline),
      buttonLabel: "Create your password",
      url: args.url,
    }),
    text: `${headline}\n\nCreate your password: ${args.url}`,
    tag: "account-invite",
    skipGlobalBcc: true,
  });
}

export async function sendPasswordResetEmail(args: {
  to: string;
  fullName: string | null;
  url: string;
}): Promise<SendEmailResult> {
  const name = firstName(args.fullName);
  const headline = name
    ? `Hi ${name}, reset your password here.`
    : "Reset your password here.";

  return sendEmail({
    to: args.to,
    subject: "Reset your Alliance Social Analytics password",
    html: shell({
      headline: escapeHtml(headline),
      buttonLabel: "Reset your password",
      url: args.url,
    }),
    text: `${headline}\n\n${args.url}`,
    tag: "account-password-reset",
    skipGlobalBcc: true,
  });
}
