import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVapidKeys } from "./vapid";

/**
 * Web Push sender — modeled on lib/email/send.ts (lazy singleton config,
 * result-object returns, never throws to callers, "server-only").
 *
 * Recipients are the active admin profiles (Phase 1: John + Larissa).
 * Each admin may have multiple subscriptions (iPhone PWA, desktop
 * browser); we fan out to all of them. Dead endpoints (404/410 from the
 * push service) are tombstoned via disabled_at so we stop retrying.
 *
 * Every send is also logged to the `notifications` table (one row per
 * recipient profile) which powers the mobile /m/alerts feed — so alerts
 * are visible in-app even when a device never subscribed to push.
 *
 * VAPID keys resolve DB-first (api_credentials platform='web_push') with
 * env fallback — see lib/push/vapid.ts. Missing config degrades
 * gracefully: notifications rows are still written; only the push
 * delivery is skipped.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped (e.g. /posts/abc). */
  url?: string;
  /** Dedupe tag — notifications sharing a tag replace each other. */
  tag?: string;
}

export interface NotifyAdminsInput extends PushPayload {
  /** notifications.type — "publish_result" | "publish_failure" | "performance" | ... */
  type: string;
  /** Extra context persisted on the notifications row (post id, platform, permalink). */
  metadata?: Record<string, unknown>;
  /** Skip the web-push delivery (log the in-app row only). */
  skip_push?: boolean;
}

export interface NotifyAdminsResult {
  ok: boolean;
  pushed: number;
  failed: number;
  logged: number;
  error?: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Load VAPID config (DB-first via api_credentials platform='web_push',
 * env fallback — see lib/push/vapid.ts) and apply it to the web-push
 * client. Returns false when push isn't configured; in-app notification
 * rows are still written in that case.
 */
async function ensureVapid(): Promise<boolean> {
  const keys = await getVapidKeys();
  if (!keys) {
    console.warn(
      "[push] VAPID keys not configured — web push disabled (in-app notifications still logged)",
    );
    return false;
  }
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  return true;
}

/** Active admin profile ids — the push/notification audience (Phase 1). */
async function fetchAdminProfileIds(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);
  if (error) {
    console.error("[push] failed to read admin profiles:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.id);
}

/**
 * Log + push a notification to every active admin. Best-effort: DB or
 * push-service failures are logged and reflected in the result, never
 * thrown — a notification problem must not break a publish.
 */
export async function notifyAdmins(
  input: NotifyAdminsInput,
): Promise<NotifyAdminsResult> {
  const result: NotifyAdminsResult = { ok: true, pushed: 0, failed: 0, logged: 0 };

  try {
    const supabase = createAdminClient();
    const adminIds = await fetchAdminProfileIds();
    if (adminIds.length === 0) {
      return { ...result, ok: false, error: "no active admin profiles" };
    }

    // 1. In-app notification rows (the /m/alerts feed).
    const { error: insertError } = await supabase.from("notifications").insert(
      adminIds.map((user_id) => ({
        user_id,
        title: input.title,
        message: input.body,
        type: input.type,
        metadata: (input.metadata ?? {}) as never,
      })),
    );
    if (insertError) {
      console.error("[push] notifications insert failed:", insertError.message);
    } else {
      result.logged = adminIds.length;
    }

    // 2. Web push fan-out.
    if (input.skip_push || !(await ensureVapid())) return result;

    // why: push_subscriptions is service-role-only and (like
    // linked_property_ids / platform_permalinks) not in the generated
    // types yet — read through an untyped client, same pattern as the
    // publish routes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;
    const { data: subsData, error: subsError } = await sbAny
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", adminIds)
      .is("disabled_at", null);
    if (subsError) {
      console.error("[push] subscriptions read failed:", subsError.message);
      return result;
    }
    const subs = (subsData ?? []) as SubscriptionRow[];

    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      url: input.url ?? "/m/alerts",
      tag: input.tag,
    });

    const deadIds: string[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { TTL: 60 * 60 * 12 },
          );
          result.pushed += 1;
        } catch (err) {
          result.failed += 1;
          const status =
            typeof err === "object" && err !== null && "statusCode" in err
              ? (err as { statusCode: number }).statusCode
              : 0;
          // 404/410 = subscription expired or revoked — tombstone it.
          if (status === 404 || status === 410) {
            deadIds.push(sub.id);
          } else {
            console.warn(
              `[push] send failed (${status || "network"}) for sub ${sub.id}`,
            );
          }
        }
      }),
    );

    if (deadIds.length > 0) {
      await sbAny
        .from("push_subscriptions")
        .update({ disabled_at: new Date().toISOString() })
        .in("id", deadIds);
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[push] notifyAdmins unexpected failure:", message);
    return { ...result, ok: false, error: message };
  }
}
