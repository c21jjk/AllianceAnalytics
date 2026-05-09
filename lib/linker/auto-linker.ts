/**
 * Auto-linker — heuristics that match a post caption to an MLS listing.
 *
 * Tiered matching (most specific first):
 *   1. MLS number (multi-format)                       → auto_mls
 *        - Bright:  NJxx#######        (raw match against properties.mls_number)
 *        - CMC:     #?CMC######        (source_mls='cmc' AND mls_number=digits)
 *        - SJSR:    #?SJSR######       (source_mls='sjsr' AND mls_number=digits)
 *   2. Full street-address substring                   → auto_address_full
 *   3. Street number + first word of street name       → auto_address_partial
 *
 * Returns null if nothing matches. The caller decides whether to overwrite an
 * existing manual link (don't — manual always wins).
 *
 * The SQL counterpart `public.run_auto_linker()` mirrors this logic and is the
 * authoritative implementation. This file exists so the IG/FB/TT edge functions
 * can do per-post linking inline during ingestion (they see one post at a time;
 * a server-side bulk SQL run is overkill).
 */

export type LinkMethod =
  | "auto_mls"
  | "auto_address_full"
  | "auto_address_partial";

export type MlsSource = "cmc" | "sjsr" | "bright" | "manual";

export interface LinkCandidate {
  property_id: string;
  mls_number: string;
  /** Origin MLS feed — required for prefix-aware matching of CMC/SJSR. */
  source_mls: MlsSource | null;
  address: string | null;
  city: string | null;
}

export interface LinkMatch {
  property_id: string;
  mls_number: string;
  method: LinkMethod;
  matched_on: string;
}

/** Matches Bright's MLS-number pattern: NJ + 2-letter county + 5-8 digits. */
const BRIGHT_REGEX = /\bNJ[A-Z]{2}\d{5,8}\b/i;
/** Matches "#CMC######" or "CMC######" (4-8 digits). */
const CMC_REGEX = /(?:^|[^A-Za-z0-9_])#?CMC(\d{4,8})\b/i;
/** Matches "#SJSR######" or "SJSR######" (4-8 digits). */
const SJSR_REGEX = /(?:^|[^A-Za-z0-9_])#?SJSR(\d{4,8})\b/i;

/**
 * Extract a canonical MLS-number token from caption text. Returns the form
 * suitable for storing in `posts.mls_number_parsed` and displaying as a chip:
 *   - Bright → "NJBL2078123" (uppercase)
 *   - CMC    → "CMC230456"
 *   - SJSR   → "SJSR571832"
 *
 * Order tried: Bright first (uniquely shaped), then CMC, then SJSR. Returns
 * null if no MLS-shaped token is present.
 */
export function extractMlsNumber(caption: string): string | null {
  if (!caption) return null;
  const bright = caption.match(BRIGHT_REGEX);
  if (bright) return bright[0].toUpperCase();
  const cmc = caption.match(CMC_REGEX);
  if (cmc) return `CMC${cmc[1]}`;
  const sjsr = caption.match(SJSR_REGEX);
  if (sjsr) return `SJSR${sjsr[1]}`;
  return null;
}

/**
 * Parse the canonical token into its (source_mls, raw_number) parts so the
 * caller can look up the correct properties row. Returns null if not parseable
 * (which would only happen if you passed something `extractMlsNumber` didn't
 * produce).
 */
export function parseCanonicalMls(
  canonical: string,
): { source_mls: MlsSource; mls_number: string } | null {
  const upper = canonical.toUpperCase();
  if (/^NJ[A-Z]{2}\d{5,8}$/.test(upper)) {
    return { source_mls: "bright", mls_number: upper };
  }
  const cmc = upper.match(/^CMC(\d{4,8})$/);
  if (cmc) return { source_mls: "cmc", mls_number: cmc[1] };
  const sjsr = upper.match(/^SJSR(\d{4,8})$/);
  if (sjsr) return { source_mls: "sjsr", mls_number: sjsr[1] };
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

  // Tier 1: MLS number (multi-format)
  const canonical = extractMlsNumber(caption);
  if (canonical) {
    const parsed = parseCanonicalMls(canonical);
    if (parsed) {
      const hit = candidates.find((c) => {
        if (parsed.source_mls === "bright") {
          // Bright: candidate may have source_mls='bright' or null (legacy);
          // the mls_number itself is the key.
          return c.mls_number.toUpperCase() === parsed.mls_number;
        }
        // CMC/SJSR: require source_mls match AND raw digits match
        return (
          c.source_mls === parsed.source_mls &&
          c.mls_number.toUpperCase() === parsed.mls_number
        );
      });
      if (hit) {
        return {
          property_id: hit.property_id,
          mls_number: hit.mls_number,
          method: "auto_mls",
          matched_on: canonical,
        };
      }
    }
    // MLS-shaped token in caption but no listing exists for it. Don't fall
    // through to address tiers — that would add noise. Caller will still see
    // the canonical token and can stamp `mls_number_parsed` on the post.
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
