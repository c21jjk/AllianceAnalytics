/**
 * Shared auth gate for /api/cron/* routes.
 *
 * Single source of truth, modeled on the strict gate publish-scheduled has
 * used since 2026-05-28. Vercel auto-generates CRON_SECRET when crons are
 * configured and sends `Authorization: Bearer <secret>` on every tick.
 *
 * Rules:
 *   - dev: allow (localhost curl / manual testing without env setup).
 *   - prod, CRON_SECRET unset: 500 "CRON_SECRET not configured". Config bug;
 *     fail loud so the operator notices, never silently allow every caller.
 *   - prod, header mismatch: 401.
 *   - prod, exact Bearer match: allow.
 *
 * Deliberately NO user-agent allowance: `user-agent: vercel-cron/...` is an
 * attacker-controlled header and was a spoofable bypass in four cron routes
 * until 2026-06-10 (full-platform audit, High #1).
 */
import { NextResponse } from "next/server";

/**
 * Returns null when the request is authorized, otherwise the error response
 * to return as-is.
 *
 * Usage:
 *   const denied = requireCronAuth(request);
 *   if (denied) return denied;
 */
export function requireCronAuth(request: Request): NextResponse | null {
  if (process.env.NODE_ENV === "development") return null;

  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const got = request.headers.get("authorization") ?? "";
  if (got !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  return null;
}
