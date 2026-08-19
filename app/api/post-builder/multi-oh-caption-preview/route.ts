/**
 * POST /api/post-builder/multi-oh-caption-preview
 * -----------------------------------------------
 *
 * Live caption preview for the multi-OH wizard's Step 3. The wizard
 * client debounces input changes and POSTs here; we synthesize the
 * caption via Claude Haiku and return the per-platform JSON.
 *
 * Why a dedicated route (vs reusing multi-oh-generate):
 *   • Generate is a heavy NDJSON streaming endpoint that renders images.
 *     The preview needs prose only — sub-second turnaround beats sharing
 *     a 120s timeout window.
 *   • Letting the wizard hit Claude directly on every keystroke would
 *     leak our API key. The route stays server-side and the client
 *     debounces.
 *
 * Auth: requires a signed-in Alliance user.
 *
 * Response headers carry the caption SOURCE so the client can show
 * a "AI caption unavailable" hint when Claude is down:
 *   X-Caption-Source: claude-haiku-4-5  (success path)
 *   X-Caption-Source: deterministic     (Claude failed; pool synth fallback)
 */
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { synthesizeMultiOHCaptionAI } from "@/lib/post-builder/ai/multi-oh-caption-ai";
import {
  synthesizeMultiOHCaption,
  type CaptionTone,
  type MultiOHCaptionInput,
  type MultiOHCaptionProperty,
  type MultiOHCaptionResult,
} from "@/lib/post-builder/multi-oh-caption-synth";
import type { RoundupType, SourceMls } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// why: Haiku usually returns inside 2-3s. 30s ceiling covers cold
// starts + the occasional slow connection without letting a wedged
// upstream tie up the function indefinitely.
export const maxDuration = 30;

const VALID_TONES = [
  "auto",
  "coastal",
  "family",
  "investor",
  "cozy",
  "editorial",
] as const satisfies readonly CaptionTone[];

const VALID_SOURCE_MLS = ["cmc", "sjsr", "bright"] as const;

interface RawProperty {
  address?: unknown;
  city?: unknown;
  mls_number?: unknown;
  source_mls?: unknown;
  unit_number?: unknown;
  list_price?: unknown;
  property_type?: unknown;
  oh_start_at?: unknown;
  oh_end_at?: unknown;
  oh_sessions?: unknown;
  // 2026-08-19 — roundup milestone fields.
  event_date?: unknown;
  price_old?: unknown;
  price_new?: unknown;
}

interface RawBody {
  properties?: unknown;
  tone?: unknown;
  hostingAgentNames?: unknown;
  captionOverride?: unknown;
  /** 2026-08-19 — roundup kind; absent = open_house. */
  roundup_type?: unknown;
}

/**
 * Defensive parser — narrows the raw POST body into the AI / synth input
 * shape. Returns null on any structural problem so the route can 400 the
 * caller without throwing.
 */
function parseBody(raw: unknown): {
  ok: true;
  input: MultiOHCaptionInput;
} | {
  ok: false;
  error: string;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const body = raw as RawBody;

  if (!Array.isArray(body.properties) || body.properties.length === 0) {
    return { ok: false, error: "properties[] required (non-empty)" };
  }

  const properties: MultiOHCaptionProperty[] = [];
  for (const rawProp of body.properties as RawProperty[]) {
    if (!rawProp || typeof rawProp !== "object") {
      return { ok: false, error: "property must be an object" };
    }
    const mlsNumber =
      typeof rawProp.mls_number === "string" ? rawProp.mls_number : null;
    if (!mlsNumber) {
      return { ok: false, error: "property.mls_number required" };
    }
    const sourceMls: SourceMls = (() => {
      if (typeof rawProp.source_mls !== "string") return null;
      const v = rawProp.source_mls;
      if ((VALID_SOURCE_MLS as readonly string[]).includes(v)) {
        return v as Exclude<SourceMls, null>;
      }
      return null;
    })();
    properties.push({
      address: typeof rawProp.address === "string" ? rawProp.address : null,
      city: typeof rawProp.city === "string" ? rawProp.city : null,
      mls_number: mlsNumber,
      source_mls: sourceMls,
      unit_number:
        typeof rawProp.unit_number === "string" ? rawProp.unit_number : null,
      list_price:
        typeof rawProp.list_price === "number" && Number.isFinite(rawProp.list_price)
          ? rawProp.list_price
          : null,
      property_type:
        typeof rawProp.property_type === "string" ? rawProp.property_type : null,
      oh_start_at:
        typeof rawProp.oh_start_at === "string" ? rawProp.oh_start_at : null,
      oh_end_at:
        typeof rawProp.oh_end_at === "string" ? rawProp.oh_end_at : null,
      // why: oh_sessions is optional — when the wizard sends per-day
      // sessions, we want them; otherwise we fall back to start/end pair.
      oh_sessions: Array.isArray(rawProp.oh_sessions)
        ? rawProp.oh_sessions
            .filter(
              (s): s is { start_at: string | null; end_at: string | null } => {
                if (!s || typeof s !== "object") return false;
                const sObj = s as Record<string, unknown>;
                return (
                  (typeof sObj.start_at === "string" || sObj.start_at === null) &&
                  (typeof sObj.end_at === "string" || sObj.end_at === null)
                );
              },
            )
        : undefined,
      event_date:
        typeof rawProp.event_date === "string" ? rawProp.event_date : null,
      price_old:
        typeof rawProp.price_old === "number" &&
        Number.isFinite(rawProp.price_old)
          ? rawProp.price_old
          : null,
      price_new:
        typeof rawProp.price_new === "number" &&
        Number.isFinite(rawProp.price_new)
          ? rawProp.price_new
          : null,
    });
  }

  // 2026-08-19 — roundup kind pass-through (absent/unknown → open_house).
  const roundupType: RoundupType =
    body.roundup_type === "under_contract" ||
    body.roundup_type === "price_reduction"
      ? body.roundup_type
      : "open_house";

  let tone: CaptionTone = "auto";
  if (typeof body.tone === "string") {
    if (!(VALID_TONES as readonly string[]).includes(body.tone)) {
      return { ok: false, error: "tone must be one of " + VALID_TONES.join(", ") };
    }
    tone = body.tone as CaptionTone;
  }

  const captionOverrideRaw =
    typeof body.captionOverride === "string" ? body.captionOverride : null;
  const captionOverride =
    captionOverrideRaw && captionOverrideRaw.trim().length > 0
      ? captionOverrideRaw
      : null;

  return {
    ok: true,
    input: {
      roundup_type: roundupType,
      properties,
      tone,
      caption_override: captionOverride,
    },
  };
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  // ---- Try Claude; fall back to deterministic ----------------------------
  let result: MultiOHCaptionResult;
  let source: "claude-haiku-4-5" | "deterministic";
  try {
    result = await synthesizeMultiOHCaptionAI(parsed.input);
    source = "claude-haiku-4-5";
  } catch (err) {
    console.error(
      "[multi-oh-caption-preview] AI synth failed, falling back to deterministic:",
      err,
    );
    result = synthesizeMultiOHCaption(parsed.input);
    source = "deterministic";
  }

  return NextResponse.json(
    { ok: true, result },
    {
      status: 200,
      headers: {
        // why: surfacing the source as a response header (not in the body)
        // keeps the body shape identical to the deterministic synth's
        // typed output. Client reads the header to decide whether to
        // show "AI caption unavailable" hint copy.
        "X-Caption-Source": source,
        // Disable any intermediary caching — the input changes per-request
        // and we want a fresh AI call on each preview round.
        "Cache-Control": "no-store",
      },
    },
  );
}
