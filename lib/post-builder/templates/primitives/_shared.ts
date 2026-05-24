/**
 * Shared types + helpers extracted from the deleted V1 HTML primitives.
 *
 * 2026-05-24 — the V1 HTML primitive system was deleted, but four non-
 * primitive callers still need the type aliases + the escapeHtml helper
 * that lived alongside them. This file is the minimal shim that lets
 * those callers keep typechecking after the primitive deletion.
 *
 * Live external consumers (2026-05-24):
 *   • lib/post-builder/listings.ts — imports PostBuilderListingWithOH
 *   • lib/post-builder/multi-oh-render.ts — imports escapeHtml + the OH type
 *   • lib/email/reports/* — import escapeHtml for HTML email templates
 *   • lib/post-builder/templates/themes.ts — imports PostTypeTheme (orphan)
 *
 * Customization helpers (applyColorCustomizations, applyTextCustomizations,
 * buildCustomizationCSS, injectCustomizationCSS) lived here too but are
 * only consumed by the V1 primitives that are now stubbed. Re-exporting
 * them as no-ops in case any future caller tries to use them.
 */
import type {
  PostBuilderListing,
  PostCustomizations,
} from "@/lib/post-builder/types";

/**
 * V1 listing payload augmented with open-house event fields. Returned by
 * lib/post-builder/listings.ts when oh_start_at / oh_end_at / oh_comments
 * are populated.
 */
export interface PostBuilderListingWithOH extends PostBuilderListing {
  oh_start_at: string | null;
  oh_end_at: string | null;
  oh_comments: string | null;
}

/**
 * Per-post-type theme — the small object the deleted V1 primitives used
 * to color the surface, badge, and text. Kept exported for type-only
 * back-compat with `themes.ts` (also orphaned).
 */
export interface PostTypeTheme {
  /** Surface background hex. */
  background: string;
  /** Primary text hex. */
  text: string;
  /** Accent (badge fill, eyebrow) hex. */
  accent: string;
  /** Secondary text hex. */
  textSecondary: string;
  /** Badge label string ("JUST LISTED", etc.). */
  badgeLabel: string;
}

/**
 * Tiny HTML-entity escaper. Still used by multi-OH render and email
 * report templates to safely interpolate listing data into HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Customization helpers — kept as no-ops for back-compat. The V1 primitives
// that consumed them are stubbed; no live caller uses these after 2026-05-24.
// ---------------------------------------------------------------------------

export function applyColorCustomizations<T>(
  theme: T,
  customizations?: PostCustomizations | null,
): T {
  void customizations;
  return theme;
}

export function applyTextCustomizations<T>(
  theme: T,
  customizations?: PostCustomizations | null,
): T {
  void customizations;
  return theme;
}

export function buildCustomizationCSS(
  customizations?: PostCustomizations | null,
): string {
  void customizations;
  return "";
}

export function injectCustomizationCSS(baseHtml: string, css: string): string {
  if (!css) return baseHtml;
  return baseHtml.replace("</head>", `<style>${css}</style></head>`);
}
