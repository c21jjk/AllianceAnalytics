"use server";

import { requireUser } from "@/lib/auth";
import {
  getMetricDetail,
  type MetricDetail,
  type MetricKind,
} from "@/lib/data/metric-details";

/**
 * Server action backing the click-to-expand metric detail dialogs on the
 * dashboard KPI strip. Auth-gated (any signed-in user can read aggregates)
 * and a thin wrapper around getMetricDetail so the client component can
 * load fresh data on open without committing to a route handler.
 */
export async function loadMetricDetailAction(opts: {
  kind: MetricKind;
  days: number;
  office_short_code?: string | null;
}): Promise<MetricDetail> {
  await requireUser();
  return getMetricDetail({
    kind: opts.kind,
    days: opts.days,
    office_short_code: opts.office_short_code ?? null,
  });
}
