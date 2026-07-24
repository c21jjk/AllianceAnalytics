import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getVapidKeys } from "@/lib/push/vapid";

export const dynamic = "force-dynamic";

/**
 * Serves the VAPID public key to the browser for pushManager.subscribe().
 *
 * Why a route instead of NEXT_PUBLIC_ env: the keypair lives in the DB
 * (api_credentials platform='web_push' — the Vercel MCP can't write env
 * vars, and NEXT_PUBLIC_ values bake at build time anyway). A runtime
 * route means key rotation via Supabase needs no redeploy.
 */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const keys = await getVapidKeys();
  if (!keys) {
    return NextResponse.json(
      { ok: false, error: "push not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, publicKey: keys.publicKey });
}
