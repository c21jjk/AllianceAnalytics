/**
 * Shared open-house host-name resolver.
 *
 * When an open house is hosted by someone OTHER than the listing agent, the
 * actual host is typically called out in the OH `comments` / notes field —
 * e.g. "Hosted by PJ Dougherty". This helper parses that pattern out of the
 * notes when present, falling back to the listing agent's own name when the
 * notes don't mention a host.
 *
 * Used by:
 *   - `UpcomingOpenHousesRow` (dashboard "Open Houses next 7 days" card)
 *   - `MultiOHWizardClient` (post-builder per-property host attribution)
 *   - any future surface that wants the same logic
 *
 * NOT exported as a side-effecty server module — pure, safe to call from
 * both client and server contexts.
 */

/**
 * Regex that detects a "Hosted by {Name}" / "Open by {Name}" / "Host: {Name}"
 * pattern. The capture group is intentionally tight (1-3 capitalized word
 * tokens) so that random sentences ("Hosted by appointment only" / "Host
 * the open house yourself") don't accidentally match. False negatives are
 * fine — callers can fall back to the listing agent. False positives would
 * corrupt the rendered agent attribution.
 */
export const HOSTING_AGENT_NOTES_REGEX =
  /(?:hosted\s+by|host(?:ed)?\s*:|open(?:ed)?\s+by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,2})/i;

/**
 * Pure helper — given a listing's notes/remarks text and the listing's own
 * agent_name as fallback, returns the best-guess hosting agent name.
 *
 * Returns the listing's own agent_name when the notes don't mention a host
 * explicitly. Returns an empty string when neither is available.
 */
export function resolveHostingAgent(
  notes: string | null | undefined,
  listingAgentName: string | null | undefined,
): string {
  if (notes) {
    const m = notes.match(HOSTING_AGENT_NOTES_REGEX);
    if (m && m[1]) return m[1].trim();
  }
  return (listingAgentName ?? "").trim();
}
