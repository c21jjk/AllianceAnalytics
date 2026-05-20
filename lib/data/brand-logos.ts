import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Supplementary lookups the Owner Story view needs in addition to its core
 * payload — brand logos from the Studio asset library + live company vitals
 * (active agent count, office count) used in The Alliance Advantage section.
 *
 * Logos are resolved by exact `brand_assets.label`, so marketing can swap a
 * mark in-place by replacing the file behind the same label — no code deploy
 * needed. Vitals are pulled live so the agent count tracks Darwin roster
 * changes automatically.
 *
 * Returns nulls / zeros (not throws) on any failure — the consuming template
 * renders a graceful fallback rather than break the seller-facing page.
 */

export interface OwnerStoryBrandLogos {
  /** C21 ALLIANCE wordmark for the top-of-page eyebrow. */
  wordmark_url: string | null;
  /** Cropped seal (no wordmark) — kept for any future surface. */
  seal_cropped_url: string | null;
  /** Full seal with wordmark inside — used in The Alliance Advantage card. */
  seal_full_url: string | null;
}

export interface AllianceVitals {
  /** Active agents on the Alliance roster (Darwin source, is_active=true). */
  active_agents: number;
  /** Active Alliance offices. */
  active_offices: number;
}

const WORDMARK_LABEL = "C21 ALLIANCE Grey";
const SEAL_CROPPED_LABEL = "Seal Gold Cropped 1";
const SEAL_FULL_LABEL = "Seal Gold Full";

export async function fetchOwnerStoryBrandLogos(): Promise<OwnerStoryBrandLogos> {
  const empty: OwnerStoryBrandLogos = {
    wordmark_url: null,
    seal_cropped_url: null,
    seal_full_url: null,
  };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("brand_assets")
      .select("label, public_url")
      .eq("kind", "logo")
      .eq("status", "active")
      .in("label", [WORDMARK_LABEL, SEAL_CROPPED_LABEL, SEAL_FULL_LABEL]);
    if (error || !data) return empty;
    const byLabel = new Map<string, string>();
    for (const row of data) {
      if (row.label && row.public_url) {
        byLabel.set(row.label, row.public_url);
      }
    }
    return {
      wordmark_url: byLabel.get(WORDMARK_LABEL) ?? null,
      seal_cropped_url: byLabel.get(SEAL_CROPPED_LABEL) ?? null,
      seal_full_url: byLabel.get(SEAL_FULL_LABEL) ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * Active-roster vitals for the Alliance Advantage section. Pulled live so
 * the agent count auto-updates as Darwin sync brings in new hires.
 */
export async function fetchAllianceVitals(): Promise<AllianceVitals> {
  const empty: AllianceVitals = { active_agents: 0, active_offices: 0 };
  try {
    const supabase = createAdminClient();
    const [{ count: agentCount }, { count: officeCount }] = await Promise.all([
      supabase
        .from("mls_agents")
        .select("id", { count: "exact", head: true })
        .eq("source", "darwin")
        .eq("is_active", true),
      supabase
        .from("offices")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
    ]);
    return {
      active_agents: agentCount ?? 0,
      active_offices: officeCount ?? 0,
    };
  } catch {
    return empty;
  }
}
