import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReportPayload } from "@/lib/reports/build";
import { fetchCompanyRollup } from "@/lib/data/company-rollup";
import { getPdfRedirectTarget, renderReportPdf } from "@/lib/reports/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Public PDF endpoint for a property report flyer.
 *
 * 1. Resolve the report by token (reports.report_token first, then a
 *    report_deliveries.share_token fallback for older deliveries).
 * 2. Best-effort bump view_count on the most recent delivery for telemetry.
 * 3. Build the report payload and render a real PDF via @react-pdf/renderer.
 * 4. If PDF rendering throws (font issue, image fetch failure, layout
 *    blow-up), fall back to a 302-redirect to the print-styled HTML flyer at
 *    /r/{token}/flyer?print=1 so the user always gets a printable view.
 *
 * Telemetry: a `?via=pdf` or `?via=html_fallback` query indicator is added to
 * the redirect URL when we fall back, and a console.log records which path
 * was taken for ops debugging.
 */
export async function GET(req: Request, ctx: RouteContext) {
  const { token } = await ctx.params;
  if (!token) {
    return new NextResponse("Missing token", { status: 400 });
  }

  const supabase = createAdminClient();

  // 1) Resolve the report — try report_token on the reports table first
  let reportId: string | null = null;
  let propertyId: string | null = null;
  // 2026-05-28 (Phase 4 #6) — track WHICH delivery the token matched. When the
  // flyer is opened via a specific delivery's share_token, the view must be
  // credited to THAT delivery, not "the most recent delivery for the report"
  // (the previous behavior misattributed every view to the newest delivery,
  // so a report sent to two sellers via two share links credited both opens
  // to whichever was sent last).
  let matchedDeliveryId: string | null = null;
  const { data: reportRow } = await supabase
    .from("reports")
    .select("id, property_id")
    .eq("report_token", token)
    .maybeSingle();
  if (reportRow) {
    reportId = reportRow.id;
    propertyId = reportRow.property_id;
  }

  // 2) Fall back to a delivery share_token lookup (older deliveries may carry the token)
  if (!reportId) {
    const { data: deliveryRow } = await supabase
      .from("report_deliveries")
      .select("id, report_id")
      .eq("share_token", token)
      .maybeSingle();
    if (deliveryRow) {
      reportId = deliveryRow.report_id;
      matchedDeliveryId = deliveryRow.id;
      const { data: indirectReport } = await supabase
        .from("reports")
        .select("id, property_id")
        .eq("id", reportId)
        .maybeSingle();
      if (indirectReport) propertyId = indirectReport.property_id;
    }
  }

  if (!reportId || !propertyId) {
    return new NextResponse("Report not found", { status: 404 });
  }

  // 3) Best-effort bump view_count. Credit the SPECIFIC delivery the token
  //    matched (share_token access); only fall back to the most-recent
  //    delivery when the flyer was opened via a bare report_token, which
  //    isn't tied to any single delivery.
  try {
    let target: { id: string; view_count: number | null } | null = null;
    if (matchedDeliveryId) {
      const { data } = await supabase
        .from("report_deliveries")
        .select("id, view_count")
        .eq("id", matchedDeliveryId)
        .maybeSingle();
      target = data ?? null;
    } else {
      const { data } = await supabase
        .from("report_deliveries")
        .select("id, view_count")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      target = data ?? null;
    }
    if (target) {
      await supabase
        .from("report_deliveries")
        .update({
          view_count: (target.view_count ?? 0) + 1,
          viewed_at: new Date().toISOString(),
          status: "viewed",
        })
        .eq("id", target.id);
    }
  } catch {
    // best-effort; never block the flyer on telemetry
  }

  // 4) Build payload + render PDF. On any failure, fall back to the HTML
  //    print view so the user is never blocked.
  try {
    const [payload, companyRollup] = await Promise.all([
      buildReportPayload(propertyId),
      fetchCompanyRollup(),
    ]);
    const bytes = await renderReportPdf(payload, companyRollup);
    const filename = `alliance-property-report-${payload.property.mls}.pdf`;
    console.log(
      `[flyer.pdf] via=pdf token=${token} mls=${payload.property.mls} bytes=${bytes.byteLength}`,
    );
    // Cast to BodyInit-compatible type. Uint8Array is a valid Response body.
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    console.error(
      `[flyer.pdf] via=html_fallback token=${token} error=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    const fallback = new URL(getPdfRedirectTarget(token), req.url);
    fallback.searchParams.set("via", "html_fallback");
    return NextResponse.redirect(fallback, { status: 302 });
  }
}
