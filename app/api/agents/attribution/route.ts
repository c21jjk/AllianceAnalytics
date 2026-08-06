/**
 * Agent attribution lookup — name → { phone, photo_url }.
 *
 * 2026-08-06 (John) — "Agent photo and phone # placeholders are in place but
 * the actual photo and agent phone # (which we def have access to) are not
 * populating the slide."
 *
 * The headshot and phone both live server-side only:
 *   • headshot → `brand_assets` (kind='agent_headshot') in this project, via
 *     an admin client, matched on the agent's name
 *   • phone    → `mls_agents.phone_override` first, then the Alliance Dash
 *     CMC / SJSR roster tables through a second Supabase project whose
 *     credentials are server-env only
 *
 * Neither is reachable from the browser, which is why Studio's canvas showed
 * empty frames for `agent_photo` / `agent_phone` while the published PNG
 * (rendered server-side) could fill them. The preview lied. This route closes
 * that gap: the Post Builder calls it for the selected listing's agent and
 * hands the result to mapListingToPayload, so the editor and the render agree.
 *
 * Read-only, authenticated, and deliberately narrow — it takes a name and
 * returns at most a phone string and a photo URL. It exposes nothing an
 * authenticated user can't already see on the listing detail page.
 */

import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getAgentAttribution } from "@/lib/data/alliance-dash-agents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }

  try {
    // getAgentAttribution fans the headshot + phone lookups out in parallel
    // and swallows its own failures, returning nulls rather than throwing.
    // A miss is a normal outcome here (Bright-listed agents have no phone
    // source at all), so a null field is data, not an error.
    const attribution = await getAgentAttribution(name);
    return NextResponse.json({
      ok: true,
      name: attribution.name,
      phone: attribution.phone,
      photo_url: attribution.photo_url,
    });
  } catch (err) {
    // why: the editor treats a failed lookup exactly like a miss — the canvas
    // falls back to empty frames, which is the pre-2026-08-06 behavior. Never
    // 500 the Post Builder over an optional enrichment.
    console.error("[agents/attribution] lookup failed:", err);
    return NextResponse.json({
      ok: true,
      name,
      phone: null,
      photo_url: null,
    });
  }
}
