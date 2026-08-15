/**
 * MLS RETS sync Edge Function (Phase 5 + 6).
 *
 * Pulls active C21 Alliance listings from a Paragon RETS feed (CMC or SJSR),
 * upserts them into the SEPARATE "Alliance Listings" Supabase project
 * (umziekblnbobkezbbupg), and replicates into AllianceAnalytics.properties.
 *
 * Phase 6 add-ons:
 *   - Office name + DOM + property type + zip extraction
 *   - Bedrooms / full + half bathrooms (CMC vs SJSR slot mapping shifted by 1)
 *   - Public remarks (CMC: LR_remarks33 / SJSR: LR_remarks22)
 *   - Hero photo via GetObject (Location=1 returns Paragon CDN URL in
 *     `Location:` HTTP header on a 200 response — NOT a 3xx redirect)
 *
 * Phase 7 add-ons:
 *   - close_date / close_price capture (from L_ClosingDate + L_SoldPrice).
 *     Falls through several Paragon field variants since the canonical name
 *     differs between CMC, SJSR, and property class. Powers the
 *     "Recently Sold" + "Under Contract" dashboard cards.
 *
 * Required Edge Function secrets:
 *   - SUPABASE_URL                       (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY          (auto-injected)
 *   - LISTINGS_SUPABASE_URL              (Alliance Listings project)
 *   - LISTINGS_SUPABASE_SERVICE_ROLE_KEY (Alliance Listings service role)
 *
 * Invocation: POST { feed_short_code: "cmc" | "sjsr", mode?: "full" | "open_houses" }.
 *   - mode omitted / "full"  → the complete listing + photo + OH sync (cron).
 *   - mode "open_houses"     → OH-only fast path for the in-app Sync Open
 *                              Houses button (2026-07-31). See
 *                              syncOpenHousesOnly.
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
// @ts-expect-error - Deno-resolved import
import { createHash, randomBytes } from "node:crypto";

/**
 * Paragon property classes per feed.
 *
 * Verified against METADATA-CLASS calls 2026-05-10. Both feeds share the
 * common four (Residential / Lots+Land / Commercial / Multi-Family) but use
 * different class codes for the condo/townhouse bucket:
 *   - CMC uses CT_5 (CONDO/TOWNHOUSE)
 *   - SJSR uses CN_5 (CONDOMINIUM)
 *
 * RN_6 (rentals) is intentionally excluded — Alliance doesn't track rental
 * promotion through this system.
 *
 * Original version only requested RE_1 / MF_4 / LD_2, which missed the
 * condo/townhouse class entirely — that was ~64% of CMC's Alliance inventory.
 */
const PROPERTY_CLASSES_BY_FEED: Record<"cmc" | "sjsr", readonly string[]> = {
  cmc: ["RE_1", "LD_2", "CI_3", "MF_4", "CT_5"],
  sjsr: ["RE_1", "LD_2", "CI_3", "MF_4", "CN_5"],
};
// L_Status is calculated and 20206's; LO1_OrganizationName=*Century 21 Alliance*
// is the C21-only constraint we need.
//
// Phase 8: dual-query search so we capture Alliance's role on BOTH sides
// of a deal. The list-side query finds properties Alliance listed; the
// buy-side query finds properties Alliance's buyer agents bought (even
// when listed by another brokerage). Results are deduped by MLS and the
// alliance_role column tracks which side(s) matched.
const DMQL2_LIST_SIDE_QUERY = "(LO1_OrganizationName=*Century 21 Alliance*)";
const DMQL2_BUY_SIDE_QUERY = "(SO1_OrganizationName=*Century 21 Alliance*)";
const RETS_USER_AGENT = "AllianceAnalytics/1.0";
const RETS_VERSION = "RETS/1.8";
const SEARCH_LIMIT = 5000;
const PHOTO_BUCKET = "property-photos";

// why: Paragon occasionally hangs mid-response; without a signal one stuck
// search would eat the whole function budget. 60s is generous for the
// biggest 5000-row search pages.
const RETS_FETCH_TIMEOUT_MS = 60_000;

interface FeedRow {
  id: string;
  short_code: string;
  name: string;
  rets_url: string | null;
  username: string | null;
  password: string | null;
  rets_version: string | null;
  is_active: boolean;
}

type RowMap = Record<string, string>;

interface ClassResult {
  class: string;
  records_seen: number;
  records_upserted: number;
  error?: string;
}

interface SyncResult {
  ok: boolean;
  feed_short_code: string;
  feed_name: string;
  duration_ms: number;
  classes: ClassResult[];
  errors: string[];
  photos_uploaded?: number;
  /** Phase 9: count of Open Houses upserted across all classes. */
  open_houses_synced?: number;
  /** Phase 11: count of listing_photos rows upserted (Post Builder picker). */
  all_photos_synced?: number;
}

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
function newCnonce(): string {
  return randomBytes(8).toString("hex");
}

function parseDigestChallenge(header: string): DigestChallenge {
  const body = header.replace(/^\s*Digest\s+/i, "");
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*("([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? "").trim();
  }
  if (!out.realm || !out.nonce) {
    throw new Error("Malformed digest challenge: missing realm or nonce");
  }
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm,
  };
}

function buildBasicAuthHeader(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function buildDigestAuthHeader(
  method: string,
  uri: string,
  user: string,
  pass: string,
  ch: DigestChallenge,
  nc: number,
): string {
  const cnonce = newCnonce();
  const ncStr = nc.toString(16).padStart(8, "0");
  const ha1 = md5(`${user}:${ch.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  let response: string;
  let qopPart = "";
  if (ch.qop) {
    const qop = ch.qop.split(",").map((q) => q.trim()).includes("auth")
      ? "auth"
      : ch.qop.split(",")[0].trim();
    response = md5(`${ha1}:${ch.nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`);
    qopPart = `, qop=${qop}, nc=${ncStr}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${ch.nonce}:${ha2}`);
  }
  let header =
    `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", ` +
    `uri="${uri}", response="${response}"${qopPart}`;
  if (ch.opaque) header += `, opaque="${ch.opaque}"`;
  if (ch.algorithm) header += `, algorithm=${ch.algorithm}`;
  return header;
}

type AuthScheme = "digest" | "basic";

class RETSClient {
  /**
   * Cookie jar — keyed by name. Paragon emits TWO Set-Cookie headers per
   * response (`RETS-Session-ID` and Cloudflare's `__cf_bm`). Reading just the
   * concatenated `headers.get("set-cookie")` and splitting on ";" loses the
   * second cookie, which trips Cloudflare's bot mitigation on subsequent
   * GetObject calls. Using `getSetCookie()` (Deno) returns the array; we
   * merge into this map so each request sends both.
   */
  private cookies = new Map<string, string>();
  capabilities: Record<string, string> = {};
  private nc = 0;
  private challenge: DigestChallenge | null = null;
  private authScheme: AuthScheme | null = null;
  private basicHeader: string | null = null;
  private loginOrigin: string | null = null;
  constructor(
    private readonly user: string,
    private readonly pass: string,
  ) {}
  absoluteUrl(rel: string): string {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (!this.loginOrigin) return rel;
    if (rel.startsWith("/")) return `${this.loginOrigin}${rel}`;
    return `${this.loginOrigin}/${rel}`;
  }
  private cookieHeader(): string {
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorbSetCookies(res: Response): void {
    // Deno-specific: getSetCookie() returns an array of all Set-Cookie headers.
    // Falls back to .get() if running outside Deno.
    const all =
      // deno-lint-ignore no-explicit-any
      (res.headers as any).getSetCookie?.() as string[] | undefined ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const sc of all) {
      if (!sc) continue;
      const nv = sc.split(";")[0];
      const i = nv.indexOf("=");
      if (i > 0) this.cookies.set(nv.slice(0, i).trim(), nv.slice(i + 1).trim());
    }
  }

  async requestAuthenticated(url: string, expectBinary = false): Promise<Response> {
    const u = new URL(url);
    const uri = u.pathname + u.search;
    const headers: Record<string, string> = {
      "User-Agent": RETS_USER_AGENT,
      "RETS-Version": RETS_VERSION,
      "Accept": "*/*",
    };
    if (this.cookies.size > 0) headers["Cookie"] = this.cookieHeader();
    if (this.authScheme === "digest" && this.challenge) {
      this.nc += 1;
      headers["Authorization"] = buildDigestAuthHeader("GET", uri, this.user, this.pass, this.challenge, this.nc);
    } else if (this.authScheme === "basic" && this.basicHeader) {
      headers["Authorization"] = this.basicHeader;
    }
    let res = await fetch(url, {
      method: "GET",
      headers,
      redirect: expectBinary ? "manual" : "follow",
      signal: AbortSignal.timeout(RETS_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      const wa = res.headers.get("www-authenticate") ?? "";
      this.absorbSetCookies(res);
      await res.body?.cancel().catch(() => undefined);
      if (/^\s*digest/i.test(wa)) {
        this.authScheme = "digest";
        this.challenge = parseDigestChallenge(wa);
        this.nc = 1;
        headers["Authorization"] = buildDigestAuthHeader("GET", uri, this.user, this.pass, this.challenge, this.nc);
      } else if (/^\s*basic/i.test(wa)) {
        this.authScheme = "basic";
        this.basicHeader = buildBasicAuthHeader(this.user, this.pass);
        headers["Authorization"] = this.basicHeader;
      } else if (this.authScheme === "basic" && this.basicHeader) {
        // Stale-cookie retry: drop cookies + re-send Basic.
        this.cookies.clear();
        delete headers["Cookie"];
        headers["Authorization"] = this.basicHeader;
      } else if (this.authScheme === "digest" && this.challenge) {
        this.cookies.clear();
        delete headers["Cookie"];
        this.nc += 1;
        headers["Authorization"] = buildDigestAuthHeader("GET", uri, this.user, this.pass, this.challenge, this.nc);
      } else {
        throw new Error(`Expected Digest or Basic challenge, got: ${wa || "none"}`);
      }
      if (this.cookies.size > 0) headers["Cookie"] = this.cookieHeader();
      res = await fetch(url, {
        method: "GET",
        headers,
        redirect: expectBinary ? "manual" : "follow",
        signal: AbortSignal.timeout(RETS_FETCH_TIMEOUT_MS),
      });
    }
    this.absorbSetCookies(res);
    return res;
  }

  async login(loginUrl: string): Promise<void> {
    const u = new URL(loginUrl);
    this.loginOrigin = `${u.protocol}//${u.host}`;
    const res = await this.requestAuthenticated(loginUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RETS login failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const text = await res.text();
    const replyErr = readReplyError(text);
    if (replyErr) throw new Error(`RETS login reply: ${replyErr}`);
    const block = text.match(/<RETS-RESPONSE[^>]*>([\s\S]*?)<\/RETS-RESPONSE>/i);
    if (!block) throw new Error("RETS login: no <RETS-RESPONSE> block");
    for (const raw of block[1].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      this.capabilities[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (!this.capabilities["Search"]) {
      throw new Error(`RETS login: no Search capability URL. Got: ${Object.keys(this.capabilities).join(",")}`);
    }
  }

  /**
   * Search a RETS resource/class, paginating past the per-request SEARCH_LIMIT
   * so classes with more than 5000 matching records sync in full.
   *
   * 2026-05-28 (Phase 4 #4) — previously this issued ONE request with
   * Limit=5000 and no Offset, so any class with >5000 matches was silently
   * truncated (we even read the server's true <COUNT Records="N"> into
   * rawCount but never fetched records 5001+). Now we loop with a 1-based
   * Offset, accumulating pages until the server returns a short/empty page or
   * we've collected the reported total.
   *
   * Guards:
   *   • MAX_PAGES ceiling — defends against an unexpectedly huge resultset or
   *     a server that never signals "done".
   *   • Offset-ignored detection — some servers ignore Offset and re-return
   *     page 1 forever. If a page's first record matches the previous page's
   *     first record, we assume Offset is unsupported and stop (taking the
   *     first page rather than looping on duplicates).
   */
  async search(resource: string, cls: string, query: string): Promise<{ rows: RowMap[]; rawCount: number }> {
    const all: RowMap[] = [];
    let serverTotal = 0;
    let offset = 1; // RETS Offset is 1-based
    let prevFirstRowKey: string | null = null;
    const MAX_PAGES = 40; // 40 × 5000 = 200k row safety ceiling

    for (let page = 0; page < MAX_PAGES; page++) {
      const { rows, rawCount } = await this.searchPage(resource, cls, query, offset);
      if (page === 0) serverTotal = rawCount;
      if (rows.length === 0) break;

      // Offset-ignored guard: if this page starts with the same record as the
      // last page, the server isn't honoring Offset — stop to avoid a dupe loop.
      const firstRowKey = JSON.stringify(rows[0]);
      if (prevFirstRowKey !== null && firstRowKey === prevFirstRowKey) {
        console.warn(
          `[search ${resource}/${cls}] server appears to ignore Offset; stopping at ${all.length} rows (server reported ${serverTotal})`,
        );
        break;
      }
      prevFirstRowKey = firstRowKey;

      all.push(...rows);

      // Done when the server returned a partial page, or we've collected the
      // full reported total.
      if (rows.length < SEARCH_LIMIT) break;
      if (serverTotal > 0 && all.length >= serverTotal) break;

      offset += rows.length;
    }

    return { rows: all, rawCount: serverTotal || all.length };
  }

  /** Fetch a single page of search results at the given 1-based Offset. */
  private async searchPage(
    resource: string,
    cls: string,
    query: string,
    offset: number,
  ): Promise<{ rows: RowMap[]; rawCount: number }> {
    const baseUrl = this.absoluteUrl(this.capabilities["Search"]);
    const params = new URLSearchParams({
      SearchType: resource, Class: cls, Query: query, QueryType: "DMQL2",
      Format: "COMPACT-DECODED", Count: "1", StandardNames: "0",
      Limit: String(SEARCH_LIMIT), Offset: String(offset),
    });
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}${params.toString()}`;
    const res = await this.requestAuthenticated(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RETS search failed (${res.status}) for ${resource}/${cls}: ${body.slice(0, 300)}`);
    }
    const text = await res.text();
    const replyErr = readReplyError(text);
    if (replyErr) {
      if (replyErr.startsWith("20201")) return { rows: [], rawCount: 0 };
      throw new Error(`RETS search reply: ${replyErr}`);
    }
    const delimMatch = text.match(/<DELIMITER\s+value="(\d+)"\s*\/?>/i);
    const delim = delimMatch ? String.fromCharCode(parseInt(delimMatch[1], 10)) : "\t";
    const colMatch = text.match(/<COLUMNS>([\s\S]*?)<\/COLUMNS>/i);
    if (!colMatch) return { rows: [], rawCount: 0 };
    const cols = colMatch[1].split(delim).map((c) => c.trim()).filter((c) => c.length > 0);
    const rows: RowMap[] = [];
    const dataRe = /<DATA>([\s\S]*?)<\/DATA>/gi;
    let m: RegExpExecArray | null;
    while ((m = dataRe.exec(text)) !== null) {
      const cells = m[1].split(delim);
      const startIdx = cells[0] === "" ? 1 : 0;
      const obj: RowMap = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = (cells[startIdx + i] ?? "").trim();
      rows.push(obj);
    }
    const cntMatch = text.match(/<COUNT\s+Records="(\d+)"\s*\/?>/i);
    const rawCount = cntMatch ? parseInt(cntMatch[1], 10) : rows.length;
    return { rows, rawCount };
  }

  /**
   * GetObject — fetch a single photo at a given sequence position.
   *
   * Tries Location=1 first: Paragon returns HTTP 200 with a `Location:` HEADER
   * pointing at the public CDN URL (NOT a 3xx redirect — the body is a tiny
   * RETS XML reply we ignore). Cheapest path because we just persist the URL.
   *
   * Falls back to Location=0 (image/jpeg or multipart/related body) when the
   * header path doesn't yield a usable URL.
   *
   * Sequence is 1-based — Paragon's first photo is `:1`. Out-of-range
   * sequences return { kind: "none" }.
   */
  async getPhotoAt(mlsNumber: string, sequence: number): Promise<
    | { kind: "url"; url: string }
    | { kind: "binary"; bytes: Uint8Array; contentType: string }
    | { kind: "none" }
  > {
    const getObjectUrl = this.capabilities["GetObject"];
    if (!getObjectUrl) return { kind: "none" };
    const baseUrl = this.absoluteUrl(getObjectUrl);
    const sep = baseUrl.includes("?") ? "&" : "?";

    // Location=1: header-based redirect to public CDN.
    const params1 = new URLSearchParams({
      Resource: "Property", Type: "Photo", ID: `${mlsNumber}:${sequence}`, Location: "1",
    });
    const url1 = `${baseUrl}${sep}${params1.toString()}`;
    try {
      const res = await this.requestAuthenticated(url1, true);
      const locHeader = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (locHeader && /^https?:\/\//i.test(locHeader)) {
        return { kind: "url", url: locHeader };
      }
    } catch (e) {
      console.error(`getPhotoAt Location=1 ${mlsNumber}:${sequence}:`, (e as Error).message);
    }

    // Fallback: Location=0 — body is jpeg or multipart/related.
    const params0 = new URLSearchParams({
      Resource: "Property", Type: "Photo", ID: `${mlsNumber}:${sequence}`, Location: "0",
    });
    const url0 = `${baseUrl}${sep}${params0.toString()}`;
    try {
      const res = await this.requestAuthenticated(url0);
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: "none" };
      }
      const ct = res.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (ct.toLowerCase().includes("multipart")) {
        const inner = extractFirstMultipartPart(bytes, ct);
        if (inner) return { kind: "binary", bytes: inner.bytes, contentType: inner.contentType };
        return { kind: "none" };
      }
      if (bytes.length < 2048) return { kind: "none" };
      return { kind: "binary", bytes, contentType: ct || "image/jpeg" };
    } catch (e) {
      console.error(`getPhotoAt Location=0 ${mlsNumber}:${sequence}:`, (e as Error).message);
      return { kind: "none" };
    }
  }

  /**
   * Backward-compat: fetch the first (hero) photo. Kept so existing
   * `syncPhotosForRows` callers don't need to change.
   */
  async getFirstPhoto(mlsNumber: string): Promise<
    | { kind: "url"; url: string }
    | { kind: "binary"; bytes: Uint8Array; contentType: string }
    | { kind: "none" }
  > {
    return this.getPhotoAt(mlsNumber, 1);
  }

  async logout(): Promise<void> {
    const logoutUrl = this.capabilities["Logout"];
    if (!logoutUrl) return;
    try {
      await this.requestAuthenticated(this.absoluteUrl(logoutUrl));
    } catch {
      // best-effort
    }
  }
}

function extractFirstMultipartPart(
  bytes: Uint8Array,
  contentType: string,
): { bytes: Uint8Array; contentType: string } | null {
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  if (!m) return null;
  const boundary = `--${m[1]}`;
  const td = new TextDecoder("latin1");
  const text = td.decode(bytes);
  const startIdx = text.indexOf(boundary);
  if (startIdx === -1) return null;
  const afterBoundary = startIdx + boundary.length;
  const headerEnd1 = text.indexOf("\r\n\r\n", afterBoundary);
  const headerEnd2 = text.indexOf("\n\n", afterBoundary);
  const headerEnd =
    headerEnd1 !== -1 && (headerEnd2 === -1 || headerEnd1 < headerEnd2)
      ? headerEnd1 + 4
      : headerEnd2 !== -1 ? headerEnd2 + 2 : -1;
  if (headerEnd === -1) return null;
  const headersBlock = text.slice(afterBoundary, headerEnd);
  const ctMatch = headersBlock.match(/Content-Type:\s*([^\r\n]+)/i);
  const innerCt = ctMatch ? ctMatch[1].trim() : "image/jpeg";
  const endIdx = text.indexOf(boundary, headerEnd);
  if (endIdx === -1) return null;
  let bodyEnd = endIdx;
  if (text[bodyEnd - 1] === "\n") bodyEnd -= 1;
  if (text[bodyEnd - 1] === "\r") bodyEnd -= 1;
  const body = bytes.slice(headerEnd, bodyEnd);
  if (body.length < 2048) return null;
  return { bytes: body, contentType: innerCt };
}

function readReplyError(xml: string): string | null {
  const m = xml.match(/<RETS\s+ReplyCode="(\d+)"\s+ReplyText="([^"]*)"/i);
  if (!m) return null;
  if (m[1] === "0") return null;
  return `${m[1]} ${m[2]}`;
}

type ListingStatus = "active" | "pending" | "sold" | "expired" | "withdrawn";

function mapStatusCategory(cat: string | undefined): ListingStatus {
  const s = (cat ?? "").toUpperCase().trim();
  if (!s) return "expired";
  if (s === "A" || s === "ACTIVE") return "active";
  if (s === "P" || s.startsWith("UNDER CONTRACT") || s.startsWith("PENDING")) return "pending";
  if (s === "S" || s.startsWith("SOLD") || s.startsWith("CLOSED")) return "sold";
  if (s === "X" || s.startsWith("EXPIRED")) return "expired";
  if (s === "W" || s.startsWith("WITHDRAWN") || s.startsWith("CANCELED")) return "withdrawn";
  return "expired";
}

function readPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function readInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sanitize Paragon's L_Address2 field into a publishable unit identifier.
 *
 * 2026-05-22 — L_Address2 carries condo/townhouse unit numbers and lot
 * identifiers ("Unit 207", "#9", "Lot #MJ-01", "Unit B", "Shannon Oaks").
 * Most rows are clean, but a small fraction stash marketing copy in this
 * column ("On the Intracoastal WATERWAY"). This sanitizer keeps the unit-
 * like values and drops the prose.
 *
 * Accepts a value when ALL of the following hold:
 *   - non-empty after trim
 *   - length 1..24
 * AND ONE of:
 *   - contains a digit (catches "Unit 207", "#9", "604179", "A21")
 *   - matches a known unit prefix (Unit, Apt, Suite, Ste, Lot, #)
 *   - is short enough to be a building/sub name (<= 12 chars — catches
 *     "Shannon Oaks", "Unit B", "Ocean World")
 *
 * Returns null for everything else.
 */
function sanitizeUnitNumber(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 24) return null;
  const hasDigit = /\d/.test(trimmed);
  const hasUnitPrefix = /^(Unit|Apt|Apartment|Suite|Ste|Lot|#)\b/i.test(trimmed);
  const isShort = trimmed.length <= 12;
  if (hasDigit || hasUnitPrefix || isShort) return trimmed;
  return null;
}

/** Strict positive int — used for L_KeywordN slots that share columns with text. */
function readPositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return n;
}

function readDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildAgentName(row: RowMap): string | null {
  const fn = (row["LA1_UserFirstName"] ?? "").trim();
  const ln = (row["LA1_UserLastName"] ?? "").trim();
  const full = [fn, ln].filter((s) => s.length > 0).join(" ");
  return full.length > 0 ? full : null;
}

/**
 * Build the buyer's-agent name from Paragon SA1 (Selling Agent — MLS
 * terminology for the agent representing the buyer). NULL when not present.
 */
function buildBuyerAgentName(row: RowMap): string | null {
  const fn = (row["SA1_UserFirstName"] ?? "").trim();
  const ln = (row["SA1_UserLastName"] ?? "").trim();
  const full = [fn, ln].filter((s) => s.length > 0).join(" ");
  return full.length > 0 ? full : null;
}

/**
 * Returns true when the given office-name string looks like Alliance.
 * Used to compute alliance_role from raw Paragon strings without relying
 * on which query a row came from (defensive — covers feeds where the SO1
 * filter didn't actually narrow on org name).
 */
function isAllianceOffice(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /century\s*21\s*alliance/i.test(raw);
}

/**
 * Paragon's L_Keyword slots are SHIFTED by one between feeds:
 *   - CMC:  K1=bedrooms,   K2=full baths, K3=half baths
 *   - SJSR: K2=bedrooms,   K3=full baths, K4=half baths (K1=total rooms)
 * Verified by cross-checking 236 Roseann Ave (in both feeds, both 4BR/2BA).
 */
function mapBedsBaths(row: RowMap, sourceMls: "cmc" | "sjsr"): {
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
} {
  if (sourceMls === "cmc") {
    return {
      bedrooms: readPositiveInt(row["L_Keyword1"]),
      bathrooms_full: readPositiveInt(row["L_Keyword2"]),
      bathrooms_half: readPositiveInt(row["L_Keyword3"]),
    };
  }
  return {
    bedrooms: readPositiveInt(row["L_Keyword2"]),
    bathrooms_full: readPositiveInt(row["L_Keyword3"]),
    bathrooms_half: readPositiveInt(row["L_Keyword4"]),
  };
}

/**
 * Living-area square footage. Field differs by feed (verified 2026-05-31
 * against the cross-listed twin 430 S Shore Road — CMC L_SquareFeet=1012
 * matched SJSR LM_Int4_2=1012):
 *   - CMC:  L_SquareFeet
 *   - SJSR: LM_Int4_2   (LM_Int4_7=lot size, LM_Int4_1/_8=year built — NOT this)
 * Feeds frequently leave it blank or "0" → return null so the placeholder
 * falls back to its layer text instead of rendering "0 Sq Ft".
 */
function mapSquareFeet(row: RowMap, sourceMls: "cmc" | "sjsr"): number | null {
  const raw = (sourceMls === "cmc" ? row["L_SquareFeet"] : row["LM_Int4_2"]) ?? "";
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  // Guard against junk: 0 means "not provided"; cap at 100k to drop stray
  // lot-size / parcel values that occasionally land in the wrong slot.
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return n;
}

/**
 * Public remarks — CMC: LR_remarks33, SJSR: LR_remarks22.
 * NEVER pull LR_remarks44 (broker-only / private comments containing seller info).
 */
function readPublicRemarks(row: RowMap, sourceMls: "cmc" | "sjsr"): string | null {
  const key = sourceMls === "cmc" ? "LR_remarks33" : "LR_remarks22";
  const raw = (row[key] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/* ------------------------------------------------------------------------ */
/* Phase 9 — OpenHouse pass                                                 */
/*                                                                          */
/* After each Property class sync, we run a second pass against the         */
/* `OpenHouse` resource for the same class. Each Open House row carries     */
/* L_DisplayId (the MLS number), OH_StartDateTime, OH_EndDateTime, and      */
/* OH_Comments. We filter to Alliance listings post-fetch by intersecting   */
/* L_DisplayId with the MLS numbers we just ingested.                       */
/* ------------------------------------------------------------------------ */

/**
 * Mapped open-house row, ready for upsert into open_houses.
 */
interface MappedOpenHouse {
  oh_unique_id: string;
  mls_number: string;
  start_at: string;          // ISO timestamptz
  end_at: string | null;
  comments: string | null;
  rets_created_at: string | null;
  rets_updated_at: string | null;
}

/**
 * Parse a Paragon date+time string into an ISO timestamptz string.
 *
 * Paragon's COMPACT-DECODED format returns OH_StartDateTime / OH_EndDateTime
 * etc. as "YYYY-MM-DDTHH:MM:SS" with NO timezone suffix — but the value is
 * **already UTC**, not local wall-time. We verified this by cross-checking
 * OH_StartDateTime against OH_StartTime (the separate "local wall-time"
 * field) on multiple rows: e.g. MLS 253231 has OH_StartTime "12:00:00"
 * (12pm EDT) and OH_StartDateTime "2026-04-18T16:00:00" (= 16:00 UTC).
 * The OH_Comments on that row literally read "OPEN HOUSE 12PM - 3PM".
 *
 * Earlier versions of this function treated the input as Eastern wall-time
 * and shifted by +4 to produce UTC, which double-shifted every OH by 4
 * hours and made 10am EDT events display as 2pm EDT. The fix: just append
 * "Z" so JS parses the string as UTC.
 */
function readDateTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Already has a timezone suffix (Z or ±HH:MM) — pass through.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Tz-less ISO "YYYY-MM-DDTHH:MM:SS(.fractional)?". Treat as UTC.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed)) {
    // Replace space separator with T (RFC 3339 form) and append Z so JS
    // parses the literal as UTC regardless of the runtime's local TZ.
    const iso = trimmed.replace(" ", "T") + "Z";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Fallback: let JS attempt a parse. Will likely be NaN for malformed input.
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Map a Paragon OpenHouse row into our open_houses schema. Returns null
 * when the row is missing required fields (UID, MLS#, start time).
 */
function mapOpenHouseRow(row: RowMap): MappedOpenHouse | null {
  const oh_unique_id = (row["OH_UniqueID"] ?? "").trim();
  // L_DisplayId is the MLS number we'd join on. L_ListingID is Paragon's
  // internal system id (different from the MLS#).
  const mls_number = (row["L_DisplayId"] ?? "").trim().toUpperCase();
  const start_at = readDateTime(row["OH_StartDateTime"]);
  if (!oh_unique_id || !mls_number || !start_at) return null;
  return {
    oh_unique_id,
    mls_number,
    start_at,
    end_at: readDateTime(row["OH_EndDateTime"]),
    comments: (row["OH_Comments"] ?? "").trim() || null,
    rets_created_at: readDateTime(row["OH_CreateDateTime"]),
    rets_updated_at: readDateTime(row["OH_UpdateDateTime"]),
  };
}

/**
 * Pull all OpenHouse rows for this property class from RETS, filter to
 * Alliance MLS numbers (passed in from the Property pass), and upsert.
 *
 * Paragon doesn't accept LO1_OrganizationName as an OpenHouse query field,
 * so we pull everything for the class and filter client-side by MLS#.
 * Volume is small (a brokerage runs maybe a handful of OHs per week).
 *
 * Returns the count of OHs upserted.
 */
async function syncOpenHousesForClass(
  rets: RETSClient,
  listingsClient: SupabaseClient,
  analyticsClient: SupabaseClient,
  feedShortCode: "cmc" | "sjsr",
  cls: string,
  allianceMlsNumbers: Set<string>,
): Promise<number> {
  if (allianceMlsNumbers.size === 0) return 0;

  // Window: future + last 7 days (so just-ended OHs still surface
  // briefly in the UI, helpful for postmortem posts).
  const windowStartIso = new Date(
    Date.now() - 7 * 86400_000,
  ).toISOString();
  // DMQL2 date filter: (OH_StartDateTime=2026-05-05T00:00:00+)
  // The trailing + means "and after". Strip the trailing Z if present
  // because Paragon doesn't tolerate the suffix in DMQL.
  const dateClause = windowStartIso.replace(/\.\d{3}Z$/, "").replace("Z", "");
  const query = `(OH_StartDateTime=${dateClause}+)`;

  let xml: string;
  try {
    const resp = await rets.search("OpenHouse", cls, query);
    if (resp.rows.length === 0) return 0;
    xml = "ok";
    void xml;

    // Filter to Alliance MLS numbers + map.
    const mapped: MappedOpenHouse[] = [];
    for (const row of resp.rows) {
      const oh = mapOpenHouseRow(row);
      if (!oh) continue;
      if (!allianceMlsNumbers.has(oh.mls_number)) continue;
      mapped.push(oh);
    }
    if (mapped.length === 0) return 0;

    const now = new Date().toISOString();

    // Upsert to Alliance Listings (source-of-truth) first.
    const upsertRowsListings = mapped.map((r) => ({
      feed_short_code: feedShortCode,
      oh_unique_id: r.oh_unique_id,
      mls_number: r.mls_number,
      start_at: r.start_at,
      end_at: r.end_at,
      comments: r.comments,
      rets_created_at: r.rets_created_at,
      rets_updated_at: r.rets_updated_at,
      updated_at: now,
      last_synced_at: now,
    }));
    const { error: lErr } = await listingsClient
      .from("open_houses")
      .upsert(upsertRowsListings, { onConflict: "feed_short_code,oh_unique_id" });
    if (lErr) {
      console.error(`[${cls}] open_houses listings upsert:`, lErr.message);
      return 0;
    }

    // Replicate to AllianceAnalytics. We need property_id; look it up by MLS#.
    const { data: propRows } = await analyticsClient
      .from("properties")
      .select("id, mls_number")
      .in(
        "mls_number",
        Array.from(new Set(mapped.map((r) => r.mls_number))),
      );
    const propertyIdByMls = new Map<string, string>();
    for (const p of (propRows ?? []) as Array<{ id: string; mls_number: string }>) {
      propertyIdByMls.set(p.mls_number, p.id);
    }
    const upsertRowsAnalytics = mapped.map((r) => ({
      feed_short_code: feedShortCode,
      oh_unique_id: r.oh_unique_id,
      mls_number: r.mls_number,
      property_id: propertyIdByMls.get(r.mls_number) ?? null,
      start_at: r.start_at,
      end_at: r.end_at,
      comments: r.comments,
      rets_created_at: r.rets_created_at,
      rets_updated_at: r.rets_updated_at,
      updated_at: now,
      last_synced_at: now,
    }));
    const { error: aErr } = await analyticsClient
      .from("open_houses")
      .upsert(upsertRowsAnalytics, { onConflict: "feed_short_code,oh_unique_id" });
    if (aErr) {
      console.error(`[${cls}] open_houses analytics upsert:`, aErr.message);
    }
    return mapped.length;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("20200") || msg.includes("20201")) {
      // No OH data for this class, or query field rejected — skip silently.
      return 0;
    }
    console.error(`[${cls}] OpenHouse sync error:`, msg);
    return 0;
  }
}

interface MappedListing {
  mls_number: string;
  source_mls: "cmc" | "sjsr";
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  status: ListingStatus;
  listing_date: string | null;
  list_agent_name: string | null;
  list_agent_email: string | null;
  list_office_id: string | null;
  list_office_name: string | null;
  property_type: string | null;
  /** Condo / townhouse / lot identifier from Paragon's L_Address2 field.
   *  Sanitized — see sanitizeUnitNumber. NULL for single-family homes. */
  unit_number: string | null;
  dom_days: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  /** Living-area square footage. CMC L_SquareFeet / SJSR LM_Int4_2. NULL when blank/0. */
  square_feet: number | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  /** Settlement / closing date (Paragon L_ClosingDate). NULL for active listings. */
  close_date: string | null;
  /** Sold price at settlement (Paragon L_SoldPrice / L_ClosePrice). NULL for active. */
  close_price: number | null;
  /** Phase 8: Alliance buyer-side agent name (Paragon SA1_*). NULL when Alliance is listing-only. */
  buyer_agent_name: string | null;
  /** Phase 8: Raw Paragon SO1_OrganizationName (buyer-side brokerage). */
  buyer_office_name: string | null;
  /** Phase 8: Which side(s) of the transaction Alliance has. */
  alliance_role: "listing" | "buyer" | "both";
  raw_payload: Record<string, unknown>;
}

/**
 * Pull close_date from any of Paragon's close-date field variants.
 * Different feeds + class codes use different keys; this falls through
 * the common ones in order of preference.
 */
function readCloseDate(row: RowMap): string | null {
  const candidates = [
    "L_ClosingDate",
    "L_ClosedDate",
    "L_CloseDate",
    "L_SettlementDate",
    "L_SoldDate",
  ];
  for (const key of candidates) {
    const v = readDate(row[key]);
    if (v) return v;
  }
  return null;
}

/**
 * Pull close_price (the actual sold/settled amount, NOT the asking price)
 * from any of Paragon's price field variants. Falls back to NULL when
 * the listing hasn't sold yet.
 */
function readClosePrice(row: RowMap): number | null {
  const candidates = [
    "L_SoldPrice",
    "L_ClosePrice",
    "L_ClosingPrice",
    "L_SalePrice",
  ];
  for (const key of candidates) {
    const v = readPrice(row[key]);
    if (v && v > 0) return v;
  }
  return null;
}


/**
 * Collapse immediately-repeated words ("STREET STREET" -> "STREET",
 * "Dr Dr" -> "Dr"). Both feeds ship doubled words: Bright bakes the suffix
 * into StreetName and also sends StreetSuffix; Paragon's L_Address itself
 * sometimes arrives pre-doubled. Case-insensitive, keeps the first casing.
 */
function collapseRepeatedWords(s: string): string {
  const parts = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && out[out.length - 1].toLowerCase() === p.toLowerCase()) continue;
    out.push(p);
  }
  return out.join(" ");
}

/**
 * Convert a raw Paragon row into our MappedListing shape.
 *
 * `querySide` indicates which DMQL2 query matched this row — used as a hint
 * for alliance_role, but the final role is determined by checking the raw
 * LO1 + SO1 office strings on the row itself (defensive — Paragon will
 * sometimes return matches with org-name variations the filter accepted).
 */
function mapRow(
  row: RowMap,
  sourceMls: "cmc" | "sjsr",
  querySide: "list" | "buy",
): MappedListing | null {
  const mlsRaw = row["L_ListingID"];
  const addr = row["L_Address"];
  if (!mlsRaw || !addr) return null;
  const beds = mapBedsBaths(row, sourceMls);

  const listOfficeName = (row["LO1_OrganizationName"] ?? "").trim() || null;
  const buyerOfficeName = (row["SO1_OrganizationName"] ?? "").trim() || null;
  const allianceOnList = isAllianceOffice(listOfficeName);
  const allianceOnBuy = isAllianceOffice(buyerOfficeName);

  // alliance_role from actual office strings, with querySide as fallback hint.
  let alliance_role: "listing" | "buyer" | "both" = "listing";
  if (allianceOnList && allianceOnBuy) alliance_role = "both";
  else if (allianceOnBuy && !allianceOnList) alliance_role = "buyer";
  else if (allianceOnList && !allianceOnBuy) alliance_role = "listing";
  else {
    // Neither office string flagged Alliance — fall back to which query
    // returned this row. (Should be rare; means Paragon's wildcard matched
    // an Alliance-named office whose display string we don't recognize.)
    alliance_role = querySide === "buy" ? "buyer" : "listing";
  }

  return {
    mls_number: mlsRaw.trim().toUpperCase(),
    source_mls: sourceMls,
    // 2026-08-15 — Paragon's L_Address sometimes arrives with the suffix
    // doubled ("4 Essex Dr Dr", "1934 West Ave Ave"); collapse repeats.
    address: collapseRepeatedWords(addr.trim()),
    city: (row["L_City"] ?? "").trim() || null,
    state: "NJ",
    zip: (row["L_Zip"] ?? "").trim() || null,
    list_price: readPrice(row["L_AskingPrice"]) ?? readPrice(row["L_OriginalPrice"]),
    status: mapStatusCategory(row["L_Status"]),
    listing_date: readDate(row["L_ListingDate"]),
    list_agent_name: buildAgentName(row),
    list_agent_email: null,
    list_office_id: (row["LO1_HiddenOrgID"] ?? row["L_ListOffice1"] ?? "").trim() || null,
    list_office_name: listOfficeName,
    property_type: (row["L_Type_"] ?? "").trim() || null,
    unit_number: sanitizeUnitNumber(row["L_Address2"]),
    dom_days: readInt(row["L_DOM"]),
    bedrooms: beds.bedrooms,
    bathrooms_full: beds.bathrooms_full,
    bathrooms_half: beds.bathrooms_half,
    square_feet: mapSquareFeet(row, sourceMls),
    public_remarks: readPublicRemarks(row, sourceMls),
    hero_image_url: null, // populated by syncPhotosForRows after upsert
    close_date: readCloseDate(row),
    close_price: readClosePrice(row),
    buyer_agent_name: buildBuyerAgentName(row),
    buyer_office_name: buyerOfficeName,
    alliance_role,
    raw_payload: row,
  };
}

/**
 * Merge a buy-side match into an existing list-side row. Used after dedup
 * when the same MLS came back from both queries — we promote alliance_role
 * to 'both' and fill in buyer agent fields if the list-side row was missing
 * them.
 */
function mergeBuySideIntoListSide(
  listSide: MappedListing,
  buySide: MappedListing,
): MappedListing {
  return {
    ...listSide,
    alliance_role: "both",
    buyer_agent_name: listSide.buyer_agent_name ?? buySide.buyer_agent_name,
    buyer_office_name: listSide.buyer_office_name ?? buySide.buyer_office_name,
    close_date: listSide.close_date ?? buySide.close_date,
    close_price: listSide.close_price ?? buySide.close_price,
  };
}

function createAnalyticsClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function createListingsClient(): SupabaseClient {
  const url = Deno.env.get("LISTINGS_SUPABASE_URL");
  const key = Deno.env.get("LISTINGS_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing LISTINGS_SUPABASE_URL / LISTINGS_SUPABASE_SERVICE_ROLE_KEY secrets on the Edge Function.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadFeed(client: SupabaseClient, shortCode: string): Promise<FeedRow> {
  const { data, error } = await client
    .from("mls_feeds")
    .select("id, short_code, name, rets_url, username, password, rets_version, is_active")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (error) throw new Error(`mls_feeds lookup failed: ${error.message}`);
  if (!data) throw new Error(`No mls_feeds row for short_code='${shortCode}'`);
  if (!data.is_active) throw new Error(`Feed '${shortCode}' is inactive`);
  if (!data.rets_url || !data.username || !data.password) {
    throw new Error(`Feed '${shortCode}' is missing rets_url/username/password`);
  }
  return data as FeedRow;
}

async function startSyncRun(client: SupabaseClient, feed: FeedRow, cls: string): Promise<number> {
  const { data, error } = await client
    .from("sync_runs")
    .insert({
      feed_id: feed.id,
      feed_short_code: feed.short_code,
      resource: "Property",
      property_class: cls,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw new Error(`sync_runs insert failed: ${error.message}`);
  return data.id as number;
}

async function finishSyncRun(
  client: SupabaseClient,
  runId: number,
  patch: {
    status: "success" | "partial" | "error";
    records_seen?: number;
    records_upserted?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client
    .from("sync_runs")
    .update({ finished_at: new Date().toISOString(), ...patch })
    .eq("id", runId);
  if (error) console.error("sync_runs update failed:", error.message);
}

async function upsertListings(client: SupabaseClient, rows: MappedListing[]): Promise<number> {
  if (rows.length === 0) return 0;
  const upsertRows = rows.map((r) => ({
    mls_number: r.mls_number,
    source_mls: r.source_mls,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_price: r.list_price,
    status: r.status,
    listing_date: r.listing_date,
    list_agent_name: r.list_agent_name,
    list_agent_email: r.list_agent_email,
    list_office_id: r.list_office_id,
    list_office_name: r.list_office_name,
    property_type: r.property_type,
    dom_days: r.dom_days,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    close_date: r.close_date,
    close_price: r.close_price,
    buyer_agent_name: r.buyer_agent_name,
    buyer_office_name: r.buyer_office_name,
    alliance_role: r.alliance_role,
    raw_payload: r.raw_payload,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  const { error, count } = await client
    .from("active_listings")
    .upsert(upsertRows, { onConflict: "mls_number", count: "exact" });
  if (error) throw new Error(`active_listings upsert failed: ${error.message}`);
  return count ?? rows.length;
}

async function replicateToProperties(client: SupabaseClient, rows: MappedListing[]): Promise<void> {
  if (rows.length === 0) return;
  const propertyRows = rows.map((r) => ({
    mls_number: r.mls_number,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_price: r.list_price,
    listing_date: r.listing_date,
    agent_name: r.list_agent_name,
    agent_email: r.list_agent_email,
    listing_office_name: r.list_office_name,
    property_type: r.property_type,
    unit_number: r.unit_number,
    dom_days: r.dom_days,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    square_feet: r.square_feet,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    close_date: r.close_date,
    close_price: r.close_price,
    buyer_agent_name: r.buyer_agent_name,
    buyer_office_name: r.buyer_office_name,
    alliance_role: r.alliance_role,
    status: r.status === "withdrawn" ? "expired" : r.status,
    source_mls: r.source_mls,
    updated_at: new Date().toISOString(),
  }));
  // 2026-05-28 (Phase 4 #3) — composite conflict target so a property
  // cross-listed in two feeds (CMC + SJSR) keeps a row per source instead of
  // the feeds clobbering each other on a global mls_number unique. Requires
  // the composite UNIQUE(mls_number, source_mls) on properties (added in the
  // properties_add_composite_mls_source_unique migration). NOTE: this only
  // takes effect once this function is redeployed; until then the live
  // function still uses onConflict "mls_number".
  const { error } = await client
    .from("properties")
    .upsert(propertyRows, { onConflict: "mls_number,source_mls" });
  if (error) console.error("properties replication failed:", error.message);
}

/**
 * Downgrade listings that left the RETS feed.
 *
 * why: passesFilter excludes expired/withdrawn/old-sold rows from upserts,
 * so a listing that drops out of the feed would otherwise stay
 * status='active' in our DBs forever. After a fully clean sync run we mark
 * any still-active row of this feed that was NOT seen in the run as expired.
 *
 * SAFETY: the caller only invokes this when no class errored AND the seen
 * set is non-empty, so a partial RETS outage cannot mass-expire inventory.
 * We diff in JS (select active, subtract seen) rather than building a giant
 * NOT IN clause, and we update by the explicit stale list so the count we
 * log is exactly what changed.
 */
async function downgradeStaleListings(
  analytics: SupabaseClient,
  listings: SupabaseClient,
  sourceMls: "cmc" | "sjsr",
  seenMls: Set<string>,
): Promise<void> {
  const now = new Date().toISOString();

  // AllianceAnalytics.properties (feed-scoped via source_mls).
  try {
    const { data, error } = await analytics
      .from("properties")
      .select("mls_number")
      .eq("source_mls", sourceMls)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const stale = ((data ?? []) as Array<{ mls_number: string }>)
      .map((r) => r.mls_number)
      .filter((m) => !seenMls.has(m));
    if (stale.length > 0) {
      const { error: upErr } = await analytics
        .from("properties")
        .update({ status: "expired", status_changed_at: now, updated_at: now })
        .eq("source_mls", sourceMls)
        .eq("status", "active")
        .in("mls_number", stale);
      if (upErr) throw new Error(upErr.message);
    }
    console.log(
      `[${sourceMls}] downgraded ${stale.length} stale properties to expired (analytics)`,
    );
  } catch (e) {
    console.error(`[${sourceMls}] stale downgrade (analytics):`, (e as Error).message);
  }

  // Alliance Listings.active_listings (same scoping + status model).
  try {
    const { data, error } = await listings
      .from("active_listings")
      .select("mls_number")
      .eq("source_mls", sourceMls)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const stale = ((data ?? []) as Array<{ mls_number: string }>)
      .map((r) => r.mls_number)
      .filter((m) => !seenMls.has(m));
    if (stale.length > 0) {
      const { error: upErr } = await listings
        .from("active_listings")
        .update({ status: "expired", status_changed_at: now, updated_at: now })
        .eq("source_mls", sourceMls)
        .eq("status", "active")
        .in("mls_number", stale);
      if (upErr) throw new Error(upErr.message);
    }
    console.log(
      `[${sourceMls}] downgraded ${stale.length} stale listings to expired (listings)`,
    );
  } catch (e) {
    console.error(`[${sourceMls}] stale downgrade (listings):`, (e as Error).message);
  }
}

async function updateFeedTimestamps(client: SupabaseClient, feedId: string, ok: boolean): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("mls_feeds")
    .update({ last_sync_at: now, last_validated_at: now, last_validated_ok: ok, updated_at: now })
    .eq("id", feedId);
  if (error) console.error("mls_feeds update failed:", error.message);
}

/**
 * Fetch the first photo per listing, persist as either:
 *   - a Paragon CDN URL (Location=1 path — preferred, no upload), OR
 *   - bytes uploaded to the property-photos Supabase Storage bucket (fallback).
 * Errors per-listing are logged and swallowed so a single bad photo doesn't
 * break the whole sync. Returns the count of properties that got hero_image_url set.
 */
async function syncPhotosForRows(
  rets: RETSClient,
  analytics: SupabaseClient,
  rows: MappedListing[],
  feedShortCode: "cmc" | "sjsr",
): Promise<number> {
  let uploaded = 0;
  for (const r of rows) {
    try {
      const result = await rets.getFirstPhoto(r.mls_number);
      let heroUrl: string | null = null;
      if (result.kind === "url") {
        heroUrl = result.url;
      } else if (result.kind === "binary") {
        const ext = result.contentType.includes("png") ? "png" : "jpg";
        const path = `${feedShortCode}/${r.mls_number}.${ext}`;
        const { error: upErr } = await analytics.storage
          .from(PHOTO_BUCKET)
          .upload(path, result.bytes, {
            cacheControl: "3600",
            contentType: result.contentType,
            upsert: true,
          });
        if (upErr) {
          console.error(`photo upload ${r.mls_number}:`, upErr.message);
          continue;
        }
        const { data: pub } = analytics.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        heroUrl = pub?.publicUrl ?? null;
      }
      if (heroUrl) {
        const { error } = await analytics
          .from("properties")
          .update({ hero_image_url: heroUrl, updated_at: new Date().toISOString() })
          .eq("mls_number", r.mls_number);
        if (!error) uploaded += 1;
      }
    } catch (e) {
      console.error(`syncPhotos ${r.mls_number}:`, (e as Error).message);
    }
  }
  return uploaded;
}

/**
 * Phase 11: Multi-photo sync for the Post Builder picker.
 *
 * For each listing, looks up Paragon's `L_PictureCount` from raw_payload
 * and fetches each photo at sequence 1..count via GetObject. Stores the
 * URL (Paragon CDN) when Location=1 returns one, falls back to uploading
 * bytes to the property-photos bucket and storing that URL.
 *
 * Smart-skip: if we already have the right count of rows for this MLS AND
 * `L_Last_Photo_updt` is older than our most recent synced_at, we skip
 * the listing entirely. Keeps steady-state sync runs fast — only new
 * listings or listings with photo updates re-fetch.
 *
 * Errors per-listing or per-photo are logged and swallowed so one bad
 * listing doesn't break the rest of the sync.
 *
 * Returns the count of listing_photos rows upserted across all listings.
 */
async function syncAllPhotosForRows(
  rets: RETSClient,
  analytics: SupabaseClient,
  rows: MappedListing[],
  feedShortCode: "cmc" | "sjsr",
): Promise<number> {
  let totalRows = 0;
  for (const r of rows) {
    try {
      const pictureCountRaw = String(r.raw_payload["L_PictureCount"] ?? "").trim();
      const pictureCount = parseInt(pictureCountRaw, 10);
      if (!Number.isFinite(pictureCount) || pictureCount < 1) continue;

      const lastPhotoUpdtRaw = String(r.raw_payload["L_Last_Photo_updt"] ?? "").trim();

      // Smart-skip: do we have all the photos AND are they current?
      const { data: existing, error: existingErr } = await analytics
        .from("listing_photos")
        .select("sequence, synced_at")
        .eq("mls_number", r.mls_number);
      if (existingErr) {
        console.error(`listing_photos read ${r.mls_number}:`, existingErr.message);
      }
      const existingCount = existing?.length ?? 0;
      const maxSyncedIso = (existing ?? []).reduce<string>(
        (max, p) => (p.synced_at && p.synced_at > max ? p.synced_at : max),
        "",
      );
      if (
        existingCount >= pictureCount &&
        lastPhotoUpdtRaw &&
        maxSyncedIso &&
        new Date(lastPhotoUpdtRaw).getTime() < new Date(maxSyncedIso).getTime()
      ) {
        continue; // up to date
      }

      // Fetch each photo. Sequential per listing — Paragon throttles
      // aggressive parallel hits, and the sync run isn't user-facing.
      const photoRows: Array<{
        mls_number: string;
        source_mls: string;
        sequence: number;
        url: string;
        source: "paragon" | "storage";
        storage_path: string | null;
      }> = [];
      for (let seq = 1; seq <= pictureCount; seq++) {
        const result = await rets.getPhotoAt(r.mls_number, seq);
        if (result.kind === "url") {
          photoRows.push({
            mls_number: r.mls_number,
            source_mls: r.source_mls,
            sequence: seq,
            url: result.url,
            source: "paragon",
            storage_path: null,
          });
        } else if (result.kind === "binary") {
          const ext = result.contentType.toLowerCase().includes("png") ? "png" : "jpg";
          const path = `${feedShortCode}/${r.mls_number}/${seq}.${ext}`;
          const { error: upErr } = await analytics.storage
            .from(PHOTO_BUCKET)
            .upload(path, result.bytes, {
              cacheControl: "31536000",
              contentType: result.contentType,
              upsert: true,
            });
          if (upErr) {
            console.error(`listing_photos upload ${r.mls_number}:${seq}:`, upErr.message);
            continue;
          }
          const { data: pub } = analytics.storage.from(PHOTO_BUCKET).getPublicUrl(path);
          if (pub?.publicUrl) {
            photoRows.push({
              mls_number: r.mls_number,
              source_mls: r.source_mls,
              sequence: seq,
              url: pub.publicUrl,
              source: "storage",
              storage_path: path,
            });
          }
        }
        // kind === "none" → skip silently, photo doesn't exist or fetch failed
      }

      if (photoRows.length > 0) {
        // Stamp synced_at fresh on every upsert so smart-skip can compare.
        const now = new Date().toISOString();
        const rowsWithTimestamp = photoRows.map((p) => ({ ...p, synced_at: now }));
        const { error } = await analytics
          .from("listing_photos")
          .upsert(rowsWithTimestamp, { onConflict: "mls_number,sequence" });
        if (error) {
          console.error(`listing_photos upsert ${r.mls_number}:`, error.message);
        } else {
          totalRows += photoRows.length;
        }
      }
    } catch (e) {
      console.error(`syncAllPhotos ${r.mls_number}:`, (e as Error).message);
    }
  }
  return totalRows;
}

async function syncFeed(shortCode: string): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    ok: false,
    feed_short_code: shortCode,
    feed_name: shortCode,
    duration_ms: 0,
    classes: [],
    errors: [],
    photos_uploaded: 0,
    open_houses_synced: 0,
    all_photos_synced: 0,
  };
  if (shortCode !== "cmc" && shortCode !== "sjsr") {
    result.errors.push(`mls-rets-sync only supports CMC + SJSR. Got: ${shortCode}`);
    result.duration_ms = Date.now() - start;
    return result;
  }
  const sourceMls = shortCode as "cmc" | "sjsr";

  const analytics = createAnalyticsClient();
  let listings: SupabaseClient;
  try {
    listings = createListingsClient();
  } catch (e) {
    result.errors.push((e as Error).message);
    result.duration_ms = Date.now() - start;
    return result;
  }

  let feed: FeedRow;
  try {
    feed = await loadFeed(analytics, shortCode);
    result.feed_name = feed.name;
  } catch (e) {
    result.errors.push((e as Error).message);
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Smoke-test login so a bad password produces ONE error.
  try {
    const probe = new RETSClient(feed.username!, feed.password!);
    await probe.login(feed.rets_url!);
    await probe.logout();
  } catch (e) {
    result.errors.push(`Login failed: ${(e as Error).message}`);
    await updateFeedTimestamps(analytics, feed.id, false);
    result.duration_ms = Date.now() - start;
    return result;
  }

  let totalSeen = 0;
  let totalUpserted = 0;
  let anyClassFailed = false;
  // why: every MLS number kept by passesFilter across ALL classes. Drives the
  // post-run stale-listing downgrade (listings that left the feed).
  const seenMls = new Set<string>();

  const propertyClasses = PROPERTY_CLASSES_BY_FEED[sourceMls];
  for (const cls of propertyClasses) {
    const runId = await startSyncRun(analytics, feed, cls).catch((e) => {
      result.errors.push(`sync_runs start ${cls}: ${(e as Error).message}`);
      return null;
    });
    const classResult: ClassResult = { class: cls, records_seen: 0, records_upserted: 0 };

    // Fresh login per class — Paragon invalidates the session after a large search.
    const rets = new RETSClient(feed.username!, feed.password!);
    try {
      await rets.login(feed.rets_url!);
    } catch (e) {
      anyClassFailed = true;
      classResult.error = `class-login: ${(e as Error).message}`;
      result.errors.push(`[${cls}] class-login: ${(e as Error).message}`);
      if (runId !== null) {
        await finishSyncRun(analytics, runId, {
          status: "error",
          records_seen: 0,
          records_upserted: 0,
          error_message: classResult.error,
        });
      }
      result.classes.push(classResult);
      continue;
    }

    try {
      // Phase 8 dual-query: list-side first, then buy-side. Each row goes
      // through mapRow with the right querySide hint. We dedupe by MLS and
      // promote alliance_role to 'both' when a row matches both queries.
      //
      // SJSR Paragon doesn't expose SO1_OrganizationName as a queryable
      // field (returns 20200 "Unknown Query Field"). We catch that and
      // proceed with list-side only — better to ship list-side coverage
      // than fail the whole class. CMC accepts the buy-side query fine.
      const listResp = await rets.search("Property", cls, DMQL2_LIST_SIDE_QUERY);
      let buyResp: { rows: RowMap[]; rawCount: number } = { rows: [], rawCount: 0 };
      try {
        buyResp = await rets.search("Property", cls, DMQL2_BUY_SIDE_QUERY);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("20200")) {
          // Field not queryable in this feed — degrade gracefully.
          console.warn(`[${cls}] buy-side query unsupported in ${sourceMls}: ${msg}`);
        } else {
          // Re-throw anything else (auth, network, etc.) — those should
          // still surface as class errors.
          throw e;
        }
      }
      const rawCount = listResp.rawCount + buyResp.rawCount;
      classResult.records_seen = rawCount;
      totalSeen += rawCount;

      const RECENT_SOLD_DAYS = 90;
      const recentSoldCutoff = Date.now() - RECENT_SOLD_DAYS * 86400_000;
      function passesFilter(r: MappedListing | null): r is MappedListing {
        if (r === null) return false;
        if (r.status === "active" || r.status === "pending") return true;
        if (r.status === "sold") {
          if (!r.close_date) return true; // unknown close date — keep, dashboard handles it
          const closeMs = new Date(`${r.close_date}T00:00:00Z`).getTime();
          return Number.isFinite(closeMs) && closeMs >= recentSoldCutoff;
        }
        return false; // expired, withdrawn
      }

      const mappedListSide = listResp.rows
        .map((row) => mapRow(row, sourceMls, "list"))
        .filter(passesFilter);
      const mappedBuySide = buyResp.rows
        .map((row) => mapRow(row, sourceMls, "buy"))
        .filter(passesFilter);

      // Dedupe by MLS. When a row appears on both sides, merge so role='both'.
      const byMls = new Map<string, MappedListing>();
      for (const r of mappedListSide) {
        byMls.set(r.mls_number, r);
      }
      for (const r of mappedBuySide) {
        const existing = byMls.get(r.mls_number);
        if (existing) {
          byMls.set(r.mls_number, mergeBuySideIntoListSide(existing, r));
        } else {
          byMls.set(r.mls_number, r);
        }
      }
      const mapped = Array.from(byMls.values());
      for (const m of mapped) seenMls.add(m.mls_number);
      const upserted = await upsertListings(listings, mapped);
      classResult.records_upserted = upserted;
      totalUpserted += upserted;
      await replicateToProperties(analytics, mapped);
      if (runId !== null) {
        await finishSyncRun(analytics, runId, {
          status: "success",
          records_seen: rawCount,
          records_upserted: upserted,
        });
      }
      // Hero photo (single) per class — drives the dashboard thumbnail.
      try {
        const ups = await syncPhotosForRows(rets, analytics, mapped, sourceMls);
        result.photos_uploaded = (result.photos_uploaded ?? 0) + ups;
      } catch (e) {
        console.error(`syncPhotosForRows [${cls}]:`, (e as Error).message);
      }

      // All-photos pass (Post Builder picker). Smart-skips listings whose
      // photos haven't changed. Per-class so the session stays warm.
      try {
        const allUps = await syncAllPhotosForRows(rets, analytics, mapped, sourceMls);
        result.all_photos_synced = (result.all_photos_synced ?? 0) + allUps;
      } catch (e) {
        console.error(`syncAllPhotosForRows [${cls}]:`, (e as Error).message);
      }

      // Phase 9: OpenHouse pass for this class. Reuses the authenticated
      // session. Filters to MLS numbers we just ingested so we never store
      // OHs for non-Alliance listings. Errors swallowed so OH issues don't
      // fail the whole class.
      try {
        const allianceMlsNumbers = new Set(mapped.map((m) => m.mls_number));
        const ohCount = await syncOpenHousesForClass(
          rets,
          listings,
          analytics,
          sourceMls,
          cls,
          allianceMlsNumbers,
        );
        result.open_houses_synced = (result.open_houses_synced ?? 0) + ohCount;
      } catch (e) {
        console.error(`syncOpenHousesForClass [${cls}]:`, (e as Error).message);
      }
    } catch (e) {
      anyClassFailed = true;
      classResult.error = (e as Error).message;
      result.errors.push(`[${cls}] ${(e as Error).message}`);
      if (runId !== null) {
        await finishSyncRun(analytics, runId, {
          status: "error",
          records_seen: classResult.records_seen,
          records_upserted: classResult.records_upserted,
          error_message: (e as Error).message,
        });
      }
    }

    result.classes.push(classResult);
    await rets.logout();
  }

  // Stale-listing downgrade — only after a fully clean run. why: if any
  // class errored, or the run saw zero listings (implausible for a healthy
  // feed), the seen set is incomplete and downgrading from it would
  // mass-expire live inventory during a partial RETS outage.
  if (!anyClassFailed && seenMls.size > 0) {
    await downgradeStaleListings(analytics, listings, sourceMls, seenMls);
  } else {
    console.warn(
      `[${sourceMls}] skipping stale downgrade (anyClassFailed=${anyClassFailed}, seen=${seenMls.size})`,
    );
  }

  // Auto-linker once after all classes complete.
  try {
    await analytics.rpc("run_auto_linker");
  } catch (e) {
    console.error("run_auto_linker post-sync:", (e as Error).message);
  }

  // Resolve properties.office_id from city/zip → offices.short_code. Without
  // this step, every freshly-upserted property has office_id = NULL, which
  // breaks office-scoped dashboard views (OfficeFilterChips, OpenHouses on
  // any tab other than All offices, audience-scope filtering). Idempotent —
  // only updates rows whose office_id is currently NULL, so manual office
  // assignments survive.
  try {
    await analytics.rpc("link_property_offices");
  } catch (e) {
    console.error("link_property_offices post-sync:", (e as Error).message);
  }

  // Ensure every property has an owner-story token (Phase 2). Idempotent —
  // only inserts a thin reports row when one doesn't already exist. The
  // story page (/home/[token]) is the seller-facing narrative view and is
  // expected to exist for every listing, not just ones with a formal
  // generated report.
  try {
    await analytics.rpc("ensure_owner_story_tokens");
  } catch (e) {
    console.error("ensure_owner_story_tokens post-sync:", (e as Error).message);
  }

  result.ok = totalUpserted > 0 || (totalSeen === 0 && !anyClassFailed);
  await updateFeedTimestamps(analytics, feed.id, result.ok);

  result.duration_ms = Date.now() - start;
  return result;
}

/**
 * Open-House-ONLY fast path (2026-07-31, John/Larissa).
 *
 * Larissa needs to refresh open houses on demand, seconds before she builds
 * a multi-property Open House carousel. Calling the full syncFeed() for that
 * is the wrong tool: it re-pulls every listing in every class plus hero and
 * gallery photos, takes 10-15s per feed, and none of that work has anything
 * to do with open houses. The 4-hourly cron already does it.
 *
 * This path skips all of it. Log in, pull the OpenHouse resource per class,
 * and filter against the Alliance MLS numbers ALREADY in `properties`
 * (written by the last full sync) instead of re-deriving them from a fresh
 * Property search. Typically 2-4s per feed.
 *
 * Tradeoff worth naming out loud: a listing that hit the MLS since the last
 * full property sync isn't in `properties` yet, so an open house attached to
 * it gets skipped here and arrives on the next 4-hourly run. In practice a
 * listing goes live days before its first open house, so this has no
 * practical bite — but it's why this is an accelerator, not a replacement.
 */
async function syncOpenHousesOnly(shortCode: string): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    ok: false,
    feed_short_code: shortCode,
    feed_name: shortCode,
    duration_ms: 0,
    classes: [],
    errors: [],
    open_houses_synced: 0,
  };
  if (shortCode !== "cmc" && shortCode !== "sjsr") {
    result.errors.push(
      `mls-rets-sync open_houses mode only supports CMC + SJSR. Got: ${shortCode}`,
    );
    result.duration_ms = Date.now() - start;
    return result;
  }
  const sourceMls = shortCode as "cmc" | "sjsr";

  const analytics = createAnalyticsClient();
  let listings: SupabaseClient;
  try {
    listings = createListingsClient();
  } catch (e) {
    result.errors.push((e as Error).message);
    result.duration_ms = Date.now() - start;
    return result;
  }

  let feed: FeedRow;
  try {
    feed = await loadFeed(analytics, shortCode);
    result.feed_name = feed.name;
  } catch (e) {
    result.errors.push((e as Error).message);
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Alliance MLS numbers from the DB rather than from RETS. Expired rows are
  // excluded — an expired listing can't hold a future open house, and letting
  // them through would only widen the filter for no gain.
  const allianceMlsNumbers = new Set<string>();
  try {
    const { data, error } = await analytics
      .from("properties")
      .select("mls_number, status")
      .eq("source_mls", sourceMls)
      .neq("status", "expired");
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ mls_number: string | null }>) {
      if (r.mls_number) allianceMlsNumbers.add(r.mls_number);
    }
  } catch (e) {
    result.errors.push(`alliance MLS lookup: ${(e as Error).message}`);
    result.duration_ms = Date.now() - start;
    return result;
  }
  if (allianceMlsNumbers.size === 0) {
    // No listings on file for this feed — nothing an open house could attach
    // to. Not an error; a feed can legitimately be empty.
    result.ok = true;
    result.duration_ms = Date.now() - start;
    return result;
  }

  let anyClassFailed = false;
  for (const cls of PROPERTY_CLASSES_BY_FEED[sourceMls]) {
    const classResult: ClassResult = {
      class: cls,
      records_seen: 0,
      records_upserted: 0,
    };
    // Fresh login per class, same as syncFeed — Paragon invalidates the
    // session aggressively and a stale one fails mid-search.
    const rets = new RETSClient(feed.username!, feed.password!);
    try {
      await rets.login(feed.rets_url!);
    } catch (e) {
      anyClassFailed = true;
      classResult.error = `class-login: ${(e as Error).message}`;
      result.errors.push(`[${cls}] class-login: ${(e as Error).message}`);
      result.classes.push(classResult);
      continue;
    }
    try {
      const ohCount = await syncOpenHousesForClass(
        rets,
        listings,
        analytics,
        sourceMls,
        cls,
        allianceMlsNumbers,
      );
      classResult.records_seen = ohCount;
      classResult.records_upserted = ohCount;
      result.open_houses_synced = (result.open_houses_synced ?? 0) + ohCount;
    } catch (e) {
      anyClassFailed = true;
      classResult.error = (e as Error).message;
      result.errors.push(`[${cls}] ${(e as Error).message}`);
    } finally {
      await rets.logout();
    }
    result.classes.push(classResult);
  }

  // Link freshly-arrived OHs to properties. syncOpenHousesForClass already
  // resolves property_id by MLS#, but run_auto_linker is what reconciles the
  // wider property/listing graph the wizard reads from.
  try {
    await analytics.rpc("run_auto_linker");
  } catch (e) {
    console.error("run_auto_linker post-OH-sync:", (e as Error).message);
  }

  result.ok = !anyClassFailed;
  result.duration_ms = Date.now() - start;
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: { feed_short_code?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const shortCode = (body.feed_short_code ?? "").trim();
  // mode="open_houses" runs the OH-only fast path (see syncOpenHousesOnly).
  // Anything else — including the absent default — runs the full sync, so
  // every existing caller (cron, Sync All, per-feed Sync Now) is untouched.
  const mode = (body.mode ?? "full").trim();
  if (!shortCode) {
    return new Response(JSON.stringify({ error: "Missing feed_short_code in body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = mode === "open_houses"
    ? await syncOpenHousesOnly(shortCode)
    : await syncFeed(shortCode);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
