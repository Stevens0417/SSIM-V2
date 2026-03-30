-- =========================================================
-- 0020_on_hand_inventory_include_packaging.sql
-- Rebuild v_on_hand_inventory + v_on_hand_inventory_wide to:
--   1) Ensure packaging products (crop='packaging') are NOT
--      excluded from v_on_hand_inventory — they appear as
--      product+treatment(NO_TREATMENT)+seed_size(NULL) rows.
--   2) Exclude NO_TREATMENT rows from v_on_hand_inventory_wide
--      so the seed treatment pivot stays clean.
-- Columns may differ from prior definition → DROP then CREATE.
-- =========================================================

drop view if exists public.v_on_hand_inventory_wide;
drop view if exists public.v_on_hand_inventory;


-- ---------------------------------------------------------
-- v_on_hand_inventory
--   Groups by product + treatment + seed_size.
--   Shipments (bayer_shipment_items) have no seed_size
--   so they contribute under seed_size = NULL.
--   Deliveries and returns carry seed_size from their rows.
-- ---------------------------------------------------------
create view public.v_on_hand_inventory as
with received as (
  select i.product_id,
         i.treatment_id,
         null::text                      as seed_size,
         sum(i.units_received)::integer  as units_received
    from bayer_shipment_items i
   where i.user_id = auth.uid()
   group by i.product_id, i.treatment_id
),
delivered as (
  select d.product_id,
         d.treatment_id,
         d.seed_size,
         sum(d.units_delivered)::integer as units_delivered
    from deliveries d
   where d.user_id = auth.uid()
   group by d.product_id, d.treatment_id, d.seed_size
),
returned as (
  select r.product_id,
         r.treatment_id,
         r.seed_size,
         sum(r.units_returned)::integer  as units_returned
    from returns r
   where r.user_id = auth.uid()
   group by r.product_id, r.treatment_id, r.seed_size
),
keys as (
  select product_id, treatment_id, seed_size from received
  union
  select product_id, treatment_id, seed_size from delivered
  union
  select product_id, treatment_id, seed_size from returned
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
    + coalesce(rt.units_returned,  0) as units_on_hand
from keys k
join products   p  on p.id = k.product_id
join treatments t  on t.id = k.treatment_id
left join received  rc on rc.product_id  = k.product_id
                      and rc.treatment_id = k.treatment_id
                      and rc.seed_size    is not distinct from k.seed_size
left join delivered dv on dv.product_id  = k.product_id
                      and dv.treatment_id = k.treatment_id
                      and dv.seed_size    is not distinct from k.seed_size
left join returned  rt on rt.product_id  = k.product_id
                      and rt.treatment_id = k.treatment_id
                      and rt.seed_size    is not distinct from k.seed_size;


-- ---------------------------------------------------------
-- v_on_hand_inventory_wide
--   Seed treatment pivot — excludes NO_TREATMENT rows so
--   packaging products (pallet/seedpak) don't appear here.
--   Aggregates across all seed sizes (SUM per treatment).
-- ---------------------------------------------------------
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
