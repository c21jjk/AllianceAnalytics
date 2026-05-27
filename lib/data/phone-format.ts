/**
 * Pure phone-formatting helper. Split from `alliance-dash-agents.ts` so both
 * server-only callers (the Alliance Dash lookup path) and client-side code
 * (the canvas-editor bound-field resolvers in `fabric-factory.ts`) can share
 * a single formatter without dragging in the server-only Supabase client.
 *
 * Idempotent: a phone that's already formatted round-trips unchanged.
 *
 *   "6095551234"        → "609-555-1234"
 *   "609-555-1234"      → "609-555-1234"
 *   "+16095551234"      → "609-555-1234"
 *   "(609) 555-1234"    → "609-555-1234" (re-formatted to dash style)
 *   "609.555.1234 x42"  → "609-555-1234" (extension stripped)
 *
 * 2026-05-27 — output style switched from "(NNN) NNN-NNNN" to dash-only
 * "NNN-NNNN-NNNN" per Larissa's brand reference on the Open House posts
 * (pic 1 spec). All downstream consumers use the formatter's output
 * verbatim so a single change here updates every surface.
 *
 * Returns null when:
 *   • input is null / undefined / empty
 *   • fewer than 10 digits after stripping non-digits
 *   • input contains only extension-style content (no usable phone digits)
 */
export function formatPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  // why: strip an "x..." or "ext..." suffix before extracting digits so a
  // 4-digit extension can't masquerade as the last 4 of the main line.
  const beforeExt = raw.split(/\s*(?:x|ext\.?)\s*/i)[0] ?? "";
  const digits = beforeExt.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // 11-digit US numbers carry a leading 1 country code — drop it. Anything
  // beyond that we treat as a 10-digit tail of whatever the user typed.
  const ten =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.slice(-10);
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}
