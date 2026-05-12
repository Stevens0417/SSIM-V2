-- =========================================================
-- 0029_fix_inventory_received_seed_size.sql
--
-- Bug fix: received CTE in v_on_hand_inventory was forcing
-- null::text as seed_size for all Bayer shipment rows,
-- discarding the actual seed_size stored in
-- bayer_shipment_items.seed_size.
--
-- Effect of the bug:
--   A Bayer shipment item saved as (DKC 100-01 / FUNGICIDE /
--   AF2 / Bag) appeared in the inventory detail view under
--   null seed_size instead of AF2, breaking:
--     - inventory availability calculations (AF2 looked
--       empty, null seed_size looked over-received)
--     - delivery/staged matching (AF2 deliveries reduced
--       a different seed_size row than the received units)
--
-- Fix:
--   Change the received CTE to use i.seed_size and include
--   it in the GROUP BY.  All other CTEs and joins are
--   unchanged.  Column structure of the view is unchanged
--   (seed_size remains text | null), so CREATE OR REPLACE
--   is safe and dependent views inherit the fix automatically.
--
-- Affected views (no changes needed — inherit automatically):
--   v_on_hand_inventory_wide
--   v_inventory_print_sheet
--   v_agent_inventory
-- =========================================================


create or replace view public.v_on_hand_inventory as
with received as (
  select i.product_id,
         i.treatment_id,
         i.seed_size,                            -- was: null::text as seed_size
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
  -- physical on hand: received − delivered + returned
  coalesce(rc.units_received,  0)
    - coalesce(dv.units_delivered, 0)
    + coalesce(rt.units_returned,  0)                    as units_on_hand,
  k.package_type,
  -- staged units: reserved in active staged deliveries
  coalesce(sg.units_staged, 0)                           as units_staged,
  -- available units: physical on hand minus staged
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
