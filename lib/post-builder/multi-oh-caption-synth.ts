/**
 * Multi-OH caption synthesis — shared, pure, client-safe module.
 *
 * Lives in `lib/post-builder/` so BOTH the generate route (server) and the
 * wizard's Step 3 caption preview (client) can call the same code. The
 * module is intentionally:
 *
 *   • dependency-free — no Supabase, no `process.env`, no `server-only`.
 *   • deterministic — same input → same output. Pool picks are hash-keyed
 *     on event title + property count so re-renders of the same event
 *     produce the same caption.
 *   • side-effect free — pure functions only. Safe to invoke 60 times per
 *     second from a React onChange if we want to (and we do — Step 3
 *     recomputes the preview on every state change).
 *
 * 2026-05-27 — moved out of `app/api/post-builder/multi-oh-generate/route.ts`
 * so the wizard's Step 3 preview can show the live caption without
 * round-tripping the server. Also expanded the opener / closer pools from
 * 5 variants × 2 themes to 8-10 variants × 5 themes, added tone auto-detect,
 * smarter geographic phrasing, and accepts a full-caption user override.
 *
 * Caption shape (matches a real gold-standard post Larissa shipped):
 *
 *   {opener_emoji} {opener_line} {closing_emoji_pair}
 *
 *   📍 {Weekday, Month Day}
 *   • {Address}, {City} | {time-range}
 *
 *   📍 {Next day}
 *   • {Address}, {City} | {time-range}
 *
 *   {closer_line} 🖤💛
 *
 *   #century21alliance #shoredivision #southjerseyrealestate #openhouse #{region}
 *
 * Caption emojis are allowed; the no-emoji rule applies to canvas/image
 * text only. IG / FB cap at 5 hashtags total. TT shortens to one line.
 */

import type { SourceMls } from "@/lib/post-builder/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Tone selector for the opener / closer pool. `"auto"` runs the heuristic
 * detection in {@link detectTone}; everything else short-circuits the
 * heuristic and picks from the named pool directly.
 *
 * `"editorial"` is never auto-picked — user-explicit only.
 */
export type CaptionTone =
  | "auto"
  | "coastal"
  | "family"
  | "investor"
  | "cozy"
  | "editorial";

/**
 * Slim property shape — only what the caption needs. Decoupled from the
 * full `MultiOHEventProperty` so wizard previews can construct it from any
 * shape without ferrying renderer-only fields (hero_image_url, etc.).
 */
export interface MultiOHCaptionProperty {
  address: string | null;
  city: string | null;
  mls_number: string;
  source_mls?: SourceMls;
  unit_number?: string | null;
  list_price?: number | null;
  property_type?: string | null;
  /** Every OH window for this property. Empty/undefined falls back to
   *  the single-session pair below. */
  oh_sessions?: ReadonlyArray<{
    start_at: string | null;
    end_at: string | null;
  }>;
  oh_start_at?: string | null;
  oh_end_at?: string | null;
}

export interface MultiOHCaptionInput {
  properties: readonly MultiOHCaptionProperty[];
  /** Tone bias. Default `"auto"`. */
  tone?: CaptionTone;
  /**
   * Full-caption user override. When set, replaces the auto-synthesized
   * body for all three platforms. Hashtags are still synthesized + appended
   * unless the override already contains hashtags (we check for `#` lines
   * at the bottom of the override; if present we trust the user wrote them
   * deliberately and skip the auto append).
   *
   * Empty string + null both mean "no override; auto-synthesize".
   */
  caption_override?: string | null;
}

export interface MultiOHCaptionResult {
  /** Legacy single-caption mirror — matches the IG variant. Persisted to
   *  generated_posts.caption + .hashtags for back-compat with consumers
   *  that haven't moved to captions_by_platform yet. */
  legacy: { caption: string; hashtags: string[]; mls_hashtag: string };
  captions: Record<
    "instagram" | "facebook" | "tiktok",
    { caption: string; hashtags: string[] }
  >;
  /** Which tone was actually used (auto resolves to a concrete one). */
  resolved_tone: Exclude<CaptionTone, "auto">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timezone pin for every date/time formatter. Pinned to America/New_York
 *  so server-side TZ drift doesn't shove a Saturday OH into Sunday's bucket. */
const CAPTION_TZ = "America/New_York";

/** Substring patterns that flag a shore/coastal city. Used by both the
 *  tone auto-detector and the geographic phrasing helper. */
const SHORE_CITY_PATTERNS: readonly string[] = [
  "wildwood",
  "ocean city",
  "cape may",
  "sea isle",
  "stone harbor",
  "avalon",
  "strathmere",
  "atlantic city",
  "brigantine",
  "margate",
  "ventnor",
  "longport",
  "beach",
  "shore",
  "coast",
  "bay",
];

/** Towns that sit inside Cape May County (per Alliance's coverage area).
 *  Used by the geographic helper to surface "all in Cape May County"
 *  variants when every picked town belongs here. */
const CAPE_MAY_COUNTY_TOWNS: readonly string[] = [
  "wildwood",
  "north wildwood",
  "wildwood crest",
  "west wildwood",
  "cape may",
  "cape may court house",
  "cape may courthouse",
  "west cape may",
  "north cape may",
  "lower township",
  "middle township",
  "sea isle city",
  "stone harbor",
  "avalon",
  "strathmere",
  "ocean city", // Ocean City is technically Cape May County
  "dennis township",
  "upper township",
  "woodbine",
];

/** Property-type / address substrings that flag a likely investor-tone
 *  property (multi-unit, duplex, triplex). */
const INVESTOR_TYPE_PATTERNS: readonly string[] = [
  "multi-family",
  "multifamily",
  "duplex",
  "triplex",
  "quadplex",
  "fourplex",
  "two family",
  "three family",
  "four family",
];

/** Hand-curated regional hashtags for the towns Alliance services. */
const TOWN_TAGS: Record<string, string> = {
  wildwood: "#wildwoodnj",
  "north wildwood": "#wildwoodnj",
  "wildwood crest": "#wildwoodnj",
  "west wildwood": "#wildwoodnj",
  "ocean city": "#oceancitynj",
  "cape may": "#capemaynj",
  "cape may court house": "#capemaynj",
  "cape may courthouse": "#capemaynj",
  "west cape may": "#capemaynj",
  "north cape may": "#capemaynj",
  "sea isle city": "#seaislecitynj",
  "stone harbor": "#stoneharbornj",
  avalon: "#avalonnj",
  strathmere: "#strathmerenj",
  "atlantic city": "#atlanticcitynj",
  brigantine: "#brigantinenj",
  margate: "#margatenj",
  "margate city": "#margatenj",
  ventnor: "#ventnornj",
  "ventnor city": "#ventnornj",
  longport: "#longportnj",
};

const BRAND_TAGS: readonly string[] = [
  "#century21alliance",
  "#shoredivision",
  "#southjerseyrealestate",
  "#openhouse",
];

// ---------------------------------------------------------------------------
// Tone auto-detection
// ---------------------------------------------------------------------------

/**
 * Heuristic tone picker — runs only when the caller passes `tone === "auto"`
 * (the wizard's default). Returns the concrete tone the synth should use.
 *
 * Rules:
 *   • Investor: ≥1 property is multi-unit/duplex/triplex AND in a shore
 *     rental market, OR median list price > $1.2M.
 *   • Coastal:  ≥2 properties sit in shore/coastal cities.
 *   • Cozy:     all properties in year-round mainland communities (no
 *     shore towns at all).
 *   • Family:   median list price < $700K AND no investor signal.
 *   • Coastal (fallback): anything else with at least 1 shore property.
 *   • Family (final fallback): everything else.
 *
 * `editorial` is never auto-picked.
 */
export function detectTone(
  properties: readonly MultiOHCaptionProperty[],
): Exclude<CaptionTone, "auto" | "editorial"> {
  if (properties.length === 0) return "family";

  let shoreCount = 0;
  let investorSignal = false;
  const prices: number[] = [];

  for (const p of properties) {
    const city = (p.city ?? "").toLowerCase();
    if (SHORE_CITY_PATTERNS.some((pat) => city.includes(pat))) {
      shoreCount += 1;
    }
    const typeStr = (p.property_type ?? "").toLowerCase();
    const addrStr = (p.address ?? "").toLowerCase();
    if (
      INVESTOR_TYPE_PATTERNS.some(
        (pat) => typeStr.includes(pat) || addrStr.includes(pat),
      )
    ) {
      investorSignal = true;
    }
    if (typeof p.list_price === "number" && p.list_price > 0) {
      prices.push(p.list_price);
    }
  }

  const medianPrice = median(prices);

  // Investor: multi-unit in a rental market, OR high-end median
  if (investorSignal && shoreCount >= 1) return "investor";
  if (medianPrice !== null && medianPrice > 1_200_000) return "investor";

  // Coastal: 2+ shore-town properties
  if (shoreCount >= 2) return "coastal";

  // Cozy: no shore properties at all
  if (shoreCount === 0) {
    // Family wins when there's a low-price signal AND no investor flag.
    if (
      medianPrice !== null &&
      medianPrice < 700_000 &&
      !investorSignal
    ) {
      return "family";
    }
    return "cozy";
  }

  // Mixed (1 shore property): bias coastal since the shore is the
  // marketable theme; family doesn't carry a single beach house well.
  return "coastal";
}

function median(nums: readonly number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// Opener pools — 5 themes × 8-10 variants
// ---------------------------------------------------------------------------

interface CaptionCtx {
  count: number;
  /** Geographic phrase appropriate to the property set. Empty when none fits. */
  geoPhrase: string;
}

const COASTAL_OPENERS: ReadonlyArray<(c: CaptionCtx) => string> = [
  (c) =>
    `🌊 Shore house hunting this weekend? We've got you covered.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} come tour these incredible coastal properties and see what shore living is all about. 🌞🏡`,
  (c) =>
    `🌊 Thinking about a place at the shore? We're opening doors all weekend long.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} salt air, sandy welcome mats, and a full lineup of homes built for the season. 🌞🏡`,
  (c) =>
    `🌊 The shore is calling — and we're answering. A full weekend of open houses, agents on every porch.${c.geoPhrase ? ` ${c.geoPhrase}, w` : " W"}alk through every one and pick your favorite. 🌞🏡`,
  (c) =>
    `🌊 Been daydreaming about shore living? This weekend is your chance to walk through it for real.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} we'll have agents on-site at every stop and answers to every question. 🌞🏡`,
  (c) =>
    `🌊 Shore tour weekend, sorted. Beach getaway, summer rental, or forever address — our open house lineup has options worth seeing in person.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} 🌞🏡`,
  (c) =>
    `🌊 Pack the flip-flops and the wishlist. We're opening doors at homes you can actually picture summering in${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : ","} every one of them worth the drive. 🌞🏡`,
  (c) =>
    `🌊 Open house weekend on the shore. Bring the family, the dog, the questions — we'll have someone on-site at every stop.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} 🌞🏡`,
  (c) =>
    `🌊 Salt air, open doors, no appointment needed.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} a shore-tour weekend built around homes worth walking through twice. 🌞🏡`,
  (c) =>
    `🌊 Coastal homes, open weekend. This is your shot to scout the shore properties you've been bookmarking${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."} Come see them with your own eyes. 🌞🏡`,
];

const FAMILY_OPENERS: ReadonlyArray<(c: CaptionCtx) => string> = [
  (c) =>
    `🏡 House hunting with the family this weekend? We've got a lineup ready for you.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} walk through, ask questions, picture the holidays — these are the kind of homes you settle into for the long haul. 🌟🏡`,
  (c) =>
    `🏡 Forever-home weekend, sorted.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} A handful of contenders, doors open, agents on every porch — bring the wish list and a friend. 🌟🏡`,
  (c) =>
    `🏡 Looking for the place that fits? Backyards, basements, breakfast nooks${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : "."} this weekend's lineup has options worth touring in person. 🌟🏡`,
  (c) =>
    `🏡 House-hunt weekend, build-a-life edition. We're opening doors at homes built for the next chapter${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."} Bring the family, take your time, no rush. 🌟🏡`,
  (c) =>
    `🏡 The "let's just go look" Saturday is here. We've lined up open houses worth the drive${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : ","} every one with someone on-site to answer the real questions. 🌟🏡`,
  (c) =>
    `🏡 The right house feels right the second you walk in. This weekend's lineup is here for you to test that theory${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."} Bring everyone whose opinion matters. 🌟🏡`,
  (c) =>
    `🏡 A handful of homes worth touring this weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} bring your wish list — these are the ones where you can picture summer cookouts and snowed-in Sundays alike. 🌟🏡`,
  (c) =>
    `🏡 House-hunt weekend.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} Walk through, sit in the kitchen, picture your stuff in it — we'll be there to answer everything. 🌟🏡`,
  (c) =>
    `🏡 Doors open this weekend — homes for growing families, downsizing parents, and everyone in between.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} take your time and find the one that feels right. 🌟🏡`,
];

const INVESTOR_OPENERS: ReadonlyArray<(c: CaptionCtx) => string> = [
  (c) =>
    `📈 Investor weekend, doors open.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} we're showing properties built for rental cash flow, appreciation, or both — come run the numbers in person. 🏠💰`,
  (c) =>
    `📈 Numbers-first weekend.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} A lineup of properties worth running the math on — bring your spreadsheet, we'll bring the comps. 🏠💰`,
  (c) =>
    `📈 Smart-money weekend. These homes pencil out on paper${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : ","} come walk through and stress-test the math in person. 🏠💰`,
  (c) =>
    `📈 Been hunting for a rental, vacation rental, or hold play? This is the weekend to scout it${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."} Bring the proforma, we'll have answers on-site. 🏠💰`,
  (c) =>
    `📈 Open houses for the portfolio crowd. Cap rates, ARV math, rental projections${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : " —"} bring questions, we'll bring answers. 🏠💰`,
  (c) =>
    `📈 Investment-grade weekend.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} A handful of properties that work as rentals, flips, or long-term holds — walk every one and pick your play. 🏠💰`,
  (c) =>
    `📈 Rental-market homes, opening this weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} the spreadsheet only tells you so much — come see the bones, the block, the ceiling. 🏠💰`,
  (c) =>
    `📈 Smart-move weekend. These properties have the bones, the location, and the rental ceiling worth touring${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."} Bring the calculator and your sharpest questions. 🏠💰`,
  (c) =>
    `📈 Opening doors on investment plays this weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} walk through, pull comps, picture the rental income — and decide which one to write on. 🏠💰`,
];

const COZY_OPENERS: ReadonlyArray<(c: CaptionCtx) => string> = [
  (c) =>
    `🍂 Settle-in weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} year-round neighborhoods, quiet streets, and a full lineup of open houses to walk through — these are the kind of homes you actually live in. 🏡✨`,
  (c) =>
    `🍂 Looking for a stay-awhile place?${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} A handful of off-season finds with the kind of character you can't fake — come see them in person. 🏡✨`,
  (c) =>
    `🍂 Stay-awhile homes, opening their doors this weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} come in, kick off your shoes, picture the fireplace lit — these are the homes that feel right in January, too. 🏡✨`,
  (c) =>
    `🍂 Settle-in season is upon us. We're opening doors at homes that already feel lived-in${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : ","} every one of them built for the long haul. 🏡✨`,
  (c) =>
    `🍂 Open house weekend for the slow-mornings crowd. Front porches, fireplaces, full neighborhoods${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()},` : " —"} come walk through and find the one that feels like home. 🏡✨`,
  (c) =>
    `🍂 Mainland weekend.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} Year-round neighbors, real schools, real grocery stores — these are the homes that work in January, too. 🏡✨`,
  (c) =>
    `🍂 A weekend of open houses built around homes that don't shut down in October.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} come scout the neighborhoods that stay lit year-round. 🏡✨`,
  (c) =>
    `🍂 Quiet-town, year-round homes — opening this weekend.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} come tour the neighborhoods, not just the houses, and see where you'd actually want to wake up. 🏡✨`,
  (c) =>
    `🍂 Doors open at homes worth coming home to year-round.${c.geoPhrase ? ` ${c.geoPhrase},` : ""} this is the weekend to scout the place you'll actually live in — bring questions, bring a friend. 🏡✨`,
];

const EDITORIAL_OPENERS: ReadonlyArray<(c: CaptionCtx) => string> = [
  (c) =>
    `${c.count} homes. One weekend. ${c.geoPhrase ? `${c.geoPhrase}.` : "Open doors at every stop."} Walk every one, pick your favorite.`,
  (c) =>
    `An open-house weekend, ${c.geoPhrase ? `${c.geoPhrase.toLowerCase()}` : "curated"}. ${c.count} addresses, one map, agents on-site at each. Walk through the lineup at your pace.`,
  (c) =>
    `A short list of homes worth walking through this weekend. ${c.geoPhrase ? `${c.geoPhrase}.` : "Doors open, agents on-site."} Bring your shortlist and your sharpest questions.`,
  (c) =>
    `${c.count} homes, ${c.geoPhrase ? c.geoPhrase.toLowerCase() + "," : "open this weekend,"} every one worth your Saturday. Schedule below — take the tour at your own pace.`,
  (c) =>
    `Open-house weekend. ${c.geoPhrase ? `${c.geoPhrase}.` : "Doors open."} Bring your shortlist; we'll have someone on-site at each one to answer the real questions.`,
  (c) =>
    `Doors open. Agents on-site. A short list of homes worth touring in person this weekend${c.geoPhrase ? ` — ${c.geoPhrase.toLowerCase()}.` : "."}`,
  (c) =>
    `${c.count} listings, one weekend, one map. ${c.geoPhrase ? `${c.geoPhrase}.` : "Take the tour."} Walk every one and decide for yourself.`,
  (c) =>
    `A curated open-house weekend — homes selected, agents on-site, schedule below.${c.geoPhrase ? ` ${c.geoPhrase}.` : ""} Take the tour and pick your favorite.`,
  (c) =>
    `The weekend's open houses, laid out simply. ${c.geoPhrase ? `${c.geoPhrase}.` : "Schedule below."} Doors open, agents on-site, no appointment needed.`,
];

// ---------------------------------------------------------------------------
// Closer pools — 5 themes × 8-10 variants, each with 2-3 buyer paths
// ---------------------------------------------------------------------------

const COASTAL_CLOSERS: readonly string[] = [
  "Whether you're looking for a beach getaway, an investment property, or your forever shore home — stop by and take a look. 🖤💛",
  "Sand-between-your-toes weekend home, summer rental income, or your forever shore address — come see what fits. 🖤💛",
  "Coastal living starts with a walkthrough. Beach escape, rental, or year-round — we'll match you to one of these. 🖤💛",
  "DMs open if you can't make it in person — we'll set up a private shore tour at the address that caught your eye. 🖤💛",
  "Bring your shore-house wishlist. Summer weekends, rental cash flow, or full-time saltwater — we'll match it to one of these. 🖤💛",
  "Beach getaway, summer rental, or your forever shore home — three paths, all of them open this weekend. 🖤💛",
  "Stop by any of these — sand in your shoes by Sunday, signed contract by closing day. 🖤💛",
  "Come tour the shore lineup. Vacation home, rental play, or the address you've had your eye on — we'll have answers on-site. 🖤💛",
  "We'll have agents at every stop. Beach buyer, investor, or forever-shore family — bring the questions, we've got the answers. 🖤💛",
];

const FAMILY_CLOSERS: readonly string[] = [
  "Backyard for the kids, room to grow, or the address you've had your eye on — stop in and walk it through. 🖤💛",
  "Whether you're upsizing, downsizing, or finding the first one — these are worth seeing in person. 🖤💛",
  "Forever home, starter home, or the in-between — three paths, all of them open this weekend. 🖤💛",
  "Bring the family, the tape measure, and the wish list. We'll have agents on-site at every stop. 🖤💛",
  "Stop by any of these. Test the kitchen, sit on the porch, picture your kids on the stairs. 🖤💛",
  "DMs open if you can't make it Saturday — we'll set up a private walkthrough at the one that caught your eye. 🖤💛",
  "Growing family, empty nest, or fresh start — bring the questions, we'll have answers on every stoop. 🖤💛",
  "Come tour the lineup. Walk every room, ask everything, leave with a favorite. 🖤💛",
  "Save this post so the schedule's on your phone all weekend — and bring a friend, more eyes always help. 🖤💛",
];

const INVESTOR_CLOSERS: readonly string[] = [
  "Cap-rate math, rental projections, or just a smart long-term hold — bring questions, we'll have answers. 📈🖤",
  "Long-term rental, short-term vacation, or value-add flip — three paths, all of them open this weekend. 📈🖤",
  "Bring your spreadsheet. We'll bring comps, rental data, and a flashlight for the basement. 📈🖤",
  "Stop by any of these — we'll walk the numbers with you on-site. 📈🖤",
  "DMs open for a private walk-through if Saturday doesn't work — and we'll send the financials ahead. 📈🖤",
  "Rental income, appreciation, or both — these are worth scouting in person before the numbers blur together. 📈🖤",
  "Cash flow, hold play, or flip — come walk through and tell us which lens you're using. We'll align the conversation. 📈🖤",
  "Bring the proforma. We'll have on-site comps, vacancy data, and a sense of what's actually moving locally. 📈🖤",
  "Investor weekend. Stop by — every property has a story the spreadsheet doesn't show. 📈🖤",
];

const COZY_CLOSERS: readonly string[] = [
  "Year-round neighbors, quiet streets, real fireplace weather — these homes deliver on all three. 🖤💛",
  "Settle-in home, fixer-with-good-bones, or move-in-ready — three paths, all of them open this weekend. 🖤💛",
  "Stop by any of these. Sit in the living room, listen to the quiet, picture the holidays. 🖤💛",
  "Front porch, fireplace, full neighborhood — these aren't summer homes, they're real-life ones. 🖤💛",
  "Bring the dog. Walk the block. Ask the neighbors — we picked these for the kind of place that holds up year-round. 🖤💛",
  "DMs open if the weekend's packed — we'll set up a slow-Tuesday walkthrough at whichever caught your eye. 🖤💛",
  "Save this post so the schedule's on your phone — and bring someone who knows what you actually want. 🖤💛",
  "Year-round, year-after-year homes — opening this weekend. Come in, take your time, see what feels right. 🖤💛",
  "Whether it's the first one, the last one, or the in-between one — these are built for the long haul. 🖤💛",
];

const EDITORIAL_CLOSERS: readonly string[] = [
  "Three homes. Three price points. One Saturday to see them all.",
  "Schedule above. Agents on-site. Take the tour.",
  "Stop by. Walk through. Decide for yourself.",
  "Open doors, on-site agents, no appointment needed.",
  "A short list. A long weekend. Make the time.",
  "Tour them all. Pick the one. Or just look — we don't mind.",
  "Bring questions. We'll be on-site to answer them.",
  "Walk through. See what fits. Leave with a favorite.",
  "Saturday is for tours. Schedule below — see you on a porch.",
];

const POOLS: Record<
  Exclude<CaptionTone, "auto">,
  {
    openers: ReadonlyArray<(c: CaptionCtx) => string>;
    closers: readonly string[];
  }
> = {
  coastal: { openers: COASTAL_OPENERS, closers: COASTAL_CLOSERS },
  family: { openers: FAMILY_OPENERS, closers: FAMILY_CLOSERS },
  investor: { openers: INVESTOR_OPENERS, closers: INVESTOR_CLOSERS },
  cozy: { openers: COZY_OPENERS, closers: COZY_CLOSERS },
  editorial: { openers: EDITORIAL_OPENERS, closers: EDITORIAL_CLOSERS },
};

// ---------------------------------------------------------------------------
// Geographic phrasing
// ---------------------------------------------------------------------------

/**
 * Pick the most appropriate geographic phrase given the picked towns and a
 * deterministic hash seed (so the same event always renders the same
 * phrase). Returns "" when no phrase is appropriate (the openers tolerate
 * an empty geoPhrase gracefully).
 *
 * Variants:
 *   • 1 unique town: "Right here in {town} this weekend"
 *   • 2 unique towns: "From {a} to {b}"
 *   • 3+ towns, all Cape May County: "Across Cape May County" /
 *     "From {a} to {b}, all in Cape May County"
 *   • Mixed shore + mainland (≥3 towns, ≥1 shore, ≥1 non-shore):
 *     "Mainland and beach, both kinds of escape"
 *   • Anything else: "From {a} to {b}" (fallback)
 */
export function buildGeoPhrase(
  properties: readonly MultiOHCaptionProperty[],
  seed: number,
): string {
  const towns = uniqueStrings(
    properties
      .map((p) => (p.city ?? "").trim())
      .filter((c) => c.length > 0),
  );

  if (towns.length === 0) return "";
  if (towns.length === 1) {
    return `Right here in ${towns[0]} this weekend`;
  }
  if (towns.length === 2) {
    return `From ${towns[0]} to ${towns[1]}`;
  }

  // 3+ towns. Check whether they all sit in Cape May County.
  const allCapeMay = towns.every((t) =>
    CAPE_MAY_COUNTY_TOWNS.includes(t.toLowerCase()),
  );
  const shoreTowns = towns.filter((t) =>
    SHORE_CITY_PATTERNS.some((pat) => t.toLowerCase().includes(pat)),
  );
  const mainlandTowns = towns.filter(
    (t) => !SHORE_CITY_PATTERNS.some((pat) => t.toLowerCase().includes(pat)),
  );

  if (allCapeMay) {
    // Alternate between two Cape-May-specific phrasings.
    return (seed >>> 3) % 2 === 0
      ? `From ${towns[0]} to ${towns[towns.length - 1]}, all in Cape May County`
      : `Across Cape May County`;
  }
  if (shoreTowns.length >= 1 && mainlandTowns.length >= 1) {
    return `Mainland and beach, both kinds of escape`;
  }
  return `From ${towns[0]} to ${towns[towns.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Day-grouped bullet rendering
// ---------------------------------------------------------------------------

interface DayGroup {
  /** YYYY-MM-DD key used for chronological sorting. */
  sortKey: string;
  /** Display label, e.g., "Saturday, May 16". */
  label: string;
  /** Per-property bullet lines. */
  bullets: string[];
}

function groupPropertiesByDay(
  properties: readonly MultiOHCaptionProperty[],
): DayGroup[] {
  const byDay = new Map<string, DayGroup>();
  for (const p of properties) {
    const sessions =
      p.oh_sessions && p.oh_sessions.length > 0
        ? p.oh_sessions
        : [{ start_at: p.oh_start_at ?? null, end_at: p.oh_end_at ?? null }];
    for (const s of sessions) {
      if (!s.start_at) continue;
      const start = new Date(s.start_at);
      if (Number.isNaN(start.getTime())) continue;
      const sortKey = start.toLocaleDateString("en-CA", {
        timeZone: CAPTION_TZ,
      });
      const label = start.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: CAPTION_TZ,
      });
      const bullet = formatPropertyBullet(p, s.start_at, s.end_at);
      if (!bullet) continue;
      let group = byDay.get(sortKey);
      if (!group) {
        group = { sortKey, label, bullets: [] };
        byDay.set(sortKey, group);
      }
      group.bullets.push(bullet);
    }
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
  );
}

function renderDayGroups(groups: readonly DayGroup[]): string {
  if (groups.length === 0) return "";
  const blocks = groups.map((g) => {
    const lines = [`📍 ${g.label}`, ...g.bullets];
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

function formatPropertyBullet(
  p: MultiOHCaptionProperty,
  startIso: string | null,
  endIso: string | null,
): string | null {
  const baseAddress = (p.address ?? "").trim();
  const unit = (p.unit_number ?? "").trim();
  const addressWithUnit = unit
    ? baseAddress
      ? `${baseAddress} · ${unit}`
      : unit
    : baseAddress;
  const city = (p.city ?? "").trim();
  if (!addressWithUnit && !city) return null;
  const addressFull =
    addressWithUnit && city
      ? `${addressWithUnit}, ${city}`
      : addressWithUnit || city;
  const timeRange = formatCompactTimeRange(startIso, endIso);
  return timeRange
    ? `• ${addressFull} | ${timeRange}`
    : `• ${addressFull}`;
}

function formatCompactTimeRange(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso) return "";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const startLabel = formatCompactHour(start);
  if (!endIso) return startLabel;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = formatCompactHour(end);
  return `${startLabel}-${endLabel}`;
}

function formatCompactHour(d: Date): string {
  const hour12 = d.toLocaleString("en-US", {
    timeZone: CAPTION_TZ,
    hour: "numeric",
    hour12: true,
  });
  const hourPart = hour12.replace(/\s?(AM|PM)$/i, "").trim();
  const minuteProbe = d.toLocaleString("en-US", {
    timeZone: CAPTION_TZ,
    hour12: false,
    minute: "2-digit",
  });
  const minutes = parseInt(minuteProbe, 10);
  if (!Number.isFinite(minutes) || minutes === 0) return hourPart;
  const mm = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${hourPart}:${mm}`;
}

// ---------------------------------------------------------------------------
// Hashtags
// ---------------------------------------------------------------------------

function pickRegionalTag(
  properties: readonly MultiOHCaptionProperty[],
  tone: Exclude<CaptionTone, "auto">,
): string | null {
  // Editorial keeps it clean — no regional tag.
  if (tone === "editorial") return null;

  const counts = new Map<string, number>();
  for (const p of properties) {
    const city = (p.city ?? "").trim().toLowerCase();
    if (!city) continue;
    const tag = TOWN_TAGS[city];
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const total = properties.length;
  let dominant: { tag: string; count: number } | null = null;
  for (const [tag, count] of counts.entries()) {
    if (!dominant || count > dominant.count) dominant = { tag, count };
  }
  if (dominant && dominant.count * 2 >= total) return dominant.tag;
  // For shore-leaning tones with multi-town spread, fall back to the
  // county tag. Cozy/family with no dominant town stays brand-only.
  if (tone === "coastal" || tone === "investor") return "#capemaycounty";
  return null;
}

function canonicalMlsHashtag(
  mls_number: string,
  source_mls: SourceMls,
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (!normalized) return "";
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function clampBody(body: string, max: number): string {
  if (body.length <= max) return body;
  const slice = body.slice(0, max - 3);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.8 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}...`;
}

/** True when the override text already contains a trailing block of
 *  hashtag lines (i.e., the user wrote their own hashtags inside the
 *  override). We respect that and skip the auto-append. */
function overrideAlreadyHasHashtags(text: string): boolean {
  // Look at the last ~3 lines for any token starting with `#`.
  const lines = text.trimEnd().split("\n");
  const tail = lines.slice(-3).join(" ");
  return /(^|\s)#[A-Za-z0-9_]+/.test(tail);
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Synthesize a multi-OH caption for the given event input. Deterministic;
 * pure; safe to call client-side or server-side. See module header for the
 * caption shape + design rationale.
 */
export function synthesizeMultiOHCaption(
  input: MultiOHCaptionInput,
): MultiOHCaptionResult {
  const properties = input.properties;
  const count = properties.length;

  const firstProp = properties[0];
  const anchorMls = firstProp
    ? canonicalMlsHashtag(firstProp.mls_number, firstProp.source_mls ?? null)
    : "";

  // ---- Tone resolution ----
  const requestedTone: CaptionTone = input.tone ?? "auto";
  const resolvedTone: Exclude<CaptionTone, "auto"> =
    requestedTone === "auto" ? detectTone(properties) : requestedTone;

  // ---- Deterministic seed for variant picks ----
  // 2026-05-28 — event_title was removed from the wizard payload entirely;
  // seed is `count | mls_numbers` so the same set of properties always
  // renders the same caption variant. The resolved tone selects the pool,
  // not the index within it.
  const mlsKey = properties.map((p) => p.mls_number).join(",");
  const seed = hashSeed(`${count}|${mlsKey}`);

  // ---- Geographic phrasing ----
  const geoPhrase = buildGeoPhrase(properties, seed);

  // ---- Day-grouped property bullets ----
  const dayGroups = groupPropertiesByDay(properties);
  const propertyBulletBlock = renderDayGroups(dayGroups);

  // ---- Pool pick ----
  const pool = POOLS[resolvedTone];
  const ctx: CaptionCtx = { count, geoPhrase };
  const opener = pool.openers[seed % pool.openers.length](ctx);
  const closer = pool.closers[(seed >>> 6) % pool.closers.length];

  // ---- Hashtags ----
  const regionalTag = pickRegionalTag(properties, resolvedTone);
  const fixedTags = regionalTag ? [...BRAND_TAGS, regionalTag] : [...BRAND_TAGS];
  const igTags = fixedTags.slice(0, 5);
  const fbTags = fixedTags.slice(0, 5);
  const ttTags = fixedTags.slice(0, 5);

  // ---- Caption body — override OR synthesized ----
  // If the user supplied a full-caption override, we use it verbatim for
  // IG + FB. TT still clamps to its shorter limit. Hashtags are
  // auto-appended unless the override already includes them.
  const overrideRaw = (input.caption_override ?? "").trim();
  const overrideActive = overrideRaw.length > 0;

  let igBody: string;
  let fbBody: string;
  let ttBody: string;
  let igFinalTags: string[];
  let fbFinalTags: string[];
  let ttFinalTags: string[];

  if (overrideActive) {
    igBody = clampBody(overrideRaw, 2200);
    fbBody = clampBody(overrideRaw, 1500);
    // TT: keep it short. If the override is short already we keep it as-is;
    // otherwise we trim to a one-liner-ish 250 chars.
    ttBody = clampBody(overrideRaw, 250);

    if (overrideAlreadyHasHashtags(overrideRaw)) {
      // User wrote their own tags inside the override — don't double up.
      igFinalTags = [];
      fbFinalTags = [];
      ttFinalTags = [];
    } else {
      igFinalTags = igTags;
      fbFinalTags = fbTags;
      ttFinalTags = ttTags;
    }
  } else {
    const bodyParts: string[] = [opener];
    if (propertyBulletBlock.length > 0) {
      bodyParts.push("", propertyBulletBlock);
    }
    bodyParts.push("", closer);
    const baseBody = bodyParts.join("\n");

    igBody = clampBody(baseBody, 2200);
    fbBody = clampBody(baseBody, 1500);

    // TT: keep the opener; drop bullets (they truncate badly in feed).
    const ttPieces: string[] = [opener];
    if (count > 1) {
      ttPieces.push("Full schedule in the carousel.");
    }
    ttBody = clampBody(ttPieces.join(" "), 250);

    igFinalTags = igTags;
    fbFinalTags = fbTags;
    ttFinalTags = ttTags;
  }

  return {
    legacy: {
      caption: igBody,
      hashtags: igFinalTags,
      mls_hashtag: anchorMls,
    },
    captions: {
      instagram: { caption: igBody, hashtags: igFinalTags },
      facebook: { caption: fbBody, hashtags: fbFinalTags },
      tiktok: { caption: ttBody, hashtags: ttFinalTags },
    },
    resolved_tone: resolvedTone,
  };
}

/**
 * Convenience helper for UI previews — returns a single rendered string
 * with the hashtags joined onto the end the same way IG / FB consumers
 * actually display them.
 */
export function renderFullCaptionString(
  platform: "instagram" | "facebook" | "tiktok",
  result: MultiOHCaptionResult,
): string {
  const slot = result.captions[platform];
  if (slot.hashtags.length === 0) return slot.caption;
  return `${slot.caption}\n\n${slot.hashtags.join(" ")}`;
}
