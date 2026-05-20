import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Brand-logo lookups against `brand_assets.kind='logo'`. Surfaces by exact
 * label so the Studio asset library remains the single source of truth —
 * marketing can swap a logo in-place by replacing the asset under the same
 * label, and the Owner Story (and any future surface using these helpers)
 * picks up the change without a code deploy.
 *
 * The Owner Story currently needs two specific marks:
 *   - "C21 ALLIANCE Grey"     → top-left brand wordmark
 *   - "Seal Gold Cropped 1"   → C21 seal in The Alliance Advantage section
 *
 * Returns nulls (not throws) when a label is missing — the consuming
 * template renders a subtle fallback rather than break the page.
 */

export interface OwnerStoryBrandLogos {
  /** C21 ALLIANCE wordmark for the top-of-page eyebrow. */
  wordmark_url: string | null;
  /** Gold-cropped C21 seal used in the Alliance Advantage card. */
  seal_url: string | null;
}

const WORDMARK_LABEL = "C21 ALLIANCE Grey";
const SEAL_LABEL = "Seal Gold Cropped 1";

export async function fetchOwnerStoryBrandLogos(): Promise<OwnerStoryBrandLogos> {
  const empty: OwnerStoryBrandLogos = {
    wordmark_url: null,
    seal_url: null,
  };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("brand_assets")
      .select("label, public_url")
      .eq("kind", "logo")
      .eq("status", "active")
      .in("label", [WORDMARK_LABEL, SEAL_LABEL]);
    if (error || !data) return empty;
    const byLabel = new Map<string, string>();
    for (const row of data) {
      if (row.label && row.public_url) {
        byLabel.set(row.label, row.public_url);
      }
    }
    return {
      wordmark_url: byLabel.get(WORDMARK_LABEL) ?? null,
      seal_url: byLabel.get(SEAL_LABEL) ?? null,
    };
  } catch {
    return empty;
  }
}
