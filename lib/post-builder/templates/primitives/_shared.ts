import type { PostBuilderListing, PostCustomizations, PostType } from "../../types";

/**
 * Helpers shared by all variant primitive renderers.
 *
 * The "primitive" layer takes a (listing, theme, heroImage) tuple and emits
 * a complete HTML document. Themes carry post-type-specific text + colors so
 * one variant primitive can render Just Listed, Just Sold, Under Contract,
 * and Open House by swapping themes.
 */

export interface PostTypeTheme {
  post_type: PostType;
  /** Top-of-image label text — uppercased at render time. */
  eyebrow: string;
  /** Primary accent color (gold-500 by default). */
  accent: string;
  /** Darker accent for gradients (gold-700 family). */
  accent_dark: string;
  /** Optional corner overlay treatment — typically "SOLD" or "↓ NEW PRICE". */
  badge?: {
    text: string;
    /** Stamp = rotated outlined block. Banner = horizontal across photo. */
    style: "stamp" | "banner";
    /**
     * Optional fill color override for the badge. Defaults to the SOLD red
     * if omitted. Use the listing-friendly green for things like price
     * reductions where we don't want the visual to read as a warning.
     */
    color?: "red" | "gold" | "green";
  };
  /**
   * What to show in the price slot:
   *   "list_price"    → use listing.list_price
   *   "close_price"   → use listing.close_price (Just Sold)
   *   "label"         → use the theme's price_label string instead (Under Contract)
   *   "none"          → omit the price line entirely
   */
  price_mode: "list_price" | "close_price" | "label" | "none";
  /** Used when price_mode === "label". */
  price_label?: string;
  /**
   * Whether to render the open house date/time slot. Templates check
   * heroImageDataUri's listing for oh_start_at when this is true.
   */
  show_open_house_datetime?: boolean;
  /** Soft footer CTA shown next to the brand mark, e.g. "Tour link in bio". */
  footer_cta?: string;
}

/**
 * Alias kept for clarity in templates — the OH fields live on
 * PostBuilderListing as optional, but templates that render the OH
 * date/time slot should accept this name to make the contract explicit.
 */
export type PostBuilderListingWithOH = PostBuilderListing;

/**
 * HTML escape — applied to ALL user-controlled strings before they hit the
 * template HTML. Tested in the edge case suite.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Canonical MLS hashtag. Mirrors lib/data/listings-needing-posts.ts toHashtag()
 * so the auto-linker recognizes the output.
 */
export function canonicalMlsHashtag(
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

/**
 * Resolve the price text to render based on theme.price_mode.
 * Returns null when nothing should be drawn in the price slot.
 */
export function resolvePriceText(
  listing: PostBuilderListing,
  theme: PostTypeTheme,
): string | null {
  if (theme.price_mode === "none") return null;
  if (theme.price_mode === "label") return theme.price_label ?? null;
  const price =
    theme.price_mode === "close_price" ? listing.close_price : listing.list_price;
  if (typeof price !== "number") {
    // Fall back gracefully: if a sold listing has no close_price, show "SOLD"
    // text via the price_label, otherwise omit.
    if (theme.price_mode === "close_price" && theme.price_label) {
      return theme.price_label;
    }
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Build the bed/bath/property-type chips list. Returns the visible strings;
 * order is BD → BA → property type.
 */
export function buildChips(listing: PostBuilderListing): string[] {
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
  return [bedLabel, bathLabel, propTypeLabel].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}

/**
 * Format an Open House date+time pair for display on the post image.
 * UTC ISO timestamps in → "SAT MAY 16 · 2-5 PM" out (America/New_York).
 *
 * If end_at is null, returns "SAT MAY 16 · 2 PM".
 * Returns null if start_at is null.
 */
export function formatOpenHouse(
  start_at: string | null | undefined,
  end_at: string | null | undefined,
): string | null {
  if (!start_at) return null;
  try {
    const start = new Date(start_at);
    const end = end_at ? new Date(end_at) : null;
    if (Number.isNaN(start.getTime())) return null;

    const datePart = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    }).format(start).toUpperCase();

    const startHour = formatHour(start);
    const endHour = end && !Number.isNaN(end.getTime()) ? formatHour(end) : null;

    const timePart = endHour ? `${startHour}-${endHour}` : startHour;
    return `${datePart} · ${timePart}`;
  } catch {
    return null;
  }
}

function formatHour(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  return fmt.format(d).replace(/\s/g, "").toUpperCase(); // "1PM" / "1:30PM"
}

/**
 * Common <head> block used by every template regardless of format. Loads
 * Inter from Google Fonts (cached aggressively, sub-second on repeat renders).
 */
export function commonHead(title: string): string {
  return `<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block" rel="stylesheet" />
</head>`;
}

/**
 * Backward-compat alias — existing square primitives call this name.
 * @deprecated Use commonHead() instead. Kept so older callers still compile.
 */
export const commonSquareHead = commonHead;

/**
 * Story 9:16 safe zones — Instagram and Facebook Story UI overlays both
 * the top and bottom of the frame. Templates must keep critical content
 * (address, price, MLS hashtag, footer brand) inside the safe band.
 *
 * Values come from Meta's published Story design guidelines; same numbers
 * work for both IG and FB.
 */
export const STORY_SAFE_ZONE = {
  /** Top region reserved for status bar, profile avatar, and time. */
  top: 250,
  /** Bottom region reserved for "Send" box, sticker tray, swipe-up area. */
  bottom: 340,
  /** Total frame height. */
  height: 1920,
  /** Critical-content band — middle of the frame. */
  contentTop: 250,
  contentBottom: 1580, // 1920 - 340
} as const;

/**
 * Renders the optional badge overlay (e.g. SOLD stamp). Returns empty string
 * when the theme has no badge configured. Supports an optional color
 * override class — `red` (default), `gold`, or `green`.
 */
export function renderBadge(theme: PostTypeTheme): string {
  if (!theme.badge) return "";
  const colorClass = `badge-color-${theme.badge.color ?? "red"}`;
  if (theme.badge.style === "stamp") {
    return `<div class="badge-stamp ${colorClass}"><span>${escapeHtml(theme.badge.text)}</span></div>`;
  }
  // banner
  return `<div class="badge-banner ${colorClass}"><span>${escapeHtml(theme.badge.text)}</span></div>`;
}

/** CSS rules for the optional badge overlays. Included in every template. */
export const BADGE_CSS = `
  .badge-stamp {
    position: absolute;
    top: 110px;
    right: 56px;
    z-index: 4;
    transform: rotate(-8deg);
    pointer-events: none;
  }
  .badge-stamp span {
    display: inline-block;
    padding: 14px 32px;
    border: 5px solid #FCFCFB;
    border-radius: 8px;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-shadow: 0 2px 8px rgba(0,0,0,0.25);
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }
  /* Color variants — applied to .badge-stamp or .badge-banner span. */
  .badge-color-red    span { background: rgba(184, 60, 60, 0.92); }
  .badge-color-gold   span { background: rgba(201, 169, 97, 0.95); color: #18181B; text-shadow: 0 1px 2px rgba(255,255,255,0.25); }
  .badge-color-green  span { background: rgba(47, 143, 92, 0.95); }
  .badge-banner {
    position: absolute;
    top: 130px;
    left: 0;
    right: 0;
    z-index: 4;
    background: rgba(184, 60, 60, 0.92);
    color: #FFFFFF;
    text-align: center;
    padding: 12px 0;
    pointer-events: none;
  }
  .badge-banner span {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    text-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
`;

/**
 * Path A — Brand-safe color palette for the customizations UI. Each entry
 * pairs an accent with a darker companion for gradients. The first row is
 * Alliance brand colors (gold + grey). Subsequent rows are tone-shifted
 * accent options that still feel appropriate for real estate marketing
 * (deep blue for luxury, emerald for growth/listing-life energy, etc).
 *
 * Off-palette hex picks are allowed via the "custom" entry but the UI
 * surfaces a "not Alliance brand" caution when used.
 */
export const BRAND_PALETTE: ReadonlyArray<{
  id: string;
  label: string;
  accent: string;
  accent_dark: string;
  on_brand: boolean;
}> = [
  { id: "alliance_gold", label: "Alliance Gold", accent: "#C9A84C", accent_dark: "#8B7530", on_brand: true },
  { id: "obsessed_grey", label: "Obsessed Grey", accent: "#3F3F45", accent_dark: "#252526", on_brand: true },
  { id: "deep_navy", label: "Deep Navy", accent: "#1E3A5F", accent_dark: "#0F2347", on_brand: false },
  { id: "emerald", label: "Emerald", accent: "#2F8F5C", accent_dark: "#1F6840", on_brand: false },
  { id: "burgundy", label: "Burgundy", accent: "#8B2C3C", accent_dark: "#5F1B27", on_brand: false },
  { id: "rosewood", label: "Rosewood", accent: "#C0584F", accent_dark: "#883830", on_brand: false },
];

/**
 * Build a CSS override layer for user customizations. Returns a `<style>`
 * tag string (or empty string when customizations is empty/undefined).
 *
 * Design notes:
 * - Color overrides use !important to win against template inline values.
 *   Templates that bake colors into background-image gradient stops still
 *   render with the original gradient — those are uncommon, and we can
 *   chase them later by refactoring to CSS variables.
 * - Visibility toggles target stable class names from the primitives:
 *   .eyebrow / .price / .chips / .footer / .badge-stamp / .badge-banner.
 * - Badge size scales the stamp by transform; we offset the transform-origin
 *   so it grows from the corner rather than the center (keeps the badge in
 *   a sensible spot regardless of size).
 * - Badge position swaps top/right anchors. The CSS resets the stamp's
 *   inset on three sides and re-anchors to the requested corner.
 */
export function buildCustomizationCSS(c?: PostCustomizations | null): string {
  if (!c || Object.keys(c).length === 0) return "";

  const lines: string[] = [];

  // ── Color overrides ──────────────────────────────────────────────
  if (c.colors?.accent) {
    const a = sanitizeHex(c.colors.accent);
    const ad = c.colors.accent_dark ? sanitizeHex(c.colors.accent_dark) : darkenHex(a);
    if (a) {
      // The gold rule, brand mark gradient, accent text, eyebrow gradient
      // all use the accent. Override them at the property level.
      lines.push(`
        .eyebrow-rule,
        .gold-rule {
          background: linear-gradient(90deg, ${a} 0%, ${ad} 100%) !important;
        }
        .brand-mark {
          background: linear-gradient(135deg, ${a} 0%, ${ad} 100%) !important;
        }
        .price { color: ${a} !important; }
        .open-house-strip { background: ${a} !important; }
        .chip { border-color: ${a} !important; }
      `);
    }
  }

  // ── Visibility toggles (target stable primitive class names) ─────
  const hideRules: string[] = [];
  if (c.hide?.eyebrow) hideRules.push(".eyebrow { display: none !important; }");
  if (c.hide?.badge) {
    hideRules.push(".badge-stamp, .badge-banner { display: none !important; }");
  }
  if (c.hide?.price) hideRules.push(".price { display: none !important; }");
  if (c.hide?.stats_row) hideRules.push(".chips { display: none !important; }");
  if (c.hide?.footer) hideRules.push(".footer { display: none !important; }");
  if (c.hide?.agent_name) {
    hideRules.push(".agent, .agent-name, [data-role='agent'] { display: none !important; }");
  }
  if (hideRules.length > 0) {
    lines.push(hideRules.join("\n"));
  }

  // ── Badge sizing ─────────────────────────────────────────────────
  if (c.badge_size && c.badge_size !== "md") {
    const scaleFor: Record<NonNullable<PostCustomizations["badge_size"]>, number> = {
      sm: 0.75,
      md: 1.0,
      lg: 1.25,
      xl: 1.5,
    };
    const s = scaleFor[c.badge_size];
    lines.push(`
      .badge-stamp { transform-origin: top right; transform: rotate(-8deg) scale(${s}) !important; }
      .badge-banner span { font-size: ${Math.round(30 * s)}px !important; }
      .badge-banner { padding: ${Math.round(12 * s)}px 0 !important; }
    `);
  }

  // ── Badge position (stamp only — banners ignore) ─────────────────
  if (c.badge_position) {
    const positions: Record<NonNullable<PostCustomizations["badge_position"]>, string> = {
      top_left: "top: 110px; right: auto; bottom: auto; left: 56px;",
      top_right: "top: 110px; right: 56px; bottom: auto; left: auto;",
      bottom_left: "top: auto; right: auto; bottom: 110px; left: 56px;",
      bottom_right: "top: auto; right: 56px; bottom: 110px; left: auto;",
    };
    // Adjust transform-origin so scale grows from the anchored corner.
    const origins: Record<NonNullable<PostCustomizations["badge_position"]>, string> = {
      top_left: "top left",
      top_right: "top right",
      bottom_left: "bottom left",
      bottom_right: "bottom right",
    };
    lines.push(`
      .badge-stamp {
        ${positions[c.badge_position]}
        transform-origin: ${origins[c.badge_position]};
      }
    `);
  }

  // ── Eyebrow sizing ───────────────────────────────────────────────
  // Scales the eyebrow text + the gold rule together so they keep their
  // visual relationship. The original 22px default felt too small in
  // practice — bumped 3× across the board so that even SM is meaningfully
  // larger than the un-customized template default.
  // Selecting any preset (including md) emits the override; "no preset"
  // (eyebrow_size undefined) falls back to the original template default.
  if (c.eyebrow_size) {
    const scaleFor: Record<NonNullable<PostCustomizations["eyebrow_size"]>, number> = {
      sm: 2.4,
      md: 3.0,
      lg: 3.9,
      xl: 4.8,
    };
    const s = scaleFor[c.eyebrow_size];
    lines.push(`
      .eyebrow { gap: ${Math.round(18 * s)}px !important; }
      .eyebrow-text { font-size: ${Math.round(22 * s)}px !important; }
      .eyebrow-rule { width: ${Math.round(56 * s)}px !important; height: ${Math.max(2, Math.round(3 * s))}px !important; }
    `);
  }

  // ── Eyebrow position ─────────────────────────────────────────────
  // Default in every template today is top_left at 56px inset.
  if (c.eyebrow_position) {
    const positions: Record<NonNullable<PostCustomizations["eyebrow_position"]>, string> = {
      top_left: "top: 56px; right: auto; bottom: auto; left: 56px;",
      top_right: "top: 56px; right: 56px; bottom: auto; left: auto;",
      bottom_left: "top: auto; right: auto; bottom: 56px; left: 56px;",
      bottom_right: "top: auto; right: 56px; bottom: 56px; left: auto;",
    };
    lines.push(`
      .eyebrow { ${positions[c.eyebrow_position]} }
    `);
  }

  if (lines.length === 0) return "";
  return `<style data-customizations="1">\n${lines.join("\n")}\n</style>`;
}

/** Resolve a customizations object's accent/accent_dark with sensible defaults. */
export function applyColorCustomizations(
  theme: PostTypeTheme,
  c?: PostCustomizations | null,
): PostTypeTheme {
  if (!c?.colors?.accent) return theme;
  const accent = sanitizeHex(c.colors.accent);
  if (!accent) return theme;
  const accent_dark = c.colors.accent_dark
    ? sanitizeHex(c.colors.accent_dark) ?? darkenHex(accent)
    : darkenHex(accent);
  return { ...theme, accent, accent_dark };
}

/**
 * Apply text + eyebrow overrides to a theme. Templates already pull
 * theme.eyebrow / theme.badge.text / theme.footer_cta, so mutating the
 * theme here lights up the overrides without touching primitive code.
 */
export function applyTextCustomizations(
  theme: PostTypeTheme,
  c?: PostCustomizations | null,
): PostTypeTheme {
  if (!c?.text) return theme;
  let next: PostTypeTheme = theme;
  if (typeof c.text.eyebrow === "string" && c.text.eyebrow.trim()) {
    next = { ...next, eyebrow: c.text.eyebrow.trim() };
  }
  if (typeof c.text.cta === "string") {
    next = { ...next, footer_cta: c.text.cta.trim() || undefined };
  }
  if (typeof c.text.badge_text === "string" && c.text.badge_text.trim() && next.badge) {
    next = { ...next, badge: { ...next.badge, text: c.text.badge_text.trim() } };
  }
  return next;
}

/**
 * Inject the customization CSS at the end of a rendered template body so
 * its rules win the cascade. Looks for `</body>` and slots the style block
 * just before it; falls back to appending if `</body>` isn't found.
 */
export function injectCustomizationCSS(html: string, css: string): string {
  if (!css) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + css;
  return html.slice(0, idx) + css + html.slice(idx);
}

// ── Internal color helpers ──────────────────────────────────────────

function sanitizeHex(s: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? `#${m[1].toUpperCase()}` : "";
}

function darkenHex(hex: string, amount = 0.35): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}
