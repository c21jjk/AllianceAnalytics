/**
 * Coach AI insight generators.
 *
 * Two functions:
 *   - generateRecommendations() → an array of spend/content recommendations
 *     ranked by priority (Recommendation[]).
 *   - generateBudgets()         → per-listing weekly budget allocations
 *     (BudgetAllocation[]).
 *
 * Both pull real post + listing performance, format a structured JSON
 * prompt, call Claude Opus, parse the response, and return the typed
 * array shape used by the existing /coach UI components.
 *
 * Callers (refresh server action + pg_cron edge function) persist the
 * results to public.coach_insights for cheap reads on /coach page loads.
 *
 * Both functions degrade to an empty array if Claude isn't configured
 * or returns malformed JSON.
 */
import "server-only";
import { ANTHROPIC_MODELS, getAnthropic } from "./anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  Platform,
} from "@/lib/types/post";
import type {
  BudgetAllocation,
  BudgetSliceByPlatform,
  Recommendation,
  RecommendationKind,
  RecommendationPriority,
} from "@/lib/types/strategy";

const PLATFORM_SET: ReadonlySet<Platform> = new Set([
  "facebook",
  "instagram",
  "tiktok",
]);
const RECOMMENDATION_KINDS: ReadonlySet<RecommendationKind> = new Set([
  "boost",
  "reallocate",
  "pause",
  "publish_more",
  "target_change",
]);
const PRIORITIES: ReadonlySet<RecommendationPriority> = new Set([
  "high",
  "medium",
  "low",
]);

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

interface PerfRow {
  post_id: string;
  platform: Platform;
  category: string | null;
  caption: string | null;
  mls_number: string | null;
  property_address: string | null;
  reach: number;
  engagements: number;
  engagement_rate: number;
}

/**
 * Pull a compact performance summary for the most recent N days of posts.
 * Used as context for both the Recommendations and Budgets prompts.
 */
async function loadRecentPerformance(
  windowDays: number = 30,
  scope: "brand_wide" | { office_short_code: string } = "brand_wide",
): Promise<PerfRow[]> {
  const supabase = createAdminClient();
  const cutoffIso = new Date(
    Date.now() - windowDays * 86400_000,
  ).toISOString();

  let officeFilterId: string | null = null;
  if (scope !== "brand_wide" && scope.office_short_code) {
    const { data: officeRow } = await supabase
      .from("offices")
      .select("id")
      .eq("short_code", scope.office_short_code)
      .maybeSingle();
    if (!officeRow) return [];
    officeFilterId = officeRow.id;
  }

  let query = supabase
    .from("posts")
    .select(
      "id, platform, category, caption, metrics, property_id, office_id",
    )
    .gte("posted_at", cutoffIso);
  if (officeFilterId) query = query.eq("office_id", officeFilterId);

  const { data: postRows, error } = await query;
  if (error || !postRows) return [];

  const propertyIds = Array.from(
    new Set(
      (postRows as Array<{ property_id: string | null }>).map(
        (p) => p.property_id,
      ),
    ),
  ).filter((x): x is string => !!x);

  const propertyById = new Map<
    string,
    { mls_number: string; address: string | null }
  >();
  if (propertyIds.length > 0) {
    const { data: propRows } = await supabase
      .from("properties")
      .select("id, mls_number, address")
      .in("id", propertyIds);
    for (const p of (propRows ?? []) as Array<{
      id: string;
      mls_number: string;
      address: string | null;
    }>) {
      propertyById.set(p.id, { mls_number: p.mls_number, address: p.address });
    }
  }

  return (postRows as Array<{
    id: string;
    platform: Platform;
    category: string | null;
    caption: string | null;
    metrics: Record<string, unknown> | null;
    property_id: string | null;
  }>).map((row) => {
    const m = row.metrics ?? {};
    const reach = readNum(m.reach) || readNum(m.impressions);
    const engagements =
      readNum(m.likes) +
      readNum(m.comments) +
      readNum(m.shares) +
      readNum(m.saves);
    const engagement_rate = reach > 0 ? engagements / reach : 0;
    const propRef = row.property_id ? propertyById.get(row.property_id) : null;
    return {
      post_id: row.id,
      platform: row.platform,
      category: row.category,
      caption: (row.caption ?? "").slice(0, 120) || null,
      mls_number: propRef?.mls_number ?? null,
      property_address: propRef?.address ?? null,
      reach,
      engagements,
      engagement_rate,
    } satisfies PerfRow;
  });
}

interface ActiveListingForBudget {
  id: string;
  mls_number: string;
  address: string | null;
  list_price: number | null;
}

async function loadActiveListings(
  scope: "brand_wide" | { office_short_code: string } = "brand_wide",
): Promise<ActiveListingForBudget[]> {
  const supabase = createAdminClient();
  let officeFilterId: string | null = null;
  if (scope !== "brand_wide" && scope.office_short_code) {
    const { data: officeRow } = await supabase
      .from("offices")
      .select("id")
      .eq("short_code", scope.office_short_code)
      .maybeSingle();
    if (!officeRow) return [];
    officeFilterId = officeRow.id;
  }
  let query = supabase
    .from("properties")
    .select("id, mls_number, address, list_price")
    .eq("status", "active")
    .order("list_price", { ascending: false, nullsFirst: false })
    .limit(50);
  if (officeFilterId) query = query.eq("office_id", officeFilterId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as ActiveListingForBudget[]).map((p) => ({
    ...p,
    list_price: p.list_price === null ? null : Number(p.list_price),
  }));
}

const RECOMMENDATIONS_SYSTEM = `You are the AI marketing strategist for Century 21 Alliance, an 8-office New Jersey real estate brokerage. Generate 6–10 actionable, specific spend & content recommendations based on the real post-performance data the user provides.

Each recommendation has:
- kind: "boost" | "reallocate" | "pause" | "publish_more" | "target_change"
- priority: "high" | "medium" | "low"
- headline: a short title (5–9 words)
- rationale: 2–3 sentences using concrete numbers from the data
- actions: 1–3 specific steps
- spend_usd: integer or null (only when paid spend is implied)
- window: short string like "next 7 days" / "this week"
- platforms: array containing only "facebook" / "instagram" / "tiktok"
- projection: { reach_lift?, engagement_lift?, lead_lift?, confidence (0–1) }
- post_id (optional): reference back to a specific post from the data
- mls (optional): reference back to a specific listing

Hard rules:
1. NEVER recommend Facebook Groups posting or personal-profile posting.
2. Be specific. Tie each rec to a number from the data.
3. Rank by priority: high first.
4. Don't recommend more than $200 in spend per rec without strong data.
5. Return ONLY valid JSON: { "recommendations": [ ... ] }`;

const BUDGETS_SYSTEM = `You are the AI marketing strategist for Century 21 Alliance. For each active listing, recommend a weekly paid-social budget split across Facebook, Instagram, and TikTok.

Output JSON shape:
{
  "budgets": [
    {
      "mls": "string",
      "total_weekly_usd": integer (50–500),
      "slices": [
        { "platform": "facebook"|"instagram"|"tiktok", "share": 0-1, "weekly_usd": integer }
      ],
      "rationale": "1–2 sentences explaining the split"
    }
  ]
}

Hard rules:
1. Slices must sum to total_weekly_usd (within $1).
2. Shares must sum to 1.0 (within 0.01).
3. Use only the three platforms listed above.
4. Weight Instagram heavier for $400K–$900K listings, TikTok for sub-$400K reach plays, and balanced for luxury ($1M+).
5. If a listing has performance data attached, use it; otherwise use price-band heuristics.
6. Return ONLY valid JSON.`;

function safeJSONParse<T>(raw: string): T | null {
  // Claude sometimes wraps JSON in prose or code fences. Find the outermost
  // braces and try to parse what's inside.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

interface ModelRecShape {
  kind?: string;
  priority?: string;
  headline?: string;
  rationale?: string;
  actions?: string[];
  spend_usd?: number | null;
  window?: string;
  platforms?: string[];
  projection?: {
    reach_lift?: number;
    engagement_lift?: number;
    lead_lift?: number;
    confidence?: number;
  };
  post_id?: string;
  mls?: string;
}

interface ModelBudgetShape {
  mls?: string;
  total_weekly_usd?: number;
  slices?: Array<{
    platform?: string;
    share?: number;
    weekly_usd?: number;
  }>;
  rationale?: string;
}

function coercePlatforms(values: unknown): Platform[] {
  if (!Array.isArray(values)) return [];
  const out: Platform[] = [];
  for (const v of values) {
    if (typeof v === "string" && PLATFORM_SET.has(v as Platform)) {
      out.push(v as Platform);
    }
  }
  return out;
}

function coerceRecommendations(raw: ModelRecShape[]): Recommendation[] {
  const out: Recommendation[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const kind = (r.kind ?? "publish_more") as RecommendationKind;
    if (!RECOMMENDATION_KINDS.has(kind)) continue;
    const priority = (r.priority ?? "medium") as RecommendationPriority;
    if (!PRIORITIES.has(priority)) continue;
    const platforms = coercePlatforms(r.platforms);
    if (platforms.length === 0) continue;
    if (!r.headline || !r.rationale) continue;
    const projection = r.projection ?? {};
    out.push({
      id: `rec_${Date.now()}_${i}`,
      kind,
      priority,
      headline: r.headline.slice(0, 120),
      rationale: r.rationale.slice(0, 600),
      actions: Array.isArray(r.actions) ? r.actions.slice(0, 5) : undefined,
      spend_usd:
        typeof r.spend_usd === "number" && Number.isFinite(r.spend_usd)
          ? Math.round(r.spend_usd)
          : undefined,
      window: r.window ?? "this week",
      platforms,
      projection: {
        reach_lift:
          typeof projection.reach_lift === "number"
            ? Math.round(projection.reach_lift)
            : undefined,
        engagement_lift:
          typeof projection.engagement_lift === "number"
            ? Math.round(projection.engagement_lift)
            : undefined,
        lead_lift:
          typeof projection.lead_lift === "number"
            ? Math.round(projection.lead_lift)
            : undefined,
        confidence:
          typeof projection.confidence === "number"
            ? Math.max(0, Math.min(1, projection.confidence))
            : 0.7,
      },
      post_id: typeof r.post_id === "string" ? r.post_id : undefined,
      mls: typeof r.mls === "string" ? r.mls : undefined,
      generated_at: now,
    });
  }
  return out;
}

function coerceBudgets(raw: ModelBudgetShape[]): BudgetAllocation[] {
  const out: BudgetAllocation[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (!b.mls || !b.slices || b.slices.length === 0) continue;
    const total = readNum(b.total_weekly_usd);
    if (total < 25 || total > 1000) continue;
    const slices: BudgetSliceByPlatform[] = [];
    for (const s of b.slices) {
      if (!s.platform || !PLATFORM_SET.has(s.platform as Platform)) continue;
      slices.push({
        platform: s.platform as Platform,
        share: Math.max(0, Math.min(1, readNum(s.share))),
        weekly_usd: Math.max(0, Math.round(readNum(s.weekly_usd))),
      });
    }
    if (slices.length === 0) continue;
    out.push({
      id: `budget_${Date.now()}_${i}`,
      mls: b.mls,
      total_weekly_usd: Math.round(total),
      slices,
      rationale: (b.rationale ?? "").slice(0, 400),
      generated_at: now,
    });
  }
  return out;
}

/**
 * Generate recommendations via Claude Opus, using real performance data as
 * context. Returns [] when Anthropic isn't configured or parsing fails.
 */
export async function generateRecommendations(
  scope: "brand_wide" | { office_short_code: string } = "brand_wide",
): Promise<Recommendation[]> {
  const client = await getAnthropic();
  if (!client) return [];

  const perf = await loadRecentPerformance(30, scope);
  if (perf.length < 5) return []; // not enough data to recommend anything

  const userMessage = JSON.stringify({
    window_days: 30,
    scope: scope === "brand_wide" ? "brand_wide" : scope.office_short_code,
    posts: perf,
  });

  try {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 4096,
      system: RECOMMENDATIONS_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n")
      .trim();
    const parsed = safeJSONParse<{ recommendations?: ModelRecShape[] }>(text);
    if (!parsed?.recommendations) return [];
    return coerceRecommendations(parsed.recommendations);
  } catch (err) {
    console.error("[coach-insights] recommendations error:", err);
    return [];
  }
}

/**
 * Generate per-listing weekly budget allocations via Claude Opus.
 * Returns [] when Anthropic isn't configured, no active listings exist,
 * or parsing fails.
 */
export async function generateBudgets(
  scope: "brand_wide" | { office_short_code: string } = "brand_wide",
): Promise<BudgetAllocation[]> {
  const client = await getAnthropic();
  if (!client) return [];

  const [listings, perf] = await Promise.all([
    loadActiveListings(scope),
    loadRecentPerformance(30, scope),
  ]);
  if (listings.length === 0) return [];

  const userMessage = JSON.stringify({
    scope: scope === "brand_wide" ? "brand_wide" : scope.office_short_code,
    active_listings: listings.map((l) => ({
      mls: l.mls_number,
      address: l.address,
      list_price: l.list_price,
    })),
    recent_performance: perf,
  });

  try {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 4096,
      system: BUDGETS_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n")
      .trim();
    const parsed = safeJSONParse<{ budgets?: ModelBudgetShape[] }>(text);
    if (!parsed?.budgets) return [];
    return coerceBudgets(parsed.budgets);
  } catch (err) {
    console.error("[coach-insights] budgets error:", err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Cache layer — reads & writes to public.coach_insights              */
/* ------------------------------------------------------------------ */

export interface CachedCoachInsights {
  recommendations: Recommendation[];
  budgets: BudgetAllocation[];
  /** ISO timestamp from the most recent generation. */
  generated_at: string | null;
  /** Last error message from generation, if any. */
  last_error: string | null;
}

/**
 * Read the latest cached insights for a scope from coach_insights. Returns
 * empty arrays + null generated_at when no cache row exists yet.
 */
export async function readCachedCoachInsights(
  scope: string = "brand_wide",
): Promise<CachedCoachInsights> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("coach_insights")
    .select("kind, data, generated_at, last_error")
    .eq("scope", scope)
    .in("kind", ["recommendations", "budgets"]);

  let recommendations: Recommendation[] = [];
  let budgets: BudgetAllocation[] = [];
  let generated_at: string | null = null;
  let last_error: string | null = null;

  for (const row of (data ?? []) as Array<{
    kind: string;
    data: unknown;
    generated_at: string | null;
    last_error: string | null;
  }>) {
    if (row.kind === "recommendations" && Array.isArray(row.data)) {
      recommendations = row.data as Recommendation[];
    }
    if (row.kind === "budgets" && Array.isArray(row.data)) {
      budgets = row.data as BudgetAllocation[];
    }
    if (row.generated_at) {
      if (!generated_at || row.generated_at > generated_at) {
        generated_at = row.generated_at;
      }
    }
    if (row.last_error && !last_error) last_error = row.last_error;
  }

  return { recommendations, budgets, generated_at, last_error };
}

/**
 * Run both generators for a scope and persist the results to
 * coach_insights. Returns the freshly-generated payloads so the caller can
 * surface them immediately (e.g., manual refresh flow).
 */
export async function refreshCoachInsights(
  scope: string = "brand_wide",
): Promise<CachedCoachInsights> {
  const supabase = createAdminClient();
  const scopeArg =
    scope === "brand_wide"
      ? "brand_wide"
      : { office_short_code: scope.replace(/^office:/, "") };

  let recommendations: Recommendation[] = [];
  let budgets: BudgetAllocation[] = [];
  let last_error: string | null = null;

  try {
    recommendations = await generateRecommendations(scopeArg as never);
  } catch (e) {
    last_error = e instanceof Error ? e.message : "recommendations failed";
  }
  try {
    budgets = await generateBudgets(scopeArg as never);
  } catch (e) {
    last_error = e instanceof Error ? e.message : "budgets failed";
  }

  const now = new Date().toISOString();
  await supabase.from("coach_insights").upsert(
    [
      {
        scope,
        kind: "recommendations",
        data: recommendations as unknown as Json,
        generated_at: now,
        last_error,
        updated_at: now,
      },
      {
        scope,
        kind: "budgets",
        data: budgets as unknown as Json,
        generated_at: now,
        last_error,
        updated_at: now,
      },
    ],
    { onConflict: "scope,kind" },
  );

  return { recommendations, budgets, generated_at: now, last_error };
}
