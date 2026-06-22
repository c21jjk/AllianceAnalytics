import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolver for the Building Consolidation feature.
 *
 * A "building" is one physical address (often a condo) that holds several MLS
 * unit-listings. `public.buildings` plus `properties.building_id` are the
 * source of truth — NOT the address-derived `v_listing_buildings` view. The
 * column lets staff fix address drift (e.g. "511 E 11th Avenue" vs "Street")
 * via the admin UI, and those manual overrides are reflected here.
 *
 * `buildings` / `properties.building_id` aren't in the generated `Database`
 * type yet, so this file uses a permissive client (cast through unknown).
 * Regenerate Supabase types after this lands to fold them in cleanly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;
function untyped(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

export interface BuildingMemberProperty {
  id: string;
  mls_number: string;
  source_mls: "cmc" | "sjsr" | null;
  address: string | null;
  city: string | null;
  status: string;
  list_price: number | null;
  listing_date: string | null;
}

export interface BuildingRecord {
  id: string;
  building_key: string | null;
  display_address: string | null;
  display_city: string | null;
  primary_property_id: string | null;
  members: BuildingMemberProperty[];
}

function asSourceMls(v: unknown): "cmc" | "sjsr" | null {
  return v === "cmc" || v === "sjsr" ? v : null;
}

function shapeMembers(rows: unknown[]): BuildingMemberProperty[] {
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    mls_number: String(r.mls_number),
    source_mls: asSourceMls(r.source_mls),
    address: (r.address as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    status: String(r.status ?? "active"),
    list_price:
      r.list_price === null || r.list_price === undefined
        ? null
        : Number(r.list_price),
    listing_date: (r.listing_date as string | null) ?? null,
  }));
}

const MEMBER_COLUMNS =
  "id, mls_number, source_mls, address, city, status, list_price, listing_date";

/** Load all member properties for a building id, listing_date-ascending. */
async function loadMembers(
  buildingId: string,
): Promise<BuildingMemberProperty[]> {
  const supabase = untyped();
  const { data } = await supabase
    .from("properties")
    .select(MEMBER_COLUMNS)
    .eq("building_id", buildingId)
    .order("listing_date", { ascending: true, nullsFirst: false });
  return shapeMembers(data ?? []);
}

async function hydrateBuildingRow(
  row: Record<string, unknown>,
): Promise<BuildingRecord> {
  const id = String(row.id);
  return {
    id,
    building_key: (row.building_key as string | null) ?? null,
    display_address: (row.display_address as string | null) ?? null,
    display_city: (row.display_city as string | null) ?? null,
    primary_property_id: (row.primary_property_id as string | null) ?? null,
    members: await loadMembers(id),
  };
}

/**
 * Return the building a property belongs to, fully hydrated with all member
 * units. Null when the property has no `building_id` (i.e. a single-family
 * listing that was never consolidated). This is the canonical entry point for
 * the read-path aggregation in owner-story-db.
 */
export async function getBuildingForProperty(
  propertyId: string,
): Promise<BuildingRecord | null> {
  if (!propertyId) return null;
  const supabase = untyped();
  const { data: prop } = await supabase
    .from("properties")
    .select("building_id")
    .eq("id", propertyId)
    .maybeSingle();
  const buildingId = (prop as { building_id?: string | null } | null)
    ?.building_id;
  if (!buildingId) return null;

  const { data: bRow } = await supabase
    .from("buildings")
    .select("id, building_key, display_address, display_city, primary_property_id")
    .eq("id", buildingId)
    .maybeSingle();
  if (!bRow) return null;
  return hydrateBuildingRow(bRow as Record<string, unknown>);
}

/**
 * Resolve the building for a property by its MLS#. Convenience wrapper for
 * surfaces that only carry the MLS string. Returns null when the MLS has no
 * row, or its property has no building_id.
 */
export async function getBuildingMembersByMls(
  mls: string,
): Promise<BuildingRecord | null> {
  if (!mls) return null;
  const supabase = untyped();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, building_id")
    .eq("mls_number", mls)
    .maybeSingle();
  const row = prop as { id?: string; building_id?: string | null } | null;
  if (!row?.id || !row.building_id) return null;
  return getBuildingForProperty(row.id);
}

/**
 * Membership info for a single MLS#, resolved against the Social DB. Returned
 * by {@link resolveBuildingMembership} so picker surfaces (which only carry an
 * mls_number from the Listings DB) can collapse a building's units into one
 * master entry without re-querying per row.
 */
export interface BuildingMembership {
  building_id: string;
  display_address: string | null;
  display_city: string | null;
  /** All member MLS#s of this building, primary first. */
  member_mls: string[];
  unit_count: number;
  /** MLS# of the building's primary_property_id, when resolvable. */
  primary_mls: string | null;
}

/**
 * Batch-resolve building membership for a list of MLS numbers.
 *
 * The two pickers (Social Post listing search + Open House) read from the
 * Listings DB, keyed by mls_number. Buildings + properties.building_id live
 * here in the Social DB, also keyed by properties.mls_number. mls_number is
 * unique per properties row, so we match purely on mls_number — source_mls is
 * accepted for signature compatibility but not needed for the lookup.
 *
 * Returns a Map keyed by the *input* mls_number. An MLS# that has no row in
 * properties, or whose property has no building_id, is simply absent from the
 * map (callers treat absence as "standalone, pass through unchanged"). Every
 * member of the same building maps to the same {@link BuildingMembership}
 * object, so callers can collapse by building_id.
 *
 * One batched query against properties, one against buildings.
 */
export async function resolveBuildingMembership(
  mlsNumbers: Array<string | { mls_number: string; source_mls?: string | null }>,
): Promise<Map<string, BuildingMembership>> {
  const out = new Map<string, BuildingMembership>();

  const inputMls = Array.from(
    new Set(
      mlsNumbers
        .map((m) => (typeof m === "string" ? m : m.mls_number))
        .map((m) => (m ?? "").trim())
        .filter((m) => m.length > 0),
    ),
  );
  if (inputMls.length === 0) return out;

  const supabase = untyped();

  // 1) Resolve the input MLS#s to their building_id (only those that have one).
  const { data: propRows } = await supabase
    .from("properties")
    .select("mls_number, building_id")
    .in("mls_number", inputMls)
    .not("building_id", "is", null);
  const rows = (propRows ?? []) as Array<{
    mls_number: string;
    building_id: string | null;
  }>;
  const inputMlsToBuilding = new Map<string, string>();
  const buildingIds = new Set<string>();
  for (const r of rows) {
    if (!r.building_id) continue;
    inputMlsToBuilding.set(r.mls_number, r.building_id);
    buildingIds.add(r.building_id);
  }
  if (buildingIds.size === 0) return out;

  const buildingIdList = Array.from(buildingIds);

  // 2) Load building display fields + primary_property_id for those buildings.
  const { data: bRows } = await supabase
    .from("buildings")
    .select("id, display_address, display_city, primary_property_id")
    .in("id", buildingIdList);
  const buildingById = new Map<
    string,
    {
      display_address: string | null;
      display_city: string | null;
      primary_property_id: string | null;
    }
  >();
  for (const b of (bRows ?? []) as Array<Record<string, unknown>>) {
    buildingById.set(String(b.id), {
      display_address: (b.display_address as string | null) ?? null,
      display_city: (b.display_city as string | null) ?? null,
      primary_property_id: (b.primary_property_id as string | null) ?? null,
    });
  }

  // 3) Load ALL members of those buildings (not just the input MLS#s) so the
  //    membership carries the complete unit list for the group-link write.
  const { data: memberRows } = await supabase
    .from("properties")
    .select("id, mls_number, building_id")
    .in("building_id", buildingIdList);
  const membersByBuilding = new Map<
    string,
    Array<{ id: string; mls_number: string }>
  >();
  for (const m of (memberRows ?? []) as Array<{
    id: string;
    mls_number: string;
    building_id: string | null;
  }>) {
    if (!m.building_id) continue;
    const list = membersByBuilding.get(m.building_id) ?? [];
    list.push({ id: m.id, mls_number: m.mls_number });
    membersByBuilding.set(m.building_id, list);
  }

  // 4) Assemble one BuildingMembership per building, primary MLS first.
  const membershipByBuilding = new Map<string, BuildingMembership>();
  for (const buildingId of buildingIdList) {
    const b = buildingById.get(buildingId);
    const members = membersByBuilding.get(buildingId) ?? [];
    let primaryMls: string | null = null;
    if (b?.primary_property_id) {
      const primary = members.find((m) => m.id === b.primary_property_id);
      primaryMls = primary?.mls_number ?? null;
    }
    // Order: primary MLS first, then the rest in stable order.
    const orderedMls = [
      ...(primaryMls ? [primaryMls] : []),
      ...members
        .map((m) => m.mls_number)
        .filter((m) => m !== primaryMls),
    ];
    membershipByBuilding.set(buildingId, {
      building_id: buildingId,
      display_address: b?.display_address ?? null,
      display_city: b?.display_city ?? null,
      member_mls: orderedMls,
      unit_count: orderedMls.length,
      primary_mls: primaryMls,
    });
  }

  // 5) Map every INPUT mls_number to its building's membership.
  for (const [mls, buildingId] of inputMlsToBuilding.entries()) {
    const membership = membershipByBuilding.get(buildingId);
    if (membership) out.set(mls, membership);
  }

  return out;
}

/** List every consolidated building with its member units. Used by the admin UI. */
export async function listBuildings(): Promise<BuildingRecord[]> {
  const supabase = untyped();
  const { data: bRows } = await supabase
    .from("buildings")
    .select("id, building_key, display_address, display_city, primary_property_id")
    .order("display_address", { ascending: true });
  const rows = (bRows ?? []) as Array<Record<string, unknown>>;
  const out: BuildingRecord[] = [];
  for (const r of rows) {
    out.push(await hydrateBuildingRow(r));
  }
  return out;
}
