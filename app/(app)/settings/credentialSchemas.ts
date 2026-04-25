/**
 * Per-platform credential field definitions. Drives the Configure form UI.
 * Fields marked `secret: true` render as <input type="password"> and are
 * treated as sensitive throughout (never returned to the client after save).
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
  fields: CredentialField[];
}

export const PLATFORMS: PlatformDef[] = [
  {
    platform: "facebook",
    label: "Facebook",
    description: "Pages, posts, and reach metrics via the Meta Graph API.",
    fields: [
      { key: "page_id", label: "Page ID", required: true, secret: false, placeholder: "123456789012345" },
      { key: "page_access_token", label: "Page Access Token", required: true, secret: true, placeholder: "EAAB…" },
      { key: "app_id", label: "App ID", required: false, secret: false },
      { key: "app_secret", label: "App Secret", required: false, secret: true },
    ],
  },
  {
    platform: "instagram",
    label: "Instagram",
    description: "Business posts and engagement via the Instagram Graph API.",
    fields: [
      { key: "ig_business_account_id", label: "IG Business Account ID", required: true, secret: false },
      { key: "page_access_token", label: "Page Access Token", required: true, secret: true, placeholder: "EAAB…" },
      { key: "app_id", label: "App ID", required: false, secret: false },
      { key: "app_secret", label: "App Secret", required: false, secret: true },
    ],
  },
  {
    platform: "tiktok",
    label: "TikTok",
    description: "Posts and engagement via the TikTok for Business API.",
    fields: [
      { key: "advertiser_id", label: "Advertiser ID", required: false, secret: false },
      { key: "access_token", label: "Access Token", required: true, secret: true },
      { key: "refresh_token", label: "Refresh Token", required: false, secret: true },
      { key: "client_key", label: "Client Key", required: false, secret: false },
      { key: "client_secret", label: "Client Secret", required: false, secret: true },
    ],
  },
  {
    platform: "paragon_mls",
    label: "Paragon MLS",
    description: "Listings sync from Paragon Connect (RESO Web API).",
    fields: [
      { key: "api_url", label: "API URL", required: true, secret: false, placeholder: "https://api.paragonrels.com/api/v2" },
      { key: "api_key", label: "API Key", required: true, secret: true },
      { key: "system_id", label: "System ID", required: false, secret: false },
    ],
  },
  {
    platform: "bright_mls",
    label: "Bright MLS",
    description: "Listings sync from Bright MLS (RESO Web API).",
    fields: [
      { key: "api_url", label: "API URL", required: true, secret: false, placeholder: "https://api.bridgedataoutput.com/api/v2" },
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
