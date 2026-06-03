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
  // 2026-05-25 — aligned with brand standards: Relentless Gold #C9A84C
  gold500: "#C9A84C",
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
  // ----- Sans (body + UI) — original catalog -----
  bodySans: "Inter, ui-sans-serif, system-ui, sans-serif",
  montserrat: '"Montserrat", "Helvetica Neue", Arial, sans-serif',
  poppins: '"Poppins", "Helvetica Neue", Arial, sans-serif',
  lato: '"Lato", "Helvetica Neue", Arial, sans-serif',

  // ----- Sans (display / headlines) — original catalog -----
  oswald: '"Oswald", "Arial Narrow", sans-serif',
  bebasNeue: '"Bebas Neue", Impact, "Arial Narrow Bold", sans-serif',

  // ----- Serif — original catalog -----
  displaySerif:
    'Georgia, "Times New Roman", ui-serif, serif',
  playfair: '"Playfair Display", Georgia, "Times New Roman", serif',
  cormorant:
    '"Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif',
  lora: '"Lora", Georgia, "Times New Roman", serif',
  merriweather: '"Merriweather", Georgia, "Times New Roman", serif',

  // ----- Script (accent) — original catalog -----
  pacifico: '"Pacifico", "Brush Script MT", cursive',

  // ----- Mono (numbers, MLS codes) — original catalog -----
  monoNum: '"SF Mono", Menlo, Consolas, monospace',

  // =====================================================================
  // 2026-05-24 EXPANSION — Larissa's recipe fonts + 50 curated additions.
  // Naming convention: lowerCamelCase, omits "family" suffix.
  // =====================================================================

  // ----- Larissa's actual recipe fonts (free Google Fonts) -----
  /** Body font Larissa uses for Just Listed posts. */
  nunito: '"Nunito", "Helvetica Neue", Arial, sans-serif',
  /** Body font Larissa uses for Open House posts. */
  livvic: '"Livvic", "Helvetica Neue", Arial, sans-serif',
  /** Body font Larissa uses for SOLD posts. Self-hosted, SIL OFL. */
  glacialIndifference: '"Glacial Indifference", "Helvetica Neue", Arial, sans-serif',

  // ----- Free Google Fonts substitutes for Larissa's commercial fonts -----
  /** Substitute for Above the Beyond Script (Just Listed eyebrow). Swap to real font by loading /public/fonts/above-the-beyond-script.woff2 + updating this stack. */
  kaushanScript: '"Kaushan Script", "Brush Script MT", cursive',
  /** Substitute for The Seasons (SOLD eyebrow). Sharper than the original; closest free serif display. */
  dmSerifDisplay: '"DM Serif Display", "Playfair Display", Georgia, serif',
  /** Substitute for Beautifully Delicious Script (Open House eyebrow). More formal than the original; closest free script. */
  allura: '"Allura", "Brush Script MT", cursive',

  // ----- Sans (geometric + humanist variety, 15 new) -----
  raleway: '"Raleway", "Helvetica Neue", Arial, sans-serif',
  workSans: '"Work Sans", "Helvetica Neue", Arial, sans-serif',
  sourceSans3: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
  ibmPlexSans: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
  dmSans: '"DM Sans", "Helvetica Neue", Arial, sans-serif',
  manrope: '"Manrope", "Helvetica Neue", Arial, sans-serif',
  outfit: '"Outfit", "Helvetica Neue", Arial, sans-serif',
  plusJakartaSans: '"Plus Jakarta Sans", "Helvetica Neue", Arial, sans-serif',
  karla: '"Karla", "Helvetica Neue", Arial, sans-serif',
  mulish: '"Mulish", "Helvetica Neue", Arial, sans-serif',
  quicksand: '"Quicksand", "Helvetica Neue", Arial, sans-serif',
  openSans: '"Open Sans", "Helvetica Neue", Arial, sans-serif',
  roboto: '"Roboto", "Helvetica Neue", Arial, sans-serif',
  firaSans: '"Fira Sans", "Helvetica Neue", Arial, sans-serif',
  nunitoSans: '"Nunito Sans", "Helvetica Neue", Arial, sans-serif',

  // ----- Display sans (8 new — big eyebrows, statement headlines) -----
  anton: '"Anton", "Arial Narrow", sans-serif',
  archivoBlack: '"Archivo Black", Impact, sans-serif',
  bigShouldersDisplay: '"Big Shoulders Display", "Arial Narrow", sans-serif',
  staatliches: '"Staatliches", "Arial Narrow", sans-serif',
  russoOne: '"Russo One", Impact, sans-serif',
  sixCaps: '"Six Caps", "Arial Narrow", sans-serif',
  squadaOne: '"Squada One", Impact, sans-serif',
  bowlbyOne: '"Bowlby One", Impact, sans-serif',

  // ----- Serif (10 new — editorial + body) -----
  ebGaramond: '"EB Garamond", Garamond, Georgia, serif',
  crimsonPro: '"Crimson Pro", Georgia, "Times New Roman", serif',
  libreBaskerville: '"Libre Baskerville", Georgia, "Times New Roman", serif',
  bodoniModa: '"Bodoni Moda", Bodoni, Georgia, serif',
  ptSerif: '"PT Serif", Georgia, "Times New Roman", serif',
  sourceSerif4: '"Source Serif 4", Georgia, "Times New Roman", serif',
  spectral: '"Spectral", Georgia, "Times New Roman", serif',
  vollkorn: '"Vollkorn", Georgia, "Times New Roman", serif',
  bitter: '"Bitter", Georgia, "Times New Roman", serif',
  libreCaslonText: '"Libre Caslon Text", Caslon, Georgia, serif',

  // ----- Display serif (4 new — bold price callouts, SOLD treatments) -----
  abrilFatface: '"Abril Fatface", Georgia, serif',
  cinzel: '"Cinzel", "Trajan Pro", Georgia, serif',
  yesevaOne: '"Yeseva One", Georgia, serif',
  vidaloka: '"Vidaloka", Georgia, serif',

  // ----- Script (10 new — biggest gap in original catalog) -----
  greatVibes: '"Great Vibes", "Brush Script MT", cursive',
  sacramento: '"Sacramento", "Brush Script MT", cursive',
  dancingScript: '"Dancing Script", "Brush Script MT", cursive',
  satisfy: '"Satisfy", "Brush Script MT", cursive',
  yellowtail: '"Yellowtail", "Brush Script MT", cursive',
  tangerine: '"Tangerine", "Brush Script MT", cursive',
  parisienne: '"Parisienne", "Brush Script MT", cursive',
  pinyonScript: '"Pinyon Script", "Brush Script MT", cursive',
  caveat: '"Caveat", "Comic Sans MS", cursive',
  cookie: '"Cookie", "Brush Script MT", cursive',
  /** 2026-06-01 (John) — brush script, NOT on Google Fonts. Served from the
   *  CDNFonts CDN via @font-face in fonts.css. Free-for-commercial per the
   *  foundry (SolidType); confirm the license before heavy use, and ideally
   *  self-host the official woff2 in /public/fonts for render reliability. */
  stayClassy: '"Stay Classy SLDT", "Brush Script MT", cursive',

  // ----- Slab serif (3 new — currently zero in original catalog) -----
  robotoSlab: '"Roboto Slab", Georgia, "Times New Roman", serif',
  arvo: '"Arvo", Georgia, "Times New Roman", serif',
  alfaSlabOne: '"Alfa Slab One", Georgia, "Times New Roman", serif',
} as const;
