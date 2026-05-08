/**
 * Auto-linker — heuristics that match a post caption to an MLS listing.
 *
 * Tiered matching (most specific first):
 *   1. NJ MLS number regex match against the caption    → auto_mls
 *   2. Full street-address substring                    → auto_address_full
 *   3. Street number + first word of street name        → auto_address_partial
 *
 * Returns null if nothing matches. The caller decides whether to overwrite an
 * existing manual link (don't — manual always wins).
 *
 * NJ MLS numbers we care about:
 *   - CMC MLS:    NJCM####### (Cape May County)
 *   - SJSR/Paragon: NJOC####### (Ocean City), NJAC####### (Atlantic Co)
 *   - Bright MLS: NJBL#######, NJCD#######, NJBU#######, etc.
 *   - Generic catchall: 6-9 digit numeric strings flagged with #MLS#
 *
 * The regex is intentionally broad — false positives are cheaper to fix in the
 * Classify panel than missed links to forensically chase.
 */

export type LinkMethod =
  | "auto_mls"
  | "auto_address_full"
  | "auto_address_partial";

export interface LinkCandidate {
  property_id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
}

export interface LinkMatch {
  property_id: string;
  mls_number: string;
  method: LinkMethod;
  matched_on: string;
}

const NJ_MLS_REGEX = /\bNJ[A-Z]{2}\d{5,8}\b/gi;

/**
 * Extract an MLS-number-shaped token from caption text. Returns null if none.
 * Used by both the auto-linker and the per-post UI ("we found NJCM1234567 —
 * was it this listing?").
 */
export function extractMlsNumber(caption: string): string | null {
  if (!caption) return null;
  const match = caption.match(NJ_MLS_REGEX);
  if (match && match.length > 0) return match[0].toUpperCase();
  return null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNumberAndWord(address: string): { num: string; word: string } | null {
  const m = address.match(/^\s*(\d+)\s+([A-Za-z]+)/);
  if (!m) return null;
  return { num: m[1], word: m[2].toLowerCase() };
}

/**
 * Run the tiered linker against a caption + a candidate set of listings.
 * The candidate set is loaded once per batch (cheap — < 500 active listings).
 */
export function findLinkMatch(
  caption: string,
  candidates: LinkCandidate[],
): LinkMatch | null {
  if (!caption || candidates.length === 0) return null;

  // Tier 1: MLS number regex
  const mls = extractMlsNumber(caption);
  if (mls) {
    const hit = candidates.find(
      (c) => c.mls_number.toUpperCase() === mls.toUpperCase(),
    );
    if (hit) {
      return {
        property_id: hit.property_id,
        mls_number: hit.mls_number,
        method: "auto_mls",
        matched_on: mls,
      };
    }
    // MLS-shaped token in caption but no listing exists for it. Don't fall
    // through — the next tiers would add noise. Just bail.
    return null;
  }

  const haystack = normalize(caption);

  // Tier 2: full address substring
  for (const c of candidates) {
    if (!c.address) continue;
    const needle = normalize(c.address);
    if (needle.length >= 8 && haystack.includes(needle)) {
      return {
        property_id: c.property_id,
        mls_number: c.mls_number,
        method: "auto_address_full",
        matched_on: c.address,
      };
    }
  }

  // Tier 3: street # + first word of street name (e.g. "123 Park")
  for (const c of candidates) {
    if (!c.address) continue;
    const parts = streetNumberAndWord(c.address);
    if (!parts) continue;
    if (parts.word.length < 4) continue; // skip tiny words like "the", "oak"
    const probe = `${parts.num} ${parts.word}`;
    if (haystack.includes(probe)) {
      return {
        property_id: c.property_id,
        mls_number: c.mls_number,
        method: "auto_address_partial",
        matched_on: probe,
      };
    }
  }

  return null;
}
