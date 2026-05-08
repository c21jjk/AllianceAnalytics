/**
 * Per-platform credential field definitions. Drives the Configure form UI.
 * Fields marked `secret: true` render as <input type="password"> and are
 * treated as sensitive throughout (never returned to the client after save).
 *
 * Last reviewed 2026-05-08 (Phase 2 ingestion live for IG + TT; FB on hold
 * pending Business Manager System User token).
 */
export type CredentialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "paragon_mls"
  | "bright_mls";

export interface CredentialField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  helper?: string;
}

export interface PlatformDef {
  platform: CredentialPlatform;
  label: string;
  description: string;
  /** Optional one-liner shown above the form clarifying setup requirements */
  setup_note?: string;
  fields: CredentialField[];
}

export const PLATFORMS: PlatformDef[] = [
  {
    platform: "facebook",
    label: "Facebook",
    description: "Page posts, reach, reactions, and link clicks via Meta Graph API.",
    setup_note:
      "Requires a long-lived Page Access Token (derived from a long-lived user token via /me/accounts). For Pages on the New Pages Experience, a System User token from Business Manager works best.",
    fields: [
      {
        key: "page_id",
        label: "Page ID",
        required: true,
        secret: false,
        placeholder: "167003126646429",
        helper: "Numeric ID of the Facebook Page to ingest.",
      },
      {
        key: "page_access_token",
        label: "Page Access Token",
        required: true,
        secret: true,
        placeholder: "EAAB…",
        helper:
          "Long-lived (60-day or non-expiring) page token. Page-scoped, with pages_read_engagement + pages_show_list scopes.",
      },
      {
        key: "app_id",
        label: "App ID",
        required: false,
        secret: false,
        helper: "Optional. Used for token refresh if you ever wire one up.",
      },
      { key: "app_secret", label: "App Secret", required: false, secret: true },
    ],
  },
  {
    platform: "instagram",
    label: "Instagram",
    description:
      "Business posts and per-post insights (reach, likes, saves) via the Instagram Graph API.",
    setup_note:
      "Requires the Instagram Business account to be linked to the Facebook Page above. Same page_access_token works for both platforms.",
    fields: [
      {
        key: "ig_business_account_id",
        label: "IG Business Account ID",
        required: true,
        secret: false,
        placeholder: "17841423495362508",
        helper: "Numeric ID of the linked IG Business account.",
      },
      {
        key: "page_access_token",
        label: "Page Access Token",
        required: true,
        secret: true,
        placeholder: "EAAB…",
        helper:
          "Same long-lived page token as Facebook. instagram_manage_insights scope required for analytics.",
      },
      {
        key: "app_id",
        label: "App ID",
        required: false,
        secret: false,
      },
      { key: "app_secret", label: "App Secret", required: false, secret: true },
    ],
  },
  {
    platform: "tiktok",
    label: "TikTok",
    description:
      "Video list and per-video stats (views, likes, comments, shares) via the TikTok Display API.",
    setup_note:
      "OAuth-based. The TT app must register a redirect URI; the target TikTok user must authorize the app. Sandbox apps (client_key prefixed `sb`) use 24-hour access tokens with year-long refresh windows.",
    fields: [
      {
        key: "client_key",
        label: "Client Key",
        required: true,
        secret: false,
        placeholder: "sbaw5pyviph3z8od3g",
        helper:
          "From TikTok dev portal. `sb` prefix = sandbox app, `aw` prefix = production.",
      },
      {
        key: "client_secret",
        label: "Client Secret",
        required: true,
        secret: true,
        helper:
          "Must match the environment of the client_key (sandbox secret for sandbox key, production for production). Also required as TT_CLIENT_SECRET env var on the Edge Function for auto-refresh.",
      },
      {
        key: "access_token",
        label: "Access Token",
        required: true,
        secret: true,
        helper: "From OAuth code exchange. Stored as-is, refreshed automatically by tt-sync when within 1h of expiry.",
      },
      {
        key: "refresh_token",
        label: "Refresh Token",
        required: true,
        secret: true,
        helper: "Single-use. Auto-rotated on every successful refresh.",
      },
      {
        key: "open_id",
        label: "Open ID (TikTok user)",
        required: false,
        secret: false,
        helper: "Identifier for the TikTok user the tokens belong to. Auto-populated from OAuth.",
      },
    ],
  },
  {
    platform: "paragon_mls",
    label: "Paragon MLS",
    description: "Listings sync from Paragon Connect (RESO Web API).",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        required: true,
        secret: false,
        placeholder: "https://api.paragonrels.com/api/v2",
      },
      { key: "api_key", label: "API Key", required: true, secret: true },
      { key: "system_id", label: "System ID", required: false, secret: false },
    ],
  },
  {
    platform: "bright_mls",
    label: "Bright MLS",
    description: "Listings sync from Bright MLS (RESO Web API).",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        required: true,
        secret: false,
        placeholder: "https://api.bridgedataoutput.com/api/v2",
      },
      { key: "api_key", label: "API Key", required: true, secret: true },
      { key: "dataset_id", label: "Dataset ID", required: false, secret: false },
    ],
  },
];

export function getPlatformDef(p: CredentialPlatform): PlatformDef {
  const def = PLATFORMS.find((d) => d.platform === p);
  if (!def) throw new Error(`Unknown platform: ${p}`);
  return def;
}
