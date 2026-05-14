/**
 * Shared design tokens for canvas-editor templates.
 * --------------------------------------------------
 *
 * Why a tokens file:
 *   The 3 Just Listed templates (square / portrait / story) share the same
 *   color and type system, only differing in layout / dimensions. Putting
 *   tokens here lets us tweak the brand once and have all formats follow.
 *
 *   Phase 4 (Brand panel) will read from this file to expose preset swatches
 *   and font choices to Larissa — but for now, hand-authored templates
 *   reference these constants directly.
 *
 * Why not import from tailwind.config.ts:
 *   Tailwind config is for utility class generation. The canvas editor draws
 *   to a raw canvas — it doesn't see Tailwind. We mirror the same gold-500
 *   hex etc. as literal strings here. If tailwind config changes, update
 *   both — for now there are only ~6 colors so the duplication is cheap.
 */

/**
 * Alliance brand palette — mirrored from tailwind.config.ts gold/neutral scales.
 * Anything that prints in the final PNG should pull from here, not from a
 * hardcoded hex inline in a template file. Makes the future Brand-panel
 * swatch picker a single-file change rather than a sweep.
 */
export const ALLIANCE_COLORS = {
  // Refined gold — accent for primary callouts (price, eyebrow rule)
  gold500: "#C9A961",
  gold600: "#B69552",
  gold100: "#F5EBCF",
  // Obsessed grey — primary text on light surfaces
  ink900: "#18181B",
  ink800: "#27272A",
  ink700: "#3F3F3D",
  // On-photo / dark-overlay text colors
  white: "#FFFFFF",
  whiteWarm: "#FBF7EE",
  whiteDim: "#E5E5E2",
  // Overlay scrim — black at 65% renders well over varied hero photos
  overlayDark: "rgba(0, 0, 0, 0.65)",
  // Hex equivalent for shapes (Fabric needs hex+alpha string or use opacity prop)
  blackAt65: "#000000",
} as const;

/**
 * Font stack. We standardize on the project's main font (Inter, per
 * tailwind.config.ts) for body type, plus a display alternate ("Georgia") for
 * editorial headlines. Templates referenced these by string literal — when we
 * add custom fonts in Phase 4 (Brand panel), the strings here drive the font
 * picker's default options.
 *
 * IMPORTANT: any custom font referenced here MUST be loaded via @font-face in
 * `app/globals.css` BEFORE the canvas editor draws — otherwise Fabric falls
 * back to a system serif/sans. The editor awaits `document.fonts.ready` before
 * hydration, which catches anything declared in CSS.
 */
export const ALLIANCE_FONTS = {
  bodySans: "Inter, ui-sans-serif, system-ui, sans-serif",
  displaySerif:
    'Georgia, "Times New Roman", ui-serif, serif',
  monoNum: '"SF Mono", Menlo, Consolas, monospace',
} as const;
