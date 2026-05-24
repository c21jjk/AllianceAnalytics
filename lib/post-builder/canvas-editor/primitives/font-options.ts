/**
 * FONT_OPTIONS — single source of truth for the font picker dropdown.
 *
 * Was duplicated in TextPropertiesControls.tsx + ContextualTopToolbar.tsx
 * before the 2026-05-24 catalog expansion. Lifted here so adding a new
 * font is a one-place change.
 *
 * Category drives the section headers inside the FontPicker popover.
 * Order within each category is the display order. Within-category order
 * here is alphabetical EXCEPT for the original catalog fonts (kept at the
 * top of each section to preserve Larissa's muscle memory after the
 * 50-font expansion).
 *
 * If you add a new font: (1) @import in fonts.css, (2) token in
 * templates/tokens.ts, (3) entry here.
 */
import { ALLIANCE_FONTS } from "../templates/tokens";
import type { FontPickerOption } from "./FontPicker";

export const FONT_OPTIONS: ReadonlyArray<FontPickerOption> = [
  // =====================================================================
  // SANS — body + UI (originals first, then 2026-05-24 expansion)
  // =====================================================================
  { label: "Inter", value: ALLIANCE_FONTS.bodySans, category: "Sans" },
  { label: "Montserrat", value: ALLIANCE_FONTS.montserrat, category: "Sans" },
  { label: "Poppins", value: ALLIANCE_FONTS.poppins, category: "Sans" },
  { label: "Lato", value: ALLIANCE_FONTS.lato, category: "Sans" },
  // Larissa's actual recipe body fonts
  { label: "Nunito", value: ALLIANCE_FONTS.nunito, category: "Sans" },
  { label: "Livvic", value: ALLIANCE_FONTS.livvic, category: "Sans" },
  { label: "Glacial Indifference", value: ALLIANCE_FONTS.glacialIndifference, category: "Sans" },
  // Curated expansion — alphabetical
  { label: "DM Sans", value: ALLIANCE_FONTS.dmSans, category: "Sans" },
  { label: "Fira Sans", value: ALLIANCE_FONTS.firaSans, category: "Sans" },
  { label: "IBM Plex Sans", value: ALLIANCE_FONTS.ibmPlexSans, category: "Sans" },
  { label: "Karla", value: ALLIANCE_FONTS.karla, category: "Sans" },
  { label: "Manrope", value: ALLIANCE_FONTS.manrope, category: "Sans" },
  { label: "Mulish", value: ALLIANCE_FONTS.mulish, category: "Sans" },
  { label: "Nunito Sans", value: ALLIANCE_FONTS.nunitoSans, category: "Sans" },
  { label: "Open Sans", value: ALLIANCE_FONTS.openSans, category: "Sans" },
  { label: "Outfit", value: ALLIANCE_FONTS.outfit, category: "Sans" },
  { label: "Plus Jakarta Sans", value: ALLIANCE_FONTS.plusJakartaSans, category: "Sans" },
  { label: "Quicksand", value: ALLIANCE_FONTS.quicksand, category: "Sans" },
  { label: "Raleway", value: ALLIANCE_FONTS.raleway, category: "Sans" },
  { label: "Roboto", value: ALLIANCE_FONTS.roboto, category: "Sans" },
  { label: "Source Sans 3", value: ALLIANCE_FONTS.sourceSans3, category: "Sans" },
  { label: "Work Sans", value: ALLIANCE_FONTS.workSans, category: "Sans" },

  // =====================================================================
  // DISPLAY — narrow caps / impact / statement headlines
  // =====================================================================
  { label: "Oswald", value: ALLIANCE_FONTS.oswald, category: "Display" },
  { label: "Bebas Neue", value: ALLIANCE_FONTS.bebasNeue, category: "Display" },
  // Curated expansion
  { label: "Anton", value: ALLIANCE_FONTS.anton, category: "Display" },
  { label: "Archivo Black", value: ALLIANCE_FONTS.archivoBlack, category: "Display" },
  { label: "Big Shoulders Display", value: ALLIANCE_FONTS.bigShouldersDisplay, category: "Display" },
  { label: "Bowlby One", value: ALLIANCE_FONTS.bowlbyOne, category: "Display" },
  { label: "Russo One", value: ALLIANCE_FONTS.russoOne, category: "Display" },
  { label: "Six Caps", value: ALLIANCE_FONTS.sixCaps, category: "Display" },
  { label: "Squada One", value: ALLIANCE_FONTS.squadaOne, category: "Display" },
  { label: "Staatliches", value: ALLIANCE_FONTS.staatliches, category: "Display" },

  // =====================================================================
  // SERIF — editorial body + display
  // =====================================================================
  { label: "Georgia", value: ALLIANCE_FONTS.displaySerif, category: "Serif" },
  { label: "Playfair Display", value: ALLIANCE_FONTS.playfair, category: "Serif" },
  { label: "Cormorant Garamond", value: ALLIANCE_FONTS.cormorant, category: "Serif" },
  { label: "Lora", value: ALLIANCE_FONTS.lora, category: "Serif" },
  { label: "Merriweather", value: ALLIANCE_FONTS.merriweather, category: "Serif" },
  // SOLD recipe substitute
  { label: "DM Serif Display", value: ALLIANCE_FONTS.dmSerifDisplay, category: "Serif" },
  // Curated expansion — body serifs first, then display
  { label: "Bitter", value: ALLIANCE_FONTS.bitter, category: "Serif" },
  { label: "Bodoni Moda", value: ALLIANCE_FONTS.bodoniModa, category: "Serif" },
  { label: "Crimson Pro", value: ALLIANCE_FONTS.crimsonPro, category: "Serif" },
  { label: "EB Garamond", value: ALLIANCE_FONTS.ebGaramond, category: "Serif" },
  { label: "Libre Baskerville", value: ALLIANCE_FONTS.libreBaskerville, category: "Serif" },
  { label: "Libre Caslon Text", value: ALLIANCE_FONTS.libreCaslonText, category: "Serif" },
  { label: "PT Serif", value: ALLIANCE_FONTS.ptSerif, category: "Serif" },
  { label: "Source Serif 4", value: ALLIANCE_FONTS.sourceSerif4, category: "Serif" },
  { label: "Spectral", value: ALLIANCE_FONTS.spectral, category: "Serif" },
  { label: "Vollkorn", value: ALLIANCE_FONTS.vollkorn, category: "Serif" },
  // Display serifs
  { label: "Abril Fatface", value: ALLIANCE_FONTS.abrilFatface, category: "Serif" },
  { label: "Cinzel", value: ALLIANCE_FONTS.cinzel, category: "Serif" },
  { label: "Vidaloka", value: ALLIANCE_FONTS.vidaloka, category: "Serif" },
  { label: "Yeseva One", value: ALLIANCE_FONTS.yesevaOne, category: "Serif" },
  // Slab serifs (currently grouped here since the FontPicker categories
  // are Sans/Display/Serif/Script/Mono — slab is a serif subcategory)
  { label: "Alfa Slab One", value: ALLIANCE_FONTS.alfaSlabOne, category: "Serif" },
  { label: "Arvo", value: ALLIANCE_FONTS.arvo, category: "Serif" },
  { label: "Roboto Slab", value: ALLIANCE_FONTS.robotoSlab, category: "Serif" },

  // =====================================================================
  // SCRIPT — handwritten + calligraphic accents
  // =====================================================================
  { label: "Pacifico", value: ALLIANCE_FONTS.pacifico, category: "Script" },
  // Larissa-recipe substitutes
  { label: "Kaushan Script", value: ALLIANCE_FONTS.kaushanScript, category: "Script" },
  { label: "Allura", value: ALLIANCE_FONTS.allura, category: "Script" },
  // Curated expansion — alphabetical
  { label: "Caveat", value: ALLIANCE_FONTS.caveat, category: "Script" },
  { label: "Cookie", value: ALLIANCE_FONTS.cookie, category: "Script" },
  { label: "Dancing Script", value: ALLIANCE_FONTS.dancingScript, category: "Script" },
  { label: "Great Vibes", value: ALLIANCE_FONTS.greatVibes, category: "Script" },
  { label: "Parisienne", value: ALLIANCE_FONTS.parisienne, category: "Script" },
  { label: "Pinyon Script", value: ALLIANCE_FONTS.pinyonScript, category: "Script" },
  { label: "Sacramento", value: ALLIANCE_FONTS.sacramento, category: "Script" },
  { label: "Satisfy", value: ALLIANCE_FONTS.satisfy, category: "Script" },
  { label: "Tangerine", value: ALLIANCE_FONTS.tangerine, category: "Script" },
  { label: "Yellowtail", value: ALLIANCE_FONTS.yellowtail, category: "Script" },

  // =====================================================================
  // MONO — numbers, MLS codes, technical metadata
  // =====================================================================
  { label: "SF Mono", value: ALLIANCE_FONTS.monoNum, category: "Mono" },
];
