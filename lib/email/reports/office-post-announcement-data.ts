import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data layer for the office post announcement email — one email per
 * `post_groups` row (a "campaign") that:
 *   1. has category = 'property' (UI label: "Property Promotion")
 *   2. has audience_scope = `office:{short_code}` OR `division:{slug}`
 *   3. has not yet been announced (no row in office_post_announcements)
 *
 * Each eligible group fans out to every active subscriber in the resolved
 * audience (a single office, or every office inside the named division).
 * The listing agent IS included — Larissa creates posts on agents' behalf,
 * so the alert is the heads-up that their listing has been promoted.
 *
 * Co-op listings (alliance_role NOT IN ('listing','both')) are skipped per
 * the global rule that Alliance only markets its own listings.
 */

export type Platform = "facebook" | "instagram" | "tiktok";

export interface AnnouncementPostVariant {
  id: string;
  platform: Platform;
  permalink: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  media_type: string | null;
}

export interface AnnouncementAudience {
  scope_raw: string;                       // "office:wildwood" | "division:shore"
  kind: "office" | "division";
  label: string;                           // "Wildwood Crest" | "Shore Division"
  short_code_or_slug: string;              // "wildwood" | "shore"
}

export interface AnnouncementListing {
  property_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  office_id: string | null;
  alliance_role: string;
}

export interface AnnouncementCandidate {
  group_id: string;
  audience: AnnouncementAudience;
  listing: AnnouncementListing;
  posts: AnnouncementPostVariant[];
  recipient_emails: string[];
}

const PLATFORM_VALUES: Platform[] = ["facebook", "instagram", "tiktok"];

function asPlatform(v: unknown): Platform | null {
  if (v === "facebook" || v === "instagram" || v === "tiktok") return v;
  return null;
}

interface OfficeRow {
  id: string;
  short_code: string;
  name: string;
  display_name: string | null;
  division: string | null;
}

interface GroupRow {
  id: string;
  audience_scope: string | null;
  category: string | null;
  property_id: string | null;
}

interface PostRow {
  id: string;
  group_id: string | null;
  platform: string;
  permalink: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  media_type: string | null;
}

interface PropertyRow {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  office_id: string | null;
  alliance_role: string;
}

function parseAudience(
  scope: string | null,
): { kind: "office" | "division"; key: string } | null {
  if (!scope) return null;
  const trimmed = scope.trim();
  if (trimmed.startsWith("office:")) {
    const key = trimmed.slice("office:".length).trim();
    if (!key) return null;
    return { kind: "office", key };
  }
  if (trimmed.startsWith("division:")) {
    const key = trimmed.slice("division:".length).trim();
    if (!key) return null;
    return { kind: "division", key };
  }
  return null;
}

function divisionLabel(slug: string): string {
  if (slug === "shore") return "Shore Division";
  if (slug === "south_jersey") return "South Jersey Division";
  // Defensive fallback — title-case unknown slugs.
  return (
    slug
      .split("_")
      .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
      .join(" ") + " Division"
  );
}

function dedupeEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    if (!raw) continue;
    const key = raw.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

/**
 * Find every post_group eligible to fire an announcement RIGHT NOW.
 * Returns the resolved candidates with listing + posts + recipients baked
 * in — the orchestrator just renders + sends + records.
 *
 * Filters:
 *   - category = 'property'
 *   - audience_scope starts with 'office:' or 'division:'
 *   - group has at least one post on a supported platform
 *   - linked property's alliance_role IN ('listing', 'both')
 *   - no row in office_post_announcements for this group_id yet
 *   - (when `freshOnly` is true) at least one post in the group within the
 *     last 30 hours — keeps the daily 8am cron's blast scoped to "things
 *     posted since the previous morning's run" without re-blasting old
 *     content if the cron misfires once
 */
export async function findEligibleAnnouncements(opts?: {
  freshOnly?: boolean;
}): Promise<AnnouncementCandidate[]> {
  const freshOnly = opts?.freshOnly ?? true;
  const supabase = createAdminClient();

  // 1) Pull eligible groups: property category, office/division audience.
  const { data: groupRows, error: groupErr } = await supabase
    .from("post_groups")
    .select("id, audience_scope, category, property_id")
    .eq("category", "property")
    .not("audience_scope", "is", null);
  if (groupErr || !groupRows) return [];
  const eligibleGroups: GroupRow[] = (groupRows as GroupRow[]).filter((g) => {
    const aud = parseAudience(g.audience_scope);
    return aud !== null;
  });
  if (eligibleGroups.length === 0) return [];

  // 2) Filter out groups already announced.
  const { data: alreadySent } = await supabase
    .from("office_post_announcements")
    .select("group_id");
  const sentIds = new Set(
    ((alreadySent ?? []) as Array<{ group_id: string }>).map((r) => r.group_id),
  );
  const unsentGroups = eligibleGroups.filter((g) => !sentIds.has(g.id));
  if (unsentGroups.length === 0) return [];

  // 3) Pull all posts for those groups.
  const groupIdList = unsentGroups.map((g) => g.id);
  const { data: postRowsRaw } = await supabase
    .from("posts")
    .select(
      "id, group_id, platform, permalink, thumbnail_url, posted_at, media_type",
    )
    .in("group_id", groupIdList);
  const postRows = (postRowsRaw ?? []) as PostRow[];
  const postsByGroup = new Map<string, PostRow[]>();
  for (const p of postRows) {
    if (!p.group_id) continue;
    const list = postsByGroup.get(p.group_id) ?? [];
    list.push(p);
    postsByGroup.set(p.group_id, list);
  }

  // 4) Filter to groups with posts AND (optional) freshness check.
  // Window is 30h, not 24h, so a late cron tick (or one missed entirely)
  // still catches yesterday's posts on the next morning's run.
  const freshCutoffMs = Date.now() - 30 * 60 * 60 * 1000;
  const withPosts: GroupRow[] = [];
  for (const g of unsentGroups) {
    const posts = postsByGroup.get(g.id) ?? [];
    const supportedPosts = posts.filter(
      (p) => asPlatform(p.platform) !== null && p.permalink,
    );
    if (supportedPosts.length === 0) continue;
    if (freshOnly) {
      const hasFresh = supportedPosts.some((p) => {
        if (!p.posted_at) return false;
        const t = Date.parse(p.posted_at);
        return Number.isFinite(t) && t >= freshCutoffMs;
      });
      if (!hasFresh) continue;
    }
    withPosts.push(g);
  }
  if (withPosts.length === 0) return [];

  // 5) Pull properties for the surviving groups.
  const propertyIds = Array.from(
    new Set(
      withPosts
        .map((g) => g.property_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const propertiesById = new Map<string, PropertyRow>();
  if (propertyIds.length > 0) {
    const { data: propRows } = await supabase
      .from("properties")
      .select(
        "id, address, city, state, zip, hero_image_url, agent_name, agent_email, office_id, alliance_role",
      )
      .in("id", propertyIds);
    for (const p of (propRows ?? []) as PropertyRow[]) {
      propertiesById.set(p.id, p);
    }
  }

  // 6) Pull every active office (small table) for audience resolution.
  const { data: officeRows } = await supabase
    .from("offices")
    .select("id, short_code, name, display_name, division")
    .eq("is_active", true);
  const offices = (officeRows ?? []) as OfficeRow[];
  const officeByShortCode = new Map(offices.map((o) => [o.short_code, o]));
  const officesByDivision = new Map<string, OfficeRow[]>();
  for (const o of offices) {
    if (!o.division) continue;
    const list = officesByDivision.get(o.division) ?? [];
    list.push(o);
    officesByDivision.set(o.division, list);
  }

  // 7) Pull subscribers in one shot — small table. We'll filter in JS.
  type SubRow = {
    email: string;
    office_id: string | null;
    is_active: boolean;
    receives_office_post_alerts: boolean;
  };
  const { data: subRows } = await supabase
    .from("email_subscribers")
    .select("email, office_id, is_active, receives_office_post_alerts")
    .eq("is_active", true)
    .eq("receives_office_post_alerts", true);
  const activeSubs = (subRows ?? []) as SubRow[];

  // 8) Materialize one candidate per group.
  const candidates: AnnouncementCandidate[] = [];
  for (const group of withPosts) {
    const aud = parseAudience(group.audience_scope);
    if (!aud) continue;

    // Audience resolution: office:* tags ALWAYS escalate to the whole
    // division (per John, 2026-05-21 — we never blast a single office
    // because Alliance markets each other's listings across the full
    // regional market). The original tag is preserved in scope_raw for
    // audit; label + recipients reflect the escalated division.
    let divisionSlug: string;
    if (aud.kind === "office") {
      const office = officeByShortCode.get(aud.key);
      if (!office || !office.division) continue;
      divisionSlug = office.division;
    } else {
      divisionSlug = aud.key;
    }
    const divisionOffices = officesByDivision.get(divisionSlug) ?? [];
    if (divisionOffices.length === 0) continue;
    const label = divisionLabel(divisionSlug);
    const scopedOfficeIds = new Set(divisionOffices.map((o) => o.id));

    // Resolve listing — skip co-op buyer-side rows.
    if (!group.property_id) continue;
    const prop = propertiesById.get(group.property_id);
    if (!prop) continue;
    if (prop.alliance_role !== "listing" && prop.alliance_role !== "both") {
      continue;
    }

    // Resolve recipients.
    const matchedSubs = activeSubs.filter(
      (s) => s.office_id && scopedOfficeIds.has(s.office_id),
    );
    // Always include the listing agent (per Larissa's rule) — Alliance creates
    // on their behalf, so the alert IS the heads-up.
    const recipientEmails = dedupeEmails([
      ...matchedSubs.map((s) => s.email),
      prop.agent_email,
    ]);
    if (recipientEmails.length === 0) continue;

    // Order the posts stably: FB → IG → TT, dropping anything unsupported.
    const posts: AnnouncementPostVariant[] = [];
    const grouped = new Map<Platform, PostRow>();
    for (const p of postsByGroup.get(group.id) ?? []) {
      const platform = asPlatform(p.platform);
      if (!platform || !p.permalink) continue;
      // If multiple posts on the same platform, keep the most recent one.
      const existing = grouped.get(platform);
      if (!existing) {
        grouped.set(platform, p);
      } else {
        const a = existing.posted_at ? Date.parse(existing.posted_at) : 0;
        const b = p.posted_at ? Date.parse(p.posted_at) : 0;
        if (b > a) grouped.set(platform, p);
      }
    }
    for (const platform of PLATFORM_VALUES) {
      const row = grouped.get(platform);
      if (!row) continue;
      posts.push({
        id: row.id,
        platform,
        permalink: row.permalink,
        thumbnail_url: row.thumbnail_url,
        posted_at: row.posted_at,
        media_type: row.media_type,
      });
    }
    if (posts.length === 0) continue;

    candidates.push({
      group_id: group.id,
      audience: {
        // Preserve the original tag so the history view can show what Larissa
        // actually selected, even though we always escalate to division.
        scope_raw: group.audience_scope as string,
        kind: "division",
        label,
        short_code_or_slug: divisionSlug,
      },
      listing: {
        property_id: prop.id,
        address: prop.address,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        hero_image_url: prop.hero_image_url,
        agent_name: prop.agent_name,
        agent_email: prop.agent_email,
        office_id: prop.office_id,
        alliance_role: prop.alliance_role,
      },
      posts,
      recipient_emails: recipientEmails,
    });
  }

  return candidates;
}

/**
 * Resolve a single candidate for the admin history view — bypasses the
 * "already announced" + freshness filters so the /settings/announcements
 * detail page can re-render an email that already went out.
 *
 * Returns null when the group can't be reconstructed (e.g., property was
 * deleted, audience scope is unrecognized).
 */
export async function resolveSingleCandidate(
  group_id: string,
): Promise<AnnouncementCandidate | null> {
  const supabase = createAdminClient();

  const { data: groupRow } = await supabase
    .from("post_groups")
    .select("id, audience_scope, category, property_id")
    .eq("id", group_id)
    .maybeSingle();
  if (!groupRow) return null;
  const group = groupRow as GroupRow;

  const aud = parseAudience(group.audience_scope);
  if (!aud) return null;

  // Listing
  if (!group.property_id) return null;
  const { data: propRow } = await supabase
    .from("properties")
    .select(
      "id, address, city, state, zip, hero_image_url, agent_name, agent_email, office_id, alliance_role",
    )
    .eq("id", group.property_id)
    .maybeSingle();
  if (!propRow) return null;
  const prop = propRow as PropertyRow;

  // Posts
  const { data: postRowsRaw } = await supabase
    .from("posts")
    .select(
      "id, group_id, platform, permalink, thumbnail_url, posted_at, media_type",
    )
    .eq("group_id", group_id);
  const postRows = (postRowsRaw ?? []) as PostRow[];

  // Audience resolution
  const { data: officeRows } = await supabase
    .from("offices")
    .select("id, short_code, name, display_name, division")
    .eq("is_active", true);
  const offices = (officeRows ?? []) as OfficeRow[];
  const officeByShortCode = new Map(offices.map((o) => [o.short_code, o]));
  // Audience escalation mirrors findEligibleAnnouncements — office:* tags
  // always resolve to their parent division so the email always blasts the
  // full division roster.
  let divisionSlug: string;
  if (aud.kind === "office") {
    const office = officeByShortCode.get(aud.key);
    if (!office || !office.division) return null;
    divisionSlug = office.division;
  } else {
    divisionSlug = aud.key;
  }
  const divisionOffices = offices.filter((o) => o.division === divisionSlug);
  if (divisionOffices.length === 0) return null;
  const label = divisionLabel(divisionSlug);
  const scopedOfficeIds = new Set(divisionOffices.map((o) => o.id));

  // Recipients
  type SubRow = {
    email: string;
    office_id: string | null;
  };
  const { data: subRows } = await supabase
    .from("email_subscribers")
    .select("email, office_id, is_active, receives_office_post_alerts")
    .eq("is_active", true)
    .eq("receives_office_post_alerts", true);
  const subs = (subRows ?? []) as SubRow[];
  const matchedSubs = subs.filter(
    (s) => s.office_id && scopedOfficeIds.has(s.office_id),
  );
  const recipientEmails = dedupeEmails([
    ...matchedSubs.map((s) => s.email),
    prop.agent_email,
  ]);

  // Stable platform order, one row per platform.
  const grouped = new Map<Platform, PostRow>();
  for (const p of postRows) {
    const platform = asPlatform(p.platform);
    if (!platform || !p.permalink) continue;
    const existing = grouped.get(platform);
    if (!existing) {
      grouped.set(platform, p);
    } else {
      const a = existing.posted_at ? Date.parse(existing.posted_at) : 0;
      const b = p.posted_at ? Date.parse(p.posted_at) : 0;
      if (b > a) grouped.set(platform, p);
    }
  }
  const posts: AnnouncementPostVariant[] = [];
  for (const platform of PLATFORM_VALUES) {
    const row = grouped.get(platform);
    if (!row) continue;
    posts.push({
      id: row.id,
      platform,
      permalink: row.permalink,
      thumbnail_url: row.thumbnail_url,
      posted_at: row.posted_at,
      media_type: row.media_type,
    });
  }
  if (posts.length === 0) return null;

  return {
    group_id: group.id,
    audience: {
      scope_raw: group.audience_scope as string,
      kind: "division",
      label,
      short_code_or_slug: divisionSlug,
    },
    listing: {
      property_id: prop.id,
      address: prop.address,
      city: prop.city,
      state: prop.state,
      zip: prop.zip,
      hero_image_url: prop.hero_image_url,
      agent_name: prop.agent_name,
      agent_email: prop.agent_email,
      office_id: prop.office_id,
      alliance_role: prop.alliance_role,
    },
    posts,
    recipient_emails: recipientEmails,
  };
}

/**
 * Mark a group as announced. Idempotent — UPSERT on the group_id PK so that a
 * concurrent cron pass can't double-fire even if the orchestrator races itself.
 */
export async function recordAnnouncement(input: {
  group_id: string;
  audience_scope: string;
  recipient_count: number;
  last_error?: string | null;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("office_post_announcements").upsert(
    {
      group_id: input.group_id,
      audience_scope: input.audience_scope,
      recipient_count: input.recipient_count,
      sent_at: new Date().toISOString(),
      last_error: input.last_error ?? null,
    },
    { onConflict: "group_id" },
  );
}
