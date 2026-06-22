-- Building Consolidation: one logical listing per physical building.
-- Some buildings (condos) hold many MLS unit-listings. This groups them so
-- Owner Stories and metrics report the whole-building picture, not per-unit.

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  building_key text,
  display_address text,
  display_city text,
  primary_property_id uuid references public.properties(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.properties
  add column if not exists building_id uuid references public.buildings(id);

create index if not exists idx_properties_building_id
  on public.properties (building_id);

-- RLS mirrors post_listings: read for authenticated, writes service-role only.
-- (post_listings has only a read policy for authenticated; service-role bypasses
--  RLS entirely, so no explicit write policy is needed.)
alter table public.buildings enable row level security;

drop policy if exists buildings_read_authenticated on public.buildings;
create policy buildings_read_authenticated
  on public.buildings
  for select
  to authenticated
  using (true);

-- ------------------------------------------------------------------
-- Backfill: one buildings row per existing v_listing_buildings group.
-- ------------------------------------------------------------------
-- v_listing_buildings groups by normalize_address(address|city) and only
-- surfaces groups with >= 2 members. We create one buildings row per group,
-- then stamp properties.building_id by joining on the SAME normalized key.

with grp as (
  select
    building_key,
    min(display_address) as display_address,
    min(display_city) as display_city
  from public.v_listing_buildings
  group by building_key
)
insert into public.buildings (building_key, display_address, display_city)
select g.building_key, g.display_address, g.display_city
from grp g
where not exists (
  select 1 from public.buildings b where b.building_key = g.building_key
);

-- Stamp member properties with their building_id via the normalized address key.
update public.properties p
set building_id = b.id,
    updated_at = now()
from public.buildings b
where b.building_key = normalize_address(
        (coalesce(p.address, '') || '|' || coalesce(p.city, ''))
      )
  and p.address is not null
  and trim(p.address) <> '';

-- primary_property_id = member with the earliest listing_date (ties: stable by id).
update public.buildings b
set primary_property_id = sub.id,
    updated_at = now()
from (
  select distinct on (building_id) building_id, id
  from public.properties
  where building_id is not null
  order by building_id, listing_date asc nulls last, id asc
) sub
where sub.building_id = b.id;

-- ------------------------------------------------------------------
-- Manual override: 511 E 11th, North Wildwood.
-- The normalized address drifts between "Avenue" and "Street" so the view
-- splits it into two groups. Unify ALL units at that address into one
-- building (keep the building row that already holds the most members; fold
-- the rest in, then recompute its primary_property_id).
-- ------------------------------------------------------------------
do $$
declare
  target_building uuid;
begin
  -- Pick the building currently holding the most 511 E 11th members.
  select p.building_id
  into target_building
  from public.properties p
  where p.address ilike '511 E 11th%'
    and p.city ilike '%north wildwood%'
    and p.building_id is not null
  group by p.building_id
  order by count(*) desc
  limit 1;

  -- If somehow none were stamped (all single-member, not in the view), make one.
  if target_building is null then
    insert into public.buildings (building_key, display_address, display_city)
    values ('511 e 11th ave|north wildwood', '511 E 11th Avenue', 'North Wildwood')
    returning id into target_building;
  end if;

  -- Move every 511 E 11th unit onto the target building.
  update public.properties p
  set building_id = target_building,
      updated_at = now()
  where p.address ilike '511 E 11th%'
    and p.city ilike '%north wildwood%';

  -- Drop now-empty building rows that used to hold the split-off units.
  delete from public.buildings b
  where b.id <> target_building
    and not exists (
      select 1 from public.properties p where p.building_id = b.id
    );

  -- Recompute primary_property_id for the unified building.
  update public.buildings b
  set primary_property_id = (
        select id from public.properties
        where building_id = target_building
        order by listing_date asc nulls last, id asc
        limit 1
      ),
      updated_at = now()
  where b.id = target_building;
end $$;
