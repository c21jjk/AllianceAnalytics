import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Web Push subscription registration.
 *
 * POST   — save/refresh the caller's PushSubscription (upsert on endpoint;
 *          re-subscribing after a key rotation updates in place, and a
 *          subscription re-registered by a different profile is re-owned).
 * DELETE — remove the subscription for the given endpoint (user toggled
 *          notifications off).
 *
 * Auth: any signed-in user. Rows are keyed to profiles.id; the sender
 * (lib/push/send.ts) further filters to active admins, so a non-admin
 * subscription is harmlessly inert.
 *
 * push_subscriptions is not in the generated Database types yet — writes
 * go through an untyped client, same pattern as the publish routes.
 */

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  user_agent?: unknown;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh =
    typeof body.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { ok: false, error: "endpoint, keys.p256dh and keys.auth are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { error } = await sbAny.from("push_subscriptions").upsert(
    {
      user_id: profile.id,
      endpoint,
      p256dh,
      auth,
      user_agent:
        typeof body.user_agent === "string"
          ? body.user_agent.slice(0, 500)
          : null,
      disabled_at: null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("[push/subscribe] upsert failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "failed to save subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { endpoint?: unknown };
  try {
    body = (await request.json()) as { endpoint?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "endpoint required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { error } = await sbAny
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", profile.id);
  if (error) {
    console.error("[push/subscribe] delete failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "failed to remove subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
