/**
 * MLS RETS sync Edge Function (Phase 5).
 *
 * Pulls active listings from a Paragon RETS feed (CMC or SJSR), filters to
 * Century 21 Alliance offices, and upserts them into the SEPARATE "Alliance
 * Listings" Supabase project (umziekblnbobkezbbupg).
 *
 * Key points (distilled from AllianceDash's working RETS code, 2026-05-09):
 *   - CMC and SJSR Paragon installations expose IDENTICAL field codes.
 *   - DMQL2 query: (L_StatusCategory=A),(LO1_OrganizationName=*Alliance*)
 *   - Property classes worth syncing for v1: RE_1, MF_4, LD_2.
 *   - Bright MLS uses RESO Web API and is NOT handled here.
 *
 * Auth: HTTP Digest (RFC 2617). Single-file inlined client below.
 *
 * Required Supabase Edge Function secrets:
 *   - SUPABASE_URL                          (this project, auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY             (this project, auto-injected)
 *   - LISTINGS_SUPABASE_URL                 (Alliance Listings project URL)
 *   - LISTINGS_SUPABASE_SERVICE_ROLE_KEY    (Alliance Listings service role)
 *
 * Invocation: POST { feed_short_code: "cmc" | "sjsr" }. With verify_jwt=true,
 * the Next.js server action authenticates via the user session.
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
// @ts-expect-error - Deno-resolved import
import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Paragon property classes to sync. RE_1 = residential, MF_4 = multi-family, LD_2 = land. */
const PROPERTY_CLASSES = ["RE_1", "MF_4", "LD_2"] as const;

// Paragon (CMC + SJSR):
//   - L_Status is a calculated field that 20206's regardless of `=A` or `=|A`
//     query syntax. Filtering it out and doing the active-status check in
//     application code (mapStatusCategory) avoids the parser entirely.
//   - LO1_OrganizationName needs the FULL "Century 21 Alliance" prefix —
//     a bare `*Alliance*` also matches "Vanguard Realty Alliance" and
//     "Home Alliance Realty" which are NOT C21.
const DMQL2_QUERY = "(LO1_OrganizationName=*Century 21 Alliance*)";

const RETS_USER_AGENT = "AllianceAnalytics/1.0";
const RETS_VERSION = "RETS/1.8";
const SEARCH_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Digest auth helpers
// ---------------------------------------------------------------------------

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
  // Strip leading "Digest " (case-insensitive)
  const body = header.replace(/^\s*Digest\s+/i, "");
  const out: Record<string, string> = {};
  // Tokenizer that respects quoted strings.
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

/**
 * RFC 7617 Basic auth header. Used by modern Paragon deployments (CAPEMAY,
 * SJSR) which return `WWW-Authenticate: Basic realm="…"` instead of Digest.
 *
 * `btoa()` is available on Deno's edge runtime (also on Node ≥ 16) so no
 * `Buffer` import is required.
 */
function buildBasicAuthHeader(user: string, pass: string): string {
  const token = btoa(`${user}:${pass}`);
  return `Basic ${token}`;
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

// ---------------------------------------------------------------------------
// RETS client (minimal)
// ---------------------------------------------------------------------------

type AuthScheme = "digest" | "basic";

class RETSClient {
  private cookie: string | null = null;
  private capabilities: Record<string, string> = {};
  private nc = 0;
  private challenge: DigestChallenge | null = null;
  private authScheme: AuthScheme | null = null;
  private basicHeader: string | null = null;
  private loginOrigin: string | null = null;

  constructor(
    private readonly user: string,
    private readonly pass: string,
  ) {}

  private absoluteUrl(rel: string): string {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (!this.loginOrigin) return rel;
    if (rel.startsWith("/")) return `${this.loginOrigin}${rel}`;
    return `${this.loginOrigin}/${rel}`;
  }

  /**
   * Make a request, handling auth challenge/response and RETS-Session cookie.
   *
   * Both Paragon variants are supported:
   *   - Digest (older deployments) — RFC 2617 challenge-response flow.
   *   - Basic  (modern Paragon)    — single base64(user:pass) header.
   *
   * The first response's WWW-Authenticate header decides which scheme this
   * client locks onto for the rest of its lifetime.
   */
  private async requestAuthenticated(url: string): Promise<Response> {
    const u = new URL(url);
    const uri = u.pathname + u.search;
    const headers: Record<string, string> = {
      "User-Agent": RETS_USER_AGENT,
      "RETS-Version": RETS_VERSION,
      "Accept": "*/*",
    };
    if (this.cookie) headers["Cookie"] = this.cookie;

    // If we already know the scheme + creds, pre-authenticate.
    if (this.authScheme === "digest" && this.challenge) {
      this.nc += 1;
      headers["Authorization"] = buildDigestAuthHeader(
        "GET",
        uri,
        this.user,
        this.pass,
        this.challenge,
        this.nc,
      );
    } else if (this.authScheme === "basic" && this.basicHeader) {
      headers["Authorization"] = this.basicHeader;
    }

    let res = await fetch(url, { method: "GET", headers });
    if (res.status === 401) {
      const wa = res.headers.get("www-authenticate") ?? "";
      // Drain body before retry
      await res.body?.cancel().catch(() => undefined);

      if (/^\s*digest/i.test(wa)) {
        this.authScheme = "digest";
        this.challenge = parseDigestChallenge(wa);
        this.nc = 1;
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];

        headers["Authorization"] = buildDigestAuthHeader(
          "GET",
          uri,
          this.user,
          this.pass,
          this.challenge,
          this.nc,
        );
      } else if (/^\s*basic/i.test(wa)) {
        this.authScheme = "basic";
        this.basicHeader = buildBasicAuthHeader(this.user, this.pass);
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];

        headers["Authorization"] = this.basicHeader;
      } else {
        throw new Error(
          `Expected Digest or Basic challenge, got: ${wa || "none"}`,
        );
      }
      if (this.cookie) headers["Cookie"] = this.cookie;
      res = await fetch(url, { method: "GET", headers });
    }
    // After a successful response, pick up any session cookie issued.
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
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
    if (!block) {
      throw new Error("RETS login: no <RETS-RESPONSE> block");
    }
    for (const raw of block[1].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      this.capabilities[key] = val;
    }
    if (!this.capabilities["Search"]) {
      throw new Error(
        `RETS login: no Search capability URL. Got: ${Object.keys(this.capabilities).join(",")}`,
      );
    }
  }

  async search(
    resource: string,
    cls: string,
    query: string,
  ): Promise<{ rows: RowMap[]; rawCount: number }> {
    const baseUrl = this.absoluteUrl(this.capabilities["Search"]);
    const params = new URLSearchParams({
      SearchType: resource,
      Class: cls,
      Query: query,
      QueryType: "DMQL2",
      Format: "COMPACT-DECODED",
      Count: "1",
      StandardNames: "0",
      Limit: String(SEARCH_LIMIT),
    });
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}${params.toString()}`;
    const res = await this.requestAuthenticated(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `RETS search failed (${res.status}) for ${resource}/${cls}: ${body.slice(0, 300)}`,
      );
    }
    const text = await res.text();
    const replyErr = readReplyError(text);
    if (replyErr) {
      // 20201 = "No records found" — treat as zero rows, not an error.
      if (replyErr.startsWith("20201")) return { rows: [], rawCount: 0 };
      throw new Error(`RETS search reply: ${replyErr}`);
    }
    const delimMatch = text.match(/<DELIMITER\s+value="(\d+)"\s*\/?>/i);
    const delim = delimMatch
      ? String.fromCharCode(parseInt(delimMatch[1], 10))
      : "\t";
    const colMatch = text.match(/<COLUMNS>([\s\S]*?)<\/COLUMNS>/i);
    if (!colMatch) return { rows: [], rawCount: 0 };
    // Strip a leading delimiter if present (some Paragon impls prefix it).
    const cols = colMatch[1]
      .split(delim)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const rows: RowMap[] = [];
    const dataRe = /<DATA>([\s\S]*?)<\/DATA>/gi;
    let m: RegExpExecArray | null;
    while ((m = dataRe.exec(text)) !== null) {
      const cells = m[1].split(delim);
      // Skip the leading-delimiter empty first cell if present.
      const startIdx = cells[0] === "" ? 1 : 0;
      const obj: RowMap = {};
      for (let i = 0; i < cols.length; i++) {
        obj[cols[i]] = (cells[startIdx + i] ?? "").trim();
      }
      rows.push(obj);
    }
    const cntMatch = text.match(/<COUNT\s+Records="(\d+)"\s*\/?>/i);
    const rawCount = cntMatch ? parseInt(cntMatch[1], 10) : rows.length;
    return { rows, rawCount };
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

function readReplyError(xml: string): string | null {
  const m = xml.match(/<RETS\s+ReplyCode="(\d+)"\s+ReplyText="([^"]*)"/i);
  if (!m) return null;
  if (m[1] === "0") return null;
  return `${m[1]} ${m[2]}`;
}

// ---------------------------------------------------------------------------
// Paragon row → active_listings mapping
// ---------------------------------------------------------------------------

type ListingStatus =
  | "active"
  | "pending"
  | "sold"
  | "expired"
  | "withdrawn";

/**
 * Paragon returns L_Status as a full English label, NOT a one-letter code:
 *   CMC: "ACTIVE", "UNDER CONTRACT", "SOLD COOP BY MEMBER", "SOLD IN-HOUSE", ...
 *   SJSR: "Sold CO OP by Member", "Sold-In House", "Active", ...
 * Mapping is keyword-based so both case styles + future variants land correctly.
 * Unknown values map to "expired" (filtered out downstream) so we never silently
 * import garbage as active.
 */
function mapStatusCategory(cat: string | undefined): ListingStatus {
  const s = (cat ?? "").toUpperCase().trim();
  if (!s) return "expired";
  // Single-letter compatibility (older Paragon servers)
  if (s === "A" || s === "ACTIVE") return "active";
  if (s === "P" || s.startsWith("UNDER CONTRACT") || s.startsWith("PENDING"))
    return "pending";
  if (s === "S" || s.startsWith("SOLD") || s.startsWith("CLOSED"))
    return "sold";
  if (s === "X" || s.startsWith("EXPIRED")) return "expired";
  if (s === "W" || s.startsWith("WITHDRAWN") || s.startsWith("CANCELED"))
    return "withdrawn";
  return "expired";
}

function readPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function readDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // Paragon returns ISO-ish dates; trim time if any.
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept "2026-05-08", "2026-05-08T00:00:00", "5/8/2026", etc.
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
  hero_image_url: string | null;
  raw_payload: Record<string, unknown>;
}

function readInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Only return an int if the source string is purely numeric (e.g. "3", "12").
 * Paragon's L_KeywordN slots reuse the same column for very different fields
 * across CMC and SJSR — and on non-residential rows (Vacant Lot, Duplex) hold
 * lot-size text like "1 to 6000 SqFt". This guard keeps junk out of bedroom
 * / bathroom counts.
 */
function readPositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return n;
}

/**
 * Paragon's L_Keyword slot mapping is shifted by one between feeds:
 *   - CMC:  K1=bedrooms,    K2=full baths, K3=half baths
 *   - SJSR: K1=total rooms, K2=bedrooms,   K3=full baths, K4=half baths
 * Verified by cross-referencing 236 Roseann Ave (in both feeds, both 4BR/2BA).
 */
function mapBedsBaths(
  row: RowMap,
  sourceMls: "cmc" | "sjsr",
): { bedrooms: number | null; bathrooms_full: number | null; bathrooms_half: number | null } {
  if (sourceMls === "cmc") {
    return {
      bedrooms: readPositiveInt(row["L_Keyword1"]),
      bathrooms_full: readPositiveInt(row["L_Keyword2"]),
      bathrooms_half: readPositiveInt(row["L_Keyword3"]),
    };
  }
  // sjsr
  return {
    bedrooms: readPositiveInt(row["L_Keyword2"]),
    bathrooms_full: readPositiveInt(row["L_Keyword3"]),
    bathrooms_half: readPositiveInt(row["L_Keyword4"]),
  };
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
    state: "NJ", // Both Paragon feeds we run are NJ-only.
    zip: (row["L_Zip"] ?? "").trim() || null,
    list_price: readPrice(row["L_AskingPrice"]) ?? readPrice(row["L_OriginalPrice"]),
    status: mapStatusCategory(row["L_Status"]),
    listing_date: readDate(row["L_ListingDate"]),
    list_agent_name: buildAgentName(row),
    list_agent_email: null, // Not denormalized on Paragon Property resource.
    list_office_id: (row["LO1_HiddenOrgID"] ?? row["L_ListOffice1"] ?? "").trim() || null,
    list_office_name: (row["LO1_OrganizationName"] ?? "").trim() || null,
    // L_Type_ has a trailing underscore in Paragon — known quirk.
    property_type: (row["L_Type_"] ?? "").trim() || null,
    dom_days: readInt(row["L_DOM"]),
    bedrooms: beds.bedrooms,
    bathrooms_full: beds.bathrooms_full,
    bathrooms_half: beds.bathrooms_half,
    hero_image_url: null, // Phase D will fetch via GetObject.
    raw_payload: row,
  };
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function createAnalyticsClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function createListingsClient(): SupabaseClient {
  const url = Deno.env.get("LISTINGS_SUPABASE_URL");
  const key = Deno.env.get("LISTINGS_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Missing LISTINGS_SUPABASE_URL / LISTINGS_SUPABASE_SERVICE_ROLE_KEY " +
        "secrets on the Edge Function. Set via `supabase secrets set` or the " +
        "Supabase dashboard → Edge Functions → Secrets.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadFeed(
  client: SupabaseClient,
  shortCode: string,
): Promise<FeedRow> {
  const { data, error } = await client
    .from("mls_feeds")
    .select(
      "id, short_code, name, rets_url, username, password, rets_version, is_active",
    )
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

async function startSyncRun(
  client: SupabaseClient,
  feed: FeedRow,
  cls: string,
): Promise<number> {
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
    .update({
      finished_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", runId);
  if (error) console.error("sync_runs update failed:", error.message);
}

async function upsertListings(
  client: SupabaseClient,
  rows: MappedListing[],
): Promise<number> {
  if (rows.length === 0) return 0;
  // active_listings on the Listings DB has its own column shape — keep
  // raw_payload + the canonical denormalized fields. dom_days /
  // list_office_name / property_type are also persisted there for parity
  // with AllianceAnalytics.properties.
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
    hero_image_url: r.hero_image_url,
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

async function replicateToProperties(
  client: SupabaseClient,
  rows: MappedListing[],
): Promise<void> {
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
    hero_image_url: r.hero_image_url,
    status: r.status === "withdrawn" ? "expired" : r.status,
    source_mls: r.source_mls,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client
    .from("properties")
    .upsert(propertyRows, { onConflict: "mls_number" });
  if (error) {
    console.error("properties replication failed:", error.message);
  }
}

async function updateFeedTimestamps(
  client: SupabaseClient,
  feedId: string,
  ok: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_sync_at: now,
    last_validated_at: now,
    last_validated_ok: ok,
    updated_at: now,
  };
  const { error } = await client
    .from("mls_feeds")
    .update(patch)
    .eq("id", feedId);
  if (error) console.error("mls_feeds update failed:", error.message);
}

// ---------------------------------------------------------------------------
// Main sync entry
// ---------------------------------------------------------------------------

async function syncFeed(shortCode: string): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    ok: false,
    feed_short_code: shortCode,
    feed_name: shortCode,
    duration_ms: 0,
    classes: [],
    errors: [],
  };

  if (shortCode !== "cmc" && shortCode !== "sjsr") {
    result.errors.push(
      `mls-rets-sync only supports CMC + SJSR. Got: ${shortCode}`,
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

  // Paragon's session/cookie state goes stale after the first large search,
  // so we use a fresh RETSClient (i.e. fresh login) per property class.
  // Single-shot smoke test: validate creds before the loop so a bad password
  // surfaces clearly, not as N identical 401 errors.
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

  for (const cls of PROPERTY_CLASSES) {
    const runId = await startSyncRun(analytics, feed, cls).catch((e) => {
      result.errors.push(`sync_runs start ${cls}: ${(e as Error).message}`);
      return null;
    });

    const classResult: ClassResult = {
      class: cls,
      records_seen: 0,
      records_upserted: 0,
    };

    // Fresh login per class to dodge Paragon's session-after-search quirk.
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
      const { rows, rawCount } = await rets.search(
        "Property",
        cls,
        DMQL2_QUERY,
      );
      classResult.records_seen = rawCount;
      totalSeen += rawCount;

      // Active-only — Paragon returns sold/pending/withdrawn rows too;
      // mapStatusCategory normalizes the verbose labels and we drop
      // anything that isn't currently active.
      const mapped = rows
        .map((r) => mapRow(r, sourceMls))
        .filter(
          (r): r is MappedListing => r !== null && r.status === "active",
        );

      const upserted = await upsertListings(listings, mapped);
      classResult.records_upserted = upserted;
      totalUpserted += upserted;

      // Best-effort cross-project replication into AllianceAnalytics.properties
      // so the auto-linker has rows to attach posts to. Errors are logged.
      await replicateToProperties(analytics, mapped);

      if (runId !== null) {
        await finishSyncRun(analytics, runId, {
          status: "success",
          records_seen: rawCount,
          records_upserted: upserted,
        });
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

  // Run the auto-linker once after all classes complete so any unlinked posts
  // mentioning these MLS numbers / addresses get attached.
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

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

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
    return new Response(
      JSON.stringify({ error: "Missing feed_short_code in body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const result = await syncFeed(shortCode);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
