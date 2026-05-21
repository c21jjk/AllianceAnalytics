import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin-side read helpers for office_post_announcements — used by the
 * /settings/announcements history view + the /settings/announcements/[group_id]
 * detail view that re-renders the sent email so John (and anyone with admin
 * access) can see exactly what landed in agents' inboxes.
 */

export interface AnnouncementHistoryRow {
  group_id: string;
  audience_scope: string;
  audience_label: string | null;
  recipient_count: number;
  sent_at: string;
  last_error: string | null;
  /** Listing address resolved via the linked post_group.property_id. */
  listing_address: string | null;
  listing_city: string | null;
}

interface RawRow {
  group_id: string;
  audience_scope: string;
  recipient_count: number;
  sent_at: string;
  last_error: string | null;
}

interface GroupRow {
  id: string;
  property_id: string | null;
}

interface PropertyRow {
  id: string;
  address: string | null;
  city: string | null;
}

interface OfficeRow {
  short_code: string;
  name: string;
  display_name: string | null;
  division: string | null;
}

function divisionLabel(slug: string): string {
  if (slug === "shore") return "Shore Division";
  if (slug === "south_jersey") return "South Jersey Division";
  return (
    slug
      .split("_")
      .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
      .join(" ") + " Division"
  );
}

/**
 * List recent announcements with listing + audience labels folded in. Sorted
 * by sent_at DESC. Defaults to the last 30 rows — plenty for the admin
 * inspection use case.
 */
export async function listRecentAnnouncements(opts?: {
  limit?: number;
}): Promise<AnnouncementHistoryRow[]> {
  const limit = opts?.limit ?? 30;
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from("office_post_announcements")
    .select("group_id, audience_scope, recipient_count, sent_at, last_error")
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error || !rows) return [];

  const raw = rows as RawRow[];
  if (raw.length === 0) return [];

  // Resolve listing addresses via post_groups → properties.
  const groupIds = raw.map((r) => r.group_id);
  const { data: groupRows } = await supabase
    .from("post_groups")
    .select("id, property_id")
    .in("id", groupIds);
  const groupsById = new Map<string, GroupRow>();
  for (const g of (groupRows ?? []) as GroupRow[]) groupsById.set(g.id, g);

  const propertyIds = Array.from(
    new Set(
      (groupRows ?? [])
        .map((g) => (g as GroupRow).property_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const propertiesById = new Map<string, PropertyRow>();
  if (propertyIds.length > 0) {
    const { data: propRows } = await supabase
      .from("properties")
      .select("id, address, city")
      .in("id", propertyIds);
    for (const p of (propRows ?? []) as PropertyRow[]) {
      propertiesById.set(p.id, p);
    }
  }

  // Resolve audience labels via offices.
  const { data: officeRows } = await supabase
    .from("offices")
    .select("short_code, name, display_name, division");
  const offices = (officeRows ?? []) as OfficeRow[];
  const officeByShortCode = new Map(offices.map((o) => [o.short_code, o]));

  return raw.map<AnnouncementHistoryRow>((r) => {
    const group = groupsById.get(r.group_id);
    const prop = group?.property_id
      ? propertiesById.get(group.property_id)
      : null;

    // Match the orchestrator: office:* tags always escalate to division.
    // The label shown here is the division the email actually went to;
    // the original tag stays available via the audience_scope column.
    let audienceLabel: string | null = null;
    if (r.audience_scope.startsWith("office:")) {
      const slug = r.audience_scope.slice("office:".length);
      const office = officeByShortCode.get(slug);
      audienceLabel = office?.division
        ? divisionLabel(office.division)
        : office?.display_name?.trim() || office?.name || slug;
    } else if (r.audience_scope.startsWith("division:")) {
      const slug = r.audience_scope.slice("division:".length);
      audienceLabel = divisionLabel(slug);
    } else {
      audienceLabel = r.audience_scope;
    }

    return {
      group_id: r.group_id,
      audience_scope: r.audience_scope,
      audience_label: audienceLabel,
      recipient_count: r.recipient_count,
      sent_at: r.sent_at,
      last_error: r.last_error,
      listing_address: prop?.address ?? null,
      listing_city: prop?.city ?? null,
    };
  });
}
