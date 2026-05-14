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
 * Font stack catalog — 12 entries curated for real-estate social posts.
 *
 * Categories (and why each is in the list):
 *   • Body sans     — Inter, Montserrat, Poppins, Lato (5 total incl. system)
 *                      Default text choice; legible at any size, all weights.
 *   • Display sans  — Oswald, Bebas Neue
 *                      Tall narrow caps work great for "JUST LISTED" type labels.
 *   • Serif         — Georgia, Playfair Display, Cormorant Garamond, Lora,
 *                      Merriweather
 *                      Editorial / luxury vibe — Playfair is the de-facto
 *                      luxury real-estate headline font.
 *   • Script        — Pacifico
 *                      Casual accent (e.g., "Open House" overlay scripts).
 *   • Mono          — SF Mono
 *                      MLS numbers + technical metadata.
 *
 * IMPORTANT: every non-system font referenced here MUST be loaded via the
 * `lib/post-builder/canvas-editor/fonts.css` file (Google Fonts @import).
 * The editor awaits `document.fonts.ready` before hydration so unloaded fonts
 * fall back to system serif/sans cleanly, but the user-facing dropdown will
 * still list the unavailable font — keep the catalog and the CSS file in sync.
 *
 * If you add a new font: (1) add the @import to fonts.css, (2) add the token
 * here, (3) add an entry to FONT_OPTIONS in TextPropertiesControls.tsx.
 */
export const ALLIANCE_FONTS = {
  // ----- Sans (body + UI) -----
  bodySans: "Inter, ui-sans-serif, system-ui, sans-serif",
  montserrat: '"Montserrat", "Helvetica Neue", Arial, sans-serif',
  poppins: '"Poppins", "Helvetica Neue", Arial, sans-serif',
  lato: '"Lato", "Helvetica Neue", Arial, sans-serif',

  // ----- Sans (display / headlines) -----
  oswald: '"Oswald", "Arial Narrow", sans-serif',
  bebasNeue: '"Bebas Neue", Impact, "Arial Narrow Bold", sans-serif',

  // ----- Serif -----
  displaySerif:
    'Georgia, "Times New Roman", ui-serif, serif',
  playfair: '"Playfair Display", Georgia, "Times New Roman", serif',
  cormorant:
    '"Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif',
  lora: '"Lora", Georgia, "Times New Roman", serif',
  merriweather: '"Merriweather", Georgia, "Times New Roman", serif',

  // ----- Script (accent) -----
  pacifico: '"Pacifico", "Brush Script MT", cursive',

  // ----- Mono (numbers, MLS codes) -----
  monoNum: '"SF Mono", Menlo, Consolas, monospace',
} as const;
