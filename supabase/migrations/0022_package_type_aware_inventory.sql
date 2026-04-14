-- =========================================================
-- 0022_package_type_aware_inventory.sql
--
-- Make package_type a first-class dimension in inventory
-- tracking, Year End verification, and the Bayer shipments
-- view.
--
-- Changes:
--   1. bayer_shipment_items — replace unique index to include
--      package_type (THE primary save-failure fix)
--   2. v_bayer_shipments    — drop + recreate (live view has
--      p.crop in a position that conflicts with CREATE OR
--      REPLACE column-order rules)
--   3. v_on_hand_inventory  — drop + recreate with package_type
--   4. v_on_hand_inventory_wide — rebuild (uses v_on_hand_inventory)
--   5. v_inventory_print_sheet  — rebuild with package_type
--   6. bayer_year_end_verifications — add seed_size + package_type;
--      update unique constraint
--   7. v_bayer_year_end_totals — drop + recreate with new grain
-- =========================================================


-- ---------------------------------------------------------
-- 1) bayer_shipment_items — fix unique index
--
--    The old index (v2) covers only:
--      (shipment_id, product_id, treatment_id, COALESCE(seed_size,''))
--    It has NO package_type column, so inserting two rows with
--    the same product+treatment but Bag vs Seedpak on the same
--    shipment hits a unique violation and the save fails.
--
--    The new index (v3) adds COALESCE(package_type,'bag') so
--    that Bag and Seedpak rows are correctly treated as distinct.
-- ---------------------------------------------------------
drop index if exists public.bayer_shipment_items_unique_line_v2;

create unique index bayer_shipment_items_unique_line_v3
  on public.bayer_shipment_items (
    shipment_id,
    product_id,
    treatment_id,
    coalesce(seed_size,    ''),
    coalesce(package_type, 'bag')
  );


-- ---------------------------------------------------------
-- 2) v_bayer_shipments
--    DROP + CREATE to avoid 42P16.  The live view already
--    includes p.crop; we preserve that column so the definition
--    matches what was previously deployed.  seed_size and
--    package_type were already present in the live view.
-- ---------------------------------------------------------
drop view if exists public.v_bayer_shipments;

create view public.v_bayer_shipments as
select
  s.id              as shipment_id,
  s.shipment_date,
  s.season_year,
  s.shipment_number,
  i.id              as shipment_item_id,
  i.product_id,
  p.product_name,
  p.crop,
  i.treatment_id,
  t.treatment_name,
  i.seed_size,
  i.package_type,
  i.units_received,
  i.is_verified,
  i.verified_at,
  i.verified_by,
  s.created_at,
  s.updated_at
from bayer_shipments      s
join bayer_shipment_items i on i.shipment_id = s.id
join products             p on p.id = i.product_id
join treatments           t on t.id = i.treatment_id
where s.user_id = auth.uid()
  and i.user_id = auth.uid();


-- ---------------------------------------------------------
-- 3-5) v_on_hand_inventory + its two dependents
--    Drop dependents first (reverse order), then drop the
--    base view, then recreate all three with package_type.
-- ---------------------------------------------------------
drop view if exists public.v_inventory_print_sheet;
drop view if exists public.v_on_hand_inventory_wide;
drop view if exists public.v_on_hand_inventory;

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
keys as (
  select product_id, treatment_id, seed_size, package_type from received
  union
  select product_id, treatment_id, seed_size, package_type from delivered
  union
  select product_id, treatment_id, seed_size, package_type from returned
)
select
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  k.seed_size,
  coalesce(rc.units_received,  0) as units_received,
  coalesce(dv.units_delivered, 0) as units_delivered,
  coalesce(rt.units_returned,  0) as units_returned,
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    + coalesce(rt.units_returned,  0) as units_on_hand,
  k.package_type
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
                      and rt.package_type  is not distinct from k.package_type;


-- Wide View: aggregates across all seed_sizes AND all package_types.
-- Intentionally has no package_type split — this is the designed behaviour.
create view public.v_on_hand_inventory_wide as
select
  v.product_id,
  v.product_name,
  sum(case when v.treatment_name = 'DIAMIDE'            then v.units_on_hand else 0 end) as "DIAMIDE",
  sum(case when v.treatment_name = 'Fung/Insect'        then v.units_on_hand else 0 end) as "Fung/Insect",
  sum(case when v.treatment_name = 'Fung/Insect/Ilevo'  then v.units_on_hand else 0 end) as "Fung/Insect/Ilevo",
  sum(case when v.treatment_name = 'Fung/Insect/Opt'    then v.units_on_hand else 0 end) as "Fung/Insect/Opt",
  sum(case when v.treatment_name = 'FUNGICIDE'          then v.units_on_hand else 0 end) as "FUNGICIDE",
  sum(case when v.treatment_name = 'FUNGICIDE OPTIMIZE' then v.units_on_hand else 0 end) as "FUNGICIDE OPTIMIZE",
  sum(case when v.treatment_name = 'PONCHO'             then v.units_on_hand else 0 end) as "PONCHO",
  sum(case when v.treatment_name = 'Poncho/i-374'       then v.units_on_hand else 0 end) as "Poncho/i-374"
from v_on_hand_inventory v
where v.treatment_name <> 'NO_TREATMENT'
group by v.product_id, v.product_name
order by v.product_name;


-- Print sheet: separate Bag vs Seedpak lines.
create view public.v_inventory_print_sheet as
select
  v.product_id,
  p.crop,
  v.product_name,
  v.treatment_id,
  v.treatment_name,
  v.seed_size,
  v.package_type,
  v.units_on_hand
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
-- 6) bayer_year_end_verifications
--    Add seed_size + package_type so verification can be
--    tracked at the same grain as shipment items.
--
--    NULLS NOT DISTINCT (PostgreSQL 15+): two NULL values
--    compare equal in the unique index, so upsert conflict
--    detection works when either column is NULL.
-- ---------------------------------------------------------
alter table public.bayer_year_end_verifications
  add column if not exists seed_size    text null,
  add column if not exists package_type text null;

alter table public.bayer_year_end_verifications
  drop constraint if exists bayer_year_end_verifications_unique;

alter table public.bayer_year_end_verifications
  add constraint bayer_year_end_verifications_unique
  unique nulls not distinct (user_id, season_year, product_id, treatment_id, seed_size, package_type);


-- ---------------------------------------------------------
-- 7) v_bayer_year_end_totals
--    DROP + CREATE to avoid 42P16 (live view has p.crop at
--    position 4 which conflicts with our new column layout).
--    New grain: product + treatment + seed_size + package_type.
-- ---------------------------------------------------------
drop view if exists public.v_bayer_year_end_totals;

create view public.v_bayer_year_end_totals as
select
  s.season_year,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  i.seed_size,
  i.package_type,
  sum(i.units_received)::integer  as net_units,
  coalesce(v.is_verified, false)  as is_verified,
  v.verified_at,
  v.verified_by
from public.bayer_shipments s
join public.bayer_shipment_items i  on i.shipment_id = s.id
join public.products             p  on p.id = i.product_id
join public.treatments           t  on t.id = i.treatment_id
left join public.bayer_year_end_verifications v
  on  v.user_id      = s.user_id
 and  v.season_year  = s.season_year
 and  v.product_id   = i.product_id
 and  v.treatment_id = i.treatment_id
 and  v.seed_size    is not distinct from i.seed_size
 and  v.package_type is not distinct from i.package_type
where s.user_id = auth.uid()
group by
  s.season_year,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  i.seed_size,
  i.package_type,
  v.is_verified,
  v.verified_at,
  v.verified_by;
