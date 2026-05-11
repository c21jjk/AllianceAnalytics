import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The dashboard's office-filter chip is *audience-aware*, not author-aware.
 * Selecting "Wildwood Crest" should show campaigns marketed TO Wildwood Crest
 * (or its parent Shore Division, or the whole company) — regardless of which
 * office actually wrote the post.
 *
 * This helper expands a single office short_code into the set of
 * `post_groups.audience_scope` values that should match:
 *
 *   1. `office:{short_code}`     — explicit office match
 *   2. `division:{division}`     — the office's parent division
 *   3. `company`                 — brand-wide content
 *
 * Unscoped (NULL) is INTENTIONALLY excluded when an office is selected. Per
 * John's 2026-05-11 directive: unscoped posts don't show under any office
 * filter — they only appear once the user explicitly assigns an audience.
 */

export interface AudienceScopeFilter {
  /**
   * Allowed audience_scope values. When null, no filter — return everything.
   * When non-null, callers should filter post_groups by `audience_scope IN
   * (allowedScopes)`. Singletons (posts without a group) inherently have no
   * scope and should be excluded.
   */
  allowedScopes: string[] | null;
  /** True when caller passed an unknown short_code. Callers should return empty results. */
  unknownOffice: boolean;
  /**
   * Human-readable label for the active filter set, e.g.
   * "Wildwood Crest + Shore Division + brand-wide". Null when no filter.
   * Surfaced on the dashboard description so the user can see what matched.
   */
  description: string | null;
}

const DIVISION_LABELS: Record<string, string> = {
  shore: "Shore Division",
  south_jersey: "South Jersey Division",
};

export async function buildAudienceScopeFilter(
  supabase: ReturnType<typeof createAdminClient>,
  shortCode: string | null | undefined,
): Promise<AudienceScopeFilter> {
  if (!shortCode) {
    return { allowedScopes: null, unknownOffice: false, description: null };
  }

  const { data: office } = await supabase
    .from("offices")
    .select("short_code, name, division")
    .eq("short_code", shortCode)
    .maybeSingle();

  if (!office) {
    return { allowedScopes: null, unknownOffice: true, description: null };
  }

  const scopes = [`office:${office.short_code}`, "company"];
  if (office.division) {
    scopes.push(`division:${office.division}`);
  }

  const divisionLabel = office.division
    ? DIVISION_LABELS[office.division] ?? null
    : null;
  const description = divisionLabel
    ? `${office.name} + ${divisionLabel} + brand-wide`
    : `${office.name} + brand-wide`;

  return { allowedScopes: scopes, unknownOffice: false, description };
}
