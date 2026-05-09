import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Platform,
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
 * Server-only data layer for the operational homepage.
 *
 * Joins post_groups with the underlying posts and properties, plus folds
 * un-grouped (singleton) posts into the timeline as one-posting "groups" so
 * the rolling window never has gaps.
 *
 * Falls back to an empty array on any DB error (page renders empty state).
 */

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

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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

/**
 * Extracts an IG shortcode from permalinks like:
 *   https://www.instagram.com/p/ABC123/
 *   https://www.instagram.com/reel/ABC123/
 */
function igShortcode(permalink: string): string | undefined {
  const m = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? m[1] : undefined;
}

/**
 * Extracts a TT video id from permalinks like:
 *   https://www.tiktok.com/@user/video/7123456789
 */
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
  const m = row.metrics ?? {};
  const reach =
    platform === "tiktok"
      ? readNum(m.plays) || readNum(m.reach) || readNum(m.impressions)
      : readNum(m.reach) || readNum(m.impressions) || readNum(m.plays);
  const engagements =
    readNum(m.likes) +
    readNum(m.comments) +
    readNum(m.shares) +
    readNum(m.saves);
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
  // Top performer: high engagement rate AND meaningful reach
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

  // Asymmetric performance across platforms (5x+ gap)
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

  // Quiet default
  return {
    tone: "quiet",
    headline: "",
    body: "Tracking normal.",
  };
}

interface DbPostRowWithOffice extends DbPostRow {
  office_id: string | null;
}

/**
 * Reads post_groups + their member posts for a rolling window of N days,
 * plus any singleton (group_id IS NULL) posts in that window so the timeline
 * has no gaps.
 *
 * @param days Time window in days. Caller is expected to pass 7/14/30.
 * @param opts.office_short_code Optional. When provided, only return groups
 *   whose member posts include at least one post tagged with that office.
 * @returns Up to 50 PostGroup rows, newest first by posted_date.
 */
export async function getGroupsLastNDays(
  days: number,
  opts: { office_short_code?: string | null } = {},
): Promise<PostGroup[]> {
  try {
    const supabase = createAdminClient();
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - days * 86400_000)
      .toISOString()
      .slice(0, 10);

    // Resolve office_short_code -> office_id once up front.
    let officeFilterId: string | null = null;
    if (opts.office_short_code) {
      const { data: officeRow } = await supabase
        .from("offices")
        .select("id")
        .eq("short_code", opts.office_short_code)
        .maybeSingle();
      if (officeRow) {
        officeFilterId = officeRow.id;
      } else {
        // Unknown office filter — return empty rather than ignoring.
        return [];
      }
    }

    // 1. Fetch groups in window
    const { data: groupRows, error: groupErr } = await supabase
      .from("post_groups")
      .select(
        "id, posted_date, representative_caption, representative_thumbnail, category, property_id, is_locked, group_method",
      )
      .gte("posted_date", cutoffDate)
      .order("posted_date", { ascending: false })
      .limit(50);
    if (groupErr) {
      console.error("getGroupsLastNDays: post_groups error", groupErr);
      return [];
    }
    const groups = (groupRows ?? []) as DbGroupRow[];
    const groupIds = groups.map((g) => g.id);

    // 2. Fetch all posts whose group_id is in groupIds OR which are singletons in window
    const cutoffIso = new Date(now.getTime() - days * 86400_000).toISOString();
    const orFilter = groupIds.length > 0
      ? `group_id.in.(${groupIds.join(",")}),and(group_id.is.null,posted_at.gte.${cutoffIso})`
      : `and(group_id.is.null,posted_at.gte.${cutoffIso})`;

    const { data: postRows, error: postErr } = await supabase
      .from("posts")
      .select(
        "id, platform, permalink, thumbnail_url, media_url, media_type, caption, posted_at, agent_name, category, link_method, property_id, group_id, metrics, platform_post_id, office_id",
      )
      .or(orFilter)
      .order("posted_at", { ascending: false })
      .limit(500);
    if (postErr) {
      console.error("getGroupsLastNDays: posts error", postErr);
      return [];
    }
    const posts = (postRows ?? []) as DbPostRowWithOffice[];

    // If filtering by office, narrow the post set first; then drop any
    // groups whose remaining members are empty.
    let allowedGroupIds: Set<string> | null = null;
    let allowedSingletonIds: Set<string> | null = null;
    if (officeFilterId) {
      const matching = posts.filter((p) => p.office_id === officeFilterId);
      allowedGroupIds = new Set(
        matching.map((p) => p.group_id).filter((g): g is string => !!g),
      );
      allowedSingletonIds = new Set(
        matching.filter((p) => !p.group_id).map((p) => p.id),
      );
    }

    // 3. Collect all property ids referenced by groups or posts; fetch in one go.
    const propIds = new Set<string>();
    for (const g of groups) {
      if (g.property_id) propIds.add(g.property_id);
    }
    for (const p of posts) {
      if (p.property_id) propIds.add(p.property_id);
    }
    const propMap = new Map<string, PropertyRef>();
    if (propIds.size > 0) {
      const { data: propRows } = await supabase
        .from("properties")
        .select(
          "id, mls_number, address, city, state, list_price, hero_image_url",
        )
        .in("id", Array.from(propIds));
      for (const p of (propRows ?? []) as DbPropertyRow[]) {
        propMap.set(p.id, rowToPropertyRef(p));
      }
    }

    // 4. Bucket posts by group_id
    const postsByGroup = new Map<string, DbPostRow[]>();
    const singletons: DbPostRow[] = [];
    for (const p of posts) {
      if (p.group_id) {
        const arr = postsByGroup.get(p.group_id) ?? [];
        arr.push(p);
        postsByGroup.set(p.group_id, arr);
      } else {
        singletons.push(p);
      }
    }

    // 5. Build "real" PostGroup rows from groupRows
    const realGroups: PostGroup[] = groups
      .map((g): PostGroup | null => {
        if (allowedGroupIds && !allowedGroupIds.has(g.id)) return null;
        const memberRows = postsByGroup.get(g.id) ?? [];
        if (memberRows.length === 0) return null;
        const postings = memberRows
          .map(postingFromRow)
          .sort((a, b) => a.platform.localeCompare(b.platform));

        const totalReach = postings.reduce((sum, p) => sum + p.reach, 0);
        const totalEngagements = postings.reduce(
          (sum, p) => sum + p.engagements,
          0,
        );
        const engagementRate =
          totalReach > 0
            ? Math.max(0, Math.min(1, totalEngagements / totalReach))
            : 0;

        const property = g.property_id
          ? propMap.get(g.property_id)
          : memberRows
              .map((r) => (r.property_id ? propMap.get(r.property_id) : undefined))
              .find(Boolean);

        const linkMethod = memberRows
          .map((r) => asLinkMethod(r.link_method))
          .find((m) => m !== undefined);

        const agentName = memberRows
          .map((r) => r.agent_name)
          .find((n) => n && n.length > 0) ?? undefined;

        const postedDate = g.posted_date ?? memberRows[0]?.posted_at?.slice(0, 10) ?? "";

        const repCaption =
          (g.representative_caption && g.representative_caption.length > 0
            ? g.representative_caption
            : memberRows.find((r) => r.caption && r.caption.length > 0)?.caption) ?? "";

        const repThumbnail =
          g.representative_thumbnail ??
          memberRows.find((r) => r.thumbnail_url)?.thumbnail_url ??
          memberRows.find((r) => r.media_url)?.media_url ??
          undefined;

        return {
          id: g.id,
          posted_date: postedDate,
          representative_caption: repCaption,
          representative_thumbnail: repThumbnail ?? undefined,
          category: asCategory(g.category),
          agent_name: agentName ?? undefined,
          property,
          link_method: linkMethod,
          is_locked: g.is_locked,
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
      })
      .filter((g): g is PostGroup => g !== null);

    // 6. Synthesize singleton "groups" so the timeline is gap-free
    const soloGroups: PostGroup[] = singletons
      .filter((row) =>
        allowedSingletonIds ? allowedSingletonIds.has(row.id) : true,
      )
      .map((row): PostGroup => {
      const posting = postingFromRow(row);
      const totalReach = posting.reach;
      const totalEngagements = posting.engagements;
      const engagementRate =
        totalReach > 0
          ? Math.max(0, Math.min(1, totalEngagements / totalReach))
          : 0;
      const postedDate = row.posted_at?.slice(0, 10) ?? "";
      const property = row.property_id ? propMap.get(row.property_id) : undefined;
      return {
        id: `solo-${row.id}`,
        posted_date: postedDate,
        representative_caption: row.caption ?? "",
        representative_thumbnail:
          row.thumbnail_url ?? row.media_url ?? undefined,
        category: asCategory(row.category),
        agent_name: row.agent_name ?? undefined,
        property,
        link_method: asLinkMethod(row.link_method),
        is_locked: false,
        postings: [posting],
        total_reach: totalReach,
        total_engagements: totalEngagements,
        engagement_rate: engagementRate,
        days_old: daysBetween(postedDate, now),
        ai_insight: buildAiInsight(
          [posting],
          totalReach,
          totalEngagements,
          engagementRate,
        ),
      };
    });

    // 7. Merge + sort by posted_date desc, slice to 50
    const merged = [...realGroups, ...soloGroups].sort((a, b) =>
      b.posted_date.localeCompare(a.posted_date),
    );
    return merged.slice(0, 50);
  } catch (e) {
    console.error("getGroupsLastNDays: fatal —", e);
    return [];
  }
}

/**
 * A candidate post that could be manually merged INTO an existing group.
 *
 * The dialog uses these to render a list of posts the staff can drag in
 * after the auto-grouper missed them (caption rewrites, low-overlap
 * hashtags, etc.).
 */
export interface MergeCandidate {
  id: string;
  platform: Platform;
  caption_preview: string;
  thumbnail_url: string | null;
  posted_at: string | null;
  media_type: string | null;
  /** If the candidate is currently in a different group, this is that group's id. */
  current_group_id: string | null;
  /** 'auto' | 'manual' | null. null when candidate is a singleton. */
  current_group_method: string | null;
}

/**
 * Internal options used by both findMergeCandidates and the API route. Kept
 * private to this module — caller never needs to override the limit today.
 */
interface FindMergeCandidatesOpts {
  limit?: number;
}

/**
 * NY-local YYYY-MM-DD bracket for a given posted_date. We compare *calendar
 * days* in America/New_York because that's what the auto-grouper uses, but
 * the underlying posts.posted_at is UTC-ish ISO. We allow ±1 day on either
 * side and re-filter in code so DST edges and post-midnight posts aren't
 * dropped.
 */
function nyDayWindow(postedDate: string): { gteIso: string; ltIso: string } {
  // postedDate is YYYY-MM-DD. Treat it as an NY day; brackets are loose
  // (-1d..+1d) so DST edges + tz drift never silently drop matches.
  const start = new Date(`${postedDate}T00:00:00Z`);
  const gte = new Date(start.getTime() - 86400_000).toISOString();
  const lt = new Date(start.getTime() + 2 * 86400_000).toISOString();
  return { gteIso: gte, ltIso: lt };
}

const NY_TZ = "America/New_York";

function toNyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA gives YYYY-MM-DD ordering for free.
  return d.toLocaleDateString("en-CA", { timeZone: NY_TZ });
}

function mediaBucket(mediaType: string | null | undefined): "video" | "still" {
  if (mediaType === "video" || mediaType === "reel") return "video";
  return "still";
}

function captionPreview(caption: string | null | undefined): string {
  const c = (caption ?? "").trim();
  if (c.length <= 140) return c;
  return c.slice(0, 137) + "...";
}

/**
 * Find ungrouped (or singleton-in-another-auto-group) posts that could
 * plausibly be merged into the target group.
 *
 * Rules:
 *   - Same calendar day (America/New_York) as the group's posted_date.
 *   - Different platform than any current member of the group.
 *   - Same media bucket (video vs still) as the group.
 *   - Excludes posts already in this group, and posts in a manual/locked group.
 *
 * Returns up to 8 results sorted by recency.
 */
export async function findMergeCandidates(
  groupId: string,
  opts: FindMergeCandidatesOpts = {},
): Promise<MergeCandidate[]> {
  const limit = opts.limit ?? 8;

  try {
    const supabase = createAdminClient();

    // 1. Look up the group + its members.
    const { data: group, error: gErr } = await supabase
      .from("post_groups")
      .select("id, posted_date")
      .eq("id", groupId)
      .maybeSingle();
    if (gErr || !group || !group.posted_date) {
      return [];
    }

    const { data: memberRows, error: memberErr } = await supabase
      .from("posts")
      .select("id, platform, media_type, posted_at")
      .eq("group_id", groupId);
    if (memberErr || !memberRows || memberRows.length === 0) {
      return [];
    }

    const memberPlatforms = new Set<string>(
      memberRows.map((r) => r.platform).filter(Boolean),
    );
    // Bucket the group by the dominant media type of its members. If any
    // member is video, treat the campaign as video; otherwise still.
    const groupBucket = memberRows.some(
      (r) => r.media_type === "video" || r.media_type === "reel",
    )
      ? "video"
      : "still";

    if (memberPlatforms.size >= 3) {
      // Already covers FB+IG+TT — nothing to merge.
      return [];
    }

    const { gteIso, ltIso } = nyDayWindow(group.posted_date);

    // 2. Pull candidate posts in the loose date window. We re-filter in code
    //    for NY-local-day match + media bucket + platform constraints.
    const { data: candRows, error: cErr } = await supabase
      .from("posts")
      .select(
        "id, platform, media_type, posted_at, caption, thumbnail_url, media_url, group_id",
      )
      .gte("posted_at", gteIso)
      .lt("posted_at", ltIso)
      .order("posted_at", { ascending: false })
      .limit(200);
    if (cErr || !candRows) return [];

    // 3. Build a quick lookup for any auto/manual group_ids the candidates
    //    might already belong to, so we can:
    //      - skip locked (manual) groups
    //      - surface current_group_method to the UI
    const candidateGroupIds = Array.from(
      new Set(
        candRows
          .map((r) => r.group_id)
          .filter((g): g is string => !!g && g !== groupId),
      ),
    );
    const groupMethodById = new Map<string, string>();
    const lockedGroupIds = new Set<string>();
    if (candidateGroupIds.length > 0) {
      const { data: groupMetaRows } = await supabase
        .from("post_groups")
        .select("id, group_method, is_locked")
        .in("id", candidateGroupIds);
      for (const gm of groupMetaRows ?? []) {
        if (gm.id) {
          groupMethodById.set(gm.id, gm.group_method);
          if (gm.is_locked) lockedGroupIds.add(gm.id);
        }
      }

      // We also need to know how many posts each candidate group has — we
      // only want singletons (group of 1) from another auto group; merging a
      // post out of a 2+ member group would orphan its other members.
    }
    // Member counts for candidate groups (so we only allow singletons).
    const groupMemberCount = new Map<string, number>();
    if (candidateGroupIds.length > 0) {
      const { data: countRows } = await supabase
        .from("posts")
        .select("group_id")
        .in("group_id", candidateGroupIds);
      for (const r of countRows ?? []) {
        if (!r.group_id) continue;
        groupMemberCount.set(
          r.group_id,
          (groupMemberCount.get(r.group_id) ?? 0) + 1,
        );
      }
    }

    const targetNyDate = group.posted_date; // already YYYY-MM-DD NY day per grouper
    const out: MergeCandidate[] = [];
    for (const r of candRows) {
      if (!r.posted_at) continue;
      // Same NY calendar day
      if (toNyDate(r.posted_at) !== targetNyDate) continue;
      // Different platform than any current member
      if (memberPlatforms.has(r.platform)) continue;
      // Same media bucket
      if (mediaBucket(r.media_type) !== groupBucket) continue;
      // Skip if already in this group
      if (r.group_id === groupId) continue;
      // Skip if already in a locked / manual group
      if (r.group_id && lockedGroupIds.has(r.group_id)) continue;
      // If candidate is in another group, only allow singletons (count === 1).
      if (r.group_id) {
        const count = groupMemberCount.get(r.group_id) ?? 0;
        if (count > 1) continue;
        const method = groupMethodById.get(r.group_id);
        if (method === "manual") continue;
      }

      out.push({
        id: r.id,
        platform: asPlatform(r.platform),
        caption_preview: captionPreview(r.caption),
        thumbnail_url: r.thumbnail_url ?? r.media_url ?? null,
        posted_at: r.posted_at,
        media_type: r.media_type,
        current_group_id: r.group_id,
        current_group_method: r.group_id
          ? groupMethodById.get(r.group_id) ?? null
          : null,
      });
      if (out.length >= limit) break;
    }

    return out;
  } catch (e) {
    console.error("findMergeCandidates: fatal —", e);
    return [];
  }
}

/**
 * Same body as findMergeCandidates — the dialog calls this via the API route.
 * Kept as a separate exported symbol so the route handler can import a stable
 * name even if we ever specialize the dialog flow.
 */
export async function findManualMergeCandidatesForGroup(
  groupId: string,
): Promise<MergeCandidate[]> {
  return findMergeCandidates(groupId);
}
