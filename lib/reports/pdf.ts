import "server-only";

/**
 * PDF rendering strategy for property report flyers.
 *
 * Status — phase-2 fallback (HTML-first):
 *   The original spec called for `@react-pdf/renderer` to produce a true
 *   server-side PDF. That dep is not installed in this repo and adding it
 *   server-side in Next.js 15 + React 19 has known peer-dep friction. To keep
 *   the build green and ship a working "download PDF" UX today, the route
 *   handler at app/r/[token]/flyer.pdf/route.ts redirects to the print-styled
 *   HTML flyer at /r/[token]/flyer instead. Browsers' built-in
 *   "Save as PDF" hits the same print stylesheet, so the seller's downloaded
 *   file matches the on-screen flyer pixel-for-pixel.
 *
 * Upgrade path (when @react-pdf/renderer is wired up):
 *   1. `npm install @react-pdf/renderer --legacy-peer-deps`
 *   2. Implement renderReportPdf below using StyleSheet/Document/Page from
 *      @react-pdf/renderer.
 *   3. The flyer.pdf route flips from a 302 redirect to streaming the buffer
 *      with `Content-Type: application/pdf`.
 *
 * Until that's done, this module exposes a single helper used by the route:
 * `getPdfRedirectTarget` returns the URL the route should redirect to.
 */
import type { ReportPayload } from "./build";

/**
 * Returns the URL the .pdf route should redirect to.
 *
 * Today: /r/{token}/flyer (the HTML version, print-styled).
 * Future: returns null and the route streams a real PDF buffer instead.
 */
export function getPdfRedirectTarget(token: string): string {
  return `/r/${encodeURIComponent(token)}/flyer?print=1`;
}

/**
 * Reserved for the future @react-pdf/renderer implementation.
 *
 * When uncommented and wired up, this should return a Uint8Array buffer
 * suitable for streaming back as application/pdf.
 *
 * Throws today — no caller invokes it; the route uses getPdfRedirectTarget.
 */
export async function renderReportPdf(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _payload: ReportPayload,
): Promise<Uint8Array> {
  throw new Error(
    "renderReportPdf: not implemented. Install @react-pdf/renderer and replace this stub.",
  );
}
