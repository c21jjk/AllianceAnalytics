/**
 * Bright MLS RETS sync Edge Function.
 *
 * Bright is a RESO Data Dictionary feed on a CoreLogic **Cornerstone** RETS
 * server (NOT the RESO Web API the app was originally scaffolded for, and NOT
 * Paragon like CMC/SJSR). This function is intentionally SEPARATE from
 * `mls-rets-sync` (Paragon) so it cannot break the two live Paragon feeds.
 *
 * What it does:
 *   1. Digest-login to Bright (User-Agent "Bright RETS Application/1.0", RETS/1.8).
 *   2. Search Property:ALL filtered to the 6 Century 21 Alliance office codes
 *      (mls_feeds.office_filter). Bright is a huge multi-state MLS, so the
 *      office filter is MANDATORY. `StandardStatus` is a lookup and cannot be
 *      filtered in DMQL, so status is filtered client-side (active / pending /
 *      sold-within-90d), same as the Paragon function.
 *   3. Map RESO fields -> upsert into Alliance Listings.active_listings AND
 *      AllianceAnalytics.properties (source_mls='bright'), keyed on
 *      (mls_number, source_mls). Then downgrade stale actives, run the
 *      auto-linker / office-linker / owner-story RPCs, and stamp the feed row.
 *
 * Photos: pulled from the separate Media resource (PROP_MEDIA), joined by
 * ResourceRecordKey == ListingKey. Media rows carry direct (watermarked) CDN
 * URLs, so we store https URLs (no binary download): hero -> properties/
 * active_listings.hero_image_url, full ordered set -> listing_photos.
 *
 * Required Edge Function secrets (shared, already set for mls-rets-sync):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   LISTINGS_SUPABASE_URL, LISTINGS_SUPABASE_SERVICE_ROLE_KEY
 *
 * Invocation: POST { feed_short_code: "bright" }  (defaults to "bright").
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
// @ts-expect-error - Deno-resolved import
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_UA = "Bright RETS Application/1.0";
const DEFAULT_VERSION = "RETS/1.8";
const BRIGHT_RESOURCE = "Property";
const BRIGHT_CLASS = "ALL"; // superset class — one query covers RESI/RINC/LAND/RLSE/commercial
const PAGE_LIMIT = 2500;
const MAX_PAGES = 30;
const RETS_FETCH_TIMEOUT_MS = 60_000;
const RECENT_SOLD_DAYS = 90;

// Photos live in a separate RESO Media resource (PROP_MEDIA), joined to a
// listing by ResourceRecordKey == Property ListingKey. Rows carry direct CDN
// URLs (no GetObject / binary download needed). URLs are http; we upgrade to
// https to avoid mixed-content blocking in the app. NOTE: Bright IDX images
// are watermarked (all URL variants contain "_WM_").
const MEDIA_RESOURCE = "Media";
const MEDIA_CLASS = "PROP_MEDIA";
const MEDIA_KEY_BATCH = 50; // ListingKeys per Media query
const MEDIA_SELECT = [
  "ResourceRecordKey", "MediaKey", "MediaCategory", "MediaDisplayOrder",
  "PreferredPhotoYN", "MediaURLHD", "MediaURLHiRes", "MediaURL",
  "MediaShortDescription",
].join(",");

// Only the fields we map — keeps the COMPACT payload small and fast.
const SELECT_FIELDS = [
  "ListingKey", "ListingId", "StandardStatus", "MlsStatus",
  "ListPrice", "OriginalListPrice", "ClosePrice",
  "BedroomsTotal", "BathroomsFull", "BathroomsHalf", "LivingArea",
  "PublicRemarks",
  "ListAgentMlsId", "ListAgentFullName", "ListAgentEmail", "ListAgentPreferredPhone",
  "ListOfficeMlsId", "ListOfficeName",
  "StreetNumber", "StreetDirPrefix", "StreetName", "StreetSuffix", "StreetDirSuffix", "UnitNumber",
  "City", "StateOrProvince", "PostalCode",
  "PropertyType", "PropertySubType",
  "DaysOnMarket", "ListingContractDate", "OnMarketDate", "CloseDate", "ModificationTimestamp",
].join(",");

type RowMap = Record<string, string>;
type ListingStatus = "active" | "pending" | "sold" | "expired" | "withdrawn";

interface FeedRow {
  id: string;
  short_code: string;
  name: string;
  rets_url: string;
  username: string;
  password: string;
  rets_version: string | null;
  user_agent: string | null;
  office_filter: string | null;
  is_active: boolean;
}

// ------------------------------ RETS client ------------------------------

function md5(s: string): string { return createHash("md5").update(s).digest("hex"); }
function newCnonce(): string { return randomBytes(8).toString("hex"); }

interface DigestChallenge { realm: string; nonce: string; qop?: string; opaque?: string; algorithm?: string; }
function parseDigestChallenge(header: string): DigestChallenge {
  const body = header.replace(/^\s*Digest\s+/i, "");
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*("([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? "").trim();
  if (!out.realm || !out.nonce) throw new Error("Malformed digest challenge");
  return { realm: out.realm, nonce: out.nonce, qop: out.qop, opaque: out.opaque, algorithm: out.algorithm };
}
function buildBasic(user: string, pass: string): string { return `Basic ${btoa(`${user}:${pass}`)}`; }
function buildDigest(method: string, uri: string, user: string, pass: string, ch: DigestChallenge, nc: number): string {
  const cnonce = newCnonce();
  const ncStr = nc.toString(16).padStart(8, "0");
  const ha1 = md5(`${user}:${ch.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  let response: string; let qopPart = "";
  if (ch.qop) {
    const qop = ch.qop.split(",").map((q) => q.trim()).includes("auth") ? "auth" : ch.qop.split(",")[0].trim();
    response = md5(`${ha1}:${ch.nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`);
    qopPart = `, qop=${qop}, nc=${ncStr}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${ch.nonce}:${ha2}`);
  }
  let header = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"${qopPart}`;
  if (ch.opaque) header += `, opaque="${ch.opaque}"`;
  if (ch.algorithm) header += `, algorithm=${ch.algorithm}`;
  return header;
}

type AuthScheme = "digest" | "basic";

class RETSClient {
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
    private readonly userAgent: string,
    private readonly retsVersion: string,
  ) {}

  private cookieHeader(): string { return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; "); }
  absoluteUrl(rel: string): string {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (!this.loginOrigin) return rel;
    return rel.startsWith("/") ? `${this.loginOrigin}${rel}` : `${this.loginOrigin}/${rel}`;
  }
  private absorb(res: Response): void {
    // deno-lint-ignore no-explicit-any
    const all = (res.headers as any).getSetCookie?.() as string[] | undefined ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const sc of all) { if (!sc) continue; const nv = sc.split(";")[0]; const i = nv.indexOf("="); if (i > 0) this.cookies.set(nv.slice(0, i).trim(), nv.slice(i + 1).trim()); }
  }

  private async req(url: string): Promise<Response> {
    const u = new URL(url);
    const uri = u.pathname + u.search;
    const headers: Record<string, string> = { "User-Agent": this.userAgent, "RETS-Version": this.retsVersion, "Accept": "*/*" };
    if (this.cookies.size > 0) headers["Cookie"] = this.cookieHeader();
    if (this.authScheme === "digest" && this.challenge) { this.nc += 1; headers["Authorization"] = buildDigest("GET", uri, this.user, this.pass, this.challenge, this.nc); }
    else if (this.authScheme === "basic" && this.basicHeader) headers["Authorization"] = this.basicHeader;
    let res = await fetch(url, { method: "GET", headers, redirect: "follow", signal: AbortSignal.timeout(RETS_FETCH_TIMEOUT_MS) });
    if (res.status === 401) {
      const wa = res.headers.get("www-authenticate") ?? "";
      this.absorb(res);
      await res.body?.cancel().catch(() => undefined);
      if (/^\s*digest/i.test(wa)) { this.authScheme = "digest"; this.challenge = parseDigestChallenge(wa); this.nc = 1; headers["Authorization"] = buildDigest("GET", uri, this.user, this.pass, this.challenge, this.nc); }
      else if (/^\s*basic/i.test(wa)) { this.authScheme = "basic"; this.basicHeader = buildBasic(this.user, this.pass); headers["Authorization"] = this.basicHeader; }
      else if (this.authScheme === "digest" && this.challenge) { this.cookies.clear(); delete headers["Cookie"]; this.nc += 1; headers["Authorization"] = buildDigest("GET", uri, this.user, this.pass, this.challenge, this.nc); }
      else throw new Error(`401 with no usable challenge. www-authenticate="${wa}"`);
      if (this.cookies.size > 0) headers["Cookie"] = this.cookieHeader();
      res = await fetch(url, { method: "GET", headers, redirect: "follow", signal: AbortSignal.timeout(RETS_FETCH_TIMEOUT_MS) });
    }
    this.absorb(res);
    return res;
  }

  async login(loginUrl: string): Promise<void> {
    const u = new URL(loginUrl);
    this.loginOrigin = `${u.protocol}//${u.host}`;
    const res = await this.req(loginUrl);
    const text = await res.text();
    if (!res.ok) throw new Error(`Bright login failed (${res.status}): ${text.slice(0, 300)}`);
    const err = readReplyError(text);
    if (err) throw new Error(`Bright login reply: ${err}`);
    const block = text.match(/<RETS-RESPONSE[^>]*>([\s\S]*?)<\/RETS-RESPONSE>/i);
    if (!block) throw new Error("Bright login: no <RETS-RESPONSE> block");
    for (const raw of block[1].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.includes("=")) continue;
      const idx = line.indexOf("=");
      this.capabilities[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (!this.capabilities["Search"]) throw new Error(`Bright login: no Search capability. Got: ${Object.keys(this.capabilities).join(",")}`);
  }

  private async searchPage(query: string, offset: number, wantCount: boolean): Promise<{ rows: RowMap[]; rawCount: number }> {
    const url = new URL(this.absoluteUrl(this.capabilities["Search"]));
    url.searchParams.set("SearchType", BRIGHT_RESOURCE);
    url.searchParams.set("Class", BRIGHT_CLASS);
    url.searchParams.set("Query", query);
    url.searchParams.set("QueryType", "DMQL2");
    url.searchParams.set("Format", "COMPACT-DECODED");
    url.searchParams.set("Count", wantCount ? "1" : "0");
    url.searchParams.set("StandardNames", "0");
    url.searchParams.set("Limit", String(PAGE_LIMIT));
    url.searchParams.set("Offset", String(offset));
    url.searchParams.set("Select", SELECT_FIELDS);
    const res = await this.req(url.toString());
    const text = await res.text();
    const err = readReplyError(text);
    // 20201 = no records found — treat as empty, not an error.
    if (err && !/20201/.test(err)) throw new Error(`Bright search reply: ${err}`);
    return { rows: parseCompact(text), rawCount: readCount(text) };
  }

  async searchAll(query: string): Promise<{ rows: RowMap[]; rawCount: number }> {
    const all: RowMap[] = [];
    let serverTotal = 0;
    let offset = 1;
    let prevFirstKey: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { rows, rawCount } = await this.searchPage(query, offset, page === 0);
      if (page === 0) serverTotal = rawCount;
      if (rows.length === 0) break;
      const firstKey = rows[0]["ListingKey"] ?? JSON.stringify(rows[0]);
      if (prevFirstKey !== null && firstKey === prevFirstKey) break; // server ignoring Offset
      prevFirstKey = firstKey;
      all.push(...rows);
      if (rows.length < PAGE_LIMIT) break;
      if (serverTotal > 0 && all.length >= serverTotal) break;
      offset += rows.length;
    }
    return { rows: all, rawCount: serverTotal || all.length };
  }

  // Fetch all Media (PROP_MEDIA) rows for a batch of ListingKeys.
  async searchMedia(keys: string[]): Promise<RowMap[]> {
    if (keys.length === 0) return [];
    const query = `(ResourceRecordKey=${keys.join(",")})`;
    const all: RowMap[] = [];
    let offset = 1;
    let prevFirstKey: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(this.absoluteUrl(this.capabilities["Search"]));
      url.searchParams.set("SearchType", MEDIA_RESOURCE);
      url.searchParams.set("Class", MEDIA_CLASS);
      url.searchParams.set("Query", query);
      url.searchParams.set("QueryType", "DMQL2");
      url.searchParams.set("Format", "COMPACT-DECODED");
      url.searchParams.set("Count", "0");
      url.searchParams.set("StandardNames", "0");
      url.searchParams.set("Limit", String(PAGE_LIMIT));
      url.searchParams.set("Offset", String(offset));
      url.searchParams.set("Select", MEDIA_SELECT);
      const res = await this.req(url.toString());
      const text = await res.text();
      const err = readReplyError(text);
      if (err && !/20201/.test(err)) throw new Error(`Bright media reply: ${err}`);
      const rows = parseCompact(text);
      if (rows.length === 0) break;
      const firstKey = rows[0]["MediaKey"] ?? JSON.stringify(rows[0]);
      if (prevFirstKey !== null && firstKey === prevFirstKey) break;
      prevFirstKey = firstKey;
      all.push(...rows);
      if (rows.length < PAGE_LIMIT) break;
      offset += rows.length;
    }
    return all;
  }
}

// ------------------------------ parsing helpers ------------------------------

function readReplyError(xml: string): string | null {
  const m = xml.match(/<RETS[^>]*ReplyCode="([^"]*)"[^>]*ReplyText="([^"]*)"/i);
  if (!m) return null;
  if (m[1] === "0") return null;
  return `${m[1]} ${m[2]}`;
}
function readCount(xml: string): number {
  const m = xml.match(/<COUNT[^>]*Records="([^"]*)"/i);
  return m ? Number(m[1]) : 0;
}
// COMPACT tab-delimited. Bright encodes null as "#" in COMPACT-DECODED.
function parseCompact(xml: string): RowMap[] {
  const colM = xml.match(/<COLUMNS>([\s\S]*?)<\/COLUMNS>/i);
  if (!colM) return [];
  const columns = colM[1].split("\t").map((c) => c.trim());
  const rows: RowMap[] = [];
  const re = /<DATA>([\s\S]*?)<\/DATA>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const cells = m[1].split("\t");
    const obj: RowMap = {};
    for (let i = 0; i < columns.length; i++) {
      const key = columns[i];
      if (!key) continue;
      let v = (cells[i] ?? "").trim();
      if (v === "#") v = ""; // Bright null marker
      obj[key] = v;
    }
    rows.push(obj);
  }
  return rows;
}

function s(raw: string | undefined): string | null { const t = (raw ?? "").trim(); return t.length ? t : null; }
function readInt(raw: string | undefined): number | null {
  const t = (raw ?? "").replace(/[,\s]/g, "");
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
function readPrice(raw: string | undefined): number | null {
  const t = (raw ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function readDate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// RESO StandardStatus -> our internal status.
function mapBrightStatus(raw: string | undefined): ListingStatus {
  const v = (raw ?? "").toUpperCase().trim();
  if (!v) return "expired";
  if (v.includes("ACTIVE UNDER CONTRACT") || v === "PENDING" || v.includes("UNDER CONTRACT")) return "pending";
  if (v === "ACTIVE" || v.includes("COMING SOON")) return "active";
  if (v.includes("CLOSED") || v.includes("SOLD")) return "sold";
  if (v.includes("EXPIRED")) return "expired";
  if (v.includes("WITHDRAWN") || v.includes("CANCEL") || v.includes("TEMP") || v.includes("DELETE")) return "withdrawn";
  return "expired";
}

function buildAddress(row: RowMap): string | null {
  const parts = ["StreetNumber", "StreetDirPrefix", "StreetName", "StreetSuffix", "StreetDirSuffix"]
    .map((k) => (row[k] ?? "").trim())
    .filter((p) => p.length > 0);
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined) return joined;
  const city = (row["City"] ?? "").trim();
  return city ? city : null;
}

// Bright media URLs are http; upgrade to https (CDN serves both) so the app's
// https pages don't block them as mixed content.
function httpsUrl(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.replace(/^http:\/\//i, "https://");
}
// Best available resolution: HD (2048) > HiRes (1440) > default.
function bestMediaUrl(row: RowMap): string | null {
  return httpsUrl(row["MediaURLHD"]) ?? httpsUrl(row["MediaURLHiRes"]) ?? httpsUrl(row["MediaURL"]);
}

// ------------------------------ mapping ------------------------------

interface MappedListing {
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  status: ListingStatus;
  listing_date: string | null;
  list_agent_name: string | null;
  list_agent_email: string | null;
  list_agent_phone: string | null;
  list_office_id: string | null;
  list_office_name: string | null;
  property_type: string | null;
  unit_number: string | null;
  dom_days: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  square_feet: number | null;
  public_remarks: string | null;
  close_date: string | null;
  close_price: number | null;
  raw_payload: RowMap;
}

function mapRow(row: RowMap): MappedListing | null {
  const mls = (row["ListingId"] ?? "").trim().toUpperCase();
  if (!mls) return null;
  // Prefer PropertySubType for the human-facing type; fall back to PropertyType.
  const propType = s(row["PropertySubType"]) ?? s(row["PropertyType"]);
  return {
    mls_number: mls,
    address: buildAddress(row),
    city: s(row["City"]),
    state: s(row["StateOrProvince"]) ?? "NJ",
    zip: s(row["PostalCode"]),
    list_price: readPrice(row["ListPrice"]) ?? readPrice(row["OriginalListPrice"]),
    status: mapBrightStatus(row["StandardStatus"] || row["MlsStatus"]),
    listing_date: readDate(row["OnMarketDate"]) ?? readDate(row["ListingContractDate"]),
    list_agent_name: s(row["ListAgentFullName"]),
    list_agent_email: s(row["ListAgentEmail"]),
    list_agent_phone: s(row["ListAgentPreferredPhone"]),
    list_office_id: s(row["ListOfficeMlsId"]),
    list_office_name: s(row["ListOfficeName"]),
    property_type: propType,
    unit_number: s(row["UnitNumber"]),
    dom_days: readInt(row["DaysOnMarket"]),
    bedrooms: readInt(row["BedroomsTotal"]),
    bathrooms_full: readInt(row["BathroomsFull"]),
    bathrooms_half: readInt(row["BathroomsHalf"]),
    square_feet: readInt(row["LivingArea"]),
    public_remarks: s(row["PublicRemarks"]),
    close_date: readDate(row["CloseDate"]),
    close_price: readPrice(row["ClosePrice"]),
    raw_payload: row,
  };
}

// ------------------------------ Supabase ------------------------------

function createAnalyticsClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}
function createListingsClient(): SupabaseClient {
  const url = Deno.env.get("LISTINGS_SUPABASE_URL");
  const key = Deno.env.get("LISTINGS_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing LISTINGS_SUPABASE_URL / LISTINGS_SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadFeed(client: SupabaseClient, shortCode: string): Promise<FeedRow> {
  const { data, error } = await client
    .from("mls_feeds")
    .select("id, short_code, name, rets_url, username, password, rets_version, user_agent, office_filter, is_active")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (error) throw new Error(`mls_feeds lookup failed: ${error.message}`);
  if (!data) throw new Error(`No mls_feeds row for short_code='${shortCode}'`);
  if (!data.is_active) throw new Error(`Feed '${shortCode}' is inactive`);
  if (!data.rets_url || !data.username || !data.password) throw new Error(`Feed '${shortCode}' missing rets_url/username/password`);
  if (!data.office_filter) throw new Error(`Feed '${shortCode}' missing office_filter (Bright requires the office-code allowlist)`);
  return data as FeedRow;
}

async function startSyncRun(client: SupabaseClient, feed: FeedRow, cls: string): Promise<number | null> {
  const { data, error } = await client.from("sync_runs").insert({
    feed_id: feed.id, feed_short_code: feed.short_code, resource: "Property", property_class: cls, status: "running",
  }).select("id").single();
  if (error) { console.error("sync_runs insert failed:", error.message); return null; }
  return data.id as number;
}
async function finishSyncRun(client: SupabaseClient, runId: number | null, patch: {
  status: "success" | "partial" | "error"; records_seen?: number; records_upserted?: number; error_message?: string;
}): Promise<void> {
  if (runId === null) return;
  const { error } = await client.from("sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", runId);
  if (error) console.error("sync_runs update failed:", error.message);
}
async function updateFeedTimestamps(client: SupabaseClient, feedId: string, ok: boolean): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client.from("mls_feeds")
    .update({ last_sync_at: now, last_validated_at: now, last_validated_ok: ok, updated_at: now }).eq("id", feedId);
  if (error) console.error("mls_feeds timestamp update failed:", error.message);
}

async function upsertActiveListings(client: SupabaseClient, rows: MappedListing[], heroByMls: Map<string, string>): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    mls_number: r.mls_number, source_mls: "bright", address: r.address, city: r.city, state: r.state, zip: r.zip,
    list_price: r.list_price, status: r.status, listing_date: r.listing_date,
    list_agent_name: r.list_agent_name, list_agent_email: r.list_agent_email,
    list_office_id: r.list_office_id, list_office_name: r.list_office_name,
    property_type: r.property_type, dom_days: r.dom_days,
    bedrooms: r.bedrooms, bathrooms_full: r.bathrooms_full, bathrooms_half: r.bathrooms_half,
    public_remarks: r.public_remarks, hero_image_url: heroByMls.get(r.mls_number) ?? null,
    close_date: r.close_date, close_price: r.close_price,
    buyer_agent_name: null, buyer_office_name: null, alliance_role: "listing",
    raw_payload: r.raw_payload, synced_at: now, updated_at: now,
  }));
  const { error, count } = await client.from("active_listings").upsert(payload, { onConflict: "mls_number", count: "exact" });
  if (error) throw new Error(`active_listings upsert failed: ${error.message}`);
  return count ?? rows.length;
}

// Map ListOfficeMlsId (e.g. YALL02) -> our offices.id, via offices.bright_office_id.
async function loadOfficeMap(client: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await client.from("offices").select("id, bright_office_id").not("bright_office_id", "is", null);
  if (error) { console.error("offices map load failed:", error.message); return map; }
  for (const o of (data ?? []) as Array<{ id: string; bright_office_id: string }>) {
    map.set(o.bright_office_id.trim().toUpperCase(), o.id);
  }
  return map;
}

async function replicateToProperties(client: SupabaseClient, rows: MappedListing[], officeMap: Map<string, string>, heroByMls: Map<string, string>): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    mls_number: r.mls_number, source_mls: "bright", address: r.address, city: r.city, state: r.state, zip: r.zip,
    list_price: r.list_price, listing_date: r.listing_date,
    agent_name: r.list_agent_name, agent_email: r.list_agent_email, agent_phone: r.list_agent_phone,
    listing_office_name: r.list_office_name, property_type: r.property_type, unit_number: r.unit_number,
    office_id: r.list_office_id ? (officeMap.get(r.list_office_id.trim().toUpperCase()) ?? null) : null,
    dom_days: r.dom_days, bedrooms: r.bedrooms, bathrooms_full: r.bathrooms_full, bathrooms_half: r.bathrooms_half,
    square_feet: r.square_feet, public_remarks: r.public_remarks, hero_image_url: heroByMls.get(r.mls_number) ?? null,
    close_date: r.close_date, close_price: r.close_price, buyer_agent_name: null, buyer_office_name: null,
    alliance_role: "listing", status: r.status === "withdrawn" ? "expired" : r.status, updated_at: now,
  }));
  const { error, count } = await client.from("properties").upsert(payload, { onConflict: "mls_number,source_mls", count: "exact" });
  if (error) throw new Error(`properties upsert failed: ${error.message}`);
  return count ?? rows.length;
}

async function downgradeStale(analytics: SupabaseClient, listings: SupabaseClient, seen: Set<string>): Promise<void> {
  const now = new Date().toISOString();
  for (const [label, client] of [["analytics", analytics], ["listings", listings]] as const) {
    const table = label === "analytics" ? "properties" : "active_listings";
    try {
      const { data, error } = await client.from(table).select("mls_number").eq("source_mls", "bright").eq("status", "active");
      if (error) throw new Error(error.message);
      const stale = ((data ?? []) as Array<{ mls_number: string }>).map((r) => r.mls_number).filter((m) => !seen.has(m));
      if (stale.length > 0) {
        const { error: upErr } = await client.from(table)
          .update({ status: "expired", status_changed_at: now, updated_at: now })
          .eq("source_mls", "bright").eq("status", "active").in("mls_number", stale);
        if (upErr) throw new Error(upErr.message);
      }
      console.log(`[bright] downgraded ${stale.length} stale -> expired (${label})`);
    } catch (e) {
      console.error(`[bright] stale downgrade (${label}):`, (e as Error).message);
    }
  }
}

// ------------------------------ photos (Media resource) ------------------------------

interface PhotoRow {
  mls_number: string; source_mls: string; sequence: number; url: string;
  source: string; storage_path: string | null; caption: string | null; synced_at: string;
}

// Pull all PROP_MEDIA rows for the kept listings, build the hero URL per
// listing + the full ordered photo set. No binary downloads — Media rows carry
// direct (watermarked) CDN URLs. Failures are per-batch and non-fatal.
async function syncMedia(rets: RETSClient, mapped: MappedListing[]): Promise<{
  heroByMls: Map<string, string>; photoRows: PhotoRow[]; listingsWithPhotos: number;
}> {
  const keyToMls = new Map<string, string>();
  for (const m of mapped) {
    const k = (m.raw_payload["ListingKey"] ?? "").trim();
    if (k) keyToMls.set(k, m.mls_number);
  }
  const keys = Array.from(keyToMls.keys());
  const mediaByMls = new Map<string, RowMap[]>();
  for (let i = 0; i < keys.length; i += MEDIA_KEY_BATCH) {
    const batch = keys.slice(i, i + MEDIA_KEY_BATCH);
    let rows: RowMap[] = [];
    try { rows = await rets.searchMedia(batch); } catch (e) { console.error("searchMedia batch:", (e as Error).message); continue; }
    for (const row of rows) {
      const cat = (row["MediaCategory"] ?? "").toLowerCase();
      if (cat && !cat.includes("photo")) continue; // skip documents / virtual tours
      const mls = keyToMls.get((row["ResourceRecordKey"] ?? "").trim());
      if (!mls) continue;
      if (!bestMediaUrl(row)) continue;
      let arr = mediaByMls.get(mls);
      if (!arr) { arr = []; mediaByMls.set(mls, arr); }
      arr.push(row);
    }
  }

  const now = new Date().toISOString();
  const heroByMls = new Map<string, string>();
  const photoRows: PhotoRow[] = [];
  for (const [mls, rows] of mediaByMls) {
    rows.sort((a, b) => (readInt(a["MediaDisplayOrder"]) ?? 9999) - (readInt(b["MediaDisplayOrder"]) ?? 9999));
    let seq = 0;
    for (const row of rows) {
      const url = bestMediaUrl(row);
      if (!url) continue;
      seq += 1; // sequential + contiguous so (mls_number, sequence) is always unique
      photoRows.push({ mls_number: mls, source_mls: "bright", sequence: seq, url, source: "bright", storage_path: null, caption: s(row["MediaShortDescription"]), synced_at: now });
    }
    const preferred = rows.find((r) => (r["PreferredPhotoYN"] ?? "").toUpperCase() === "Y") ?? rows[0];
    const heroUrl = preferred ? bestMediaUrl(preferred) : null;
    if (heroUrl) heroByMls.set(mls, heroUrl);
  }
  return { heroByMls, photoRows, listingsWithPhotos: mediaByMls.size };
}

async function upsertListingPhotos(analytics: SupabaseClient, photoRows: PhotoRow[]): Promise<number> {
  if (photoRows.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < photoRows.length; i += 500) {
    const chunk = photoRows.slice(i, i + 500);
    const { error } = await analytics.from("listing_photos").upsert(chunk, { onConflict: "mls_number,sequence" });
    if (error) console.error("listing_photos upsert:", error.message);
    else total += chunk.length;
  }
  return total;
}

// ------------------------------ orchestration ------------------------------

interface SyncResult {
  ok: boolean; feed_short_code: string; feed_name: string; duration_ms: number;
  records_seen: number; records_upserted: number; kept: number;
  photos_synced: number; listings_with_hero: number; errors: string[];
}

async function syncFeed(shortCode: string): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = { ok: false, feed_short_code: shortCode, feed_name: shortCode, duration_ms: 0, records_seen: 0, records_upserted: 0, kept: 0, photos_synced: 0, listings_with_hero: 0, errors: [] };

  const analytics = createAnalyticsClient();
  let listings: SupabaseClient;
  try { listings = createListingsClient(); } catch (e) { result.errors.push((e as Error).message); result.duration_ms = Date.now() - start; return result; }

  let feed: FeedRow;
  try { feed = await loadFeed(analytics, shortCode); } catch (e) { result.errors.push((e as Error).message); result.duration_ms = Date.now() - start; return result; }
  result.feed_name = feed.name;

  const runId = await startSyncRun(analytics, feed, BRIGHT_CLASS);
  const rets = new RETSClient(feed.username, feed.password, feed.user_agent ?? DEFAULT_UA, feed.rets_version ?? DEFAULT_VERSION);

  try {
    await rets.login(feed.rets_url);
  } catch (e) {
    result.errors.push(`login: ${(e as Error).message}`);
    await finishSyncRun(analytics, runId, { status: "error", error_message: (e as Error).message });
    await updateFeedTimestamps(analytics, feed.id, false);
    result.duration_ms = Date.now() - start;
    return result;
  }

  const codes = feed.office_filter!.split(",").map((c) => c.trim()).filter(Boolean).join(",");
  const query = `(ListOfficeMlsId=${codes})`;

  let raw: { rows: RowMap[]; rawCount: number };
  try {
    raw = await rets.searchAll(query);
  } catch (e) {
    result.errors.push(`search: ${(e as Error).message}`);
    await finishSyncRun(analytics, runId, { status: "error", error_message: (e as Error).message });
    await updateFeedTimestamps(analytics, feed.id, false);
    result.duration_ms = Date.now() - start;
    return result;
  }
  result.records_seen = raw.rows.length;

  // Map + client-side status filter (StandardStatus is a lookup, not DMQL-filterable).
  const recentSoldCutoff = Date.now() - RECENT_SOLD_DAYS * 86400_000;
  function passesFilter(r: MappedListing | null): r is MappedListing {
    if (r === null) return false;
    if (r.status === "active" || r.status === "pending") return true;
    if (r.status === "sold") {
      if (!r.close_date) return true;
      const closeMs = new Date(`${r.close_date}T00:00:00Z`).getTime();
      return Number.isFinite(closeMs) && closeMs >= recentSoldCutoff;
    }
    return false; // expired, withdrawn
  }

  const byMls = new Map<string, MappedListing>();
  for (const row of raw.rows) {
    const m = mapRow(row);
    if (passesFilter(m)) byMls.set(m.mls_number, m);
  }
  const mapped = Array.from(byMls.values());
  result.kept = mapped.length;
  const seen = new Set(mapped.map((m) => m.mls_number));

  const officeMap = await loadOfficeMap(analytics);

  // Photos from the Media resource. Non-fatal: a media failure must not fail
  // the listing sync, so its errors are logged, not pushed onto result.errors.
  let media: { heroByMls: Map<string, string>; photoRows: PhotoRow[]; listingsWithPhotos: number } =
    { heroByMls: new Map(), photoRows: [], listingsWithPhotos: 0 };
  try { media = await syncMedia(rets, mapped); } catch (e) { console.error("syncMedia:", (e as Error).message); }

  let upserted = 0;
  try {
    upserted = await replicateToProperties(analytics, mapped, officeMap, media.heroByMls);
    await upsertActiveListings(listings, mapped, media.heroByMls);
  } catch (e) {
    result.errors.push(`upsert: ${(e as Error).message}`);
    await finishSyncRun(analytics, runId, { status: "error", records_seen: raw.rows.length, error_message: (e as Error).message });
    await updateFeedTimestamps(analytics, feed.id, false);
    result.duration_ms = Date.now() - start;
    return result;
  }
  result.records_upserted = upserted;

  // Photo rows into listing_photos (Post Builder picker). Non-fatal.
  try { result.photos_synced = await upsertListingPhotos(analytics, media.photoRows); }
  catch (e) { console.error("upsertListingPhotos:", (e as Error).message); }
  result.listings_with_hero = media.heroByMls.size;

  // Stale downgrade only after a clean pull (non-empty), mirroring the Paragon safety.
  if (seen.size > 0) {
    await downgradeStale(analytics, listings, seen);
  }

  // Post-sync RPCs (idempotent). Failures are logged, not fatal.
  for (const rpc of ["run_auto_linker", "link_property_offices", "ensure_owner_story_tokens"]) {
    try { await analytics.rpc(rpc); } catch (e) { console.error(`${rpc}:`, (e as Error).message); }
  }

  result.ok = result.errors.length === 0;
  await finishSyncRun(analytics, runId, { status: result.ok ? "success" : "partial", records_seen: raw.rows.length, records_upserted: upserted });
  await updateFeedTimestamps(analytics, feed.id, result.ok);
  result.duration_ms = Date.now() - start;
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  let body: { feed_short_code?: string };
  try { body = await req.json(); } catch { body = {}; }
  const shortCode = (body.feed_short_code ?? "bright").trim() || "bright";
  const result = await syncFeed(shortCode);
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" }, status: result.ok ? 200 : 500 });
});
