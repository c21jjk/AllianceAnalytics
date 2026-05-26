/**
 * ListTrac portal-traffic ingestion Edge Function.
 *
 * Pulls per-listing / per-portal / per-day metrics from ListTrac's
 * `getmetricsbyorganization` endpoint, normalizes them, and upserts into
 * `public.listing_portal_metrics`.
 *
 * Scope of each sync run:
 *   - All active + pending listings
 *   - Sold listings closed within the last 90 days (so wrap-up reports
 *     keep flowing for a window after close)
 *
 * Date window: env LISTTRAC_LOOKBACK_DAYS (default 30). Late-arriving
 * portal counts get caught by overlapping windows.
 *
 * Auth flow (per ListTrac v1.0 API spec, validated 2026-05-26):
 *   1. GET /api/getkey?orgID=&username= → returns a short-lived key (~seconds)
 *   2. token = MD5(password + key) as lowercase 32-char hex
 *   3. POST body must follow the key fetch IMMEDIATELY or it returns expired
 *
 * Per-call concurrency is capped at 8 to stay under whatever rate limit
 * ListTrac applies (not documented in the spec).
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import; runs in the Edge Function runtime
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
// @ts-expect-error - Deno-resolved import for MD5 (Web Crypto subtle.digest doesn't support MD5)
import { crypto as stdCrypto } from "jsr:@std/crypto@1/crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LISTTRAC_BASE = "https://b2b.listtrac.com/api";
const LOOKBACK_DAYS = Number(Deno.env.get("LISTTRAC_LOOKBACK_DAYS") ?? "30");
const CONCURRENCY = Number(Deno.env.get("LISTTRAC_CONCURRENCY") ?? "8");
const SOLD_LOOKBACK_DAYS = 90;

// ----------------------------- Types -----------------------------

interface ListtracCreds {
  org_id: string;
  username: string;
  password: string;
}

interface ListingRow {
  mls_number: string;
  source_mls: "cmc" | "sjsr";
  status: string;
}

interface ListtracDetail {
  listingid?: string;
  additionalListingid?: string;
  counts?: Array<{ key: string; value: string }>;
}

interface ListtracDateBucket {
  date: string;
  details?: ListtracDetail[];
}

interface ListtracSite {
  sitename: string;
  sitetype: string;
  dates?: ListtracDateBucket[];
}

interface ListtracResponse {
  response: {
    returncode: number | string;
    message: string;
    metrics?: { sites?: ListtracSite[] | null } | null;
  };
}

interface PerListingResult {
  mls_number: string;
  source_mls: string;
  ok: boolean;
  rows_written: number;
  sites_seen: number;
  views: number;
  message?: string;
}

interface SyncResult {
  ok: boolean;
  listings_checked: number;
  listings_with_data: number;
  rows_written: number;
  total_views: number;
  errors: { mls_number?: string; message: string }[];
  duration_ms: number;
}

// --------------------------- Utilities ---------------------------

function ymd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isoDateFromYmd(ymdStr: string): string {
  // "20260524" -> "2026-05-24"
  return `${ymdStr.slice(0, 4)}-${ymdStr.slice(4, 6)}-${ymdStr.slice(6, 8)}`;
}

/**
 * MD5 via @std/crypto. Web Crypto subtle.digest does NOT support MD5
 * natively (only SHA-1/256/384/512). Returns lowercase 32-char hex.
 */
async function md5Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await stdCrypto.subtle.digest("MD5", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchToken(creds: ListtracCreds): Promise<string> {
  const url = `${LISTTRAC_BASE}/getkey?orgID=${encodeURIComponent(creds.org_id)}&username=${encodeURIComponent(creds.username)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getkey HTTP ${res.status}`);
  const body = await res.json() as { key?: string; message?: string; returncode?: number };
  if (!body.key || body.returncode !== 0) {
    throw new Error(`getkey failed: ${body.message ?? "unknown"}`);
  }
  return await md5Hex(creds.password + body.key);
}

async function callMetrics(
  creds: ListtracCreds,
  mlsNumber: string,
  start: string,
  end: string,
): Promise<ListtracResponse> {
  // Fetch token immediately before the POST — key expires within seconds.
  const token = await fetchToken(creds);
  const body = JSON.stringify({
    request: {
      token,
      viewtype: "listing",
      viewtypeID: mlsNumber,
      metric: "view,inquiry,share,favorite,gallery,vtour",
      details: "true",
      startdate: start,
      enddate: end,
    },
  });
  const res = await fetch(`${LISTTRAC_BASE}/GetMetricsByOrganization`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return await res.json() as ListtracResponse;
}

// --------------------------- DB helpers ---------------------------

function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function loadListtracCredentials(client: SupabaseClient): Promise<ListtracCreds> {
  const { data, error } = await client
    .from("api_credentials")
    .select("credentials, is_active")
    .eq("platform", "listtrac")
    .maybeSingle();
  if (error) throw new Error(`api_credentials read failed: ${error.message}`);
  if (!data) throw new Error("No api_credentials row for platform=listtrac");
  if (!data.is_active) throw new Error("api_credentials for listtrac is not active");
  const c = (data.credentials ?? {}) as Record<string, unknown>;
  for (const k of ["org_id", "username", "password"]) {
    if (!c[k] || typeof c[k] !== "string") {
      throw new Error(`api_credentials for listtrac missing field: ${k}`);
    }
  }
  return {
    org_id: c.org_id as string,
    username: c.username as string,
    password: c.password as string,
  };
}

async function loadListingsToSync(client: SupabaseClient): Promise<ListingRow[]> {
  // Active + pending always, plus sold listings closed within 90 days.
  const soldCutoff = new Date();
  soldCutoff.setUTCDate(soldCutoff.getUTCDate() - SOLD_LOOKBACK_DAYS);
  const cutoffIso = soldCutoff.toISOString().slice(0, 10);

  // Two queries unioned in TS land — simpler than building a complex .or() filter.
  const { data: activePending, error: e1 } = await client
    .from("properties")
    .select("mls_number, source_mls, status")
    .in("status", ["active", "pending"]);
  if (e1) throw new Error(`properties (active/pending) read failed: ${e1.message}`);

  const { data: recentSold, error: e2 } = await client
    .from("properties")
    .select("mls_number, source_mls, status")
    .eq("status", "sold")
    .gte("close_date", cutoffIso);
  if (e2) throw new Error(`properties (sold) read failed: ${e2.message}`);

  return [...(activePending ?? []), ...(recentSold ?? [])] as ListingRow[];
}

// --------------------------- Per-listing logic ---------------------------

async function syncOneListing(
  client: SupabaseClient,
  creds: ListtracCreds,
  listing: ListingRow,
  startYmd: string,
  endYmd: string,
): Promise<PerListingResult> {
  const result: PerListingResult = {
    mls_number: listing.mls_number,
    source_mls: listing.source_mls,
    ok: false,
    rows_written: 0,
    sites_seen: 0,
    views: 0,
  };

  let resp: ListtracResponse;
  try {
    resp = await callMetrics(creds, listing.mls_number, startYmd, endYmd);
  } catch (e) {
    result.message = (e as Error).message;
    return result;
  }

  const rr = resp.response;
  // returncode 98 = "no stats available" — valid empty response, not an error
  if (rr.returncode !== 0 && rr.returncode !== "0" && rr.returncode !== 98 && rr.returncode !== "98") {
    result.message = `returncode=${rr.returncode} ${rr.message ?? ""}`.trim();
    return result;
  }

  const sites = rr.metrics?.sites ?? [];
  result.sites_seen = sites.length;
  result.ok = true;

  // Pivot the API response into rows keyed by (portal, date). One site can
  // contribute multiple metric kinds for the same day; we sum them per key
  // before inserting.
  const rowsByKey = new Map<string, {
    portal_name: string;
    portal_type: string | null;
    metric_date: string;
    views: number;
    inquiries: number;
    shares: number;
    favorites: number;
    gallery_opens: number;
    vtour_opens: number;
  }>();

  for (const site of sites) {
    const portal_name = site.sitename ?? "";
    if (!portal_name) continue;
    const portal_type = site.sitetype ?? null;
    for (const day of site.dates ?? []) {
      const metric_date = isoDateFromYmd(day.date);
      const key = `${portal_name}|${metric_date}`;
      let row = rowsByKey.get(key);
      if (!row) {
        row = {
          portal_name,
          portal_type,
          metric_date,
          views: 0,
          inquiries: 0,
          shares: 0,
          favorites: 0,
          gallery_opens: 0,
          vtour_opens: 0,
        };
        rowsByKey.set(key, row);
      }
      for (const det of day.details ?? []) {
        for (const c of det.counts ?? []) {
          const v = Number(c.value ?? 0);
          if (!Number.isFinite(v) || v === 0) continue;
          switch (c.key) {
            case "views":
            case "view":
              row.views += v;
              result.views += v;
              break;
            case "inquiries":
            case "inquiry":
              row.inquiries += v;
              break;
            case "shares":
            case "share":
              row.shares += v;
              break;
            case "favorites":
            case "favorite":
              row.favorites += v;
              break;
            case "gallery":
              row.gallery_opens += v;
              break;
            case "vtour":
              row.vtour_opens += v;
              break;
          }
        }
      }
    }
  }

  if (rowsByKey.size === 0) {
    return result;
  }

  const rows = Array.from(rowsByKey.values()).map((r) => ({
    mls_number: listing.mls_number,
    source_mls: listing.source_mls,
    portal_name: r.portal_name,
    portal_type: r.portal_type,
    metric_date: r.metric_date,
    views: r.views,
    inquiries: r.inquiries,
    shares: r.shares,
    favorites: r.favorites,
    gallery_opens: r.gallery_opens,
    vtour_opens: r.vtour_opens,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await client
    .from("listing_portal_metrics")
    .upsert(rows, { onConflict: "mls_number,source_mls,portal_name,metric_date" });

  if (error) {
    result.ok = false;
    result.message = `upsert failed: ${error.message}`;
    return result;
  }

  result.rows_written = rows.length;
  return result;
}

// --------------------------- Orchestration ---------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function consume(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

async function syncListtrac(lookbackDays: number = LOOKBACK_DAYS): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    ok: false,
    listings_checked: 0,
    listings_with_data: 0,
    rows_written: 0,
    total_views: 0,
    errors: [],
    duration_ms: 0,
  };

  const client = createServiceClient();

  try {
    const creds = await loadListtracCredentials(client);

    // Date window: lookback + 1 day on either side for safety.
    const end = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);
    const startYmd = ymd(startDate);
    const endYmd = ymd(end);

    const listings = await loadListingsToSync(client);
    result.listings_checked = listings.length;

    const perListing = await runWithConcurrency(
      listings,
      CONCURRENCY,
      (l) => syncOneListing(client, creds, l, startYmd, endYmd),
    );

    for (const r of perListing) {
      if (!r.ok) {
        result.errors.push({
          mls_number: r.mls_number,
          message: r.message ?? "unknown",
        });
        continue;
      }
      if (r.sites_seen > 0 || r.views > 0) result.listings_with_data++;
      result.rows_written += r.rows_written;
      result.total_views += r.views;
    }

    result.ok = result.errors.length < listings.length;
  } catch (e) {
    result.ok = false;
    result.errors.push({ message: (e as Error).message });
  }

  // Touch last_validated_at on success so the Settings UI shows a fresh tick.
  if (result.ok) {
    await client
      .from("api_credentials")
      .update({ last_validated_at: new Date().toISOString() })
      .eq("platform", "listtrac");
  }

  // System-level notification mirroring the social syncs' shape.
  try {
    await client.from("notifications").insert({
      user_id: null,
      type: result.ok ? "sync_success" : "sync_failure",
      title: `ListTrac sync ${result.ok ? "succeeded" : "failed"}`,
      message: JSON.stringify({
        listings_checked: result.listings_checked,
        listings_with_data: result.listings_with_data,
        rows_written: result.rows_written,
        total_views: result.total_views,
        errors: result.errors.slice(0, 5),
      }).slice(0, 500),
      metadata: {
        listings_checked: result.listings_checked,
        listings_with_data: result.listings_with_data,
        rows_written: result.rows_written,
        total_views: result.total_views,
      },
    });
  } catch (_e) {
    // non-fatal
  }

  result.duration_ms = Date.now() - start;
  return result;
}

// @ts-expect-error - Deno runtime
Deno.serve(async (req: Request) => {
  // Optional body override: { lookback_days: 365 } lets one-off backfill
  // runs pull a wider window than the daily cron default. Bounded at
  // [1, 730] to prevent absurd values from hammering ListTrac.
  let lookbackDays = LOOKBACK_DAYS;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json() as { lookback_days?: unknown };
      if (typeof body.lookback_days === "number" && Number.isFinite(body.lookback_days)) {
        lookbackDays = Math.min(730, Math.max(1, Math.round(body.lookback_days)));
      }
    }
  } catch (_e) {
    // No body or non-JSON body — fall through to default.
  }

  const out = await syncListtrac(lookbackDays);
  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json" },
    status: out.ok ? 200 : 500,
  });
});
