/**
 * Deterministic hard-rule checker for AI-designed CanvasTemplateSchemas.
 *
 * Purpose: Pass 4 (critique, Opus) was the only enforcer of Alliance brand
 * hard rules — and Opus's compliance drifted run-to-run. This module does
 * the same checks IN CODE so the pipeline can:
 *   1. Inject specific violations into Pass 4's user prompt ("you MUST
 *      fix these in `revised`") before the LLM thinks.
 *   2. Re-check after Pass 4 lands; if violations remain, trigger a
 *      single retry of Pass 3 + Pass 4 with the violations injected.
 *   3. If still failing after the retry, surface `criticalIssues` to the
 *      caller as a warning instead of silently shipping a bad design.
 *
 * No LLM call here. Pure walk over the schema. Cheap and predictable.
 *
 * See `brand-prompt.ts` HARD RULES section and the `category` recipes for
 * the canonical statement of each rule. This file is the executable
 * version of that prose.
 */
import type {
  CanvasLayer,
  CanvasTemplateSchema,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "../types";
import type { CompositionBrief, HardRuleViolation } from "./types";

// ---------------------------------------------------------------------------
// Constants — the numeric thresholds the rules enforce
// ---------------------------------------------------------------------------

const RESTRICTED_AGENT_CATEGORIES = new Set([
  "just_listed",
  "just_sold",
  "open_house",
  "under_contract",
  "price_reduction",
]);

const FORBIDDEN_ADDRESS_BOUND_FIELDS = new Set([
  "city_state_zip",
  "state",
  "zip",
]);

const LOGO_MIN_WIDTH = 160;
/** Target width for `just_listed` (recipe-specific). 160 ≤ w < 280 → WARN. */
const LOGO_RECIPE_JL_TARGET = 280;

const EYEBROW_SANS_MIN = 44;
const EYEBROW_SCRIPT_OR_SERIF_MIN = 70;

const BODY_TEXT_MIN = 26;

const SCRIPT_FONT_HINTS = [
  "Kaushan",
  "Allura",
  "Pacifico",
  "Brush Script",
  "cursive",
];

const SERIF_FONT_HINTS = [
  "Playfair",
  "DM Serif",
  "Cormorant",
  "Georgia",
  "EB Garamond",
  "Garamond",
  "Merriweather",
  "Lora",
  "serif",
];

const STATUS_EYEBROW_TEXT_HINTS = [
  "JUST LISTED",
  "Just Listed",
  "SOLD",
  "Just Sold",
  "JUST SOLD",
  "OPEN HOUSE",
  "Open House",
  "UNDER CONTRACT",
  "Under Contract",
  "PRICE REDUCED",
  "Price Reduced",
  "PRICE REDUCTION",
];

// ---------------------------------------------------------------------------
// Helpers — narrow CanvasLayer + introspect fonts safely
// ---------------------------------------------------------------------------

function isTextLayer(l: CanvasLayer): l is TextLayer {
  return l.kind === "text";
}

function isImageLayer(l: CanvasLayer): l is ImageLayer {
  return l.kind === "image";
}

function isShapeLayer(l: CanvasLayer): l is ShapeLayer {
  return l.kind === "shape";
}

/**
 * Walk every layer including nested group children. The schema permits
 * GroupLayer (children array) but Phase-2 AI doesn't author them; we
 * still recurse to be defensive against future changes.
 */
function* iterateLayers(layers: readonly CanvasLayer[]): Generator<CanvasLayer> {
  for (const layer of layers) {
    yield layer;
    if (layer.kind === "group") {
      yield* iterateLayers(layer.children);
    }
  }
}

function fontFamilyContains(
  fontFamily: string | undefined | null,
  hints: readonly string[],
): boolean {
  if (!fontFamily) return false;
  const ff = fontFamily.toLowerCase();
  return hints.some((h) => ff.includes(h.toLowerCase()));
}

function isScriptFont(fontFamily: string): boolean {
  return fontFamilyContains(fontFamily, SCRIPT_FONT_HINTS);
}

function isSerifFont(fontFamily: string): boolean {
  return fontFamilyContains(fontFamily, SERIF_FONT_HINTS);
}

function isScriptOrSerif(fontFamily: string): boolean {
  return isScriptFont(fontFamily) || isSerifFont(fontFamily);
}

/**
 * Heuristic — does this text layer look like the post's status eyebrow?
 * True if either bound to `status_label` OR its literal text matches a
 * known status string.
 */
function isStatusEyebrow(layer: TextLayer): boolean {
  if (layer.boundField === "status_label") return true;
  const t = (layer.text ?? "").trim();
  if (!t) return false;
  return STATUS_EYEBROW_TEXT_HINTS.some((hint) => t.includes(hint));
}

/**
 * Find the first text layer matching a literal substring (case-insensitive,
 * trimmed). Used by the per-recipe checks ("does an `Open` script layer
 * at 250pt+ exist?").
 */
function findTextLayerByLiteral(
  layers: readonly CanvasLayer[],
  needle: string,
): TextLayer | null {
  const lowerNeedle = needle.trim().toLowerCase();
  for (const layer of iterateLayers(layers)) {
    if (!isTextLayer(layer)) continue;
    const t = (layer.text ?? "").trim().toLowerCase();
    if (t === lowerNeedle || t.includes(lowerNeedle)) {
      return layer;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk the schema, return every hard-rule violation. Empty array == clean.
 *
 * Pure function — no I/O, no LLM, no time-of-day weirdness. Same input
 * always yields the same output.
 *
 * Severity:
 *   • "fail" — MUST be fixed. The pipeline injects these into the critique
 *     prompt and triggers a retry if they remain.
 *   • "warn" — surfaces in `criticalIssues` for visibility but does not
 *     trigger a retry on its own. (Used for recipe-target misses where
 *     the minimum is still met.)
 */
export function checkHardRules(
  schema: CanvasTemplateSchema,
  // 2026-07-29: brief is now optional so non-AI callers (template save
  // validation in lib/template-builder/storage.ts) can run the checker
  // without fabricating a composition. When absent, the photo-subject
  // rule (HR7) is skipped; every schema-only rule still runs.
  brief?: CompositionBrief,
): HardRuleViolation[] {
  const violations: HardRuleViolation[] = [];
  const category = schema.category;
  const canvasW = schema.width;
  const canvasH = schema.height;

  // -------------------------------------------------------------------------
  // HR1 — address must not use state/zip/city_state_zip bound fields
  // -------------------------------------------------------------------------
  for (const layer of iterateLayers(schema.layers)) {
    if (!isTextLayer(layer)) continue;
    if (!layer.boundField) continue;
    if (FORBIDDEN_ADDRESS_BOUND_FIELDS.has(layer.boundField)) {
      violations.push({
        rule: "HR1_address_state_zip",
        severity: "fail",
        layerId: layer.id,
        detail: `Text layer "${layer.name}" (id ${layer.id}) is bound to "${layer.boundField}" — state and zip are forbidden on social posts.`,
        fix_hint:
          "Remove the layer OR change its boundField to `address_line1` or `city`. Use street + city only.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR2 — no agent fields on restricted categories
  //
  // 2026-07-29: extended to hosting_agent_* bound fields (they don't
  // match the agent_ prefix). Business rule: open_house is the ONE
  // restricted category where hosting_agent_* is allowed, in fact
  // required, see HR10 below (John's rule 2026-07-29: hosting agent on
  // every OH template). Everywhere else in the restricted set,
  // hosting_agent_* is just as forbidden as agent_*.
  // -------------------------------------------------------------------------
  if (RESTRICTED_AGENT_CATEGORIES.has(category)) {
    const hostingForbidden = category !== "open_house";
    for (const layer of iterateLayers(schema.layers)) {
      if (isTextLayer(layer)) {
        const bf = layer.boundField;
        if (
          bf &&
          (bf.startsWith("agent_") ||
            (hostingForbidden && bf.startsWith("hosting_agent_")))
        ) {
          violations.push({
            rule: "HR2_agent_on_restricted_category",
            severity: "fail",
            layerId: layer.id,
            detail: `Text layer "${layer.name}" binds to "${bf}" but category "${category}" forbids agent fields.`,
            fix_hint: `Strip this layer entirely. Category ${category} posts must contain zero agent_* references.`,
          });
        }
      } else if (isImageLayer(layer)) {
        if (
          layer.boundField === "agent_photo" ||
          (hostingForbidden && layer.boundField === "hosting_agent_photo")
        ) {
          violations.push({
            rule: "HR2_agent_on_restricted_category",
            severity: "fail",
            layerId: layer.id,
            detail: `Image layer "${layer.name}" binds to "${layer.boundField}" but category "${category}" forbids agent fields.`,
            fix_hint: `Strip this layer entirely. Category ${category} posts must contain zero agent_* references.`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // HR10 (2026-07-29): open_house templates MUST carry a hosting-agent block
  //
  // 2026-07-29 (John's explicit rule, reaffirming Larissa's 5/27 design
  // rules): every Open House template must surface who is hosting. At
  // least one hosting_agent_name text layer OR hosting_agent_photo image
  // layer is required. Numbered HR10 (not "HR4" as first drafted) because
  // HR4 is already the eyebrow-size rule.
  // -------------------------------------------------------------------------
  if (category === "open_house") {
    let sawHostingBlock = false;
    for (const layer of iterateLayers(schema.layers)) {
      if (isTextLayer(layer) && layer.boundField === "hosting_agent_name") {
        sawHostingBlock = true;
        break;
      }
      if (isImageLayer(layer) && layer.boundField === "hosting_agent_photo") {
        sawHostingBlock = true;
        break;
      }
    }
    if (!sawHostingBlock) {
      violations.push({
        rule: "HR10_oh_hosting_agent_required",
        severity: "fail",
        detail:
          "Category \"open_house\" requires a hosting-agent block: no layer binds to `hosting_agent_name` or `hosting_agent_photo`.",
        fix_hint:
          "Add a text layer with boundField='hosting_agent_name' (and ideally an image layer with boundField='hosting_agent_photo'). Every OH post must show who is hosting.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR3 — brokerage_logo presence + minimum width
  // -------------------------------------------------------------------------
  let brokerageLogo: ImageLayer | null = null;
  for (const layer of iterateLayers(schema.layers)) {
    if (isImageLayer(layer) && layer.boundField === "brokerage_logo") {
      brokerageLogo = layer;
      break;
    }
  }
  if (!brokerageLogo) {
    violations.push({
      rule: "HR3_logo_missing",
      severity: "fail",
      detail:
        "No image layer with boundField=`brokerage_logo` exists. The C21 ALLIANCE lockup is mandatory on every post.",
      fix_hint:
        "Add an image layer { kind: 'image', boundField: 'brokerage_logo', width: 280 } positioned prominently (band footer or top-center per recipe).",
    });
  } else {
    const w = brokerageLogo.width;
    if (w < LOGO_MIN_WIDTH) {
      violations.push({
        rule: "HR3_logo_too_small",
        severity: "fail",
        layerId: brokerageLogo.id,
        detail: `Brokerage logo width is ${Math.round(w)}px (minimum is ${LOGO_MIN_WIDTH}px). The logo would be illegible on Instagram thumbnails.`,
        fix_hint: `Set brokerage_logo image layer width to at least 280, never less than ${LOGO_MIN_WIDTH}.`,
      });
    } else if (category === "just_listed" && w < LOGO_RECIPE_JL_TARGET) {
      // Recipe target met-the-minimum-but-not-the-target — surface as WARN.
      violations.push({
        rule: "HR3_logo_below_recipe_target",
        severity: "warn",
        layerId: brokerageLogo.id,
        detail: `Brokerage logo width is ${Math.round(w)}px — above the ${LOGO_MIN_WIDTH}px floor but below the just_listed recipe target of ${LOGO_RECIPE_JL_TARGET}px.`,
        fix_hint: `Bump brokerage_logo width to ${LOGO_RECIPE_JL_TARGET} for the just_listed recipe.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR4 — status eyebrow minimum size
  // -------------------------------------------------------------------------
  for (const layer of iterateLayers(schema.layers)) {
    if (!isTextLayer(layer)) continue;
    if (!isStatusEyebrow(layer)) continue;
    const isScriptOrSerifFont = isScriptOrSerif(layer.fontFamily);
    const min = isScriptOrSerifFont
      ? EYEBROW_SCRIPT_OR_SERIF_MIN
      : EYEBROW_SANS_MIN;
    if (layer.fontSize < min) {
      violations.push({
        rule: "HR4_eyebrow_too_small",
        severity: "fail",
        layerId: layer.id,
        detail: `Status eyebrow "${layer.text}" (id ${layer.id}) has fontSize ${Math.round(layer.fontSize)} — below the ${isScriptOrSerifFont ? "script/serif" : "sans"} minimum of ${min}.`,
        fix_hint: `Set fontSize to at least ${min} for this eyebrow. The status label must visually dominate.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR5 — per-category recipe enforcement
  // -------------------------------------------------------------------------

  if (category === "just_listed") {
    // The "Just Listed" script eyebrow recipe — Kaushan/Allura/Pacifico
    // at 140pt+ minimum.
    for (const layer of iterateLayers(schema.layers)) {
      if (!isTextLayer(layer)) continue;
      if (!isScriptFont(layer.fontFamily)) continue;
      // Restrict to layers that look like the eyebrow (text contains
      // "listed" or status_label binding) so we don't trip on script
      // accents elsewhere.
      const looksLikeEyebrow =
        layer.boundField === "status_label" ||
        /listed/i.test(layer.text ?? "");
      if (!looksLikeEyebrow) continue;
      if (layer.fontSize < 140) {
        violations.push({
          rule: "HR5_recipe_just_listed_eyebrow",
          severity: "fail",
          layerId: layer.id,
          detail: `just_listed script eyebrow "${layer.text}" is ${Math.round(layer.fontSize)}pt — recipe minimum is 140pt.`,
          fix_hint:
            "Set the script Just Listed eyebrow fontSize to at least 140 (recipe target ~140 for square, ~180 for story).",
        });
      }
    }
  }

  if (category === "open_house") {
    // Recipe: Allura/Pacifico/Kaushan "Open" layer at ~314pt; allow -20% (≥250).
    const openLayer = findTextLayerByLiteral(schema.layers, "Open");
    if (openLayer && isScriptFont(openLayer.fontFamily)) {
      if (openLayer.fontSize < 250) {
        violations.push({
          rule: "HR5_recipe_open_house_script",
          severity: "fail",
          layerId: openLayer.id,
          detail: `open_house script "Open" eyebrow is ${Math.round(openLayer.fontSize)}pt — recipe target 314pt, minimum 250pt.`,
          fix_hint:
            "Set the script 'Open' layer fontSize to at least 250 (recipe target 314). It is the design's signature.",
        });
      }
    }
  }

  if (category === "just_sold") {
    // Recipe: DM Serif/Playfair "SOLD" at ~70pt; allow -15% (≥60).
    let sawSoldEyebrow = false;
    for (const layer of iterateLayers(schema.layers)) {
      if (!isTextLayer(layer)) continue;
      const t = (layer.text ?? "").trim();
      if (!/^sold$/i.test(t) && !/sold/i.test(t)) continue;
      if (!isSerifFont(layer.fontFamily)) continue;
      sawSoldEyebrow = true;
      if (layer.fontSize < 60) {
        violations.push({
          rule: "HR5_recipe_sold_eyebrow",
          severity: "fail",
          layerId: layer.id,
          detail: `just_sold serif "SOLD" eyebrow is ${Math.round(layer.fontSize)}pt — recipe target 70pt, minimum 60pt.`,
          fix_hint:
            "Set the serif SOLD layer fontSize to at least 60 (recipe target 70).",
        });
      }
    }
    void sawSoldEyebrow; // intentional: we don't fail when absent — HR4 covers eyebrow presence.

    // Recipe: white rect frame stroke layer at strokeWidth ≥ 5 must exist.
    let sawFrame = false;
    for (const layer of iterateLayers(schema.layers)) {
      if (!isShapeLayer(layer)) continue;
      if (layer.shapeType !== "rect") continue;
      const noFill =
        typeof layer.fill === "string" &&
        (layer.fill === "" || layer.fill === "transparent");
      if (!noFill) continue;
      if (!layer.stroke || layer.stroke === "" || layer.stroke === "transparent") {
        continue;
      }
      if (layer.strokeWidth >= 5) {
        sawFrame = true;
        break;
      }
    }
    if (!sawFrame) {
      violations.push({
        rule: "HR5_recipe_sold_frame",
        severity: "fail",
        detail:
          "just_sold recipe requires a no-fill rect shape with a stroke (strokeWidth ≥ 5) framing the composition.",
        fix_hint:
          "Add a rect shape layer with fill='' (no fill), stroke='#FFFFFF', strokeWidth=7, inset ~40px from canvas edges so it boxes the photo.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR6 — body text minimum size (beds/baths/price/address)
  // -------------------------------------------------------------------------
  const BODY_BOUND_FIELDS = new Set([
    "beds",
    "baths",
    "beds_baths",
    "price",
    "address_line1",
    "city",
  ]);
  for (const layer of iterateLayers(schema.layers)) {
    if (!isTextLayer(layer)) continue;
    if (!layer.boundField || !BODY_BOUND_FIELDS.has(layer.boundField)) continue;
    if (layer.fontSize < BODY_TEXT_MIN) {
      violations.push({
        rule: "HR6_body_text_too_small",
        severity: "fail",
        layerId: layer.id,
        detail: `Body text layer "${layer.name}" bound to "${layer.boundField}" is ${Math.round(layer.fontSize)}pt — minimum is ${BODY_TEXT_MIN}pt.`,
        fix_hint: `Set fontSize to at least ${BODY_TEXT_MIN}. Body info (beds/baths/price/address) must be legible on mobile.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR7 — hero photo subject containment vs. composition.subject_position
  // Skip when the photo box spans the full canvas width (full-bleed).
  // -------------------------------------------------------------------------
  // 2026-07-29: brief is optional now; no brief = skip the subject rule.
  const subjectPos = brief?.subject_position;
  if (subjectPos && subjectPos !== "balanced") {
    for (const layer of iterateLayers(schema.layers)) {
      if (!isImageLayer(layer)) continue;
      if (layer.boundField !== "hero_photo") continue;

      // Full-bleed guard — photo covers ≥98% of canvas width = skip.
      const photoLeft = layer.left;
      const photoRight = layer.left + layer.width;
      const spansFullWidth =
        photoLeft <= canvasW * 0.02 && photoRight >= canvasW * 0.98;
      if (spansFullWidth) continue;

      if (subjectPos === "center") {
        const okLeft = photoLeft <= canvasW * 0.15;
        const okRight = photoRight >= canvasW * 0.85;
        if (!okLeft || !okRight) {
          violations.push({
            rule: "HR7_hero_photo_subject_cropped",
            severity: "fail",
            layerId: layer.id,
            detail: `Hero photo subject is CENTER (per composition brief), but the photo layer (left=${Math.round(photoLeft)}, right=${Math.round(photoRight)}) does not contain the center 0.15–0.85 band of the canvas (${Math.round(canvasW * 0.15)}–${Math.round(canvasW * 0.85)}px).`,
            fix_hint: `For a center-subject photo, the hero_photo layer's box must span at least left ≤ ${Math.round(canvasW * 0.15)}px AND right ≥ ${Math.round(canvasW * 0.85)}px. Widen the photo or move it to capture the subject.`,
          });
        }
      } else if (subjectPos === "left") {
        const okLeft = photoLeft <= canvasW * 0.05;
        const okRight = photoRight >= canvasW * 0.40;
        if (!okLeft || !okRight) {
          violations.push({
            rule: "HR7_hero_photo_subject_cropped",
            severity: "fail",
            layerId: layer.id,
            detail: `Hero photo subject is LEFT (per composition brief), but the photo layer (left=${Math.round(photoLeft)}, right=${Math.round(photoRight)}) does not contain the left 0.05–0.40 band of the canvas.`,
            fix_hint: `For a left-subject photo, the hero_photo layer's box must span left ≤ ${Math.round(canvasW * 0.05)}px AND right ≥ ${Math.round(canvasW * 0.40)}px. Move the photo left or widen it.`,
          });
        }
      } else if (subjectPos === "right") {
        const okLeft = photoLeft <= canvasW * 0.60;
        const okRight = photoRight >= canvasW * 0.95;
        if (!okLeft || !okRight) {
          violations.push({
            rule: "HR7_hero_photo_subject_cropped",
            severity: "fail",
            layerId: layer.id,
            detail: `Hero photo subject is RIGHT (per composition brief), but the photo layer (left=${Math.round(photoLeft)}, right=${Math.round(photoRight)}) does not contain the right 0.60–0.95 band of the canvas.`,
            fix_hint: `For a right-subject photo, the hero_photo layer's box must span left ≤ ${Math.round(canvasW * 0.60)}px AND right ≥ ${Math.round(canvasW * 0.95)}px. Move the photo right or widen it.`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // HR8 — address must be present (address_line1 OR city)
  // -------------------------------------------------------------------------
  let sawAddress = false;
  for (const layer of iterateLayers(schema.layers)) {
    if (!isTextLayer(layer)) continue;
    if (layer.boundField === "address_line1" || layer.boundField === "city") {
      sawAddress = true;
      break;
    }
  }
  if (!sawAddress) {
    violations.push({
      rule: "HR8_address_present",
      severity: "fail",
      detail:
        "No text layer binds to `address_line1` or `city`. Every post must surface a street + city.",
      fix_hint:
        "Add at least one text layer with boundField='address_line1' OR boundField='city'.",
    });
  }

  // -------------------------------------------------------------------------
  // HR9 — price must be present when applicable
  // -------------------------------------------------------------------------
  if (category === "just_listed" || category === "price_reduction") {
    let sawPrice = false;
    for (const layer of iterateLayers(schema.layers)) {
      if (!isTextLayer(layer)) continue;
      if (layer.boundField === "price") {
        sawPrice = true;
        break;
      }
    }
    if (!sawPrice) {
      violations.push({
        rule: "HR9_price_present_when_applicable",
        severity: "fail",
        detail: `Category "${category}" requires a text layer bound to \`price\`.`,
        fix_hint: "Add a text layer with boundField='price' (typically the most prominent number on the design).",
      });
    }
  } else if (category === "just_sold") {
    let sawPrice = false;
    for (const layer of iterateLayers(schema.layers)) {
      if (!isTextLayer(layer)) continue;
      if (layer.boundField === "price" || layer.boundField === "close_price") {
        sawPrice = true;
        break;
      }
    }
    if (!sawPrice) {
      violations.push({
        rule: "HR9_price_present_when_applicable",
        severity: "fail",
        detail: "Category \"just_sold\" requires a text layer bound to `price` or `close_price`.",
        fix_hint: "Add a text layer with boundField='close_price' (preferred for sold posts) or 'price'.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // HR11 (2026-07-29): layers must sit on the canvas
  //
  // A layer whose bounding box extends beyond the canvas by more than
  // OFF_CANVAS_TOLERANCE px on any edge, or sits fully outside, is a
  // violation. Catches the "parked off to the side and forgotten" layers
  // that render as clipped fragments (or nothing) in production PNGs.
  //
  // Scope notes:
  //   • Top-level layers only. Group children carry group-relative coords
  //     in Fabric, so recursing would false-positive; the group's own
  //     bbox at the top level covers the composition.
  //   • Hidden layers (visible=false) are skipped; they don't render, so
  //     an off-canvas hidden layer is harmless scratch.
  //   • scaleX/scaleY aren't part of the schema type (width/height are
  //     post-scale), but Fabric round-trips can leave them on stored
  //     JSON; honor them defensively when present.
  //   • Rotation is ignored (axis-aligned approximation); the tolerance
  //     absorbs small rotated overhangs.
  // -------------------------------------------------------------------------
  const OFF_CANVAS_TOLERANCE = 4;
  for (const layer of schema.layers) {
    if (layer.visible === false) continue;
    const loose = layer as unknown as Record<string, unknown>;
    const scaleX =
      typeof loose.scaleX === "number" && Number.isFinite(loose.scaleX)
        ? (loose.scaleX as number)
        : 1;
    const scaleY =
      typeof loose.scaleY === "number" && Number.isFinite(loose.scaleY)
        ? (loose.scaleY as number)
        : 1;
    const left = layer.left;
    const top = layer.top;
    const right = left + layer.width * scaleX;
    const bottom = top + layer.height * scaleY;

    const fullyOutside =
      right <= 0 || bottom <= 0 || left >= canvasW || top >= canvasH;
    const overhangsEdge =
      left < -OFF_CANVAS_TOLERANCE ||
      top < -OFF_CANVAS_TOLERANCE ||
      right > canvasW + OFF_CANVAS_TOLERANCE ||
      bottom > canvasH + OFF_CANVAS_TOLERANCE;

    // 2026-07-29: intentional bleed is a normal design device. Cover-crop
    // hero/property photos and background shapes routinely extend past the
    // canvas edge (every live library template has at least one), so a
    // partial overhang only counts as a defect where clipping loses real
    // content: text layers, and images that are NOT property photos (logos,
    // seals, headshots). Fully-outside layers are flagged regardless of kind.
    const isPhotoImage =
      layer.kind === "image" &&
      typeof (loose.boundField as string | undefined) === "string" &&
      /^(hero_photo|photo_\d+)$/.test(loose.boundField as string);
    const overhangMatters =
      layer.kind === "text" || (layer.kind === "image" && !isPhotoImage);

    if (fullyOutside || (overhangsEdge && overhangMatters)) {
      violations.push({
        rule: "HR11_layer_off_canvas",
        severity: "fail",
        layerId: layer.id,
        detail: fullyOutside
          ? `Layer "${layer.name}" (id ${layer.id}) sits entirely outside the ${canvasW}x${canvasH} canvas (bbox left=${Math.round(left)}, top=${Math.round(top)}, right=${Math.round(right)}, bottom=${Math.round(bottom)}).`
          : `Layer "${layer.name}" (id ${layer.id}) extends beyond the ${canvasW}x${canvasH} canvas by more than ${OFF_CANVAS_TOLERANCE}px (bbox left=${Math.round(left)}, top=${Math.round(top)}, right=${Math.round(right)}, bottom=${Math.round(bottom)}).`,
        fix_hint: `Move or resize layer ${layer.id} so its box stays within 0..${canvasW} x 0..${canvasH} (within ${OFF_CANVAS_TOLERANCE}px), or delete it if it is leftover scratch.`,
      });
    }
  }

  return violations;
}

/**
 * Format violations as a numbered, human-and-LLM-readable block for
 * injection into a system or user prompt.
 *
 * Used by both `runCritiquePass` (Pass 4 user prompt) and `runLayoutPass`
 * (Pass 3 retry user prompt). Keeps the formatting consistent.
 */
export function formatViolationsForPrompt(
  violations: readonly HardRuleViolation[],
): string {
  if (violations.length === 0) return "";
  const lines: string[] = [];
  violations.forEach((v, i) => {
    lines.push(
      `${i + 1}. [${v.rule}] (${v.severity}) ${v.detail}\n   FIX: ${v.fix_hint}`,
    );
  });
  return lines.join("\n");
}

/**
 * Filter to fail-severity only — these are the ones that trigger retries
 * and gating logic. WARN-severity violations surface in `criticalIssues`
 * for visibility but don't gate the pipeline.
 */
export function failsOnly(
  violations: readonly HardRuleViolation[],
): HardRuleViolation[] {
  return violations.filter((v) => v.severity === "fail");
}
