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
 * Invocation: POST { feed_short_code: "cmc" | "sjsr" }.
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
const DMQL2_QUERY = "(LO1_OrganizationName=*Century 21 Alliance*)";
const RETS_USER_AGENT = "AllianceAnalytics/1.0";
const RETS_VERSION = "RETS/1.8";
const SEARCH_LIMIT = 5000;
const PHOTO_BUCKET = "property-photos";

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
    let res = await fetch(url, { method: "GET", headers, redirect: expectBinary ? "manual" : "follow" });
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
      res = await fetch(url, { method: "GET", headers, redirect: expectBinary ? "manual" : "follow" });
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

  async search(resource: string, cls: string, query: string): Promise<{ rows: RowMap[]; rawCount: number }> {
    const baseUrl = this.absoluteUrl(this.capabilities["Search"]);
    const params = new URLSearchParams({
      SearchType: resource, Class: cls, Query: query, QueryType: "DMQL2",
      Format: "COMPACT-DECODED", Count: "1", StandardNames: "0", Limit: String(SEARCH_LIMIT),
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
   * GetObject — fetch the first photo for a property.
   *
   * Tries Location=1 first: Paragon returns HTTP 200 with a `Location:` HEADER
   * pointing at the public CDN URL (NOT a 3xx redirect — the body is a tiny
   * RETS XML reply we ignore). Cheapest path because we just persist the URL.
   *
   * Falls back to Location=0 (image/jpeg or multipart/related body) when the
   * header path doesn't yield a usable URL.
   */
  async getFirstPhoto(mlsNumber: string): Promise<
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
      Resource: "Property", Type: "Photo", ID: `${mlsNumber}:1`, Location: "1",
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
      console.error(`getFirstPhoto Location=1 ${mlsNumber}:`, (e as Error).message);
    }

    // Fallback: Location=0 — body is jpeg or multipart/related.
    const params0 = new URLSearchParams({
      Resource: "Property", Type: "Photo", ID: `${mlsNumber}:1`, Location: "0",
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
      console.error(`getFirstPhoto Location=0 ${mlsNumber}:`, (e as Error).message);
      return { kind: "none" };
    }
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
 * Public remarks — CMC: LR_remarks33, SJSR: LR_remarks22.
 * NEVER pull LR_remarks44 (broker-only / private comments containing seller info).
 */
function readPublicRemarks(row: RowMap, sourceMls: "cmc" | "sjsr"): string | null {
  const key = sourceMls === "cmc" ? "LR_remarks33" : "LR_remarks22";
  const raw = (row[key] ?? "").trim();
  return raw.length > 0 ? raw : null;
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
  dom_days: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  /** Settlement / closing date (Paragon L_ClosingDate). NULL for active listings. */
  close_date: string | null;
  /** Sold price at settlement (Paragon L_SoldPrice / L_ClosePrice). NULL for active. */
  close_price: number | null;
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

function mapRow(row: RowMap, sourceMls: "cmc" | "sjsr"): MappedListing | null {
  const mlsRaw = row["L_ListingID"];
  const addr = row["L_Address"];
  if (!mlsRaw || !addr) return null;
  const beds = mapBedsBaths(row, sourceMls);
  return {
    mls_number: mlsRaw.trim().toUpperCase(),
    source_mls: sourceMls,
    address: addr.trim(),
    city: (row["L_City"] ?? "").trim() || null,
    state: "NJ",
    zip: (row["L_Zip"] ?? "").trim() || null,
    list_price: readPrice(row["L_AskingPrice"]) ?? readPrice(row["L_OriginalPrice"]),
    status: mapStatusCategory(row["L_Status"]),
    listing_date: readDate(row["L_ListingDate"]),
    list_agent_name: buildAgentName(row),
    list_agent_email: null,
    list_office_id: (row["LO1_HiddenOrgID"] ?? row["L_ListOffice1"] ?? "").trim() || null,
    list_office_name: (row["LO1_OrganizationName"] ?? "").trim() || null,
    property_type: (row["L_Type_"] ?? "").trim() || null,
    dom_days: readInt(row["L_DOM"]),
    bedrooms: beds.bedrooms,
    bathrooms_full: beds.bathrooms_full,
    bathrooms_half: beds.bathrooms_half,
    public_remarks: readPublicRemarks(row, sourceMls),
    hero_image_url: null, // populated by syncPhotosForRows after upsert
    close_date: readCloseDate(row),
    close_price: readClosePrice(row),
    raw_payload: row,
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
    dom_days: r.dom_days,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    close_date: r.close_date,
    close_price: r.close_price,
    status: r.status === "withdrawn" ? "expired" : r.status,
    source_mls: r.source_mls,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client
    .from("properties")
    .upsert(propertyRows, { onConflict: "mls_number" });
  if (error) console.error("properties replication failed:", error.message);
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
      const { rows, rawCount } = await rets.search("Property", cls, DMQL2_QUERY);
      classResult.records_seen = rawCount;
      totalSeen += rawCount;
      // Ingest active + pending + recently-sold (last 90 days). Expired
      // and withdrawn drop out so the DB doesn't bloat with stale rows.
      // Sold listings older than 90 days also drop — the "Recently Sold"
      // dashboard surface only shows the last 30, so we keep a buffer
      // for variations in cron timing.
      const RECENT_SOLD_DAYS = 90;
      const recentSoldCutoff = Date.now() - RECENT_SOLD_DAYS * 86400_000;
      const mapped = rows
        .map((r) => mapRow(r, sourceMls))
        .filter((r): r is MappedListing => {
          if (r === null) return false;
          if (r.status === "active" || r.status === "pending") return true;
          if (r.status === "sold") {
            if (!r.close_date) return true; // unknown close date — keep, dashboard handles it
            const closeMs = new Date(`${r.close_date}T00:00:00Z`).getTime();
            return Number.isFinite(closeMs) && closeMs >= recentSoldCutoff;
          }
          return false; // expired, withdrawn
        });
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
      // Photos for this class — the session is fresh and authenticated.
      try {
        const ups = await syncPhotosForRows(rets, analytics, mapped, sourceMls);
        result.photos_uploaded = (result.photos_uploaded ?? 0) + ups;
      } catch (e) {
        console.error(`syncPhotosForRows [${cls}]:`, (e as Error).message);
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

  // Auto-linker once after all classes complete.
  try {
    await analytics.rpc("run_auto_linker");
  } catch (e) {
    console.error("run_auto_linker post-sync:", (e as Error).message);
  }

  result.ok = totalUpserted > 0 || (totalSeen === 0 && !anyClassFailed);
  await updateFeedTimestamps(analytics, feed.id, result.ok);

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
  let body: { feed_short_code?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const shortCode = (body.feed_short_code ?? "").trim();
  if (!shortCode) {
    return new Response(JSON.stringify({ error: "Missing feed_short_code in body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await syncFeed(shortCode);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
