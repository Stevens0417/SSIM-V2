-- =========================================================
-- 0037_on_hand_inventory_subtract_replants.sql
--
-- Context:
--   v_on_hand_inventory historically computed
--     units_on_hand = received − delivered + returned
--   omitting replants. Replanted seed physically leaves the
--   warehouse (it is handed to the customer to re-plant a
--   failed field), so it must reduce physical stock — even
--   though the customer is not invoiced for it.
--
-- New formulas:
--   Physical On Hand = received − delivered − replanted + returned
--   Available        = Physical On Hand − staged
--
-- Grain (unchanged): (product_id, treatment_id, seed_size,
--   package_type). Replants are aggregated at this same grain
--   and joined with IS NOT DISTINCT FROM on the nullable
--   seed_size / package_type dimensions, exactly like the
--   existing delivered / returned / staged CTEs.
--
-- New column:
--   v_on_hand_inventory.units_replanted — exposed for the
--   detail view and the agent. Positioned between
--   units_delivered and units_returned, which requires a
--   column reorder. Postgres CREATE OR REPLACE VIEW cannot
--   reorder columns, so this migration DROPs the view family
--   in dependency order and recreates it (mirrors the pattern
--   used by 0027_staged_deliveries.sql).
--
-- Dependency chain (drop in this order, recreate in reverse):
--   v_agent_inventory          → select * from v_on_hand_inventory
--   v_inventory_print_sheet     → from v_on_hand_inventory
--   v_on_hand_inventory_wide    → from v_on_hand_inventory
--   v_on_hand_inventory         (base)
--
-- Reconciliation views (v_year_end_adjustments, customer
--   adjustment report) already net replants into SALES math.
--   That is a separate axis from physical stock and is NOT
--   touched here — replants must not be double-counted.
-- =========================================================


-- ---------------------------------------------------------
-- 0) Drop dependents first, then the base view.
-- ---------------------------------------------------------
drop view if exists public.v_agent_inventory;
drop view if exists public.v_inventory_print_sheet;
drop view if exists public.v_on_hand_inventory_wide;
drop view if exists public.v_on_hand_inventory;


-- ---------------------------------------------------------
-- 1) v_on_hand_inventory  (rebuilt with replanted CTE)
--
--    Adds a `replanted` CTE and subtracts units_replanted in
--    both units_on_hand and available_units. The received CTE
--    keeps the migration 0029 seed_size fix (i.seed_size, not
--    null::text).
--
--    Grain: one row per (product, treatment, seed_size,
--           package_type).
-- ---------------------------------------------------------
create view public.v_on_hand_inventory as
with received as (
  select i.product_id,
         i.treatment_id,
         i.seed_size,
         i.package_type,
         sum(i.units_received)::integer          as units_received
    from bayer_shipment_items i
   where i.user_id = auth.uid()
   group by i.product_id, i.treatment_id, i.seed_size, i.package_type
),
delivered as (
  select d.product_id,
         d.treatment_id,
         d.seed_size,
         d.package_type,
         sum(d.units_delivered)::integer         as units_delivered
    from deliveries d
   where d.user_id = auth.uid()
   group by d.product_id, d.treatment_id, d.seed_size, d.package_type
),
replanted as (
  -- Replanted seed physically left the warehouse — subtract it.
  -- Same grain and user scope as delivered/returned.
  select rp.product_id,
         rp.treatment_id,
         rp.seed_size,
         rp.package_type,
         sum(rp.units_replanted)::integer        as units_replanted
    from replants rp
   where rp.user_id = auth.uid()
   group by rp.product_id, rp.treatment_id, rp.seed_size, rp.package_type
),
returned as (
  select r.product_id,
         r.treatment_id,
         r.seed_size,
         r.package_type,
         sum(r.units_returned)::integer          as units_returned
    from returns r
   where r.user_id = auth.uid()
   group by r.product_id, r.treatment_id, r.seed_size, r.package_type
),
staged as (
  -- Only in_progress staged deliveries reserve inventory.
  select sdi.product_id,
         sdi.treatment_id,
         sdi.seed_size,
         sdi.package_type,
         sum(sdi.units_staged)::integer          as units_staged
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
  select product_id, treatment_id, seed_size, package_type from replanted
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
  coalesce(rpl.units_replanted, 0)                       as units_replanted,
  coalesce(rt.units_returned,  0)                        as units_returned,
  -- physical on hand: received − delivered − replanted + returned
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    - coalesce(rpl.units_replanted, 0)
    + coalesce(rt.units_returned,  0)                    as units_on_hand,
  k.package_type,
  -- staged units: reserved in active staged deliveries
  coalesce(sg.units_staged, 0)                           as units_staged,
  -- available units: physical on hand minus staged
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    - coalesce(rpl.units_replanted, 0)
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
left join replanted rpl on rpl.product_id  = k.product_id
                      and rpl.treatment_id = k.treatment_id
                      and rpl.seed_size    is not distinct from k.seed_size
                      and rpl.package_type is not distinct from k.package_type
left join returned  rt on rt.product_id   = k.product_id
                      and rt.treatment_id  = k.treatment_id
                      and rt.seed_size     is not distinct from k.seed_size
                      and rt.package_type  is not distinct from k.package_type
left join staged    sg on sg.product_id   = k.product_id
                      and sg.treatment_id  = k.treatment_id
                      and sg.seed_size     is not distinct from k.seed_size
                      and sg.package_type  is not distinct from k.package_type;


-- ---------------------------------------------------------
-- 2) v_on_hand_inventory_wide  (recreated verbatim)
--
--    Pivots available_units per treatment. available_units now
--    includes the replant subtraction automatically — no
--    structural change. Recreated only because its base view
--    was dropped above.
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
-- 3) v_inventory_print_sheet  (recreated verbatim)
--
--    Shows the result columns (Physical / Staged / Available),
--    which now include replants automatically. Component
--    columns (received/delivered/replanted/returned) are
--    intentionally not on the print sheet — consistent with
--    its existing results-only layout.
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
-- 4) v_agent_inventory  (recreated)
--
--    SELECT * wrapper — automatically inherits the new
--    units_replanted column and the corrected units_on_hand /
--    available_units values.
-- ---------------------------------------------------------
create view public.v_agent_inventory as
select * from public.v_on_hand_inventory;
