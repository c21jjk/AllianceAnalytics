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
    .select("id, report_token, generated_at, is_locked")
    .eq("property_id", propertyId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const token = data.report_token;
  return {
    report_id: data.id,
    report_token: token,
    generated_at: data.generated_at,
    is_locked: data.is_locked,
    share_url_path: `/r/${token}`,
    flyer_url_path: `/r/${token}/flyer`,
    pdf_url_path: `/r/${token}/flyer.pdf`,
  };
}
