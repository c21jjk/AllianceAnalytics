/**
 * Excellence Collection — the brokerage's premium listing tier.
 *
 * Per business rule (set 2026-05-17): any listing priced at $949,000 or
 * above is automatically part of the Excellence Collection. This file is
 * the single source of truth for that threshold + helpers that read it:
 *
 *   • `isExcellenceCollection(price)` — boolean check.
 *   • `EXCELLENCE_HASHTAG` — the canonical hashtag for caption generation.
 *
 * Used by:
 *   • The Excellence Collection canvas template (variant 'v3', replaces
 *     side-by-side as of 2026-05-17) auto-selects when the listing's
 *     price clears this threshold.
 *   • `lib/post-builder/captions.ts` auto-appends EXCELLENCE_HASHTAG to
 *     captions on qualifying listings.
 */

/** Hard cutoff (USD). At-or-above this price → Excellence Collection. */
export const EXCELLENCE_PRICE_THRESHOLD = 949_000;

/** Canonical hashtag added to captions on qualifying listings. */
export const EXCELLENCE_HASHTAG = "#ExcellenceCollection";

/**
 * True when a listing's price qualifies it as Excellence Collection.
 * Returns false on null/undefined/non-finite prices so the caller can
 * use this as a safe gate (no separate null check).
 */
export function isExcellenceCollection(
  price: number | null | undefined,
): boolean {
  if (price == null || !Number.isFinite(price)) return false;
  return price >= EXCELLENCE_PRICE_THRESHOLD;
}
