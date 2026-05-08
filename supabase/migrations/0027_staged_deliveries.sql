-- =========================================================
-- 0027_staged_deliveries.sql
--
-- Implements the database foundation for the Staged Deliveries
-- feature.  A staged delivery is product physically set aside
-- for a customer but not yet recorded as an actual delivery.
--
-- Changes:
--   1.  staged_deliveries table + RLS
--   2.  staged_delivery_items table + RLS
--   3.  updated_at triggers for both tables
--   4.  v_staged_deliveries   — flat per-item list view
--   5.  v_staged_inventory_by_item — aggregated staged units
--   6.  Rebuild v_on_hand_inventory with staged_units +
--         available_units columns
--   7.  Rebuild v_on_hand_inventory_wide to pivot
--         available_units (not units_on_hand)
--   8.  Rebuild v_inventory_print_sheet with staged_units +
--         available_units
--   9.  Rebuild v_agent_inventory (SELECT * wrapper must be
--         recreated after its base view changes)
--   10. v_agent_staged_deliveries — agent SQL-fallback view
--
-- Inventory definitions:
--   physical_on_hand  = received - delivered + returned
--   staged_units      = sum of items in in_progress staged deliveries
--   available_units   = physical_on_hand - staged_units
--
-- Dependency order (drop → recreate):
--   Drop  : v_agent_inventory
--            v_inventory_print_sheet
--            v_on_hand_inventory_wide
--            v_on_hand_inventory
--   Create: v_on_hand_inventory
--            v_on_hand_inventory_wide
--            v_inventory_print_sheet
--            v_agent_inventory
-- =========================================================


-- ---------------------------------------------------------
-- 1) staged_deliveries (header)
--
--    One row per staged delivery event.
--    status values:
--      'in_progress' — active staged delivery, reserves inventory
--      'converted'   — converted to an actual delivery; no longer reserves inventory
--      'cancelled'   — cancelled; no longer reserves inventory
-- ---------------------------------------------------------
create table if not exists public.staged_deliveries (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  customer_id  uuid        not null references public.customers(id) on delete restrict,
  season_year  integer     not null,
  staged_date  date        not null,
  notes        text        null,
  status       text        not null default 'in_progress'
                           check (status in ('in_progress', 'converted', 'cancelled')),
  converted_at timestamptz null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.staged_deliveries
  alter column user_id set default auth.uid();

create index if not exists idx_staged_deliveries_user_status
  on public.staged_deliveries (user_id, status);

create index if not exists idx_staged_deliveries_user_season
  on public.staged_deliveries (user_id, season_year);


-- ---------------------------------------------------------
-- 2) staged_delivery_items (line items)
--
--    One row per product + treatment + seed_size + package_type
--    within a staged delivery.  Mirrors the grain of deliveries.
-- ---------------------------------------------------------
create table if not exists public.staged_delivery_items (
  id                  uuid    primary key default gen_random_uuid(),
  staged_delivery_id  uuid    not null references public.staged_deliveries(id) on delete cascade,
  user_id             uuid    not null references auth.users(id) on delete cascade,
  product_id          uuid    not null references public.products(id) on delete restrict,
  treatment_id        uuid    not null references public.treatments(id) on delete restrict,
  seed_size           text    null,
  package_type        text    not null default 'bag'
                              check (package_type in ('bag', 'tote')),
  units_staged        integer not null check (units_staged > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.staged_delivery_items
  alter column user_id set default auth.uid();

create index if not exists idx_staged_delivery_items_delivery
  on public.staged_delivery_items (staged_delivery_id);

create index if not exists idx_staged_delivery_items_user_product
  on public.staged_delivery_items (user_id, product_id, treatment_id);


-- ---------------------------------------------------------
-- 3) updated_at triggers
--    Reuse the existing set_updated_at() function from
--    migration 0002.
-- ---------------------------------------------------------
drop trigger if exists trg_staged_deliveries_updated_at on public.staged_deliveries;
create trigger trg_staged_deliveries_updated_at
  before update on public.staged_deliveries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_staged_delivery_items_updated_at on public.staged_delivery_items;
create trigger trg_staged_delivery_items_updated_at
  before update on public.staged_delivery_items
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------
-- 4) RLS — staged_deliveries
-- ---------------------------------------------------------
alter table public.staged_deliveries enable row level security;

drop policy if exists "Users can read own staged_deliveries"   on public.staged_deliveries;
drop policy if exists "Users can insert own staged_deliveries" on public.staged_deliveries;
drop policy if exists "Users can update own staged_deliveries" on public.staged_deliveries;
drop policy if exists "Users can delete own staged_deliveries" on public.staged_deliveries;

create policy "Users can read own staged_deliveries"
  on public.staged_deliveries for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own staged_deliveries"
  on public.staged_deliveries for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own staged_deliveries"
  on public.staged_deliveries for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own staged_deliveries"
  on public.staged_deliveries for delete to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------
-- 5) RLS — staged_delivery_items
-- ---------------------------------------------------------
alter table public.staged_delivery_items enable row level security;

drop policy if exists "Users can read own staged_delivery_items"   on public.staged_delivery_items;
drop policy if exists "Users can insert own staged_delivery_items" on public.staged_delivery_items;
drop policy if exists "Users can update own staged_delivery_items" on public.staged_delivery_items;
drop policy if exists "Users can delete own staged_delivery_items" on public.staged_delivery_items;

create policy "Users can read own staged_delivery_items"
  on public.staged_delivery_items for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own staged_delivery_items"
  on public.staged_delivery_items for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own staged_delivery_items"
  on public.staged_delivery_items for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own staged_delivery_items"
  on public.staged_delivery_items for delete to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------
-- 6) v_staged_deliveries
--
--    Flat per-item view of all staged deliveries with header
--    info joined in.  Shows all statuses so the UI can filter
--    by status = 'in_progress' for the active list and show
--    history if needed.
--
--    Grain: one row per staged_delivery_item.
-- ---------------------------------------------------------
create or replace view public.v_staged_deliveries as
select
  sd.id                    as staged_delivery_id,
  sdi.id                   as staged_delivery_item_id,
  sd.user_id,
  sd.customer_id,
  c.customer_name,
  c.farm_name,
  sd.season_year,
  sd.staged_date,
  sd.notes,
  sd.status,
  sd.converted_at,
  sd.created_at,
  sd.updated_at,
  sdi.product_id,
  p.product_name,
  sdi.treatment_id,
  t.treatment_name,
  sdi.seed_size,
  sdi.package_type,
  sdi.units_staged
from public.staged_deliveries     sd
join public.customers             c   on c.id  = sd.customer_id
                                     and c.user_id = sd.user_id
join public.staged_delivery_items sdi on sdi.staged_delivery_id = sd.id
                                     and sdi.user_id = sd.user_id
join public.products              p   on p.id  = sdi.product_id
join public.treatments            t   on t.id  = sdi.treatment_id
where sd.user_id = auth.uid();


-- ---------------------------------------------------------
-- 7) v_staged_inventory_by_item
--
--    Aggregated staged units per product + treatment +
--    seed_size + package_type.  Only includes in_progress
--    staged deliveries — the set that reserves inventory.
--
--    Grain: one row per (product, treatment, seed_size,
--           package_type) combination across all in_progress
--           staged deliveries for the current user.
-- ---------------------------------------------------------
create or replace view public.v_staged_inventory_by_item as
select
  sd.user_id,
  sd.season_year,
  sdi.product_id,
  p.product_name,
  sdi.treatment_id,
  t.treatment_name,
  sdi.seed_size,
  sdi.package_type,
  sum(sdi.units_staged)::integer as units_staged
from public.staged_delivery_items sdi
join public.staged_deliveries     sd  on sd.id = sdi.staged_delivery_id
join public.products              p   on p.id  = sdi.product_id
join public.treatments            t   on t.id  = sdi.treatment_id
where sd.user_id = auth.uid()
  and sd.status  = 'in_progress'
group by
  sd.user_id,
  sd.season_year,
  sdi.product_id,
  p.product_name,
  sdi.treatment_id,
  t.treatment_name,
  sdi.seed_size,
  sdi.package_type;


-- ---------------------------------------------------------
-- 8) Rebuild inventory views
--
--    v_agent_inventory, v_inventory_print_sheet, and
--    v_on_hand_inventory_wide all depend on v_on_hand_inventory
--    via SELECT *.  They must be dropped before v_on_hand_inventory
--    is dropped, then recreated in the correct order.
--
--    Drop order (reverse dependency):
--      1. v_agent_inventory
--      2. v_inventory_print_sheet
--      3. v_on_hand_inventory_wide
--      4. v_on_hand_inventory
-- ---------------------------------------------------------
drop view if exists public.v_agent_inventory;
drop view if exists public.v_inventory_print_sheet;
drop view if exists public.v_on_hand_inventory_wide;
drop view if exists public.v_on_hand_inventory;


-- ---------------------------------------------------------
-- 8a) v_on_hand_inventory  (rebuilt with staged support)
--
--    Adds a staged CTE and two new computed columns:
--      units_staged   — reserved in in_progress staged deliveries
--      available_units — units_on_hand - units_staged
--
--    The keys CTE unions staged items so combinations that only
--    exist in staged deliveries appear in the view with
--    units_on_hand = 0 and available_units < 0.
--
--    Column order is preserved for positions 1-10 from
--    migration 0022; units_staged and available_units are new
--    additions at positions 11-12.
--
--    All existing CTEs (received, delivered, returned) and
--    join logic are unchanged from migration 0022.
--
--    Grain: one row per (product, treatment, seed_size,
--           package_type) — unchanged from migration 0022.
-- ---------------------------------------------------------
create view public.v_on_hand_inventory as
with received as (
  select i.product_id,
         i.treatment_id,
         null::text                      as seed_size,
         i.package_type,
         sum(i.units_received)::integer  as units_received
    from bayer_shipment_items i
   where i.user_id = auth.uid()
   group by i.product_id, i.treatment_id, i.package_type
),
delivered as (
  select d.product_id,
         d.treatment_id,
         d.seed_size,
         d.package_type,
         sum(d.units_delivered)::integer as units_delivered
    from deliveries d
   where d.user_id = auth.uid()
   group by d.product_id, d.treatment_id, d.seed_size, d.package_type
),
returned as (
  select r.product_id,
         r.treatment_id,
         r.seed_size,
         r.package_type,
         sum(r.units_returned)::integer  as units_returned
    from returns r
   where r.user_id = auth.uid()
   group by r.product_id, r.treatment_id, r.seed_size, r.package_type
),
staged as (
  -- Only in_progress staged deliveries reserve inventory.
  -- Filter through staged_deliveries header for the user_id
  -- and status check.  IS NOT DISTINCT FROM used below for
  -- NULL-safe join on seed_size and package_type.
  select sdi.product_id,
         sdi.treatment_id,
         sdi.seed_size,
         sdi.package_type,
         sum(sdi.units_staged)::integer  as units_staged
    from staged_delivery_items sdi
    join staged_deliveries     sd  on sd.id = sdi.staged_delivery_id
   where sd.user_id = auth.uid()
     and sd.status  = 'in_progress'
   group by sdi.product_id, sdi.treatment_id, sdi.seed_size, sdi.package_type
),
keys as (
  select product_id, treatment_id, seed_size, package_type from received
  union
  select product_id, treatment_id, seed_size, package_type from delivered
  union
  select product_id, treatment_id, seed_size, package_type from returned
  union
  -- Include staged-only combinations so they appear in the view
  -- with units_on_hand = 0 and available_units < 0.
  select product_id, treatment_id, seed_size, package_type from staged
)
select
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  k.seed_size,
  coalesce(rc.units_received,  0)                        as units_received,
  coalesce(dv.units_delivered, 0)                        as units_delivered,
  coalesce(rt.units_returned,  0)                        as units_returned,
  -- physical on hand: unchanged formula from migration 0022
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    + coalesce(rt.units_returned,  0)                    as units_on_hand,
  k.package_type,
  -- staged units: reserved in active staged deliveries
  coalesce(sg.units_staged, 0)                           as units_staged,
  -- available units: what can still be sold or committed
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    + coalesce(rt.units_returned,  0)
    - coalesce(sg.units_staged, 0)                       as available_units
from keys k
join products   p  on p.id = k.product_id
join treatments t  on t.id = k.treatment_id
left join received  rc on rc.product_id   = k.product_id
                      and rc.treatment_id  = k.treatment_id
                      and rc.seed_size     is not distinct from k.seed_size
                      and rc.package_type  is not distinct from k.package_type
left join delivered dv on dv.product_id   = k.product_id
                      and dv.treatment_id  = k.treatment_id
                      and dv.seed_size     is not distinct from k.seed_size
                      and dv.package_type  is not distinct from k.package_type
left join returned  rt on rt.product_id   = k.product_id
                      and rt.treatment_id  = k.treatment_id
                      and rt.seed_size     is not distinct from k.seed_size
                      and rt.package_type  is not distinct from k.package_type
left join staged    sg on sg.product_id   = k.product_id
                      and sg.treatment_id  = k.treatment_id
                      and sg.seed_size     is not distinct from k.seed_size
                      and sg.package_type  is not distinct from k.package_type;


-- ---------------------------------------------------------
-- 8b) v_on_hand_inventory_wide  (rebuilt)
--
--    Now pivots available_units instead of units_on_hand so
--    the wide view shows the operationally meaningful quantity
--    (what can still be committed to another customer).
--
--    All other logic unchanged from migration 0022.
-- ---------------------------------------------------------
create view public.v_on_hand_inventory_wide as
select
  v.product_id,
  v.product_name,
  sum(case when v.treatment_name = 'DIAMIDE'            then v.available_units else 0 end) as "DIAMIDE",
  sum(case when v.treatment_name = 'Fung/Insect'        then v.available_units else 0 end) as "Fung/Insect",
  sum(case when v.treatment_name = 'Fung/Insect/Ilevo'  then v.available_units else 0 end) as "Fung/Insect/Ilevo",
  sum(case when v.treatment_name = 'Fung/Insect/Opt'    then v.available_units else 0 end) as "Fung/Insect/Opt",
  sum(case when v.treatment_name = 'FUNGICIDE'          then v.available_units else 0 end) as "FUNGICIDE",
  sum(case when v.treatment_name = 'FUNGICIDE OPTIMIZE' then v.available_units else 0 end) as "FUNGICIDE OPTIMIZE",
  sum(case when v.treatment_name = 'PONCHO'             then v.available_units else 0 end) as "PONCHO",
  sum(case when v.treatment_name = 'Poncho/i-374'       then v.available_units else 0 end) as "Poncho/i-374"
from v_on_hand_inventory v
where v.treatment_name <> 'NO_TREATMENT'
group by v.product_id, v.product_name
order by v.product_name;


-- ---------------------------------------------------------
-- 8c) v_inventory_print_sheet  (rebuilt)
--
--    Adds units_staged and available_units columns at the end.
--    Core sort order and filters unchanged from migration 0022.
-- ---------------------------------------------------------
create view public.v_inventory_print_sheet as
select
  v.product_id,
  p.crop,
  v.product_name,
  v.treatment_id,
  v.treatment_name,
  v.seed_size,
  v.package_type,
  v.units_on_hand,
  v.units_staged,
  v.available_units
from public.v_on_hand_inventory v
join public.products p on p.id = v.product_id
where v.treatment_name <> 'NO_TREATMENT'
order by
  case when lower(p.crop) = 'corn' then 0 else 1 end,
  v.product_name,
  v.treatment_name,
  v.seed_size    nulls last,
  v.package_type nulls last;


-- ---------------------------------------------------------
-- 8d) v_agent_inventory  (rebuilt)
--
--    SELECT * wrapper must be recreated after its base view
--    was dropped and recreated.  Automatically inherits the
--    new units_staged and available_units columns.
-- ---------------------------------------------------------
create or replace view public.v_agent_inventory as
select * from public.v_on_hand_inventory;


-- ---------------------------------------------------------
-- 9) v_agent_staged_deliveries
--
--    Thin wrapper around v_staged_deliveries scoped to
--    in_progress staged deliveries.  Listed in the SQL
--    fallback approved views for agent queries.
--
--    Grain: one row per staged_delivery_item.
-- ---------------------------------------------------------
create or replace view public.v_agent_staged_deliveries as
select
  staged_delivery_id,
  staged_delivery_item_id,
  customer_id,
  customer_name,
  farm_name,
  season_year,
  staged_date,
  notes,
  product_id,
  product_name,
  treatment_id,
  treatment_name,
  seed_size,
  package_type,
  units_staged,
  created_at
from public.v_staged_deliveries
where status = 'in_progress';
