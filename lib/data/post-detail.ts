import "server-only";
import { getPostById } from "@/lib/data";
import { listOffices } from "@/lib/data/offices";
import { createAdminClient } from "@/lib/supabase/admin";
import { reachOf, engagementsOf } from "@/lib/data/post-metrics";
import type {
  Platform,
  Post,
  PostAudience,
  PostCategory,
  PostLinkMethod,
  PropertyRef,
} from "@/lib/types/post";
import type {
  AiInsight,
  PlatformPosting,
  PostGroup,
} from "@/lib/types/group";

/**
 * Server-only group detail fetcher used by both the post-detail drawer
 * (intercepted route) and the standalone /posts/[id] page. Given any
 * `posts.id`, resolves to the parent post_group (or synthesizes a
 * singleton group when group_id is null) and returns a PostGroup +
 * supporting context (offices, listing-agent fields, combined audience,
 * combined daily reach series).
 *
 * The same shape powers the drawer body so that clicking from a GroupCard
 * always shows the merged campaign — never just one platform.
 */

export interface GroupDetailBundle {
  group: PostGroup;
  /** All member posts hydrated as full Post objects (carries audience, daily, video metrics). */
  posts: Post[];
  offices: Array<{ id: string; short_code: string; name: string }>;
  /** posts.office_id of the post the user clicked — feeds the Classify panel's initial state. */
  initialOfficeId: string | null;
  /** Listing agent contact info, when the campaign is linked to a property. */
  listingAgent: { name: string | null; email: string | null } | null;
  /** Combined daily reach across all platforms. Sorted ascending by date. */
  combinedDaily: Array<{ date: string; reach: number; engagements: number }>;
  /** First non-empty audience among member posts, if any. */
  combinedAudience: PostAudience | null;
}

interface DbPostRow {
  id: string;
  platform: string;
  permalink: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  media_type: string | null;
  caption: string | null;
  posted_at: string | null;
  agent_name: string | null;
  category: string | null;
  link_method: string | null;
  property_id: string | null;
  group_id: string | null;
  metrics: Record<string, unknown> | null;
  platform_post_id: string | null;
  mls_number_parsed: string | null;
  office_id: string | null;
}

interface DbGroupRow {
  id: string;
  posted_date: string | null;
  representative_caption: string | null;
  representative_thumbnail: string | null;
  category: string | null;
  property_id: string | null;
  is_locked: boolean;
  group_method: string;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  hero_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "FB",
  instagram: "IG",
  tiktok: "TT",
};

function asPlatform(value: string): Platform {
  if (value === "facebook" || value === "instagram" || value === "tiktok") {
    return value;
  }
  return "instagram";
}

function asCategory(value: string | null): PostCategory | undefined {
  if (
    value === "property" ||
    value === "agent" ||
    value === "educational" ||
    value === "marketing" ||
    value === "community" ||
    value === "sold" ||
    value === "open_house" ||
    value === "other"
  ) {
    return value;
  }
  return undefined;
}

function asLinkMethod(value: string | null): PostLinkMethod | undefined {
  if (
    value === "manual" ||
    value === "auto_mls" ||
    value === "auto_address_full" ||
    value === "auto_address_partial"
  ) {
    return value;
  }
  return undefined;
}

function rowToPropertyRef(row: DbPropertyRow): PropertyRef {
  const addressParts = [row.address, row.city, row.state].filter(Boolean);
  return {
    mls: row.mls_number,
    address: addressParts.join(", "),
    list_price:
      row.list_price === null || row.list_price === undefined
        ? undefined
        : Number(row.list_price),
    hero_image_url: row.hero_image_url ?? undefined,
  };
}

function igShortcode(permalink: string): string | undefined {
  const m = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? m[1] : undefined;
}
function ttVideoId(permalink: string): string | undefined {
  const m = permalink.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  return m ? m[1] : undefined;
}
function shortcodeFor(platform: Platform, permalink: string): string | undefined {
  if (platform === "instagram") return igShortcode(permalink);
  if (platform === "tiktok") return ttVideoId(permalink);
  return undefined;
}

function postingFromRow(row: DbPostRow): PlatformPosting {
  const platform = asPlatform(row.platform);
  // Reach + engagements via lib/data/post-metrics — same formula used by the
  // Owner Story and the weekly social email, so numbers never drift between
  // the dashboard, the seller-facing report, and the leadership email.
  const reach = reachOf(row);
  const engagements = engagementsOf(row);
  const permalink = row.permalink ?? "";
  return {
    platform,
    post_id: row.id,
    permalink,
    thumbnail_url: row.thumbnail_url ?? row.media_url ?? undefined,
    caption: row.caption ?? "",
    reach,
    engagements,
    is_video: row.media_type === "video" || row.media_type === "reel",
    shortcode: shortcodeFor(platform, permalink),
  };
}

function daysBetween(isoDate: string, now: Date): number {
  const d = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(d)) return 0;
  const ms = now.getTime() - d;
  return Math.max(0, Math.floor(ms / 86400_000));
}

function buildAiInsight(
  postings: PlatformPosting[],
  totalReach: number,
  totalEngagements: number,
  engagementRate: number,
): AiInsight {
  if (engagementRate >= 0.04 && totalReach >= 500) {
    const top = postings.slice().sort((a, b) => b.reach - a.reach)[0];
    const topLabel = top ? PLATFORM_LABEL[top.platform] : "this channel";
    const pct = (engagementRate * 100).toFixed(1);
    return {
      tone: "success",
      headline: "Top performer this week.",
      body: `Above-average reach with ${pct}% engagement. Worth pinning on ${topLabel}.`,
      action_label: `Pin on ${topLabel}`,
      action_href: "#",
    };
  }
  if (postings.length >= 2) {
    const sorted = postings
      .filter((p) => p.reach > 0)
      .sort((a, b) => b.reach - a.reach);
    if (sorted.length >= 2) {
      const winner = sorted[0];
      const loser = sorted[sorted.length - 1];
      if (loser.reach > 0 && winner.reach >= loser.reach * 5) {
        const ratio = Math.round(winner.reach / Math.max(1, loser.reach));
        const projected = Math.round(winner.reach * 0.4);
        const winnerLabel = PLATFORM_LABEL[winner.platform];
        const loserLabel = PLATFORM_LABEL[loser.platform];
        return {
          tone: "info",
          headline: `Strong ${winnerLabel} performance, weak ${loserLabel} distribution.`,
          body: `${ratio}x reach gap suggests boosting on ${loserLabel} could yield ~${projected.toLocaleString()} additional reach for around $40 spend.`,
          action_label: `Boost on ${loserLabel}`,
          action_href: "#",
        };
      }
    }
  }
  return { tone: "quiet", headline: "", body: "Tracking normal." };
}

/**
 * Find the parent group for a post id and fetch all member rows. When the
 * post has no group_id, returns just the single row so callers can synthesize
 * a singleton.
 */
async function fetchGroupRowsForPost(postId: string): Promise<{
  group: DbGroupRow | null;
  members: DbPostRow[];
  clickedRow: DbPostRow | null;
}> {
  const supabase = createAdminClient();

  const { data: clickedRowRaw } = await supabase
    .from("posts")
    .select(
      "id, platform, permalink, thumbnail_url, media_url, media_type, caption, posted_at, agent_name, category, link_method, property_id, group_id, metrics, platform_post_id, mls_number_parsed, office_id",
    )
    .eq("id", postId)
    .maybeSingle();
  const clickedRow = (clickedRowRaw ?? null) as DbPostRow | null;
  if (!clickedRow) {
    return { group: null, members: [], clickedRow: null };
  }

  if (!clickedRow.group_id) {
    return { group: null, members: [clickedRow], clickedRow };
  }

  const [groupRes, memberRes] = await Promise.all([
    supabase
      .from("post_groups")
      .select(
        "id, posted_date, representative_caption, representative_thumbnail, category, property_id, is_locked, group_method",
      )
      .eq("id", clickedRow.group_id)
      .maybeSingle(),
    supabase
      .from("posts")
      .select(
        "id, platform, permalink, thumbnail_url, media_url, media_type, caption, posted_at, agent_name, category, link_method, property_id, group_id, metrics, platform_post_id, mls_number_parsed, office_id",
      )
      .eq("group_id", clickedRow.group_id),
  ]);

  const group = (groupRes.data ?? null) as DbGroupRow | null;
  const members = (memberRes.data ?? []) as DbPostRow[];
  return {
    group,
    members: members.length > 0 ? members : [clickedRow],
    clickedRow,
  };
}

/**
 * Combine per-post daily series into a single date-keyed reach/engagement
 * series across all platforms in the campaign.
 */
function combineDaily(
  posts: Post[],
): Array<{ date: string; reach: number; engagements: number }> {
  const map = new Map<string, { reach: number; engagements: number }>();
  for (const p of posts) {
    for (const d of p.daily ?? []) {
      const cur = map.get(d.date) ?? { reach: 0, engagements: 0 };
      cur.reach += d.reach;
      cur.engagements += d.engagements;
      map.set(d.date, cur);
    }
  }
  return Array.from(map.entries())
    .map(([date, v]) => ({ date, reach: v.reach, engagements: v.engagements }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Resolves any `posts.id` to its parent group (real or synthesized
 * singleton) and bundles everything the drawer/page need to render
 * a campaign-level view.
 */
export async function fetchGroupDetailBundleForPost(
  postId: string,
): Promise<GroupDetailBundle | null> {
  const { group, members, clickedRow } = await fetchGroupRowsForPost(postId);
  if (members.length === 0 || !clickedRow) return null;

  const supabase = createAdminClient();

  // Hydrate each member as a full Post (audience/daily/video fields).
  const hydratedPosts: Post[] = [];
  for (const m of members) {
    const post = await getPostById(m.id);
    if (post) hydratedPosts.push(post);
  }
  if (hydratedPosts.length === 0) return null;

  // Property + listing-agent fields.
  let property: PropertyRef | undefined;
  let listingAgent: GroupDetailBundle["listingAgent"] = null;
  const propertyId =
    group?.property_id ??
    members.find((m) => m.property_id)?.property_id ??
    null;
  if (propertyId) {
    const { data: propRow } = await supabase
      .from("properties")
      .select(
        "id, mls_number, address, city, state, list_price, hero_image_url, agent_name, agent_email",
      )
      .eq("id", propertyId)
      .maybeSingle();
    if (propRow) {
      const row = propRow as DbPropertyRow;
      property = rowToPropertyRef(row);
      listingAgent = {
        name: row.agent_name ?? null,
        email: row.agent_email ?? null,
      };
    }
  }

  // Build PlatformPosting[] from member rows.
  const postings = members
    .map(postingFromRow)
    .sort((a, b) => a.platform.localeCompare(b.platform));
  const totalReach = postings.reduce((s, p) => s + p.reach, 0);
  const totalEngagements = postings.reduce((s, p) => s + p.engagements, 0);
  const engagementRate =
    totalReach > 0
      ? Math.max(0, Math.min(1, totalEngagements / totalReach))
      : 0;

  const now = new Date();
  const postedDate =
    group?.posted_date ??
    members[0]?.posted_at?.slice(0, 10) ??
    new Date().toISOString().slice(0, 10);

  const repCaption =
    (group?.representative_caption && group.representative_caption.length > 0
      ? group.representative_caption
      : members.find((r) => r.caption && r.caption.length > 0)?.caption) ?? "";

  const repThumbnail =
    group?.representative_thumbnail ??
    members.find((r) => r.thumbnail_url)?.thumbnail_url ??
    members.find((r) => r.media_url)?.media_url ??
    undefined;

  const linkMethod = members
    .map((r) => asLinkMethod(r.link_method))
    .find((m) => m !== undefined);

  const mlsParsed =
    members.map((r) => r.mls_number_parsed).find((m) => m && m.length > 0) ??
    undefined;

  const agentName =
    members.map((r) => r.agent_name).find((n) => n && n.length > 0) ??
    undefined;

  const category =
    asCategory(group?.category ?? null) ??
    members.map((r) => asCategory(r.category)).find((c) => c !== undefined);

  const groupOut: PostGroup = {
    id: group?.id ?? `solo-${clickedRow.id}`,
    posted_date: postedDate,
    representative_caption: repCaption,
    representative_thumbnail: repThumbnail ?? undefined,
    category,
    agent_name: agentName ?? undefined,
    property,
    // Multi-property + audience_scope: groupBuilder here doesn't yet read the
    // post_groups columns; falls back to single-property array. Right rail
    // build-out will replace this with a proper fetch.
    properties: property ? [property] : [],
    audience_scope: null,
    link_method: linkMethod,
    mls_number_parsed: mlsParsed,
    is_locked: group?.is_locked ?? false,
    postings,
    total_reach: totalReach,
    total_engagements: totalEngagements,
    engagement_rate: engagementRate,
    days_old: daysBetween(postedDate, now),
    ai_insight: buildAiInsight(
      postings,
      totalReach,
      totalEngagements,
      engagementRate,
    ),
  };

  // Combined audience: just take the first non-empty audience block.
  const combinedAudience: PostAudience | null =
    hydratedPosts.find((p) => p.audience)?.audience ?? null;

  // Office + offices list.
  const offices = await listOffices({ active_only: true });
  const initialOfficeId = clickedRow.office_id ?? null;

  return {
    group: groupOut,
    posts: hydratedPosts,
    offices: offices.map((o) => ({
      id: o.id,
      short_code: o.short_code,
      name: o.name,
    })),
    initialOfficeId,
    listingAgent,
    combinedDaily: combineDaily(hydratedPosts),
    combinedAudience,
  };
}

/**
 * Legacy fetcher kept for callers that only need the single-post bundle.
 * Prefer {@link fetchGroupDetailBundleForPost} for any new surface.
 */
export interface PostDetailBundle {
  post: Post;
  offices: Array<{ id: string; short_code: string; name: string }>;
  initialOfficeId: string | null;
}

export async function fetchPostDetailBundle(
  id: string,
): Promise<PostDetailBundle | null> {
  const post = await getPostById(id);
  if (!post) return null;

  const [officesRows, postOfficeRow] = await Promise.all([
    listOffices({ active_only: true }),
    (async () => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("posts")
        .select("office_id")
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    })(),
  ]);

  return {
    post,
    offices: officesRows.map((o) => ({
      id: o.id,
      short_code: o.short_code,
      name: o.name,
    })),
    initialOfficeId: postOfficeRow?.office_id ?? null,
  };
}
