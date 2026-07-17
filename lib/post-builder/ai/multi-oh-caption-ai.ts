/**
 * Claude-powered multi-OH caption synth.
 *
 * Drop-in replacement for `synthesizeMultiOHCaption` (the deterministic
 * pool-pick + template assembly path) that produces captions via a
 * single Haiku call. Returns the SAME `MultiOHCaptionResult` shape so
 * callers can swap implementations without downstream changes.
 *
 * Error contract: throws on any failure (API error, malformed JSON,
 * shape mismatch). The caller — either the multi-OH generate route or
 * the wizard's preview endpoint — catches and falls back to the
 * deterministic synth. We do NOT swallow errors here because the caller
 * needs to know to switch sources.
 *
 * SDK init: reuses `getAnthropic()` from `lib/ai/anthropic.ts`, which
 * reads the key from the `api_credentials` table (platform='claude')
 * and falls back to `ANTHROPIC_API_KEY` env. Same pattern as the canvas
 * design pipeline (`lib/post-builder/canvas-editor/ai/design-pipeline.ts`).
 *
 * Cost: per-call usage is logged so the cost tab can sample real spend.
 * At Haiku rates (~$1/M input, $5/M output as of 2026-05) a typical
 * 6-property multi-OH call runs ~$0.001 (~0.1¢). See
 * estimateCostCents() below for the per-call math.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "@/lib/ai/anthropic";
import {
  buildGeoPhrase,
  detectTone,
  sortPropertiesByOpenHouse,
  type CaptionTone,
  type MultiOHCaptionInput,
  type MultiOHCaptionProperty,
  type MultiOHCaptionResult,
} from "@/lib/post-builder/multi-oh-caption-synth";
import type { SourceMls } from "@/lib/post-builder/types";

import {
  buildSystemPrompt,
  buildUserPrompt,
  type MultiOhCaptionPromptInput,
} from "./multi-oh-caption-prompt";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Haiku 4.5 pinned. Task spec calls for this exact model id (not via
 * ANTHROPIC_MODELS because that constant covers sonnet/opus only for the
 * design pipeline). Inlined so a future bump is one line to find.
 */
const CAPTION_MODEL = "claude-haiku-4-5-20251001";

/** Temperature pinned at 0.3 — low enough for consistent shape, high
 *  enough for the opener pool to vary across repeat generations. */
const CAPTION_TEMPERATURE = 0.3;

/** 2000 is comfortable for IG body (≤2100 chars) + FB + TT + 15 hashtag
 *  strings + JSON wrapper. We've never observed Claude exceed ~1400. */
const CAPTION_MAX_TOKENS = 2000;

// ---------------------------------------------------------------------------
// Pricing — Haiku rates as of 2026-05
// ---------------------------------------------------------------------------

const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;

/** Rough per-call cost in CENTS (not dollars). Returned with one
 *  decimal of precision for log readability — anything finer is noise. */
function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputUsd = (inputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M;
  const outputUsd = (outputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
  return Math.round((inputUsd + outputUsd) * 100 * 100) / 100; // round to 0.01¢
}

// ---------------------------------------------------------------------------
// JSON extraction + validation
// ---------------------------------------------------------------------------

/**
 * Robust JSON extract — handles Claude wrapping the payload in ```json
 * fences, leading prose, or trailing notes. Mirrors `extractJson` in
 * `lib/post-builder/canvas-editor/ai/schema.ts` so behavior matches the
 * rest of the AI features in the codebase.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Find the first `{` and last `}` and try again — handles a leading
    // "Here's the JSON:" or a trailing apology.
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

interface PlatformPayload {
  body: string;
  hashtags: string[];
}

interface CaptionAiPayload {
  ig: PlatformPayload;
  fb: PlatformPayload;
  tt: PlatformPayload;
}

/**
 * Manual shape validation — no Zod, same as the rest of the codebase.
 * Returns null on any structural problem so the caller falls back.
 */
function validateCaptionPayload(parsed: unknown): CaptionAiPayload | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  function readPlatform(key: "ig" | "fb" | "tt"): PlatformPayload | null {
    const slot = obj[key];
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) return null;
    const slotObj = slot as Record<string, unknown>;
    const body = slotObj.body;
    const hashtags = slotObj.hashtags;
    if (typeof body !== "string" || body.length === 0) return null;
    if (!Array.isArray(hashtags)) return null;
    const stringTags = hashtags.filter(
      (h): h is string => typeof h === "string" && h.length > 0,
    );
    // why: relax to "at least 1" rather than "exactly 5" because the
    // override path may want to skip auto-append. We enforce the 5-tag
    // brand policy at the caller, not at the validator.
    if (stringTags.length === 0) return null;
    return { body, hashtags: stringTags };
  }

  const ig = readPlatform("ig");
  const fb = readPlatform("fb");
  const tt = readPlatform("tt");
  if (!ig || !fb || !tt) return null;
  return { ig, fb, tt };
}

// ---------------------------------------------------------------------------
// MLS hashtag helper — mirror of the deterministic synth's helper
// ---------------------------------------------------------------------------

function canonicalMlsHashtag(
  mls_number: string,
  source_mls: SourceMls,
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (!normalized) return "";
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}

// ---------------------------------------------------------------------------
// Property → prompt window helper
// ---------------------------------------------------------------------------

const PROMPT_TZ = "America/New_York";

/**
 * Format a property's OH sessions as a single human-readable window string
 * ("Saturday, May 16 | 10-12; Sunday, May 17 | 12-2") for the AI prompt.
 * The prompt does NOT do timezone math — we hand it pre-formatted strings.
 */
function formatOhWindowForPrompt(p: MultiOHCaptionProperty): string {
  const sessions =
    p.oh_sessions && p.oh_sessions.length > 0
      ? p.oh_sessions
      : [{ start_at: p.oh_start_at ?? null, end_at: p.oh_end_at ?? null }];
  const parts: string[] = [];
  for (const s of sessions) {
    if (!s.start_at) continue;
    const start = new Date(s.start_at);
    if (Number.isNaN(start.getTime())) continue;
    const dayLabel = start.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: PROMPT_TZ,
    });
    const startHour = formatCompactHour(start);
    let timeRange = startHour;
    if (s.end_at) {
      const end = new Date(s.end_at);
      if (!Number.isNaN(end.getTime())) {
        timeRange = `${startHour}-${formatCompactHour(end)}`;
      }
    }
    parts.push(`${dayLabel} | ${timeRange}`);
  }
  return parts.join("; ");
}

function formatCompactHour(d: Date): string {
  const hour12 = d.toLocaleString("en-US", {
    timeZone: PROMPT_TZ,
    hour: "numeric",
    hour12: true,
  });
  const hourPart = hour12.replace(/\s?(AM|PM)$/i, "").trim();
  const minuteProbe = d.toLocaleString("en-US", {
    timeZone: PROMPT_TZ,
    hour12: false,
    minute: "2-digit",
  });
  const minutes = parseInt(minuteProbe, 10);
  if (!Number.isFinite(minutes) || minutes === 0) return hourPart;
  const mm = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${hourPart}:${mm}`;
}

// ---------------------------------------------------------------------------
// Deterministic seed + tone resolution mirrors (small helpers we don't
// want to re-export from the synth module — used only to derive prompt
// inputs)
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resolveTone(
  requested: CaptionTone | undefined,
  properties: readonly MultiOHCaptionProperty[],
): Exclude<CaptionTone, "auto"> {
  const r: CaptionTone = requested ?? "auto";
  return r === "auto" ? detectTone(properties) : r;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Call Claude Haiku for a multi-OH caption set. Returns the same shape
 * as the deterministic synth — IG / FB / TT bodies + 5-tag arrays + a
 * legacy mirror that matches the IG variant. Throws on any failure.
 */
export async function synthesizeMultiOHCaptionAI(
  input: MultiOHCaptionInput,
): Promise<MultiOHCaptionResult> {
  // why: chronological order (earliest OH date first) so the AI's day
  // sections never appear out of order. The prompt also instructs
  // chronological grouping, but sorting the source list is the reliable
  // guarantee — the model just lists what it's given, in order.
  const properties = sortPropertiesByOpenHouse(input.properties);
  if (properties.length === 0) {
    throw new Error("[multi-oh-ai-caption] no properties supplied");
  }

  // ---- Resolve tone, geo hint, seed -------------------------------------
  const resolvedTone = resolveTone(input.tone, properties);
  const mlsKey = properties.map((p) => p.mls_number).join(",");
  const seed = hashSeed(`${properties.length}|${mlsKey}`);
  const geoHint = buildGeoPhrase(properties, seed);

  // ---- Build prompt inputs ---------------------------------------------
  const promptInput: MultiOhCaptionPromptInput = {
    properties: properties.map((p) => ({
      address: p.address,
      city: p.city,
      oh_window: formatOhWindowForPrompt(p),
    })),
    tone: input.tone ?? "auto",
    hostingAgentNames: [], // why: hosting agents stay slide-only — see
    // prompt rules. We don't surface names through this synth even though
    // the input type accepts them — the prompt explicitly tells Claude to
    // ignore them, and adding them here would just be tempting Claude
    // to violate the rule.
    captionOverride: input.caption_override ?? null,
    geoHint,
    resolvedTone,
  };

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(promptInput);

  // ---- Get client + call -----------------------------------------------
  const client = await getAnthropic();
  if (!client) {
    throw new Error(
      "[multi-oh-ai-caption] Anthropic API key not configured (check /settings)",
    );
  }

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: CAPTION_MODEL,
      max_tokens: CAPTION_MAX_TOKENS,
      temperature: CAPTION_TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[multi-oh-ai-caption] API call failed: ${msg}`);
  }

  // ---- Log usage --------------------------------------------------------
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const costCents = estimateCostCents(inputTokens, outputTokens);
  console.log("[multi-oh-ai-caption] usage:", {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_estimate_cents: costCents,
  });

  // ---- Parse + validate -------------------------------------------------
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw);
  const payload = validateCaptionPayload(parsed);
  if (!payload) {
    throw new Error(
      `[multi-oh-ai-caption] malformed JSON. First 400 chars: ${raw.slice(0, 400)}`,
    );
  }

  // ---- Adapt to the deterministic synth's result shape ------------------
  const firstProp = properties[0];
  const anchorMls = firstProp
    ? canonicalMlsHashtag(firstProp.mls_number, firstProp.source_mls ?? null)
    : "";

  // why: keep the legacy mirror = IG variant. Downstream consumers that
  // haven't migrated to `captions_by_platform` read `.legacy.caption`.
  const result: MultiOHCaptionResult = {
    legacy: {
      caption: payload.ig.body,
      hashtags: payload.ig.hashtags,
      mls_hashtag: anchorMls,
    },
    captions: {
      instagram: { caption: payload.ig.body, hashtags: payload.ig.hashtags },
      facebook: { caption: payload.fb.body, hashtags: payload.fb.hashtags },
      tiktok: { caption: payload.tt.body, hashtags: payload.tt.hashtags },
    },
    resolved_tone: resolvedTone,
  };

  return result;
}
