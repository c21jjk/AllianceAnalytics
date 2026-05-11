import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Owner-report read helpers for the live property detail view.
 *
 * Owner reports are persisted in `public.reports` by `generateReportAction`.
 * Each row owns a `report_token` that the public `/r/[token]` route resolves
 * directly — no separate delivery row required.
 *
 * RLS on `reports` allows authenticated read but the property detail view
 * runs on the server, so we use the admin client for consistency with the
 * rest of the analytics-side data fetchers.
 */

/** Cadence values mirror the CHECK constraint on `public.reports.cadence`. */
export type OwnerReportCadence = "none" | "weekly" | "biweekly" | "monthly";

export const CADENCE_VALUES: OwnerReportCadence[] = [
  "none",
  "weekly",
  "biweekly",
  "monthly",
];

export interface OwnerReportRecipient {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  created_at: string;
}

export interface ExistingOwnerReport {
  report_id: string;
  report_token: string;
  generated_at: string | null;
  is_locked: boolean;
  /** Public web view, e.g. "/r/{token}" */
  share_url_path: string;
  /** Flyer view, e.g. "/r/{token}/flyer" */
  flyer_url_path: string;
  /** PDF download, e.g. "/r/{token}/flyer.pdf" */
  pdf_url_path: string;
  /** Subscriber cadence — "none" means manual-only. */
  cadence: OwnerReportCadence;
  /** When the next scheduled send is due (null when cadence is "none"). */
  next_send_at: string | null;
  /** Subscriber list ordered newest-first. */
  recipients: OwnerReportRecipient[];
}

/**
 * Return the most recent existing report for a property, or null if no report
 * has been generated yet. Sorted by `generated_at DESC` (NULLs sort last) so
 * that freshly-generated reports surface immediately on the detail page.
 */
export async function fetchExistingOwnerReportForProperty(
  propertyId: string,
): Promise<ExistingOwnerReport | null> {
  if (!propertyId) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, report_token, generated_at, is_locked, cadence, next_send_at",
    )
    .eq("property_id", propertyId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const token = data.report_token;
  const { data: recipientRows } = await supabase
    .from("report_recipients")
    .select("id, name, email, phone, created_at")
    .eq("report_id", data.id)
    .order("created_at", { ascending: false });

  const cadence: OwnerReportCadence = (CADENCE_VALUES as string[]).includes(
    data.cadence,
  )
    ? (data.cadence as OwnerReportCadence)
    : "none";

  return {
    report_id: data.id,
    report_token: token,
    generated_at: data.generated_at,
    is_locked: data.is_locked,
    share_url_path: `/r/${token}`,
    flyer_url_path: `/r/${token}/flyer`,
    pdf_url_path: `/r/${token}/flyer.pdf`,
    cadence,
    next_send_at: data.next_send_at,
    recipients: (recipientRows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      created_at: r.created_at,
    })),
  };
}

/**
 * Days-from-now lookup for cadence options. Used both by the cadence-setter
 * server action (to compute next_send_at) and by Phase D's send job (to
 * advance the schedule after a send completes).
 */
export function cadenceIntervalDays(
  cadence: OwnerReportCadence,
): number | null {
  switch (cadence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "none":
    default:
      return null;
  }
}
