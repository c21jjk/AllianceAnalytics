/**
 * Deep-link helpers for handing off "Boost" / "Pin" actions from the
 * AllianceAnalytics dashboard to each platform's native ad/promotion UI.
 *
 * Track E scope: pure URL builders only. No async, no fetch, no side effects.
 * Consumed by the AI Insight strip (Track C) — clicking a CTA opens the
 * resulting URL in a new tab.
 *
 * IMPORTANT CAVEATS (apply to every function in this module):
 *  - Meta (Facebook + Instagram) frequently deprecates Ads Manager
 *    deep-link query parameters. Treat the URLs below as best-effort:
 *    they will reliably land the user on the correct surface inside
 *    Business Suite / Ads Manager, but pre-filling specific creative,
 *    budget, or targeting fields is NOT guaranteed.
 *  - `suggested_budget_usd` is included as a vanity `?suggested_budget=`
 *    query param. Meta and TikTok will ignore it, but our own app can
 *    re-read it if the user comes back to the dashboard via a referrer.
 *  - `audience_geo` is informational only — none of these platforms
 *    accept geo targeting via URL params.
 */

export type SuggestedAction = "boost" | "promote_profile" | "pin";

export interface PromotionParams {
  platform: "facebook" | "instagram" | "tiktok";
  /** Public post URL, e.g. https://www.instagram.com/p/ABC123/ */
  permalink?: string;
  /** Raw platform post id (FB post id, IG media id, TT video id). */
  platform_post_id?: string;
  /** Suggested boost budget in USD, e.g. 40. Vanity hint only. */
  suggested_budget_usd?: number;
  /** Suggested run length in days. Defaults to 3 when emitted. */
  suggested_duration_days?: number;
  /** Geo hints, e.g. ["NJ", "PA"]. Informational; not honored by URL params. */
  audience_geo?: string[];
}

export interface DeepLink {
  /** Fully qualified URL to open in a new tab. */
  url: string;
  /** Human-readable label for the CTA button. */
  label: string;
  /** Which surface the link will land on. */
  opens_in:
    | "ads_manager"
    | "meta_business_suite"
    | "tiktok_ads"
    | "platform_native";
  /** User-facing note shown next to the CTA (sign-in needed, manual step, etc.). */
  caveat?: string;
}

/**
 * Append vanity / hint query params to a base URL.
 * - `suggested_budget` and `suggested_duration_days` are NOT honored by
 *   the destination platforms — we include them so our own app can
 *   recover the suggestion if the user returns via referrer.
 */
function appendHints(
  baseUrl: string,
  params: PromotionParams,
  extra: Record<string, string | undefined> = {}
): string {
  // We intentionally avoid `new URL(...)` so a malformed/relative input
  // can't throw — these helpers must always return a usable URL.
  const sep = baseUrl.includes("?") ? "&" : "?";
  const parts: string[] = [];

  if (typeof params.suggested_budget_usd === "number") {
    parts.push(
      `suggested_budget=${encodeURIComponent(String(params.suggested_budget_usd))}`
    );
  }
  if (typeof params.suggested_duration_days === "number") {
    parts.push(
      `suggested_duration_days=${encodeURIComponent(
        String(params.suggested_duration_days)
      )}`
    );
  }
  if (params.audience_geo && params.audience_geo.length > 0) {
    parts.push(
      `audience_geo=${encodeURIComponent(params.audience_geo.join(","))}`
    );
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== "") {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }

  if (parts.length === 0) return baseUrl;
  return `${baseUrl}${sep}${parts.join("&")}`;
}

/**
 * Build a Meta Ads Manager / Business Suite deep link to boost a Facebook
 * Page post.
 *
 * The cleanest stable surface today is the Business Suite "published posts"
 * list, scoped to the post id. Meta has historically deprecated true
 * "boost flow" deep links every 6–12 months, so we lean on this.
 *
 * Falls back to the Business Suite home if `platform_post_id` is missing.
 *
 * Caveat: requires the user to be signed in to a Facebook Business Suite
 * account that has access to the relevant Page.
 */
export function boostOnFacebook(params: PromotionParams): DeepLink {
  const id = params.platform_post_id ?? "";
  const base = id
    ? `https://business.facebook.com/latest/posts/?post_id=${encodeURIComponent(
        id
      )}`
    : "https://business.facebook.com/latest/home";

  return {
    url: appendHints(base, params),
    label: "Boost on Facebook",
    opens_in: "meta_business_suite",
    caveat:
      "Opens Meta Business Suite. Requires sign-in with access to the Facebook Page. Suggested budget is shown here for reference only — Meta does not pre-fill it from the URL.",
  };
}

/**
 * Build a Meta Business Suite deep link to boost an Instagram post.
 *
 * IG boosting on web flows through Business Suite (or Ads Manager). The
 * `placement=instagram` hint is best-effort — Meta may or may not honor it
 * on a given build.
 *
 * Falls back to the Business Suite home if `platform_post_id` is missing.
 */
export function boostOnInstagram(params: PromotionParams): DeepLink {
  const id = params.platform_post_id ?? "";
  const base = id
    ? `https://business.facebook.com/latest/posts/published_posts?post_id=${encodeURIComponent(
        id
      )}&placement=instagram`
    : "https://business.facebook.com/latest/home?placement=instagram";

  return {
    url: appendHints(base, params),
    label: "Boost on Instagram",
    opens_in: "meta_business_suite",
    caveat:
      "Boosting Instagram posts requires Meta Business Suite access linked to the IG account. Budget is a suggestion — Meta will not pre-fill it.",
  };
}

/**
 * Build a TikTok Ads Manager "Promote" deep link for an organic TT post.
 *
 * Pattern: https://ads.tiktok.com/i18n/promote/post?video_id={id}
 *
 * Falls back to the Promote landing page if `platform_post_id` is missing.
 *
 * Caveat: requires a TikTok for Business account linked to the posting
 * TikTok user.
 */
export function boostOnTikTok(params: PromotionParams): DeepLink {
  const id = params.platform_post_id ?? "";
  const base = id
    ? `https://ads.tiktok.com/i18n/promote/post?video_id=${encodeURIComponent(
        id
      )}`
    : "https://ads.tiktok.com/i18n/promote";

  return {
    url: appendHints(base, params),
    label: "Promote on TikTok",
    opens_in: "tiktok_ads",
    caveat:
      "Requires a TikTok for Business account linked to the posting handle. Budget is a suggestion — TikTok will not pre-fill it.",
  };
}

/**
 * Build a deep link that opens an Instagram post for manual pinning.
 *
 * Instagram exposes NO public API or URL parameter for pinning a post to
 * the profile grid. The best UX we can offer is opening the post itself
 * and instructing the user to long-press / use the post's "..." menu and
 * pick "Pin to your profile".
 *
 * Prefers `permalink` (canonical post URL). Falls back to the platform_post_id
 * via the /p/ shortcode if a permalink isn't available, and finally to
 * instagram.com if neither is present.
 */
export function pinOnInstagram(params: PromotionParams): DeepLink {
  let url = "https://www.instagram.com/";

  if (params.permalink) {
    // Try to normalize via URL parsing, but tolerate malformed input.
    try {
      const parsed = new URL(params.permalink);
      // Only follow http(s) URLs to instagram.com to avoid open-redirect smell.
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.hostname.endsWith("instagram.com")
      ) {
        url = `https://www.instagram.com${parsed.pathname}`;
      } else {
        url = params.permalink;
      }
    } catch {
      url = params.permalink;
    }
  } else if (params.platform_post_id) {
    url = `https://www.instagram.com/p/${encodeURIComponent(
      params.platform_post_id
    )}/`;
  }

  return {
    url: appendHints(url, params),
    label: "Pin on Instagram",
    opens_in: "platform_native",
    caveat:
      "Pinning is a manual action — open the post in the Instagram app, tap the ••• menu, and pick \"Pin to your profile\". There is no public API to do this for you.",
  };
}

/**
 * Dispatcher used by the AI Insight strip. Returns a DeepLink for the
 * (action, platform) combinations we support, or `null` when no sensible
 * deep link exists (e.g., "promote_profile" on any platform — there's no
 * single canonical URL for that flow).
 */
export function getDeepLinkFor(
  action: SuggestedAction,
  params: PromotionParams
): DeepLink | null {
  if (action === "boost") {
    switch (params.platform) {
      case "facebook":
        return boostOnFacebook(params);
      case "instagram":
        return boostOnInstagram(params);
      case "tiktok":
        return boostOnTikTok(params);
      default:
        return null;
    }
  }

  if (action === "pin") {
    if (params.platform === "instagram") {
      return pinOnInstagram(params);
    }
    return null;
  }

  // "promote_profile" and any unknown action: no canonical deep link.
  return null;
}
