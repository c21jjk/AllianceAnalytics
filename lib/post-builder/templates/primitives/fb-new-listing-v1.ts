import {
  canonicalMlsHashtag,
  commonHead,
  escapeHtml,
  type PostBuilderListingWithOH,
} from "./_shared";

/**
 * FB New Listing · Hero Card · v1 · Square 1080×1080
 *
 * The "lead" image in a Facebook multi-photo post. Designed asset that
 * provides brand identity + key stats; the subsequent photos in the FB
 * gallery are real listing shots so viewers can evaluate the property.
 *
 * Matches the actual C21 Alliance NJ post design:
 *   - Cream/white background (NOT the dark IG palette)
 *   - "NEW LISTING" in Playfair Display serif (large, top-left)
 *   - Address subtitle in uppercase sans-serif (under title)
 *   - "C21 ALLIANCE" black badge (top-right)
 *   - Property photo center (~58% of card), rounded corners
 *   - Dark bottom strip: BD | BA | CUSTOM_FEATURE
 *
 * The custom_feature is hand-picked or AI-suggested — the third stat
 * that makes the property stand out (e.g. "SUNSET VIEWS", "BEACHBLOCK",
 * "OPEN CONCEPT"). Falls back to PROPERTY TYPE if not provided.
 */
export function renderFBNewListingV1(args: {
  listing: PostBuilderListingWithOH;
  heroImageDataUri: string;
  customFeature?: string | null;
}): string {
  const { listing, heroImageDataUri, customFeature } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ").trim();
  const cityStateZip = listing.zip ? `${cityState} ${listing.zip}` : cityState;

  const bdLabel =
    typeof listing.bedrooms === "number" && listing.bedrooms > 0
      ? `${listing.bedrooms} BEDROOM${listing.bedrooms === 1 ? "" : ""}`
      : null;
  const totalBaths =
    (listing.bathrooms_full ?? 0) + (listing.bathrooms_half ?? 0) * 0.5;
  const baLabel =
    totalBaths > 0
      ? totalBaths % 1 === 0
        ? `${totalBaths.toFixed(0)} BATHROOM`
        : `${totalBaths.toFixed(1)} BATHROOM`
      : null;
  const propTypeLabel = listing.property_type
    ? listing.property_type.toUpperCase().replace(/_/g, " ")
    : null;

  // Custom feature is the third stat. AI suggests, user can override.
  // Fall back to property type if not provided.
  const featureLabel = customFeature?.trim().toUpperCase() || propTypeLabel || "";

  const statItems = [bdLabel, baLabel, featureLabel].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>New Listing · ${escapeHtml(addressLine1)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=block" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #F8F4ED; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame {
    position: relative;
    width: 1080px;
    height: 1080px;
    background: #F8F4ED;
    padding: 64px 64px 0 64px;
  }
  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }
  .title-block { flex: 1; min-width: 0; }
  .title {
    font-family: "Playfair Display", "Times New Roman", serif;
    font-size: 96px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.0;
    color: #18181B;
  }
  .address-sub {
    margin-top: 18px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #525250;
  }
  .brand-badge {
    flex-shrink: 0;
    margin-top: 14px;
    display: inline-flex;
    align-items: center;
    background: #18181B;
    color: #FCFCFB;
    padding: 8px 14px;
    border-radius: 4px;
    gap: 6px;
  }
  .brand-c21 {
    font-family: "Playfair Display", serif;
    font-size: 14px;
    font-weight: 700;
    color: #C9A961;
    letter-spacing: 0.06em;
  }
  .brand-alliance {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.20em;
    text-transform: uppercase;
  }
  .photo-wrap {
    margin-top: 36px;
    width: 952px;
    height: 632px;
    border-radius: 18px;
    overflow: hidden;
    background-image: url("${heroImageDataUri}");
    background-size: cover;
    background-position: center;
    box-shadow: 0 12px 36px rgba(24, 24, 27, 0.18);
  }
  .stats-strip {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: #18181B;
    color: #FCFCFB;
    padding: 28px 64px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .stat {
    flex: 1;
    text-align: center;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #FCFCFB;
  }
  .stat-sep {
    width: 1px;
    height: 36px;
    background: rgba(252, 252, 251, 0.30);
    flex-shrink: 0;
  }
  .mls-watermark {
    position: absolute;
    bottom: 88px;
    right: 28px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #A3A3A0;
    opacity: 0.7;
  }
</style>
<body>
  <div class="frame">
    <div class="title-row">
      <div class="title-block">
        <div class="title">New Listing</div>
        ${cityStateZip ? `<div class="address-sub">${escapeHtml(addressLine1)} · ${escapeHtml(cityStateZip)}</div>` : addressLine1 ? `<div class="address-sub">${escapeHtml(addressLine1)}</div>` : ""}
      </div>
      <div class="brand-badge">
        <span class="brand-c21">C21</span>
        <span class="brand-alliance">Alliance</span>
      </div>
    </div>
    <div class="photo-wrap"></div>
    ${statItems.length > 0
      ? `<div class="stats-strip">${statItems
          .map(
            (s, i) =>
              (i > 0 ? `<span class="stat-sep"></span>` : "") +
              `<span class="stat">${escapeHtml(s)}</span>`,
          )
          .join("")}</div>`
      : ""}
    <div class="mls-watermark">${escapeHtml(mlsHashtag)}</div>
  </div>
</body>
</html>`;
}
