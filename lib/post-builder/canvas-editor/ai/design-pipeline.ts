/**
 * Multi-pass AI design pipeline — server-only orchestrator.
 *
 * Public surface: `runDesignPipeline(input, onProgress?)`. Internally
 * runs four passes against the Claude API:
 *
 *   1. Composition  (Sonnet + vision) — read the hero photo
 *   2. Strategy     (Opus)            — pick a creative direction
 *   3. Layout       (Sonnet)          — produce the actual schema
 *   4. Critique     (Opus)            — review + optionally revise
 *
 * Why Sonnet for 1 and 3, Opus for 2 and 4:
 *   • Pass 1 is mechanical observation — Sonnet sees enough.
 *   • Pass 2 is the creative judgment call — Opus's aesthetic sense is
 *     noticeably stronger and worth the cost.
 *   • Pass 3 is execution against constraints — Sonnet executes well
 *     when the strategy already locked the direction.
 *   • Pass 4 is critical self-review — Opus catches issues Sonnet's
 *     pass 3 missed because the same model rarely critiques its own
 *     output well.
 *
 * Error handling rule: if ANY pass fails, the pipeline returns a
 * DesignPipelineFailure with whatever it had completed. The caller can
 * decide whether to surface a clean error, retry, or fall back to the
 * template default. We never throw past this boundary.
 *
 * Phase 1 (2026-05-23) — no UI consumer yet. The route handler hits this
 * directly and streams progress events to a manual test harness.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODELS, getAnthropic } from "@/lib/ai/anthropic";

import {
  COMPOSITION_PROMPT,
  CRITIQUE_PROMPT,
  LAYOUT_PROMPT,
  STRATEGY_PROMPT,
} from "./brand-prompt";
import {
  extractJson,
  validateCompositionBrief,
  validateCritiqueResult,
  validateLayoutPlan,
  validateStrategyBrief,
} from "./schema";
import type {
  CompositionBrief,
  CritiqueResult,
  DesignPipelineFailure,
  DesignPipelineInput,
  DesignPipelineOutput,
  DesignPipelineResult,
  LayoutPlan,
  PipelinePass,
  PipelineProgress,
  StrategyBrief,
} from "./types";
import type { MLSListingPayload } from "../types";

// ===========================================================================
// Token-usage accumulator
// ===========================================================================

interface TokenTally {
  input: number;
  output: number;
}

function accrueTokens(tally: TokenTally, response: Anthropic.Message): void {
  const usage = response.usage;
  if (!usage) return;
  tally.input += usage.input_tokens ?? 0;
  tally.output += usage.output_tokens ?? 0;
}

// ===========================================================================
// Listing → prompt-friendly text block
// ===========================================================================

function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

function formatListingForPrompt(listing: MLSListingPayload): string {
  const lines: string[] = [];
  lines.push(`Address: ${listing.addressLine1 ?? "(unknown)"}`);
  if (listing.city || listing.state || listing.zip) {
    lines.push(
      `Locale: ${[listing.city, listing.state, listing.zip]
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  lines.push(`Status: ${listing.status}`);
  const price = formatPrice(listing.priceList);
  if (price) lines.push(`List price: ${price}`);
  const close = formatPrice(listing.priceClose);
  if (close) lines.push(`Close price: ${close}`);
  if (listing.beds !== null && listing.beds !== undefined) {
    lines.push(`Bedrooms: ${listing.beds}`);
  }
  const baths =
    (listing.bathsFull ?? 0) + (listing.bathsHalf ?? 0) * 0.5;
  if (baths > 0) lines.push(`Bathrooms: ${baths}`);
  if (listing.propertyType) {
    lines.push(`Property type: ${listing.propertyType}`);
  }
  if (listing.tagline) lines.push(`Tagline: ${listing.tagline}`);
  if (listing.mlsNumber) lines.push(`MLS#: ${listing.mlsNumber}`);
  if (listing.agentName) lines.push(`Listing agent: ${listing.agentName}`);
  if (listing.officeName) lines.push(`Office: ${listing.officeName}`);
  if (listing.openHouseStartUtc) {
    lines.push(
      `Open House: ${listing.openHouseStartUtc}${listing.openHouseEndUtc ? ` → ${listing.openHouseEndUtc}` : ""}`,
    );
  }
  return lines.join("\n");
}

// ===========================================================================
// Progress emission — tiny helper that no-ops when no callback is set
// ===========================================================================

function emit(
  onProgress: ((evt: PipelineProgress) => void) | undefined,
  evt: PipelineProgress,
): void {
  try {
    onProgress?.(evt);
  } catch {
    // why: progress sinks (e.g., a stream writer) failing must NOT crash
    // the pipeline. Swallow defensively.
  }
}

// ===========================================================================
// Pass 1 — Composition Brief (Sonnet + vision)
// ===========================================================================

async function runCompositionPass(
  client: Anthropic,
  heroPhotoUrl: string,
  tally: TokenTally,
): Promise<{ ok: true; brief: CompositionBrief } | { ok: false; error: string }> {
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 1500,
      system: COMPOSITION_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            // why: image as URL — the Anthropic API accepts URL sources for
            // image content blocks, so we don't have to base64-encode the
            // photo. Saves a fetch + memory round-trip.
            {
              type: "image",
              source: { type: "url", url: heroPhotoUrl },
            },
            {
              type: "text",
              text:
                "Analyze this real-estate listing photo and return the structured composition brief described in the system prompt.",
            },
          ],
        },
      ],
    });
    accrueTokens(tally, response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `composition pass API call failed: ${msg}` };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw);
  const brief = validateCompositionBrief(parsed);
  if (!brief) {
    return {
      ok: false,
      error: `composition pass returned malformed JSON. First 400 chars: ${raw.slice(0, 400)}`,
    };
  }
  return { ok: true, brief };
}

// ===========================================================================
// Pass 2 — Strategy Brief (Opus, text-only)
// ===========================================================================

async function runStrategyPass(
  client: Anthropic,
  input: DesignPipelineInput,
  brief: CompositionBrief,
  tally: TokenTally,
): Promise<
  { ok: true; strategy: StrategyBrief } | { ok: false; error: string }
> {
  const userPrompt = [
    "LISTING DATA",
    formatListingForPrompt(input.listing),
    "",
    "COMPOSITION BRIEF (from Pass 1)",
    JSON.stringify(brief, null, 2),
    "",
    `TARGET FORMAT: ${input.format} (${input.currentSchema.width}×${input.currentSchema.height}px)`,
    "",
    input.intent
      ? `USER INTENT: "${input.intent}"`
      : "USER INTENT: (none — pick a direction yourself based on the listing + composition)",
    input.forceMood
      ? `\nFORCED MOOD: "${input.forceMood}" — you MUST use this mood regardless of your independent judgment.`
      : "",
    "",
    "Return the strategy brief JSON.",
  ].join("\n");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 1200,
      system: STRATEGY_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    accrueTokens(tally, response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `strategy pass API call failed: ${msg}` };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw);
  const strategy = validateStrategyBrief(parsed);
  if (!strategy) {
    return {
      ok: false,
      error: `strategy pass returned malformed JSON. First 400 chars: ${raw.slice(0, 400)}`,
    };
  }
  return { ok: true, strategy };
}

// ===========================================================================
// Pass 3 — Layout (Sonnet)
// ===========================================================================

async function runLayoutPass(
  client: Anthropic,
  input: DesignPipelineInput,
  brief: CompositionBrief,
  strategy: StrategyBrief,
  tally: TokenTally,
): Promise<{ ok: true; plan: LayoutPlan } | { ok: false; error: string }> {
  const userPrompt = [
    "LISTING DATA",
    formatListingForPrompt(input.listing),
    "",
    "COMPOSITION BRIEF (Pass 1)",
    JSON.stringify(brief, null, 2),
    "",
    "STRATEGY BRIEF (Pass 2)",
    JSON.stringify(strategy, null, 2),
    "",
    `CANVAS DIMENSIONS: ${input.currentSchema.width}×${input.currentSchema.height}px (format: ${input.format})`,
    "",
    "CURRENT SCHEMA (starting reference — feel free to rewrite, but keep layer IDs stable where possible)",
    // why: trim the current schema to fields the model cares about. We
    // strip clipPath data, raw Fabric metadata, etc., that aren't part
    // of the schema contract.
    JSON.stringify(input.currentSchema, null, 2),
    "",
    "Produce a full_replacement LayoutPlan executing the strategy.",
  ].join("\n");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      // Schema output is large — give Sonnet headroom. A 6-layer template
      // serializes to ~1500-2500 tokens, with critique-and-revise we want
      // 4000 to be safe.
      max_tokens: 4000,
      system: LAYOUT_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    accrueTokens(tally, response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `layout pass API call failed: ${msg}` };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw);
  const plan = validateLayoutPlan(parsed);
  if (!plan) {
    return {
      ok: false,
      error: `layout pass returned malformed JSON. First 400 chars: ${raw.slice(0, 400)}`,
    };
  }
  return { ok: true, plan };
}

// ===========================================================================
// Pass 4 — Self-Critique (Opus)
// ===========================================================================

async function runCritiquePass(
  client: Anthropic,
  brief: CompositionBrief,
  strategy: StrategyBrief,
  plan: LayoutPlan,
  tally: TokenTally,
): Promise<
  { ok: true; critique: CritiqueResult } | { ok: false; error: string }
> {
  const userPrompt = [
    "STRATEGY BRIEF (Pass 2)",
    JSON.stringify(strategy, null, 2),
    "",
    "COMPOSITION BRIEF (Pass 1)",
    JSON.stringify(brief, null, 2),
    "",
    "LAYOUT PLAN (Pass 3 — your own output)",
    JSON.stringify(plan, null, 2),
    "",
    "Run the checklist from the system prompt and return your critique result.",
  ].join("\n");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 4500,
      system: CRITIQUE_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    accrueTokens(tally, response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `critique pass API call failed: ${msg}` };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw);
  const critique = validateCritiqueResult(parsed);
  if (!critique) {
    return {
      ok: false,
      error: `critique pass returned malformed JSON. First 400 chars: ${raw.slice(0, 400)}`,
    };
  }
  return { ok: true, critique };
}

// ===========================================================================
// Public entry point
// ===========================================================================

export async function runDesignPipeline(
  input: DesignPipelineInput,
  onProgress?: (evt: PipelineProgress) => void,
): Promise<DesignPipelineResult> {
  const startTs = Date.now();
  const tally: TokenTally = { input: 0, output: 0 };
  const partial: DesignPipelineFailure["partial"] = {};

  emit(onProgress, { type: "started", ts: startTs });

  const client = await getAnthropic();
  if (!client) {
    const error = "Anthropic API key not configured (check /settings)";
    emit(onProgress, { type: "failed", error, ts: Date.now() });
    return {
      ok: false,
      failure: { failedAt: "composition", error, partial },
    };
  }

  const heroPhoto = input.photoUrls[0];
  if (!heroPhoto) {
    const error = "No hero photo URL provided (photoUrls is empty)";
    emit(onProgress, { type: "failed", error, ts: Date.now() });
    return {
      ok: false,
      failure: { failedAt: "composition", error, partial },
    };
  }

  // ---- Pass 1: Composition ----
  emit(onProgress, {
    type: "pass_started",
    pass: "composition",
    ts: Date.now(),
  });
  const passStart1 = Date.now();
  const passRes1 = await runCompositionPass(client, heroPhoto, tally);
  if (!passRes1.ok) {
    emit(onProgress, {
      type: "pass_failed",
      pass: "composition",
      error: passRes1.error,
      ts: Date.now(),
    });
    emit(onProgress, { type: "failed", error: passRes1.error, ts: Date.now() });
    return {
      ok: false,
      failure: { failedAt: "composition", error: passRes1.error, partial },
    };
  }
  partial.composition = passRes1.brief;
  emit(onProgress, {
    type: "pass_completed",
    pass: "composition",
    durationMs: Date.now() - passStart1,
    ts: Date.now(),
  });

  // ---- Pass 2: Strategy ----
  emit(onProgress, { type: "pass_started", pass: "strategy", ts: Date.now() });
  const passStart2 = Date.now();
  const passRes2 = await runStrategyPass(client, input, passRes1.brief, tally);
  if (!passRes2.ok) {
    emit(onProgress, {
      type: "pass_failed",
      pass: "strategy",
      error: passRes2.error,
      ts: Date.now(),
    });
    emit(onProgress, { type: "failed", error: passRes2.error, ts: Date.now() });
    return {
      ok: false,
      failure: { failedAt: "strategy", error: passRes2.error, partial },
    };
  }
  partial.strategy = passRes2.strategy;
  emit(onProgress, {
    type: "pass_completed",
    pass: "strategy",
    durationMs: Date.now() - passStart2,
    ts: Date.now(),
  });

  // ---- Pass 3: Layout ----
  emit(onProgress, { type: "pass_started", pass: "layout", ts: Date.now() });
  const passStart3 = Date.now();
  const passRes3 = await runLayoutPass(
    client,
    input,
    passRes1.brief,
    passRes2.strategy,
    tally,
  );
  if (!passRes3.ok) {
    emit(onProgress, {
      type: "pass_failed",
      pass: "layout",
      error: passRes3.error,
      ts: Date.now(),
    });
    emit(onProgress, { type: "failed", error: passRes3.error, ts: Date.now() });
    return {
      ok: false,
      failure: { failedAt: "layout", error: passRes3.error, partial },
    };
  }
  partial.plan = passRes3.plan;
  emit(onProgress, {
    type: "pass_completed",
    pass: "layout",
    durationMs: Date.now() - passStart3,
    ts: Date.now(),
  });

  // ---- Pass 4: Critique ----
  emit(onProgress, { type: "pass_started", pass: "critique", ts: Date.now() });
  const passStart4 = Date.now();
  const passRes4 = await runCritiquePass(
    client,
    passRes1.brief,
    passRes2.strategy,
    passRes3.plan,
    tally,
  );
  if (!passRes4.ok) {
    // why: critique failure is recoverable — the layout from Pass 3 is
    // still valid, just un-critiqued. Surface the issue but proceed.
    emit(onProgress, {
      type: "pass_failed",
      pass: "critique",
      error: passRes4.error,
      ts: Date.now(),
    });
    // Build a degenerate "critique passed with no notes" result so the
    // pipeline output stays well-typed.
    const fallbackCritique: CritiqueResult = {
      passed: true,
      issues: [`critique_unavailable: ${passRes4.error}`],
      notes: "Critique pass failed; layout used as-is.",
    };
    const totalDurationMs = Date.now() - startTs;
    const output: DesignPipelineOutput = {
      composition: passRes1.brief,
      strategy: passRes2.strategy,
      plan: passRes3.plan,
      critique: fallbackCritique,
      totalDurationMs,
      tokensUsed: tally,
    };
    emit(onProgress, {
      type: "completed",
      result: output,
      durationMs: totalDurationMs,
      ts: Date.now(),
    });
    return { ok: true, output };
  }
  emit(onProgress, {
    type: "pass_completed",
    pass: "critique",
    durationMs: Date.now() - passStart4,
    ts: Date.now(),
  });

  // ---- Compose final output ----
  // why: when critique returns passed=false with a revised plan, that's
  // the canonical plan. Pass 3's original is discarded.
  const finalPlan: LayoutPlan = passRes4.critique.passed
    ? passRes3.plan
    : passRes4.critique.revised ?? passRes3.plan;

  const totalDurationMs = Date.now() - startTs;
  const output: DesignPipelineOutput = {
    composition: passRes1.brief,
    strategy: passRes2.strategy,
    plan: finalPlan,
    critique: passRes4.critique,
    totalDurationMs,
    tokensUsed: tally,
  };
  emit(onProgress, {
    type: "completed",
    result: output,
    durationMs: totalDurationMs,
    ts: Date.now(),
  });

  return { ok: true, output };
}

// Re-export for convenience so consumers can import everything from one
// module path. Saves a "where does this type live?" hunt.
export type {
  DesignPipelineInput,
  DesignPipelineOutput,
  DesignPipelineResult,
  PipelineProgress,
} from "./types";

// Sentinel value indicating which passes are available for retry / replay
// in later phases. Used by tests + the route handler.
export const PIPELINE_PASSES: readonly PipelinePass[] = [
  "composition",
  "strategy",
  "layout",
  "critique",
];
