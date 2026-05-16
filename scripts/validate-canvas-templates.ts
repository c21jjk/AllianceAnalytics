/**
 * scripts/validate-canvas-templates.ts
 * --------------------------------------
 *
 * Standalone runner for the canvas-editor template validator. Run with:
 *
 *   npx tsx scripts/validate-canvas-templates.ts
 *
 * Exits 0 when all templates pass; non-zero with a descriptive error
 * message when any template fails an invariant.
 *
 * The same validator runs automatically at module-load time in `next dev`
 * and `next build` (see `lib/post-builder/canvas-editor/templates/index.ts`).
 * This script exists so the check can be run on demand — useful in CI,
 * pre-commit hooks, or just a manual sanity check after authoring a new
 * template.
 *
 * What gets checked: see `validateCanvasTemplates` in the registry module.
 */

import {
  CANVAS_TEMPLATES,
  validateCanvasTemplates,
} from "@/lib/post-builder/canvas-editor/templates";

try {
  validateCanvasTemplates(CANVAS_TEMPLATES);
  // why: also surface a per-variant breakdown so the runner doubles as a
  // quick "what do we ship?" snapshot. Useful when scanning git diffs that
  // touch the factories — confirm the expected count moved as expected.
  const byVariant: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  for (const t of CANVAS_TEMPLATES) {
    byVariant[t.variant] = (byVariant[t.variant] ?? 0) + 1;
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    byFormat[t.format] = (byFormat[t.format] ?? 0) + 1;
  }
  console.log(`OK — ${CANVAS_TEMPLATES.length} templates pass all invariants.`);
  console.log(`  by variant : ${JSON.stringify(byVariant)}`);
  console.log(`  by category: ${JSON.stringify(byCategory)}`);
  console.log(`  by format  : ${JSON.stringify(byFormat)}`);
  process.exit(0);
} catch (e) {
  console.error("FAIL — canvas template validation rejected one or more templates:");
  console.error("");
  if (e instanceof Error) {
    console.error(`  ${e.message}`);
  } else {
    console.error(`  ${String(e)}`);
  }
  process.exit(1);
}
