import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPdfRedirectTarget } from "@/lib/reports/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Public PDF endpoint for a property report flyer.
 *
 * Today this resolves the report by token, best-effort bumps the latest
 * delivery's view_count, then redirects to the print-styled HTML flyer at
 * /r/{token}/flyer?print=1. Browsers' built-in "Save as PDF" produces a
 * file that matches the on-screen flyer.
 *
 * When `lib/reports/pdf.ts:renderReportPdf` is wired up to
 * @react-pdf/renderer, swap the redirect for a streamed application/pdf
 * response — the rest of this handler stays the same.
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const { token } = await ctx.params;
  if (!token) {
    return new NextResponse("Missing token", { status: 400 });
  }

  const supabase = createAdminClient();

  // 1) Resolve the report — try report_token on the reports table first
  let reportId: string | null = null;
  const { data: reportRow } = await supabase
    .from("reports")
    .select("id")
    .eq("report_token", token)
    .maybeSingle();
  if (reportRow) reportId = reportRow.id;

  // 2) Fall back to a delivery share_token lookup (older deliveries may carry the token)
  if (!reportId) {
    const { data: deliveryRow } = await supabase
      .from("report_deliveries")
      .select("report_id")
      .eq("share_token", token)
      .maybeSingle();
    if (deliveryRow) reportId = deliveryRow.report_id;
  }

  if (!reportId) {
    return new NextResponse("Report not found", { status: 404 });
  }

  // 3) Best-effort bump view_count on the most recent delivery for this report
  try {
    const { data: latestDelivery } = await supabase
      .from("report_deliveries")
      .select("id, view_count")
      .eq("report_id", reportId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestDelivery) {
      await supabase
        .from("report_deliveries")
        .update({
          view_count: (latestDelivery.view_count ?? 0) + 1,
          viewed_at: new Date().toISOString(),
          status: "viewed",
        })
        .eq("id", latestDelivery.id);
    }
  } catch {
    // best-effort; never block the flyer on telemetry
  }

  // 4) Redirect to the HTML flyer in print mode.
  //    When react-pdf is wired up, swap this for a streamed PDF buffer:
  //
  //      const payload = await buildReportPayload(...);
  //      const bytes = await renderReportPdf(payload);
  //      return new NextResponse(bytes, {
  //        headers: {
  //          "Content-Type": "application/pdf",
  //          "Content-Disposition": `inline; filename="alliance-property-report.pdf"`,
  //        },
  //      });
  return NextResponse.redirect(
    new URL(getPdfRedirectTarget(token), _req.url),
    { status: 302 },
  );
}
