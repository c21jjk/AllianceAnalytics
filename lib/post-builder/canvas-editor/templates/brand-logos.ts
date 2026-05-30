/**
 * Brand logo URL registry.
 * ------------------------
 *
 * Single source of truth for the C21 Alliance + Excellence Collection
 * lockups used inside canvas templates and HTML preview primitives.
 *
 * Why a separate file (vs. inline constants in every factory):
 *
 *   • Logos are uploaded by an admin via the Studio sidecar (kind='logo' in
 *     `brand_assets`). When a logo is re-uploaded (re-cropped, exported at a
 *     different DPI), only this file needs updating — every template picks
 *     up the new URL automatically.
 *
 *   • The brand_assets table is the canonical store, but reading it at
 *     factory-build time would force every template into an async path.
 *     Templates run synchronously today (the registry validator on module
 *     load expects sync construction), so we keep the URLs frozen here.
 *
 *   • Each URL points to Supabase Storage public bucket. The asset IDs are
 *     immutable; if Larissa re-uploads under the same `label`, the new row
 *     gets a new UUID and this file must be updated by hand to point at it.
 *     A future enhancement is to resolve by `label` at build time and bake
 *     in the URL via a codegen script — not worth the complexity yet.
 *
 * Why these six (and not all 18):
 *
 *   The brand library has 18 active logos as of 2026-05-17. Templates use
 *   the six "anchor" variants below. Templates that need a different lockup
 *   (e.g. a one-off Just Sold campaign with the Seal-Gold-Cropped variant)
 *   can drop their URL directly inside the factory — but anything used by
 *   2+ templates belongs here.
 */

/**
 * Primary C21 Alliance lockup in Obsessed Grey. Use on cream / light surfaces.
 * Source: brand_assets row id `081cdf25-0578-4586-9463-e8e40e7b5153`,
 * label "C21 ALLIANCE Grey".
 */
export const C21_ALLIANCE_GREY_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/15c6c2ea-dc9f-45c1-8f65-3cd412ba8299.png";

/**
 * Primary C21 Alliance lockup in white. Use on dark surfaces (data panes,
 * photo overlays, dark scrims).
 * Source: brand_assets row id `554df725-98d1-4733-80f9-f44406fee298`,
 * label "C21 ALLIANCE White".
 */
export const C21_ALLIANCE_WHITE_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/1243286b-f208-47fb-a8f3-7fa1367951a2.png";

/**
 * Excellence Collection sub-brand wordmark (variant 2).
 * Use ONLY in v3 Excellence Collection templates (premium tier, $949k+).
 * Canonical anchor per John's choice 2026-05-30 (switched from variant 1).
 * The headless render route resolves this same label from brand_assets at
 * render time (resolveBrandLogoUrl); this constant is the editor-preview /
 * AI-Design / safety fallback.
 * Source: brand_assets row id `7ea3877f-7559-45d2-8dcd-07904cabc778`,
 * label "Excellence Collection - 2".
 */
export const EXCELLENCE_COLLECTION_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/488d325e-10d2-40ce-92bc-1a4ce9ef9370.png";

/**
 * C21 seal (gold, full lockup). Decorative accent — pair sparingly with
 * the wordmark; using both at once feels stamped.
 * Source: brand_assets row id `604c60e1-148d-4925-8215-4c4b1a9795ba`,
 * label "Seal Gold Full".
 */
export const SEAL_GOLD_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/ef174a50-b6ae-4199-a25f-0e062c8012c6.png";

/**
 * C21 letter-pattern block in Relentless Gold. Bold graphic mark for
 * editorial / poster-style compositions.
 * Source: brand_assets row id `4dfdebdf-51de-47af-a181-60adf63875e5`,
 * label "C21 Letter Pattern Block RelentlessGold".
 */
export const C21_LETTER_PATTERN_GOLD_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/138de027-81fb-4cf4-9d1a-ec3f3dbdc9c5.png";

/**
 * Merged Gold lockup — full Alliance wordmark + seal in one rendered file.
 * Source: brand_assets row id `81152b84-1dd2-42f3-b329-1f491c47b7ba`,
 * label "Merged Gold".
 */
export const MERGED_GOLD_LOGO =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/9a607add-56e2-41d2-8b28-1f04068ff016.jpg";
