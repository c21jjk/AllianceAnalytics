"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { markOutboxAcknowledged } from "@/lib/data/agent-outbox-db";

export interface OutboxActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Mark an outbox row as acknowledged — i.e. Larissa clicked the mailto
 * link in the pending-notifications view. Interim proxy for "the
 * notification went out" until Phase 6 wires Resend for automatic send.
 *
 * Idempotent: re-acknowledging a row is a no-op (the second update writes
 * the same shape; we don't surface an error).
 */
export async function acknowledgeOutboxRowAction(
  rowId: string,
): Promise<OutboxActionResult> {
  const profile = await requireAdmin();
  if (!rowId) return { ok: false, error: "Missing outbox row id." };

  const result = await markOutboxAcknowledged({
    id: rowId,
    acknowledged_by: profile.id,
  });
  if ("error" in result) return { ok: false, error: result.error };

  // The pending list lives on the Outbox view; the property detail page
  // also rolls up agent-notification status (Phase 5b).
  revalidatePath("/outbox");
  return { ok: true };
}
