import "server-only";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * lib/email/listing-note-notification.ts
 *
 * 2026-08-07 (John): "Possible that if a note mentions someone else or is
 * assigned to someone else, that person can be notified via email?"
 *
 * Three kinds of message, one template:
 *   note          someone wrote a note and ticked you in the notify row
 *   hold_set      someone put the listing on hold, do not post it
 *   hold_released the hold came off, it is clear to post
 *
 * Every send is logged to listing_note_emails. An ok=true row for
 * (note_id, recipient_id, kind) suppresses a repeat, so a double click or a
 * retried server action cannot email the same person twice about one note.
 *
 * All of this FAILS OPEN. A note that saved but could not be emailed is a
 * minor problem. A note that refused to save because Resend was down is a
 * real one.
 *
 * Copy style: no em dashes, and the subject leads with the address and the
 * actual point rather than a generic "You have a new notification".
 */

const APP_BASE_URL = "https://www.alliancesocialanalytics.com";

export type NoteEmailKind = "note" | "hold_set" | "hold_released";

export interface NoteEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface SendNoteNotificationsArgs {
  kind: NoteEmailKind;
  mlsNumber: string;
  /** Street address for the subject line. Falls back to the MLS number. */
  address: string | null;
  authorName: string;
  /** Author's address, so a reply reaches a person and not the report alias. */
  authorEmail: string | null;
  /** Note text. Null for a hold toggled without anything written. */
  body: string | null;
  noteId: string | null;
  recipients: NoteEmailRecipient[];
}

/**
 * Sends one email per recipient and returns the names actually reached, so the
 * UI can confirm what happened instead of leaving the writer guessing.
 */
export async function sendListingNoteNotifications(
  args: SendNoteNotificationsArgs,
): Promise<string[]> {
  if (args.recipients.length === 0) return [];

  const supabase = createAdminClient();
  // listing_note_emails is not in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const label = args.address?.trim() || `MLS ${args.mlsNumber}`;
  const propertyUrl = `${APP_BASE_URL}/properties/${encodeURIComponent(
    args.mlsNumber,
  )}`;

  // Which of these people already got this exact message? Only note-kind sends
  // dedupe: a hold can legitimately be set, released, and set again.
  let alreadySent = new Set<string>();
  if (args.noteId) {
    const { data } = await untyped
      .from("listing_note_emails")
      .select("recipient_id")
      .eq("note_id", args.noteId)
      .eq("kind", args.kind)
      .eq("ok", true);
    alreadySent = new Set(
      ((data ?? []) as Array<{ recipient_id: string | null }>)
        .map((r) => r.recipient_id)
        .filter((x): x is string => !!x),
    );
  }

  const notified: string[] = [];

  for (const recipient of args.recipients) {
    if (alreadySent.has(recipient.id)) continue;

    const subject = buildSubject(args.kind, label, args.authorName, args.body);
    const result = await sendEmail({
      to: recipient.email,
      subject,
      html: buildHtml({ ...args, label, propertyUrl, recipient }),
      text: buildText({ ...args, label, propertyUrl, recipient }),
      replyTo: args.authorEmail ?? undefined,
      tag: "listing-note",
    }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));

    // Log the attempt either way. A failed send that leaves no trace is the
    // thing that makes "did Cheryl ever get told?" unanswerable later.
    await untyped
      .from("listing_note_emails")
      .insert({
        note_id: args.noteId,
        mls_number: args.mlsNumber,
        recipient_id: recipient.id,
        recipient_email: recipient.email,
        kind: args.kind,
        ok: result.ok,
        error: result.ok ? null : result.error ?? "unknown",
      })
      .then(
        () => undefined,
        (e: unknown) => {
          console.error("[listing-note-email] log insert failed:", e);
        },
      );

    if (result.ok) notified.push(recipient.name);
    else {
      console.error(
        `[listing-note-email] send failed to ${recipient.email}:`,
        result.error,
      );
    }
  }

  return notified;
}

function buildSubject(
  kind: NoteEmailKind,
  label: string,
  author: string,
  body: string | null,
): string {
  if (kind === "hold_set") {
    return `${label}: ${author} put this on hold, do not post yet`;
  }
  if (kind === "hold_released") {
    return `${label}: ${author} released the hold, clear to post`;
  }
  // Lead with the note itself. A subject that only says "new note" makes
  // everyone open the email to find out whether it mattered.
  const snippet = (body ?? "").replace(/\s+/g, " ").trim();
  const trimmed =
    snippet.length > 70 ? `${snippet.slice(0, 67).trimEnd()}...` : snippet;
  return trimmed
    ? `${label}: ${author} says ${trimmed}`
    : `${label}: note from ${author}`;
}

interface RenderArgs extends SendNoteNotificationsArgs {
  label: string;
  propertyUrl: string;
  recipient: NoteEmailRecipient;
}

function headline(kind: NoteEmailKind, author: string): string {
  if (kind === "hold_set") return `${author} put this listing on hold.`;
  if (kind === "hold_released") return `${author} released the hold.`;
  return `${author} left a note for you.`;
}

function subline(kind: NoteEmailKind): string {
  if (kind === "hold_set") {
    return "Please do not post it until the hold comes off.";
  }
  if (kind === "hold_released") return "It is clear to post.";
  return "";
}

function buildHtml(a: RenderArgs): string {
  const accent = a.kind === "hold_set" ? "#B45309" : "#7E6829";
  const bg = a.kind === "hold_set" ? "#FEF6E0" : "#FBF8EF";
  const sub = subline(a.kind);

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#FCFCFB;font-family:Barlow,Helvetica,Arial,sans-serif;color:#18181B;">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E5E2;border-radius:12px;overflow:hidden;">
      <div style="background:${bg};padding:16px 20px;border-bottom:1px solid #E5E5E2;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">
          ${a.kind === "note" ? "Listing note" : "Listing hold"}
        </div>
        <div style="margin-top:4px;font-size:17px;font-weight:600;color:#18181B;">
          ${escapeHtml(a.label)}
        </div>
      </div>
      <div style="padding:20px;">
        <p style="margin:0 0 12px;font-size:14px;color:#3F3F3D;">
          ${escapeHtml(headline(a.kind, a.authorName))}
          ${sub ? escapeHtml(sub) : ""}
        </p>
        ${
          a.body
            ? `<blockquote style="margin:0 0 16px;padding:12px 14px;background:#F8F8F7;border-left:3px solid ${accent};border-radius:0 6px 6px 0;font-size:14px;line-height:1.5;color:#27272A;">${escapeHtml(
                a.body,
              )}</blockquote>`
            : ""
        }
        <a href="${a.propertyUrl}" style="display:inline-block;background:#C9A84C;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:6px;">
          Open the listing
        </a>
        <p style="margin:16px 0 0;font-size:12px;color:#737370;">
          Reply to this email to answer ${escapeHtml(a.authorName)} directly,
          or add a note on the listing page so everyone sees it.
        </p>
      </div>
    </div>
  </body>
</html>`;
}

function buildText(a: RenderArgs): string {
  const lines = [
    a.label,
    "",
    headline(a.kind, a.authorName),
  ];
  const sub = subline(a.kind);
  if (sub) lines.push(sub);
  if (a.body) {
    lines.push("", `"${a.body}"`);
  }
  lines.push("", `Open the listing: ${a.propertyUrl}`);
  lines.push(
    "",
    `Reply to this email to answer ${a.authorName} directly, or add a note on the listing page so everyone sees it.`,
  );
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
