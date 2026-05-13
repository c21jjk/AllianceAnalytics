import type { PostBuilderListing } from "../types";

/**
 * Just Listed · Square 1:1 · v1 (Hero Photo · Editorial)
 *
 * 1080x1080. Hero photo fills the frame. Bottom 38% is a downward dark
 * gradient that holds the type. Layout:
 *
 *   ┌─────────────────────────────┐
 *   │  [JUST LISTED  · gold rule] │
 *   │                             │
 *   │      hero image fills       │
 *   │      entire frame           │
 *   │                             │
 *   │ ─── gradient ───            │
 *   │  Address · Line 1           │
 *   │  City, ST  ZIP              │
 *   │                             │
 *   │  $ Price                    │
 *   │  • beds  • baths  · chips   │
 *   │                             │
 *   │  C21 ALLIANCE   ·   #MLS    │
 *   └─────────────────────────────┘
 *
 * Brand: gold #C9A961, neutrals from the design system. Inter font (matches
 * the app — Barlow can be added in a later iteration if requested).
 *
 * Returns a complete HTML document ready for headless Chromium to render.
 * All CSS is inlined; no external network calls except for fonts (Google
 * Fonts) which are intentional and cache well.
 */
export function renderJustListedSquareV1(args: {
  listing: PostBuilderListing;
  heroImageDataUri: string;
}): string {
  const { listing, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityStateZip = [
    [listing.city, listing.state].filter(Boolean).join(", "),
    listing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const priceFormatted =
    typeof listing.list_price === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(listing.list_price)
      : null;

  const totalBaths =
    (listing.bathrooms_full ?? 0) + (listing.bathrooms_half ?? 0) * 0.5;
  const bathLabel =
    totalBaths > 0
      ? totalBaths % 1 === 0
        ? `${totalBaths.toFixed(0)} BA`
        : `${totalBaths.toFixed(1)} BA`
      : null;
  const bedLabel =
    typeof listing.bedrooms === "number" && listing.bedrooms > 0
      ? `${listing.bedrooms} BD`
      : null;
  const propTypeLabel = listing.property_type
    ? listing.property_type.toUpperCase().replace(/_/g, " ")
    : null;

  const chips = [bedLabel, bathLabel, propTypeLabel].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Just Listed · ${escapeHtml(addressLine1)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame {
    position: relative;
    width: 1080px;
    height: 1080px;
    overflow: hidden;
  }
  .hero {
    position: absolute;
    inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }
  .hero-tint {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.55) 0%,
      rgba(24,24,27,0.18) 14%,
      rgba(24,24,27,0.0) 32%,
      rgba(24,24,27,0.0) 50%,
      rgba(24,24,27,0.55) 70%,
      rgba(24,24,27,0.92) 100%);
  }
  .eyebrow {
    position: absolute;
    top: 56px;
    left: 56px;
    display: flex;
    align-items: center;
    gap: 18px;
    z-index: 3;
  }
  .eyebrow-rule {
    width: 56px;
    height: 3px;
    background: linear-gradient(90deg, #C9A961 0%, #B69552 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .content {
    position: absolute;
    left: 56px;
    right: 56px;
    bottom: 56px;
    z-index: 3;
  }
  .gold-rule {
    width: 64px;
    height: 4px;
    background: linear-gradient(90deg, #C9A961 0%, #B69552 100%);
    border-radius: 2px;
    margin-bottom: 22px;
  }
  .address {
    font-size: 56px;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #FFFFFF;
    text-shadow: 0 2px 12px rgba(0,0,0,0.4);
    word-break: break-word;
  }
  .citystate {
    margin-top: 8px;
    font-size: 26px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #F1F1EF;
    text-transform: uppercase;
    text-shadow: 0 1px 6px rgba(0,0,0,0.3);
  }
  .price {
    margin-top: 28px;
    font-size: 64px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #C9A961;
    text-shadow: 0 2px 14px rgba(0,0,0,0.45);
    line-height: 1;
  }
  .chips {
    margin-top: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 12px 22px;
    background: rgba(252,252,251,0.10);
    border: 1.5px solid rgba(201,169,97,0.55);
    border-radius: 999px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: #FCFCFB;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .footer {
    margin-top: 32px;
    padding-top: 22px;
    border-top: 1px solid rgba(252,252,251,0.18);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-mark {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    background: linear-gradient(135deg, #C9A961 0%, #937843 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 800;
    color: #18181B;
    letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #FCFCFB;
    text-transform: uppercase;
  }
  .mls-tag {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.16em;
    color: rgba(252,252,251,0.65);
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="hero"></div>
    <div class="hero-tint"></div>
    <div class="eyebrow">
      <span class="eyebrow-rule"></span>
      <span class="eyebrow-text">Just Listed</span>
    </div>
    <div class="content">
      <div class="gold-rule"></div>
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
      ${priceFormatted ? `<div class="price">${escapeHtml(priceFormatted)}</div>` : ""}
      ${
        chips.length > 0
          ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`
          : ""
      }
      <div class="footer">
        <div class="brand">
          <div class="brand-mark">21</div>
          <div class="brand-text">Century 21 Alliance</div>
        </div>
        <div class="mls-tag">${escapeHtml(mlsHashtag)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Inline duplicate of toHashtag() from lib/data/listings-needing-posts.ts —
 * kept here so the template file is self-contained for testing. If the
 * canonical function moves, update both.
 */
function canonicalMlsHashtag(
  mls_number: string,
  source_mls: PostBuilderListing["source_mls"],
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
