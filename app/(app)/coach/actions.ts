"use server";

/**
 * Server actions for /coach.
 *
 * Two surfaces:
 *   - generatePlanAction      — long-form strategy plan generator (Phase 1)
 *   - refreshCoachInsightsAction — admin-only manual refresh of the cached
 *     Spend Recommendations + Per-listing Budgets surfaces (Phase 2)
 *
 * The cron refresh of coach_insights runs daily via the supabase
 * coach-refresh Edge Function — this manual action lets admins regenerate on
 * demand without waiting for the next cron tick.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  generateStrategyPlan,
  type StrategyPlan,
  type StrategyScope,
} from "@/lib/ai/strategy";
import { refreshCoachInsights } from "@/lib/ai/coach-insights";

export type PlanScopeKind = "brand_wide" | "single_office" | "multi_office";

export interface PlanActionResult {
  ok: boolean;
  plan?: StrategyPlan;
  error?: string;
}

export async function generatePlanAction(
  scopeKind: PlanScopeKind,
  officeShortCodes: string[] = [],
): Promise<PlanActionResult> {
  await requireUser();

  let scope: StrategyScope;
  if (scopeKind === "brand_wide") {
    scope = { kind: "brand_wide" };
  } else if (scopeKind === "single_office") {
    const code = officeShortCodes[0]?.trim();
    if (!code) {
      return { ok: false, error: "Pick an office first." };
    }
    scope = { kind: "single_office", office_short_code: code };
  } else {
    const codes = officeShortCodes
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (codes.length === 0) {
      return { ok: false, error: "Pick at least one office." };
    }
    scope = { kind: "multi_office", office_short_codes: codes };
  }

  try {
    const plan = await generateStrategyPlan(scope);
    return { ok: true, plan };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "plan generation failed",
    };
  }
}

export interface RefreshInsightsResult {
  ok: boolean;
  recommendations_count?: number;
  budgets_count?: number;
  generated_at?: string;
  error?: string;
}

/**
 * Admin-only refresh of the cached Coach insights. Calls Claude twice
 * (recommendations + budgets), upserts to coach_insights, and revalidates
 * the /coach route so the freshly-generated data renders on next load.
 *
 * Scope defaults to "brand_wide" — future-proofs per-office refresh.
 */
export async function refreshCoachInsightsAction(
  scope: string = "brand_wide",
): Promise<RefreshInsightsResult> {
  await requireAdmin();
  try {
    const result = await refreshCoachInsights(scope);
    revalidatePath("/coach");
    return {
      ok: true,
      recommendations_count: result.recommendations.length,
      budgets_count: result.budgets.length,
      generated_at: result.generated_at ?? new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "refresh failed",
    };
  }
}
