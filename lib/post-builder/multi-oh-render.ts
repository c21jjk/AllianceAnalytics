import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenshotHtml } from "./chromium";
import { escapeHtml } from "./templates/primitives/_shared";
import {
  PLATFORM_DIMENSIONS,
} from "./canvas-editor/types";
import type {
  MultiOHEventInput,
  MultiOHEventProperty,
  PostFormat,
} from "./types";

/**
 * Multi-property Open House event-overview renderer.
 *
 * Sits beside V1's `render.ts`. V1 renders a single-listing graphic via a
 * template registry + bound listing data. This module renders the audience-
 * facing "event hero" card that introduces a multi-OH carousel — a polished
 * flyer-style image listing every property (address + time + price) plus the
 * hosting agent's contact info.
 *
 * Why parallel and not a registry entry:
 *   The V1 registry contract is (listing, theme, heroImageDataUri) → HTML.
 *   The event hero takes N properties and a primary agent — a different
 *   shape entirely. Forcing it through the registry would mean fudging a
 *   "fake listing" + smuggling the property list through customizations,
 *   which would tangle the V1 templates with multi-OH concerns. A separate
 *   module keeps both surfaces clean.
 *
 * Flow:
 *   1. Pick the emitter for the requested format (square / portrait / story).
 *   2. The emitter builds a complete <!doctype html> document at the format's
 *      exact pixel dimensions, with all user-controlled strings escaped.
 *   3. Headless Chromium screenshots the document via the shared helper.
 *   4. Upload the PNG to the same `post-builder-renders` bucket V1 uses, under
 *      a `multi_oh_event/{format}/{timestamp}.png` path.
 *   5. Return the public URL + storage path. The caller (the multi-oh
 *      generate route) stitches this into a generated_posts row alongside
 *      the per-property cards rendered through the V1 pipeline.
 */

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = "post-builder-renders";

export interface MultiOHRenderResult {
  image_url: string;
  image_path: string;
}

/**
 * Render the event-overview hero for a multi-property Open House carousel.
 *
 * Picks the format-specific HTML emitter, screenshots it via headless
 * Chromium, uploads the PNG to Supabase Storage, and returns the public URL
 * plus storage path.
 *
 * Throws on Chromium failure or Storage upload failure with a tagged
 * message so the caller can surface the cause without parsing nested errors.
 */
export async function renderMultiOHEventOverview(
  input: MultiOHEventInput,
): Promise<MultiOHRenderResult> {
  const emitter = pickEmitter(input.format);
  const html = emitter(input);

  const { width, height } = PLATFORM_DIMENSIONS[input.format];

  // why: tag the log label so cold-start traces from this path are easy to
  // grep from V1 single-listing renders sharing the same log channel.
  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      html,
      width,
      height,
      log_label: "multi-oh",
    });
  } catch (e) {
    throw new Error(
      `Multi-OH overview render failed via Chromium: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const supabase = createAdminClient();
  const path = `multi_oh_event/${input.format}/${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pngBytes, {
      contentType: "image/png",
      // why: events are typically one-off — a path collision means two posts
      // composed in the same millisecond, which shouldn't happen. If it does
      // we want the upload to fail loudly rather than silently overwrite
      // someone else's render.
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    throw new Error(
      `Multi-OH overview upload to Storage failed: ${uploadError.message}`,
    );
  }

  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  return {
    image_url: pub.publicUrl,
    image_path: path,
  };
}

// ---------------------------------------------------------------------------
// Format dispatch
// ---------------------------------------------------------------------------

/**
 * Map the requested PostFormat to its dedicated HTML emitter. Kept as a
 * standalone helper (not a `Record<PostFormat, ...>` constant) so the
 * exhaustiveness check below catches new formats at compile time.
 */
function pickEmitter(
  format: PostFormat,
): (input: MultiOHEventInput) => string {
  switch (format) {
    case "portrait_4x5":
      return emitEventOverviewPortrait;
    case "story_9x16":
      return emitEventOverviewStory;
    default: {
      // why: exhaustive check — if PostFormat gains a new variant, this
      // line fails to compile and forces a deliberate emitter update.
      const _never: never = format;
      throw new Error(`Unknown PostFormat: ${String(_never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Brand palette + typography (constants used by all three emitters)
// ---------------------------------------------------------------------------
//
// Centralized so a future brand-color tweak only touches this file. These
// mirror the Alliance Gold + Obsessed Grey values referenced in the V1
// primitives, with a softer off-white background since the event overview
// is a "flyer" — light surface with dark type, opposite of V1 where the
// hero photo carries the surface.

const BRAND = {
  gold: "#C9A961",
  goldDark: "#A68A4A",
  /** Page background — warm off-white, slightly creamier than pure #FCFCFB. */
  surface: "#FBF7EE",
  /** Card / row background, very faint contrast against the surface. */
  surfaceAlt: "#FCFCFB",
  /** Primary text — Obsessed Grey near-black. */
  ink: "#18181B",
  /** Secondary / muted text — used for city-state, hosted-by, and time. */
  inkMuted: "#525250",
  /** Hairline dividers between property rows. */
  divider: "#E5E5E2",
  /** Chip on the numbered marker — gold on dark for contrast on light bg. */
  chipInk: "#18181B",
} as const;

// ---------------------------------------------------------------------------
// Date / time formatting (Eastern time — project is NJ-based)
// ---------------------------------------------------------------------------

/**
 * Format one property's OH window as "Sat · 11:00 AM – 1:00 PM".
 *
 * Uses an EN DASH (U+2013) for the range separator — brand call: en dash
 * reads cleaner than a hyphen at large display sizes and matches typographic
 * standards for time ranges.
 *
 * - `start` null + `end` null → "Time TBA"
 * - `start` set + `end` null → just the start time
 * - both set                 → "Day · Start – End"
 * - parse failure            → "Time TBA" (defensive — don't take down the
 *   whole render because one ISO string is malformed upstream).
 */
function formatPropertyOH(
  start: string | null,
  end: string | null,
): string {
  if (!start) return "Time TBA";
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return "Time TBA";

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  }).format(startDate);

  const startTime = formatTimeOfDay(startDate);

  if (!end) {
    return `${weekday} · ${startTime}`;
  }
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) {
    return `${weekday} · ${startTime}`;
  }
  const endTime = formatTimeOfDay(endDate);
  // why: en dash (U+2013), not hyphen. Brand typography rule for ranges.
  return `${weekday} · ${startTime} – ${endTime}`;
}

/**
 * Format a Date as "11:00 AM" / "1:30 PM" in America/New_York. Always
 * renders minutes (zero-padded) so the time-range visually balances —
 * "11:00 AM – 1:00 PM" looks more deliberate than "11 AM – 1 PM" at the
 * font sizes this template uses.
 */
function formatTimeOfDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(d);
}

/** Format USD price for the per-row price chip. Returns null when unset. */
function formatPriceChip(price: number | null): string | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Compose the "city, state ZIP" line — same pattern V1 primitives use, but
 * extracted here because the event hero renders this for every row.
 */
function composeCityStateZip(p: MultiOHEventProperty): string {
  return [
    [p.city, p.state].filter(Boolean).join(", "),
    p.zip ?? "",
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .trim();
}

// ---------------------------------------------------------------------------
// Density model — row heights + font scales adapt to property count
// ---------------------------------------------------------------------------
//
// The property list is the most important content. Hard rule: addresses
// must always be legible. Hierarchy of trim-downs as the list grows:
//   1. Tighten row height + reduce vertical padding.
//   2. Drop the "Hosted by {name}" sub-line at 8+.
//   3. Shrink the numbered chip + reduce its inset.
//
// Adjusted per format because story 9:16 has more vertical room than square,
// and portrait sits between. Returns concrete pixel values + a global font
// scale that the emitter multiplies into each text-style block.

interface RowDensity {
  /** Total height per property row in px. */
  rowHeight: number;
  /** Vertical padding inside the row, px. */
  rowPadY: number;
  /** Address font-size in px (Inter 700). */
  addressSize: number;
  /** Sub-line (city-state-time) font-size in px. */
  subSize: number;
  /** Numbered chip diameter in px. */
  chipSize: number;
  /** Chip font-size in px. */
  chipFontSize: number;
  /** Price chip font-size in px. */
  priceSize: number;
  /** Whether to draw the per-row "Hosted by …" sub-line if available. */
  showHostedBy: boolean;
  /** Whether to draw the divider rule between rows. */
  showDivider: boolean;
}

/**
 * Pick density values for a given (propertyCount, format) tuple.
 *
 * Tiers chosen by feel after laying out the three counts at the visual spec:
 *   • 2-3 properties → "spacious"  — addresses ~36-46px, ~140-150px per row
 *   • 4-6 properties → "balanced"  — addresses ~30-36px, ~90-110px per row
 *   • 7-9 properties → "compact"   — addresses ~24-28px, ~60-72px per row
 *
 * Each format applies its own multiplier on top of the base tier — story
 * 9:16 has the most vertical real estate, so its rows can be slightly
 * taller; square is the tightest constraint.
 */
export function computeRowDensity(
  propertyCount: number,
  format: PostFormat,
): RowDensity {
  // why: clamp to MULTI_OH_MIN/MAX bounds; outside-of-range counts shouldn't
  // crash the renderer, even though the wizard should already validate.
  const n = Math.max(2, Math.min(9, propertyCount));

  // Format multipliers — story has the most room, square the least.
  const heightMul =
    format === "story_9x16" ? 1.18 : format === "portrait_4x5" ? 1.08 : 1.0;
  const fontMul =
    format === "story_9x16" ? 1.08 : format === "portrait_4x5" ? 1.04 : 1.0;

  if (n <= 3) {
    return {
      rowHeight: Math.round(150 * heightMul),
      rowPadY: 24,
      addressSize: Math.round(44 * fontMul),
      subSize: Math.round(22 * fontMul),
      chipSize: 56,
      chipFontSize: 26,
      priceSize: Math.round(30 * fontMul),
      showHostedBy: true,
      showDivider: true,
    };
  }
  if (n <= 6) {
    return {
      rowHeight: Math.round(108 * heightMul),
      rowPadY: 18,
      addressSize: Math.round(34 * fontMul),
      subSize: Math.round(18 * fontMul),
      chipSize: 46,
      chipFontSize: 22,
      priceSize: Math.round(24 * fontMul),
      showHostedBy: n <= 5,
      showDivider: true,
    };
  }
  // 7-9 — compact
  return {
    rowHeight: Math.round(78 * heightMul),
    rowPadY: 12,
    addressSize: Math.round(26 * fontMul),
    subSize: Math.round(15 * fontMul),
    chipSize: 36,
    chipFontSize: 18,
    priceSize: Math.round(20 * fontMul),
    // why: at 7+ properties even portrait gets crowded; drop the
    // hosted-by sub-line so addresses stay dominant.
    showHostedBy: false,
    showDivider: true,
  };
}

// ---------------------------------------------------------------------------
// Shared head + base CSS
// ---------------------------------------------------------------------------

/**
 * <head> shared by all three formats. Preloads Inter (body) + Playfair
 * Display (headline serif) from Google Fonts — `display=block` matches the
 * V1 primitives so Chromium waits for the font swap before screenshotting.
 */
function eventOverviewHead(title: string): string {
  return `<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700;800&display=block" rel="stylesheet" />
</head>`;
}

/**
 * Base CSS shared across all three formats. Per-format styles override the
 * dimensions + headline sizes; the layout primitives (rows, chips, footer
 * rule) reuse the same class names so the visual language stays consistent.
 *
 * Parameterized on density + dimensions so the emitter can hand the same
 * CSS structure different concrete sizes per format.
 */
function baseCss(args: {
  width: number;
  height: number;
  margin: number;
  density: RowDensity;
}): string {
  const { width, height, margin, density } = args;
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${width}px; height: ${height}px;
    overflow: hidden; background: ${BRAND.surface};
  }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: ${BRAND.ink};
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame {
    position: relative;
    width: ${width}px; height: ${height}px;
    padding: ${margin}px;
    display: flex; flex-direction: column;
  }
  /* ─── Header ──────────────────────────────────────────────────── */
  .header {
    display: flex; flex-direction: column; gap: 18px;
    margin-bottom: 32px;
  }
  .eyebrow {
    display: flex; align-items: center; gap: 18px;
  }
  .eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-family: "Inter", sans-serif;
    font-size: 20px; font-weight: 700; letter-spacing: 0.32em;
    color: ${BRAND.goldDark}; text-transform: uppercase;
  }
  .event-title {
    font-family: "Playfair Display", Georgia, serif;
    font-weight: 700; line-height: 1.05; letter-spacing: -0.015em;
    color: ${BRAND.ink};
    /* Per-format override sets font-size. */
  }
  /* ─── Property list ───────────────────────────────────────────── */
  .properties {
    flex: 1 1 auto; display: flex; flex-direction: column;
    min-height: 0;
  }
  .row {
    position: relative;
    display: flex; align-items: center; gap: 22px;
    height: ${density.rowHeight}px;
    padding: ${density.rowPadY}px 0;
    ${density.showDivider ? `border-bottom: 1px solid ${BRAND.divider};` : ""}
  }
  .row:first-child { border-top: 1px solid ${BRAND.divider}; }
  .row-num {
    flex-shrink: 0;
    width: ${density.chipSize}px; height: ${density.chipSize}px;
    border-radius: 50%;
    background: linear-gradient(135deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);
    color: ${BRAND.chipInk};
    display: flex; align-items: center; justify-content: center;
    font-family: "Inter", sans-serif;
    font-size: ${density.chipFontSize}px; font-weight: 800;
    letter-spacing: -0.02em;
    box-shadow: 0 2px 6px rgba(166,138,74,0.25);
  }
  .row-body {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .row-address {
    font-family: "Inter", sans-serif;
    font-size: ${density.addressSize}px; font-weight: 700;
    line-height: 1.1; letter-spacing: -0.012em;
    color: ${BRAND.ink};
    /* why: prevent extreme-long addresses from blowing out the row width. */
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-sub {
    display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
    font-family: "Inter", sans-serif;
    font-size: ${density.subSize}px; font-weight: 500;
    color: ${BRAND.inkMuted};
  }
  .row-citystate {
    text-transform: uppercase; letter-spacing: 0.12em;
  }
  .row-dot {
    display: inline-block; width: 4px; height: 4px; border-radius: 50%;
    background: ${BRAND.gold}; vertical-align: middle;
  }
  .row-time {
    font-weight: 600; color: ${BRAND.ink};
  }
  .row-host {
    font-size: ${Math.max(13, Math.round(density.subSize * 0.85))}px;
    color: ${BRAND.inkMuted};
    font-style: italic; letter-spacing: 0.02em;
  }
  .row-right {
    flex-shrink: 0; display: flex; flex-direction: column;
    align-items: flex-end; gap: 6px;
  }
  .row-price {
    display: inline-block;
    padding: 6px 14px;
    background: ${BRAND.ink}; color: ${BRAND.gold};
    border-radius: 4px;
    font-family: "Inter", sans-serif;
    font-size: ${density.priceSize}px; font-weight: 800;
    letter-spacing: -0.01em;
  }
  /* ─── Footer (brand strip) ───────────────────────────────────── */
  /* The agent-name/phone block was removed 2026-05-21 — per-property
     hosting attribution lives on each carousel slide. Only the brand
     strip remains here as the hero's bottom anchor. */
  .agent-block {
    margin-top: 32px;
    padding-top: 28px;
    border-top: 2px solid ${BRAND.ink};
    /* why: thick rule above the brand strip tells the eye "this is the close". */
    position: relative;
  }
  .agent-block::before {
    content: "";
    position: absolute; top: -2px; left: 0;
    width: 96px; height: 2px;
    background: linear-gradient(90deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);
  }
  /* ─── Brand mark ─────────────────────────────────────────────── */
  .brand-rule {
    width: 100%; height: 1px;
    background: linear-gradient(90deg, ${BRAND.gold} 0%, transparent 100%);
  }
  .brand-row {
    margin-top: 14px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .brand {
    display: flex; align-items: center; gap: 12px;
  }
  .brand-mark {
    width: 36px; height: 36px; border-radius: 7px;
    background: linear-gradient(135deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: "Inter", sans-serif;
    font-size: 16px; font-weight: 800;
    color: ${BRAND.ink}; letter-spacing: -0.02em;
  }
  .brand-text {
    font-family: "Inter", sans-serif;
    font-size: 14px; font-weight: 700; letter-spacing: 0.2em;
    color: ${BRAND.ink}; text-transform: uppercase;
  }
  .brand-tag {
    font-family: "Inter", sans-serif;
    font-size: 12px; font-weight: 600; letter-spacing: 0.18em;
    color: ${BRAND.inkMuted}; text-transform: uppercase;
  }
  `;
}

// ---------------------------------------------------------------------------
// Shared building blocks (called by each emitter)
// ---------------------------------------------------------------------------

/**
 * Render one property row's HTML. Reused by all three format emitters because
 * the row layout is identical across formats — only the surrounding margins
 * and density vary.
 *
 * Every user-controlled string is escaped at the leaf. `index` is 1-based
 * for the visible chip number.
 */
function renderPropertyRow(
  p: MultiOHEventProperty,
  index: number,
  density: RowDensity,
): string {
  const baseAddress = (p.address ?? "").trim();
  // 2026-05-22 — suffix the unit identifier onto the displayed address so
  // condo / townhouse / lot consumers know which unit to visit. Skipped
  // for single-family homes (unit_number stays null after the sanitizer).
  const unit = (p.unit_number ?? "").trim();
  const address = unit
    ? baseAddress
      ? `${baseAddress} · ${unit}`
      : unit
    : baseAddress;
  const cityStateZip = composeCityStateZip(p);
  // 2026-05-22 — when the user picks multiple OHs for the same property
  // (e.g. Sat + Sun for one condo unit), `oh_sessions` holds the full
  // list. Format each as "Sat · 11–1 PM" and join with a separator so
  // the row's sub-line reads "Villas, NJ · Sat 11–1 PM · Sun 10–12 PM".
  const sessions =
    p.oh_sessions && p.oh_sessions.length > 0
      ? p.oh_sessions
      : [{ start_at: p.oh_start_at, end_at: p.oh_end_at }];
  const sessionLabels = sessions
    .map((s) => formatPropertyOH(s.start_at, s.end_at))
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  const price = formatPriceChip(p.list_price);
  const hostedBy =
    density.showHostedBy &&
    typeof p.hosting_agent_name === "string" &&
    p.hosting_agent_name.trim().length > 0
      ? p.hosting_agent_name.trim()
      : null;

  // why: city-state and time live on the same sub-line separated by a small
  // gold dot, which lets the eye scan address → location → time top-to-bottom
  // → left-to-right without a second line for the typical case. The hosted-by
  // line, when present, sits below as a smaller italic note.
  const subParts: string[] = [];
  if (cityStateZip) {
    subParts.push(
      `<span class="row-citystate">${escapeHtml(cityStateZip)}</span>`,
    );
  }
  for (const label of sessionLabels) {
    if (subParts.length > 0) {
      subParts.push(`<span class="row-dot"></span>`);
    }
    subParts.push(`<span class="row-time">${escapeHtml(label)}</span>`);
  }

  return `<div class="row">
    <div class="row-num">${index}</div>
    <div class="row-body">
      ${address ? `<div class="row-address">${escapeHtml(address)}</div>` : ""}
      ${subParts.length > 0 ? `<div class="row-sub">${subParts.join("")}</div>` : ""}
      ${hostedBy ? `<div class="row-host">Hosted by ${escapeHtml(hostedBy)}</div>` : ""}
    </div>
    ${price ? `<div class="row-right"><div class="row-price">${escapeHtml(price)}</div></div>` : ""}
  </div>`;
}

/**
 * Render the hero card's footer block.
 *
 * 2026-05-21 — the previous version of this function rendered an event-level
 * agent name + Call/Email pairs at the bottom of the hero. We removed those
 * because each per-property slide already carries its own
 * `hosting_agent_name`, and a single big "Agent" attribution on the hero
 * contradicted multi-host events (a Larissa event with PJ hosting one home
 * was misleadingly stamped "Larissa Johnson" big at the bottom).
 *
 * What's left is the brand strip — gold rule + Century 21 mark + "Open
 * House Event" tag — which still anchors the bottom of the hero card
 * visually without claiming a single agent.
 *
 * `input` is kept in the signature for future use (e.g., a future per-event
 * co-marketed office stamp could read input.office_name). For now, the
 * footer is identical across every event.
 */
function renderAgentBlock(_input: MultiOHEventInput): string {
  return `<div class="agent-block">
    <div class="brand-rule"></div>
    <div class="brand-row">
      <div class="brand">
        <div class="brand-mark">21</div>
        <div class="brand-text">Century 21 Alliance</div>
      </div>
      <div class="brand-tag">Open House Event</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Emitter — Portrait 4:5 · 1080×1350
// ---------------------------------------------------------------------------

/**
 * Portrait 4:5 — IG's preferred feed format. Extra 270px of vertical room
 * over square; everything gets more breathing space. Margins bumped to 60px,
 * headline up to 72px to take advantage of the taller frame.
 */
export function emitEventOverviewPortrait(input: MultiOHEventInput): string {
  const fmt: PostFormat = "portrait_4x5";
  const { width, height } = PLATFORM_DIMENSIONS[fmt];
  const margin = 60;
  const density = computeRowDensity(input.properties.length, fmt);

  const titleSize =
    input.properties.length <= 3 ? 72 : input.properties.length <= 6 ? 60 : 52;

  const rowsHtml = input.properties
    .map((p, i) => renderPropertyRow(p, i + 1, density))
    .join("");

  return `<!doctype html>
<html lang="en">
${eventOverviewHead(`Open House Event — ${input.event_title}`)}
<style>
${baseCss({ width, height, margin, density })}
.header { gap: 22px; margin-bottom: 40px; }
.event-title { font-size: ${titleSize}px; }
.agent-block { margin-top: 40px; padding-top: 32px; }
</style>
<body>
  <div class="frame">
    <div class="header">
      <div class="eyebrow">
        <span class="eyebrow-rule"></span>
        <span class="eyebrow-text">Open House Event</span>
      </div>
      <div class="event-title">${escapeHtml(input.event_title)}</div>
    </div>
    <div class="properties">${rowsHtml}</div>
    ${renderAgentBlock(input)}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Emitter — Story 9:16 · 1080×1920
// ---------------------------------------------------------------------------

/**
 * Story 9:16 — IG/FB Story format. Respects platform safe zones: 0-250px at
 * the top is reserved for status bar + profile avatar; 1720-1920px at the
 * bottom is reserved for the Send box + swipe-up UI. We render an outer
 * frame at full 1080×1920 (CSS lays out top-to-bottom) but pad the .frame
 * element so critical content sits between 250-1720.
 *
 * Implementation: top padding = 250 + 60 outer margin; bottom padding =
 * 200 (puts the brand row right at ~1720). This means the visible content
 * band is ~310 → ~1720 = 1410px of vertical room — plenty for 9 rows even
 * at the compact density.
 */
export function emitEventOverviewStory(input: MultiOHEventInput): string {
  const fmt: PostFormat = "story_9x16";
  const { width, height } = PLATFORM_DIMENSIONS[fmt];
  const margin = 64;
  const density = computeRowDensity(input.properties.length, fmt);

  const titleSize =
    input.properties.length <= 3 ? 76 : input.properties.length <= 6 ? 64 : 56;

  const rowsHtml = input.properties
    .map((p, i) => renderPropertyRow(p, i + 1, density))
    .join("");

  // why: story format pads top/bottom heavily to clear IG's UI overlays.
  // The 310px top padding = 250 safe zone + 60 visual breathing room.
  // The 200px bottom padding tucks the brand footer above the 1720 line.
  return `<!doctype html>
<html lang="en">
${eventOverviewHead(`Open House Event — ${input.event_title}`)}
<style>
${baseCss({ width, height, margin, density })}
.frame {
  padding: 310px ${margin}px 200px ${margin}px;
}
.header { gap: 24px; margin-bottom: 44px; }
.event-title { font-size: ${titleSize}px; }
.agent-block { margin-top: 44px; padding-top: 32px; }
</style>
<body>
  <div class="frame">
    <div class="header">
      <div class="eyebrow">
        <span class="eyebrow-rule"></span>
        <span class="eyebrow-text">Open House Event</span>
      </div>
      <div class="event-title">${escapeHtml(input.event_title)}</div>
    </div>
    <div class="properties">${rowsHtml}</div>
    ${renderAgentBlock(input)}
  </div>
</body>
</html>`;
}
