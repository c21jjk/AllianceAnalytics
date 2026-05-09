/**
 * Public entry point for the promote helpers (Track E).
 * Re-exports pure deep-link builders consumed by the AI Insight strip.
 */
export {
  boostOnFacebook,
  boostOnInstagram,
  boostOnTikTok,
  pinOnInstagram,
  getDeepLinkFor,
} from "./deep-links";

export type {
  SuggestedAction,
  PromotionParams,
  DeepLink,
} from "./deep-links";
