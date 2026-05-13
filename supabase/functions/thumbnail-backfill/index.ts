/**
 * thumbnail-backfill Edge Function.
 *
 * Walks posts where `thumbnail_cached_at IS NULL AND thumbnail_url IS NOT NULL`,
 * downloads each thumbnail, uploads to the public `post-thumbnails` Supabase
 * Storage bucket, and rewrites the row's thumbnail_url to point at the
 * durable Storage URL.
 *
 * Decoupled from the platform sync functions on purpose — caching inline
 * during sync was blowing the 150s Edge Function timeout. This runs on its
 * own cron schedule and gracefully handles whatever batch it can finish.
 *
 * Body: { limit?: number, max_concurrency?: number } — both optional.
 * Default batch is 80, concurrency is 6.
 *
 * Output: JSON summary of processed/cached/failed/remaining counts.
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "post-thumbnails";
const FETCH_TIMEOUT_MS = 8000;
const FUNCTION_TIME_BUDGET_MS = 120_000; // 2 min — well under the 150s ceiling
const DEFAULT_BATCH = 80;
const DEFAULT_CONCURRENCY = 6;

interface BackfillBody {
  limit?: number;
  max_concurrency?: number;
}

interface PostRow {
  id: string;
  platform: "facebook" | "instagram" | "tiktok";
  platform_post_id: string | null;
  thumbnail_url: string | null;
}

interface CacheOutcome {
  postId: string;
  ok: boolean;
  reason?: string;
}

function extOf(ct: string | null): string {
  if (!ct) return "jpg";
  const lower = ct.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  return "jpg";
}
function mimeOf(ct: string | null): string {
  if (!ct) return "image/jpeg";
  const lower = ct.toLowerCase().split(";")[0].trim();
  if (
    lower === "image/jpeg" ||
    lower === "image/png" ||
    lower === "image/webp" ||
    lower === "image/gif"
  ) {
    return lower;
  }
  return "image/jpeg";
}

async function cacheOne(
  supabase: SupabaseClient,
  row: PostRow,
): Promise<CacheOutcome> {
  if (!row.thumbnail_url) return { postId: row.id, ok: false, reason: "no-url" };
  if (!row.platform_post_id)
    return { postId: row.id, ok: false, reason: "no-platform-id" };

  // 1) Fetch with timeout. Browser-like UA helps with Meta/TikTok CDNs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let bytes: ArrayBuffer;
  let contentType: string | null;
  try {
    const res = await fetch(row.thumbnail_url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
      },
    });
    if (!res.ok) {
      return { postId: row.id, ok: false, reason: `fetch-${res.status}` };
    }
    contentType = res.headers.get("content-type");
    bytes = await res.arrayBuffer();
    if (bytes.byteLength < 200) {
      return { postId: row.id, ok: false, reason: "fetch-too-small" };
    }
  } catch (e) {
    return {
      postId: row.id,
      ok: false,
      reason: `fetch-err:${(e as Error).message.slice(0, 60)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  // 2) Upload.
  const path = `${row.platform}/${row.platform_post_id}.${extOf(contentType)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(
    path,
    new Uint8Array(bytes),
    {
      contentType: mimeOf(contentType),
      upsert: true,
      cacheControl: "31536000",
    },
  );
  if (upErr) {
    return { postId: row.id, ok: false, reason: `upload:${upErr.message.slice(0, 80)}` };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const cachedUrl = data?.publicUrl;
  if (!cachedUrl) {
    return { postId: row.id, ok: false, reason: "no-public-url" };
  }

  // 3) Update post row.
  const { error: updErr } = await supabase
    .from("posts")
    .update({
      thumbnail_url: cachedUrl,
      thumbnail_cached_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updErr) {
    return { postId: row.id, ok: false, reason: `update:${updErr.message.slice(0, 80)}` };
  }
  return { postId: row.id, ok: true };
}

/**
 * Process an array in parallel with a max concurrency limit. Returns the
 * outcomes in input order. No external dependency.
 */
async function withConcurrency<T, R>(
  items: T[],
  max: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(max, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supaUrl, supaKey, {
    auth: { persistSession: false },
  });

  // Parse body (lenient — accept empty bodies for cron pings).
  let body: BackfillBody = {};
  try {
    if (req.body) body = (await req.json()) as BackfillBody;
  } catch {
    body = {};
  }
  const limit = Math.max(1, Math.min(500, body.limit ?? DEFAULT_BATCH));
  const concurrency = Math.max(
    1,
    Math.min(20, body.max_concurrency ?? DEFAULT_CONCURRENCY),
  );

  const { data: rows, error: readErr } = await supabase
    .from("posts")
    .select("id, platform, platform_post_id, thumbnail_url")
    .is("thumbnail_cached_at", null)
    .not("thumbnail_url", "is", null)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (readErr) {
    return new Response(
      JSON.stringify({ ok: false, error: readErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const candidates = (rows ?? []) as PostRow[];

  // Time-budget check — cooperatively bail early so the function never
  // hits the 150s Edge Function ceiling. The cron just runs again.
  const outcomes: CacheOutcome[] = [];
  let budgetExceeded = false;
  await withConcurrency(candidates, concurrency, async (row) => {
    if (Date.now() - startedAt > FUNCTION_TIME_BUDGET_MS) {
      budgetExceeded = true;
      return outcomes.push({ postId: row.id, ok: false, reason: "time-budget" });
    }
    const r = await cacheOne(supabase, row);
    outcomes.push(r);
    return r;
  });

  const cached = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok).length;
  const failureReasons = outcomes
    .filter((o) => !o.ok)
    .reduce<Record<string, number>>((acc, o) => {
      const reason = o.reason ?? "unknown";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  // Recount remaining for monitoring + cron-tail decisions.
  const { count: remaining } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .is("thumbnail_cached_at", null)
    .not("thumbnail_url", "is", null);

  return new Response(
    JSON.stringify({
      ok: true,
      processed: candidates.length,
      cached,
      failed,
      remaining: remaining ?? 0,
      duration_ms: Date.now() - startedAt,
      budget_exceeded: budgetExceeded,
      failure_reasons: failureReasons,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
