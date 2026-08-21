/**
 * Agent name matching — the single normalizer + first-name comparer that
 * every headshot and phone lookup runs on.
 *
 * WHY THIS MODULE EXISTS: the same two functions were copy-pasted into
 * `owner-story-db.ts` (headshot lookup), `alliance-dash-agents.ts` (phone
 * lookup) and `agent-roster.ts` (the /agents page that TELLS Cheryl what the
 * other two would resolve). Each copy carried a comment saying "change BOTH
 * or the lookups drift apart" — and they had already drifted: the
 * agent-roster.ts copy split on whitespace only, keeping the hyphen inside
 * the word, so /agents disagreed with the renderer about every hyphenated
 * agent ("Elvis Ochoa-Rosendo"). A comment is not a mechanism. This is.
 *
 * NOT to be confused with `brand-asset-resolver.ts`'s exported
 * `normalizeAgentName`, which is a DIFFERENT function that also strips noise
 * words ("pic", "headshot") off Studio library labels. Importing that one
 * here would silently change which agents look matched.
 */

/**
 * Generational suffixes, dropped before we decide which token is the
 * surname.
 *
 * 2026-08-21 (John): "there's a few Agent photos that are not flowing
 * through to the templates, but they are in studio Agent pics". Root cause
 * for two of them: this normalizer took the LAST token as the surname, so
 * "Philip Dougherty IV" normalized to "philip iv" and "Charles Dahmer III"
 * to "charles iii". The lookup then went hunting for a headshot whose label
 * contained "iv" — which in the live library meant Olivia Meyer, Ivana
 * Henry and Lisa Oliver. Nobody named Dougherty was ever a candidate.
 *
 * Worse than a miss: had exactly ONE label contained "iv", the sole-match
 * pass in `fetchAgentHeadshotUrl` would have returned a STRANGER'S face for
 * Philip's open house. Same hazard on the phone side.
 *
 * "v" is included deliberately even though a bare middle initial "V" also
 * lands here — we only ever keep the first and last tokens, so dropping a
 * middle initial changes nothing.
 */
const GENERATIONAL_SUFFIXES = new Set([
  "jr",
  "jnr",
  "sr",
  "snr",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
]);

/**
 * Well-known short forms that a prefix test cannot reach, because the short
 * form is not a prefix of the long one: "Chuck" is not the start of
 * "Charles", "Tom" is not the start of "Thomas" (t-h-o vs t-o-m), "Mike" is
 * not the start of "Michael".
 *
 * Each entry maps a variant to the ONE canonical spelling for its group;
 * `firstNameMatches` treats two names as equal when they canonicalize to the
 * same value. Keys must be lowercase and already normalized.
 *
 * 2026-08-21 — added because the Studio library labels agents the way they
 * introduce themselves ("Chuck Meyer", "Mike Meyer", "Tom Hunt") while
 * `mls_agents.full_name` carries what the MLS board has on file ("Charles
 * Meyer", "Michael Meyer", "Thomas Hunt"). Five Alliance agents had a photo
 * sitting in the library that no template could reach. The documented
 * alternative — a manual `headshot_label_override` row per agent — does not
 * scale past the person who remembers to add it, and John had just spent an
 * afternoon discovering that.
 *
 * SAFETY: this table only ever runs in the LAST matching pass, after exact
 * and sole-candidate matching, and only against candidates whose surname
 * already matches exactly. So "Ted" resolving to both Edward and Theodore
 * can only pick the wrong person if two agents share a surname AND one is a
 * Theodore while the other is an Edward. If that day comes, the fix is the
 * same as it has always been: a `headshot_label_override` row, which still
 * wins over everything here.
 */
const NICKNAME_CANONICAL: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // — the five that prompted this table —
    chuck: "charles",
    charlie: "charles",
    chas: "charles",
    mike: "michael",
    mikey: "michael",
    tom: "thomas",
    tommy: "thomas",
    // — the rest of the common English set —
    bob: "robert",
    bobby: "robert",
    rob: "robert",
    robbie: "robert",
    bill: "william",
    billy: "william",
    will: "william",
    willie: "william",
    dick: "richard",
    rick: "richard",
    ricky: "richard",
    rich: "richard",
    jim: "james",
    jimmy: "james",
    joe: "joseph",
    joey: "joseph",
    jack: "john",
    johnny: "john",
    liz: "elizabeth",
    beth: "elizabeth",
    betsy: "elizabeth",
    betty: "elizabeth",
    peg: "margaret",
    peggy: "margaret",
    maggie: "margaret",
    marge: "margaret",
    patty: "patricia",
    tricia: "patricia",
    trish: "patricia",
    kate: "katherine",
    katie: "katherine",
    kathy: "katherine",
    cathy: "catherine",
    debbie: "deborah",
    deb: "deborah",
    jen: "jennifer",
    jenny: "jennifer",
    kim: "kimberly",
    chris: "christopher",
    dan: "daniel",
    danny: "daniel",
    dave: "david",
    tony: "anthony",
    larry: "lawrence",
    nick: "nicholas",
    steve: "steven",
    greg: "gregory",
    matt: "matthew",
    andy: "andrew",
    drew: "andrew",
    ben: "benjamin",
    sam: "samuel",
    sue: "susan",
    barb: "barbara",
    don: "donald",
    ron: "ronald",
    ken: "kenneth",
    kenny: "kenneth",
    vince: "vincent",
    gene: "eugene",
    ray: "raymond",
    phil: "philip",
    pete: "peter",
    tim: "timothy",
    jeff: "jeffrey",
    doug: "douglas",
    jerry: "gerald",
    terry: "terence",
    fred: "frederick",
    marty: "martin",
    norm: "norman",
    russ: "russell",
    stan: "stanley",
    walt: "walter",
    wes: "wesley",
    zach: "zachary",
    // — a second pass over the live roster, 2026-08-21: each of these is an
    //   Alliance agent whose Studio photo was reachable only by the loose
    //   sole-surname guess before —
    art: "arthur",
    bart: "bartholomew",
    carrie: "caroline",
    jackie: "jacqueline",
    judy: "judith",
    julie: "julia",
    meg: "margaret",
    randy: "randall",
    shelly: "michelle",
    woody: "elwood",
    lou: "louis",
    jon: "jonathan",
    mitch: "mitchell",
    jo: "josephine",
  }),
);

/** Spelling variants that are the same name, folded together. */
const SPELLING_CANONICAL: ReadonlyMap<string, string> = new Map(
  Object.entries({
    stephen: "steven",
    catherine: "katherine",
    phillip: "philip",
    geoffrey: "jeffrey",
    terrence: "terence",
    kathryn: "katherine",
    michele: "michelle",
    marilynn: "marilyn",
  }),
);

function canonicalFirstName(name: string): string {
  const spelled = SPELLING_CANONICAL.get(name) ?? name;
  return NICKNAME_CANONICAL.get(spelled) ?? spelled;
}

/**
 * Normalize to "first last", lowercased, punctuation and generational
 * suffixes stripped.
 *
 * Hyphens split words exactly like spaces: the Bright feed says "Elvis
 * Ochoa-Rosendo" while the Drive headshot label says "Elvis Ochoa Rosendo",
 * and both must collapse to "elvis rosendo".
 *
 * Returns null when the input has no usable letters (empty, whitespace-only,
 * or all punctuation).
 */
export function normalizeAgentName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const parts = trimmed
    .split(/[\s-]+/)
    .map((p) => p.replace(/[^a-z']/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  // Drop suffixes only when something is left to call a name — an input of
  // literally "IV" keeps its one token rather than normalizing to null.
  const named = parts.filter((p) => !GENERATIONAL_SUFFIXES.has(p));
  const useful = named.length > 0 ? named : parts;
  if (useful.length === 1) return useful[0];
  return `${useful[0]} ${useful[useful.length - 1]}`;
}

/**
 * Returns true when two first-name strings refer to the same first name:
 * identical, a prefix relationship ("Ed" ↔ "Edward", "Liz" ↔ "Elizabeth"),
 * or a known short form ("Chuck" ↔ "Charles", "Tom" ↔ "Thomas").
 *
 * The min-2-char guard on the prefix test prevents a single-letter input
 * ("J") from matching every James/John/Judith/Justin in the roster.
 */
export function firstNameMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;

  const shorter = x.length < y.length ? x : y;
  const longer = x.length < y.length ? y : x;
  if (shorter.length >= 2 && longer.startsWith(shorter)) return true;

  const cx = canonicalFirstName(x);
  const cy = canonicalFirstName(y);
  if (cx === cy) return true;
  // "Ed" ↔ "Eddie" ↔ "Edward": canonicalize both, then allow the same
  // prefix relationship between the canonical forms.
  const cShorter = cx.length < cy.length ? cx : cy;
  const cLonger = cx.length < cy.length ? cy : cx;
  return cShorter.length >= 2 && cLonger.startsWith(cShorter);
}
