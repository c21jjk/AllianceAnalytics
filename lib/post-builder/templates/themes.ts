import type { PostType } from "../types";
import type { PostTypeTheme } from "./primitives/_shared";

/**
 * Post type theme registry.
 *
 * Each theme configures the post-type-specific bits of a template:
 *   - eyebrow text (the "JUST LISTED" / "JUST SOLD" label at the top)
 *   - accent colors (mostly gold; could vary if we later want per-type tints)
 *   - optional badge overlay (e.g. SOLD stamp on Just Sold)
 *   - how the price slot renders (list_price, close_price, label, or none)
 *   - whether to show open house date/time
 *   - optional footer CTA pull-string
 *
 * Variant primitives consume these themes — one primitive renders all 4 post
 * types by swapping themes, keeping design effort focused on three reusable
 * layouts instead of 12 unique files.
 */

const GOLD = "#C9A961";
const GOLD_DARK = "#937843";

export const POST_TYPE_THEMES: Record<PostType, PostTypeTheme> = {
  just_listed: {
    post_type: "just_listed",
    eyebrow: "Just Listed",
    accent: GOLD,
    accent_dark: GOLD_DARK,
    price_mode: "list_price",
    footer_cta: "Tour link in bio",
  },
  just_sold: {
    post_type: "just_sold",
    eyebrow: "Just Sold",
    accent: GOLD,
    accent_dark: GOLD_DARK,
    badge: { text: "SOLD", style: "stamp", color: "red" },
    price_mode: "close_price",
    price_label: "SOLD",
    footer_cta: "Thinking of selling?",
  },
  under_contract: {
    post_type: "under_contract",
    eyebrow: "Under Contract",
    accent: GOLD,
    accent_dark: GOLD_DARK,
    price_mode: "label",
    price_label: "Under Contract",
    footer_cta: "Pipeline open",
  },
  open_house: {
    post_type: "open_house",
    eyebrow: "Open House",
    accent: GOLD,
    accent_dark: GOLD_DARK,
    price_mode: "list_price",
    show_open_house_datetime: true,
    footer_cta: "See you there",
  },
  price_reduction: {
    post_type: "price_reduction",
    eyebrow: "Price Reduced",
    accent: GOLD,
    accent_dark: GOLD_DARK,
    // "↓ NEW PRICE" stamp in green — value-positive feel, distinct from
    // the SOLD red. Reads as opportunity, not warning.
    badge: { text: "↓ NEW PRICE", style: "stamp", color: "green" },
    price_mode: "list_price",
    footer_cta: "Better value now",
  },
};

export function getTheme(post_type: PostType): PostTypeTheme {
  return POST_TYPE_THEMES[post_type];
}
