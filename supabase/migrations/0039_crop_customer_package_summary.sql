-- =========================================================
-- 0039_crop_customer_package_summary.sql
--
-- Purpose:
--   Re-grain the "Corn Summary" and "Bean Summary" tabs on the
--   Adjustments page so they aggregate physical movement by
--   CUSTOMER + FARM NAME + PACKAGE TYPE only.
--
--   Previously (migration 0038) v_crop_customer_movement_summary
--   carried a fine grain that also split rows by product/variety,
--   treatment, and seed size:
--     (user_id, season_year, crop, customer_id, product_id,
--      treatment_id, seed_size, package_type)
--
--   The new requirement collapses product/variety, treatment, and
--   seed size out of the summary entirely. The new grain is:
--     (user_id, season_year, crop_group, customer_id, package_type)
--   (customer_name and farm_name are customer attributes carried
--   along for display — they are functionally determined by
--   customer_id, so they do not change the grain.)
--
--   This stays MOVEMENT-ONLY. Orders and pricing remain excluded
--   (the Year-End Adjustments / Customer Adjustment Report views
--   already cover ordered vs. settled reconciliation). Here we only
--   care about physical movement:
--     net_units = units_delivered + units_replanted - units_returned
--
--   The sign convention still DIFFERS from v_year_end_adjustments
--   and v_customer_adjustment_report_summary, which measure
--   *outstanding* units to settle:
--     reconciliation net = ordered - delivered - replanted + returned
--   This view measures what the customer physically kept:
--     movement net      = delivered + replanted - returned
--
-- crop_group normalization:
--   products.crop = 'corn'    -> crop_group = 'corn'
--   products.crop = 'soybean' -> crop_group = 'beans'
--   (any other non-packaging crop value falls through to lower(crop))
--   Because product/variety is no longer part of the grain, crop is
--   derived per movement row via a join to products purely so the
--   row can be bucketed into the corn or bean tab, then aggregated
--   away. The raw products.crop value is intentionally NOT exposed
--   as a column (multiple raw crop spellings such as 'soybean' /
--   'soybeans' can collapse into a single 'beans' bucket).
--
-- Packaging exclusion:
--   Packaging / non-seed products (Pallet, Seedpak containers, etc.)
--   are identified by products.crop = 'packaging' — the canonical
--   field used throughout the codebase (same identifier used by
--   v_customer_adjustment_report_summary and v_year_end_adjustments).
--   They are excluded inside every movement CTE so they never appear
--   as crop rows in the corn/bean summaries. They are tracked
--   separately in v_customer_adjustment_report_packaging.
--
-- Row inclusion:
--   A (customer, package_type) row appears whenever ANY movement
--   exists in ANY category — delivery only, return only, replant
--   only, or any combination. This is achieved by UNION-ing the keys
--   from all three movement CTEs and LEFT JOIN-ing each total back
--   (missing categories read 0).
--
-- Scope: every CTE is user-scoped via user_id = auth.uid().
--
-- Safety / dependency order:
--   v_crop_customer_movement_totals is built ON TOP of
--   v_crop_customer_movement_summary and references columns that no
--   longer exist at the new grain (product_id). Removing/reordering
--   columns is NOT safe with CREATE OR REPLACE VIEW, so both views
--   are DROPPED in dependency order (totals first, then summary) and
--   recreated at the new grain. No other views (Year-End Adjustments,
--   Customer Adjustment Report, Customer Summary, On-Hand Inventory)
--   are touched.
--
-- This migration is intended to be run manually in Supabase. It is
-- authored from the repo's migration / schema / docs files, not from
-- a live Supabase connection.
-- =========================================================


-- ---------------------------------------------------------
-- Step 1: Drop dependent views in dependency order.
--   totals depends on summary, so drop totals first.
-- ---------------------------------------------------------
drop view if exists public.v_crop_customer_movement_totals;
drop view if exists public.v_crop_customer_movement_summary;


-- ---------------------------------------------------------
-- Step 2: Recreate v_crop_customer_movement_summary at the new
--   grain: one row per (user, season, crop_group, customer,
--   package_type) with delivered / returned / replanted totals and
--   a movement net. Product/variety, treatment, and seed size are
--   aggregated away.
-- ---------------------------------------------------------
create view public.v_crop_customer_movement_summary as
with delivered as (
  select
    d.user_id,
    d.season_year,
    -- Normalized crop bucket the frontend filters on.
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end                                       as crop_group,
    d.customer_id,
    d.package_type,
    sum(d.units_delivered)::integer           as units_delivered
  from deliveries d
  join products p on p.id = d.product_id
  where d.user_id = auth.uid()
    -- Exclude packaging / non-seed products (Pallet, Seedpak).
    and coalesce(p.crop, '') <> 'packaging'
  group by
    d.user_id, d.season_year,
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end,
    d.customer_id, d.package_type
),
returned as (
  select
    r.user_id,
    r.season_year,
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end                                       as crop_group,
    r.customer_id,
    r.package_type,
    sum(r.units_returned)::integer            as units_returned
  from returns r
  join products p on p.id = r.product_id
  where r.user_id = auth.uid()
    and coalesce(p.crop, '') <> 'packaging'
  group by
    r.user_id, r.season_year,
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end,
    r.customer_id, r.package_type
),
replanted as (
  select
    rp.user_id,
    rp.season_year,
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end                                       as crop_group,
    rp.customer_id,
    rp.package_type,
    sum(rp.units_replanted)::integer          as units_replanted
  from replants rp
  join products p on p.id = rp.product_id
  where rp.user_id = auth.uid()
    and coalesce(p.crop, '') <> 'packaging'
  group by
    rp.user_id, rp.season_year,
    case lower(coalesce(p.crop, ''))
      when 'corn'     then 'corn'
      when 'soybean'  then 'beans'
      when 'soybeans' then 'beans'
      when 'bean'     then 'beans'
      when 'beans'    then 'beans'
      else lower(coalesce(p.crop, ''))
    end,
    rp.customer_id, rp.package_type
),
-- Union all keys so a row appears when activity exists in only one
-- category (delivery-only, return-only, or replant-only).
keys as (
  select user_id, season_year, crop_group, customer_id, package_type
    from delivered
  union
  select user_id, season_year, crop_group, customer_id, package_type
    from returned
  union
  select user_id, season_year, crop_group, customer_id, package_type
    from replanted
)
select
  k.user_id,
  k.season_year,
  k.crop_group,
  k.customer_id,
  c.customer_name,
  c.farm_name,
  k.package_type,
  coalesce(d.units_delivered, 0)            as units_delivered,
  coalesce(r.units_returned,  0)            as units_returned,
  coalesce(rep.units_replanted, 0)          as units_replanted,
  -- movement net: what the customer physically kept
  coalesce(d.units_delivered, 0)
    + coalesce(rep.units_replanted, 0)
    - coalesce(r.units_returned, 0)         as net_units
from keys k
join customers c on c.id = k.customer_id
left join delivered d
  on  d.user_id      = k.user_id
  and d.season_year  = k.season_year
  and d.crop_group   = k.crop_group
  and d.customer_id  = k.customer_id
  and d.package_type = k.package_type
left join returned r
  on  r.user_id      = k.user_id
  and r.season_year  = k.season_year
  and r.crop_group   = k.crop_group
  and r.customer_id  = k.customer_id
  and r.package_type = k.package_type
left join replanted rep
  on  rep.user_id      = k.user_id
  and rep.season_year  = k.season_year
  and rep.crop_group   = k.crop_group
  and rep.customer_id  = k.customer_id
  and rep.package_type = k.package_type;


-- ---------------------------------------------------------
-- Step 3: Recreate v_crop_customer_movement_totals on the new grain.
--   Top-of-page totals per (user, season, crop_group). Built directly
--   on v_crop_customer_movement_summary so the numbers can never drift
--   from the detail rows.
--
--   product_count no longer exists (product is no longer in the
--   grain); it is replaced by package_count — the distinct number of
--   package types with movement for that crop_group.
-- ---------------------------------------------------------
create view public.v_crop_customer_movement_totals as
select
  user_id,
  season_year,
  crop_group,
  sum(units_delivered)::integer        as total_units_delivered,
  sum(units_returned)::integer         as total_units_returned,
  sum(units_replanted)::integer        as total_units_replanted,
  sum(net_units)::integer              as total_net_units,
  count(distinct customer_id)::integer as customer_count,
  count(distinct package_type)::integer as package_count
from public.v_crop_customer_movement_summary
group by user_id, season_year, crop_group;


-- =========================================================
-- Validation queries (run manually after applying — read-only).
-- These run in the security context of the calling user, so the
-- auth.uid() scoping inside the views applies automatically.
-- =========================================================
--
-- 1) Corn rows grouped by customer + package (no product/variety,
--    treatment, or seed size split):
--
--    select customer_name, farm_name, package_type,
--           units_delivered, units_returned, units_replanted, net_units
--    from public.v_crop_customer_movement_summary
--    where season_year = 2025 and crop_group = 'corn'
--    order by customer_name, package_type;
--
-- 2) Bean rows grouped by customer + package:
--
--    select customer_name, farm_name, package_type,
--           units_delivered, units_returned, units_replanted, net_units
--    from public.v_crop_customer_movement_summary
--    where season_year = 2025 and crop_group = 'beans'
--    order by customer_name, package_type;
--
-- 3) No Pallet / Seedpak (packaging) rows are included. Every key in
--    the summary must trace back to a non-packaging product. This
--    must return ZERO rows:
--
--    select s.*
--    from public.v_crop_customer_movement_summary s
--    where not exists (
--      select 1
--      from public.deliveries d
--      join public.products p on p.id = d.product_id
--      where d.customer_id = s.customer_id
--        and d.season_year = s.season_year
--        and d.package_type = s.package_type
--        and coalesce(p.crop, '') <> 'packaging'
--      union
--      select 1
--      from public.returns r
--      join public.products p on p.id = r.product_id
--      where r.customer_id = s.customer_id
--        and r.season_year = s.season_year
--        and r.package_type = s.package_type
--        and coalesce(p.crop, '') <> 'packaging'
--      union
--      select 1
--      from public.replants rp
--      join public.products p on p.id = rp.product_id
--      where rp.customer_id = s.customer_id
--        and rp.season_year = s.season_year
--        and rp.package_type = s.package_type
--        and coalesce(p.crop, '') <> 'packaging'
--    );
--
--    A simpler smoke test — the summary must contain no row whose
--    package movement came only from a packaging product. Confirm the
--    product names 'Pallet' and 'Seedpak' never leak in by checking
--    they have crop = 'packaging' and so are filtered:
--
--    select product_name, crop
--    from public.products
--    where product_name in ('Pallet', 'Seedpak');   -- expect crop = 'packaging'
--
-- 4) Totals equal delivered + replanted - returned for every row:
--
--    select count(*) as bad_rows
--    from public.v_crop_customer_movement_summary
--    where net_units <> units_delivered + units_replanted - units_returned;
--    -- expect bad_rows = 0
--
-- 5) The final summary view exposes NO product / treatment / seed_size
--    columns. This must return ZERO rows:
--
--    select column_name
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'v_crop_customer_movement_summary'
--      and column_name in (
--        'product_id', 'product_name',
--        'treatment_id', 'treatment_name',
--        'seed_size', 'crop'
--      );
--    -- expect 0 rows
--
--    The full expected column set is exactly:
--      user_id, season_year, crop_group, customer_id, customer_name,
--      farm_name, package_type, units_delivered, units_returned,
--      units_replanted, net_units
-- =========================================================
