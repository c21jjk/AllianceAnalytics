import {
  canonicalMlsHashtag,
  escapeHtml,
  formatOpenHouse,
  type PostBuilderListingWithOH,
} from "./_shared";

/**
 * FB Open House · Hero Card · v1 · Square 1080×1080
 *
 * One designed card per property in a multi-property FB Open House post.
 * Matches the actual C21 Alliance NJ "Open House Weekend" gallery format:
 *
 *   - Cream/white background
 *   - Day + full date + time range at top in small uppercase sans
 *   - "Open" in elegant script (Pinyon Script) + "House" in sans uppercase
 *   - Property photo center in rounded rectangle, drop shadow
 *   - Address centered below in uppercase sans
 *   - "C21" gold serif + "Alliance" dark sans at the very bottom
 *
 * Each listing in the bundle gets its own card with its own date/time.
 * Caller is responsible for setting listing.oh_start_at + oh_end_at on
 * every listing — without those, the time strip falls back to "OPEN HOUSE".
 */
export function renderFBOpenHouseV1(args: {
  listing: PostBuilderListingWithOH;
  heroImageDataUri: string;
}): string {
  const { listing, heroImageDataUri } = args;

  const addressLine = (listing.address ?? "").trim();
  // City only (no state) per the sample — punchier on the gallery card.
  const cityForCard = (listing.city ?? "").trim();
  const addressForCard = [addressLine, cityForCard]
    .filter((s) => s.length > 0)
    .join(", ")
    .toUpperCase();

  // "SATURDAY MAY 9TH 11-1" format
  const dateTimeBanner = formatOHDateTimeBanner(
    listing.oh_start_at,
    listing.oh_end_at,
  );

  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Open House · ${escapeHtml(addressLine)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Pinyon+Script&family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=block" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #FBF8F2; }
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
    background: #FBF8F2;
    padding: 70px 90px 64px 90px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .datetime {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: #525250;
    text-align: center;
  }
  .title {
    margin-top: 12px;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 14px;
    line-height: 1;
  }
  .title-script {
    font-family: "Pinyon Script", "Allura", cursive;
    font-size: 130px;
    font-weight: 400;
    color: #18181B;
    line-height: 1;
    /* The script font sits a bit low — nudge to align with HOUSE baseline */
    transform: translateY(-12px);
  }
  .title-sans {
    font-family: "Inter", sans-serif;
    font-size: 72px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #18181B;
    line-height: 1;
  }
  .photo {
    margin-top: 28px;
    width: 720px;
    height: 480px;
    border-radius: 16px;
    overflow: hidden;
    background-image: url("${heroImageDataUri}");
    background-size: cover;
    background-position: center;
    box-shadow: 0 10px 30px rgba(24, 24, 27, 0.16);
  }
  .address {
    margin-top: 40px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.20em;
    text-transform: uppercase;
    color: #525250;
    text-align: center;
    word-break: break-word;
  }
  .brand {
    margin-top: auto;
    padding-top: 24px;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 12px;
  }
  .brand-c21 {
    font-family: "Playfair Display", serif;
    font-size: 44px;
    font-weight: 700;
    color: #C9A961;
    letter-spacing: -0.01em;
  }
  .brand-alliance {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: 0.20em;
    text-transform: uppercase;
    color: #18181B;
  }
  .mls-watermark {
    position: absolute;
    bottom: 18px;
    right: 24px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #A3A3A0;
    opacity: 0.6;
  }
</style>
<body>
  <div class="frame">
    <div class="datetime">${escapeHtml(dateTimeBanner)}</div>
    <div class="title">
      <span class="title-script">Open</span>
      <span class="title-sans">House</span>
    </div>
    <div class="photo"></div>
    ${addressForCard ? `<div class="address">${escapeHtml(addressForCard)}</div>` : ""}
    <div class="brand">
      <span class="brand-c21">C21</span>
      <span class="brand-alliance">Alliance</span>
    </div>
    <div class="mls-watermark">${escapeHtml(mlsHashtag)}</div>
  </div>
</body>
</html>`;
}

/**
 * Format the date/time banner shown at the top of the Open House card.
 * Output: "SATURDAY MAY 16TH 2-5PM"
 *
 * Falls back to "OPEN HOUSE" if start_at is missing.
 */
function formatOHDateTimeBanner(
  start_at: string | null | undefined,
  end_at: string | null | undefined,
): string {
  if (!start_at) return "OPEN HOUSE";
  try {
    const start = new Date(start_at);
    if (Number.isNaN(start.getTime())) return "OPEN HOUSE";

    // Weekday + month + day with ordinal
    const tz = "America/New_York";
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: tz,
    })
      .format(start)
      .toUpperCase();
    const month = new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: tz,
    })
      .format(start)
      .toUpperCase();
    const day = parseInt(
      new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(start),
      10,
    );
    const dayWithOrdinal = `${day}${ordinalSuffix(day)}`;

    // Times: drop minute when on the hour, drop "M" suffix to match brand
    // ("11-1PM" not "11AM-1PM" per the sample).
    const startTime = formatHour(start, tz);
    const end = end_at ? new Date(end_at) : null;
    const endTime = end && !Number.isNaN(end.getTime()) ? formatHour(end, tz) : null;

    // Use the existing helper as a fallback for output format
    const timeRange = endTime
      ? `${startTime.replace(/(AM|PM)$/i, "")}-${endTime}`
      : startTime;

    return `${weekday} ${month} ${dayWithOrdinal} ${timeRange}`;
  } catch {
    return formatOpenHouse(start_at, end_at) ?? "OPEN HOUSE";
  }
}

function ordinalSuffix(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "TH";
  switch (n % 10) {
    case 1: return "ST";
    case 2: return "ND";
    case 3: return "RD";
    default: return "TH";
  }
}

function formatHour(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: d.getUTCMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: tz,
  });
  return fmt.format(d).replace(/\s/g, "").toUpperCase();
}
