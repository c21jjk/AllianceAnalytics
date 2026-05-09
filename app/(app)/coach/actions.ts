"use server";

/**
 * Server actions for /coach.
 *
 * generatePlanAction is invoked by the "Generate this week's plan" button on
 * the Coach page. Always returns a StrategyPlan — even when Anthropic isn't
 * configured the underlying generator returns a baseline outline so the UI
 * has something to render.
 */
import { requireUser } from "@/lib/auth";
import {
  generateStrategyPlan,
  type StrategyPlan,
  type StrategyScope,
} from "@/lib/ai/strategy";

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
