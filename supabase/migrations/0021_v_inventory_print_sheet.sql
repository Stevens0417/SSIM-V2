-- =========================================================
-- 0021_v_inventory_print_sheet.sql
-- New view for the On-Hand Inventory print sheet.
-- Adds p.crop so the UI can sort corn first, beans after.
-- Excludes NO_TREATMENT packaging rows from the count sheet
-- (they are tracked separately in the Bayer workflow).
-- Based on v_on_hand_inventory defined in migration 0020.
-- =========================================================

create or replace view public.v_inventory_print_sheet as
select
  v.product_id,
  p.crop,
  v.product_name,
  v.treatment_id,
  v.treatment_name,
  v.seed_size,
  v.units_on_hand
from public.v_on_hand_inventory v
join public.products p on p.id = v.product_id
where v.treatment_name <> 'NO_TREATMENT'
order by
  case when lower(p.crop) = 'corn' then 0 else 1 end,
  v.product_name,
  v.treatment_name,
  v.seed_size nulls last;
