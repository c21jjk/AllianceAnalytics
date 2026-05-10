import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Property data source for the analytics-side `/properties` index.
 *
 * Reads `public.properties` (the AllianceAnalytics-side mirror, replicated
 * from the Listings DB on save) plus rolls up post counts + reach + engagement
 * per property in a single bulk query.
 *
 * The /properties detail page (`/properties/[mls]`) is still on fixtures —
 * out of scope for this fetcher. When that page moves to live data, this
 * module can grow a per-mls fetcher.
 */

export interface PropertySummary {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  agent_name: string | null;
  hero_image_url: string | null;
  status: "active" | "pending" | "sold" | "expired";
  source_mls: string | null;
  /** Total posts linked to this property. */
  post_count: number;
  /** Sum of reach across all linked posts. */
  total_reach: number;
  /** Sum of likes + comments + shares + saves across all linked posts. */
  total_engagements: number;
  updated_at: string;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  agent_name: string | null;
  hero_image_url: string | null;
  status: "active" | "pending" | "sold" | "expired";
  source_mls: string | null;
  updated_at: string;
}

interface DbPostMetricsRow {
  property_id: string | null;
  metrics: Record<string, unknown> | null;
}

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Fetch all properties + per-property post rollups in two queries.
 *
 * Order: most-recently-updated first, then by listing_date desc.
 */
export async function fetchProperties(): Promise<PropertySummary[]> {
  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, zip, list_price, listing_date, agent_name, hero_image_url, status, source_mls, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !rows) {
    console.error("fetchProperties:", error);
    return [];
  }

  const properties = rows as DbPropertyRow[];
  if (properties.length === 0) return [];

  // Bulk fetch post metrics for all linked posts at once and aggregate.
  const propertyIds = properties.map((p) => p.id);
  const { data: postRows } = await supabase
    .from("posts")
    .select("property_id, metrics")
    .in("property_id", propertyIds);

  const rollup = new Map<
    string,
    { post_count: number; total_reach: number; total_engagements: number }
  >();
  for (const r of (postRows ?? []) as DbPostMetricsRow[]) {
    if (!r.property_id) continue;
    const m = r.metrics ?? {};
    const reach = readNum(m.reach) || readNum(m.impressions) || readNum(m.plays);
    const engagements =
      readNum(m.likes) +
      readNum(m.comments) +
      readNum(m.shares) +
      readNum(m.saves);
    const cur = rollup.get(r.property_id) ?? {
      post_count: 0,
      total_reach: 0,
      total_engagements: 0,
    };
    cur.post_count += 1;
    cur.total_reach += reach;
    cur.total_engagements += engagements;
    rollup.set(r.property_id, cur);
  }

  return properties.map((p) => {
    const r = rollup.get(p.id) ?? {
      post_count: 0,
      total_reach: 0,
      total_engagements: 0,
    };
    return {
      id: p.id,
      mls_number: p.mls_number,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      list_price: p.list_price,
      listing_date: p.listing_date,
      agent_name: p.agent_name,
      hero_image_url: p.hero_image_url,
      status: p.status,
      source_mls: p.source_mls,
      post_count: r.post_count,
      total_reach: r.total_reach,
      total_engagements: r.total_engagements,
      updated_at: p.updated_at,
    };
  });
}
