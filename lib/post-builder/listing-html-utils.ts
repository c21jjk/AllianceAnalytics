/**
 * Listing HTML utilities.
 *
 * Relocated 2026-05-30 out of the deleted V1 `templates/primitives/_shared.ts`.
 * These are generic helpers/types with no tie to the retired V1 template
 * system: the open-house-augmented listing type and a tiny HTML-entity
 * escaper used by the multi-OH render path and the email report templates.
 */
import type { PostBuilderListing } from "@/lib/post-builder/types";

/**
 * Listing payload augmented with open-house event fields. Returned by
 * lib/post-builder/listings.ts when oh_start_at / oh_end_at / oh_comments
 * are populated.
 */
export interface PostBuilderListingWithOH extends PostBuilderListing {
  oh_start_at: string | null;
  oh_end_at: string | null;
  oh_comments: string | null;
}

/**
 * Tiny HTML-entity escaper. Used by multi-OH render and email report
 * templates to safely interpolate listing data into HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
