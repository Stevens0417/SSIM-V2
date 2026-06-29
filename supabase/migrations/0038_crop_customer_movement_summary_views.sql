-- =========================================================
-- 0038_crop_customer_movement_summary_views.sql
--
-- Purpose:
--   Power the new "Corn Summary" and "Bean Summary" tabs on the
--   Adjustments page. These tabs need a season-level, movement-only
--   summary of every customer / variety with:
--     - total units delivered
--     - total units returned
--     - total units replanted
--   split by crop so the frontend can show corn and bean tabs.
--
--   This is MOVEMENT-ONLY. Orders and pricing are intentionally
--   excluded (the existing Year-End Adjustments / Customer
--   Adjustment Report views already cover ordered vs. settled
--   reconciliation). Here we only care about physical movement:
--     net_units = units_delivered + units_replanted - units_returned
--
--   Note the sign convention DIFFERS from v_year_end_adjustments
--   and v_customer_adjustment_report_summary, which measure
--   *outstanding* units to settle:
--     reconciliation net = ordered - delivered - replanted + returned
--   This view measures what the customer physically kept:
--     movement net      = delivered + replanted - returned
--   (matches the "net_physical_units" metric used by the
--   Customer Summary report.)
--
-- Grain:
--   (user_id, season_year, crop, customer_id, product_id,
--    treatment_id, seed_size, package_type)
--
-- Crop normalization (crop_group):
--   products.crop = 'corn'    -> crop_group = 'corn'
--   products.crop = 'soybean' -> crop_group = 'beans'
--   (any other non-packaging crop value falls through to lower(crop))
--   The raw products.crop value is preserved alongside crop_group so
--   the frontend can filter reliably on crop_group while still
--   having the source value available.
--
-- Packaging exclusion:
--   Packaging / non-seed products (Pallet, Seedpak containers, etc.)
--   are identified by products.crop = 'packaging' — the canonical
--   field used throughout the codebase. They are excluded here so
--   they never appear in the corn/bean movement summaries. (They are
--   tracked separately in v_customer_adjustment_report_packaging.)
--
-- Row inclusion:
--   A (customer, product, treatment, seed_size, package_type) row
--   appears whenever ANY movement exists in ANY category — delivery
--   only, return only, replant only, or any combination. This is
--   achieved by UNION-ing the keys from all three movement CTEs.
--
-- Scope: every CTE is user-scoped via user_id = auth.uid().
--
-- Safety: these are NEW views. No existing views (Year-End
--   Adjustments, Customer Adjustment Report, On-Hand Inventory) are
--   modified or dropped by this migration.
-- =========================================================


-- ---------------------------------------------------------
-- View 1: v_crop_customer_movement_summary
--
--   One row per (user, season, crop, customer, product, treatment,
--   seed_size, package_type) with delivered / returned / replanted
--   totals and a movement net.
-- ---------------------------------------------------------

create view public.v_crop_customer_movement_summary as
with delivered as (
  select
    d.user_id,
    d.season_year,
    d.customer_id,
    d.product_id,
    d.treatment_id,
    d.seed_size,
    d.package_type,
    sum(d.units_delivered)::integer as units_delivered
  from deliveries d
  where d.user_id = auth.uid()
  group by
    d.user_id, d.season_year, d.customer_id,
    d.product_id, d.treatment_id, d.seed_size, d.package_type
),
returned as (
  select
    r.user_id,
    r.season_year,
    r.customer_id,
    r.product_id,
    r.treatment_id,
    r.seed_size,
    r.package_type,
    sum(r.units_returned)::integer as units_returned
  from returns r
  where r.user_id = auth.uid()
  group by
    r.user_id, r.season_year, r.customer_id,
    r.product_id, r.treatment_id, r.seed_size, r.package_type
),
replanted as (
  select
    rp.user_id,
    rp.season_year,
    rp.customer_id,
    rp.product_id,
    rp.treatment_id,
    rp.seed_size,
    rp.package_type,
    sum(rp.units_replanted)::integer as units_replanted
  from replants rp
  where rp.user_id = auth.uid()
  group by
    rp.user_id, rp.season_year, rp.customer_id,
    rp.product_id, rp.treatment_id, rp.seed_size, rp.package_type
),
-- Union all keys so a row appears when activity exists in only one
-- category (delivery-only, return-only, or replant-only).
keys as (
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type
    from delivered
  union
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type
    from returned
  union
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type
    from replanted
)
select
  k.user_id,
  k.season_year,
  p.crop,
  -- Normalized crop bucket the frontend filters on.
  case lower(coalesce(p.crop, ''))
    when 'corn'     then 'corn'
    when 'soybean'  then 'beans'
    when 'soybeans' then 'beans'
    when 'bean'     then 'beans'
    when 'beans'    then 'beans'
    else lower(coalesce(p.crop, ''))
  end                                       as crop_group,
  k.customer_id,
  c.customer_name,
  c.farm_name,
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  k.seed_size,
  k.package_type,
  coalesce(d.units_delivered, 0)            as units_delivered,
  coalesce(r.units_returned,  0)            as units_returned,
  coalesce(rep.units_replanted, 0)          as units_replanted,
  -- movement net: what the customer physically kept
  coalesce(d.units_delivered, 0)
    + coalesce(rep.units_replanted, 0)
    - coalesce(r.units_returned, 0)         as net_units
from keys k
join customers  c on c.id = k.customer_id
join products   p on p.id = k.product_id
join treatments t on t.id = k.treatment_id
left join delivered d
  on  d.user_id      = k.user_id
  and d.season_year  = k.season_year
  and d.customer_id  = k.customer_id
  and d.product_id   = k.product_id
  and d.treatment_id = k.treatment_id
  and d.seed_size    is not distinct from k.seed_size
  and d.package_type = k.package_type
left join returned r
  on  r.user_id      = k.user_id
  and r.season_year  = k.season_year
  and r.customer_id  = k.customer_id
  and r.product_id   = k.product_id
  and r.treatment_id = k.treatment_id
  and r.seed_size    is not distinct from k.seed_size
  and r.package_type = k.package_type
left join replanted rep
  on  rep.user_id      = k.user_id
  and rep.season_year  = k.season_year
  and rep.customer_id  = k.customer_id
  and rep.product_id   = k.product_id
  and rep.treatment_id = k.treatment_id
  and rep.seed_size    is not distinct from k.seed_size
  and rep.package_type = k.package_type
-- Exclude packaging / non-seed products (Pallet, Seedpak containers).
-- Canonical identifier is products.crop = 'packaging'.
where coalesce(p.crop, '') <> 'packaging';


-- ---------------------------------------------------------
-- View 2: v_crop_customer_movement_totals (optional)
--
--   Top-of-page totals per (user, season, crop_group). Powers the
--   summary header cards on the Corn / Bean Summary tabs. Built
--   directly on v_crop_customer_movement_summary so the numbers can
--   never drift from the detail rows.
--
--   customer_count / product_count are DISTINCT counts of customers
--   and products that had any movement for that crop_group.
-- ---------------------------------------------------------

create view public.v_crop_customer_movement_totals as
select
  user_id,
  season_year,
  crop_group,
  sum(units_delivered)::integer       as total_units_delivered,
  sum(units_returned)::integer        as total_units_returned,
  sum(units_replanted)::integer       as total_units_replanted,
  sum(net_units)::integer             as total_net_units,
  count(distinct customer_id)::integer as customer_count,
  count(distinct product_id)::integer  as product_count
from public.v_crop_customer_movement_summary
group by user_id, season_year, crop_group;
