-- =========================================================
-- 0036_customer_adjustment_report_packaging.sql
--
-- Context:
--   0035_customer_adjustment_report_views.sql (from the main
--   branch) defines 5 Customer Adjustment Report views but was
--   superseded in Supabase by a local migration that created
--   packaging-tracking views instead. This migration:
--
--   1. Replaces the 5 Customer Adjustment Report views from 0035
--      using CREATE OR REPLACE VIEW (they already exist in Supabase
--      from the GitHub 0035 migration).
--      v_customer_adjustment_report_summary gets a packaging
--      exclusion so pallets/seedpaks never appear in the seed
--      reconciliation rows.
--
--   2. Replaces v_customer_adjustment_report_packaging (wrong
--      version from the local 0035) with a correct definition.
--
--   3. Replaces v_customer_adjustment_report_packaging_detail
--      (already functionally correct, dropped and recreated for
--      naming consistency with the rest of the report family).
--
-- Packaging identification: products.crop = 'packaging'
--   This is the canonical field used throughout the codebase.
--   A corn delivery with package_type = 'tote' is still a seed
--   row; only products where crop = 'packaging' are excluded.
--
-- v_year_end_adjustments: already excludes packaging as of the
--   previous migration — no change needed here.
-- =========================================================


-- ---------------------------------------------------------
-- 1) Customer Adjustment Report — detail views
--
--    These views expose raw seed transaction rows for the
--    printable Customer Adjustment Report. Packaging products
--    (crop = 'packaging') are excluded from orders, deliveries,
--    and returns — they are tracked separately in the packaging
--    views below. Replants are seed-only by business rule and
--    need no filter.
--
--    Each view is user-scoped via user_id = auth.uid().
-- ---------------------------------------------------------

create or replace view public.v_customer_adjustment_report_orders as
select
  o.user_id,
  o.season_year,
  o.customer_id,
  c.customer_name,
  c.farm_name,
  o.id                                        as order_id,
  o.order_date,
  oi.product_id,
  p.product_name,
  oi.treatment_id,
  t.treatment_name,
  oi.seed_size,
  oi.package_type,
  oi.retail_price_per_unit,
  -- sale price = retail minus brand_grower and tote/bulk discounts (before early pay)
  (
    oi.retail_price_per_unit
    - coalesce(oi.brand_grower_discount_amount, 0)
    - coalesce(oi.tote_bulk_discount_amount, 0)
  )                                           as sale_price_per_unit,
  oi.units                                    as units_ordered,
  coalesce(o.early_pay_pct, 0)::integer       as early_pay_discount_pct,
  coalesce(o.brand_grower_pct, 0)::integer    as brand_grower_discount_pct,
  -- total discount pct: brand_grower + early_pay (tote/bulk is unit-level, shown separately)
  (coalesce(o.brand_grower_pct, 0) + coalesce(o.early_pay_pct, 0))::integer
                                              as total_discount_pct,
  oi.line_total_after_all_discounts           as line_total,
  o.notes
from orders      o
join order_items oi on oi.order_id = o.id
join customers   c  on c.id        = o.customer_id
join products    p  on p.id        = oi.product_id
join treatments  t  on t.id        = oi.treatment_id
where o.user_id = auth.uid()
  and coalesce(p.crop, '') <> 'packaging';


create or replace view public.v_customer_adjustment_report_deliveries as
select
  d.user_id,
  d.season_year,
  d.customer_id,
  c.customer_name,
  c.farm_name,
  d.delivery_header_id,
  d.id                                        as delivery_id,
  d.delivery_date,
  d.product_id,
  p.product_name,
  d.treatment_id,
  t.treatment_name,
  d.seed_size,
  d.package_type,
  d.units_delivered,
  d.notes
from deliveries d
join customers  c on c.id = d.customer_id
join products   p on p.id = d.product_id
join treatments t on t.id = d.treatment_id
where d.user_id = auth.uid()
  and coalesce(p.crop, '') <> 'packaging';


create or replace view public.v_customer_adjustment_report_replants as
select
  rp.user_id,
  rp.season_year,
  rp.customer_id,
  c.customer_name,
  c.farm_name,
  rp.id                                       as replant_id,
  rp.replant_date,
  rp.product_id,
  p.product_name,
  rp.treatment_id,
  t.treatment_name,
  rp.seed_size,
  rp.package_type,
  rp.units_replanted,
  rp.notes
from replants   rp
join customers  c  on c.id = rp.customer_id
join products   p  on p.id = rp.product_id
join treatments t  on t.id = rp.treatment_id
where rp.user_id = auth.uid();


create or replace view public.v_customer_adjustment_report_returns as
select
  r.user_id,
  r.season_year,
  r.customer_id,
  c.customer_name,
  c.farm_name,
  r.id                                        as return_id,
  r.return_date,
  r.product_id,
  p.product_name,
  r.treatment_id,
  t.treatment_name,
  r.seed_size,
  r.package_type,
  r.units_returned,
  r.notes
from returns    r
join customers  c on c.id = r.customer_id
join products   p on p.id = r.product_id
join treatments t on t.id = r.treatment_id
where r.user_id = auth.uid()
  and coalesce(p.crop, '') <> 'packaging';


-- ---------------------------------------------------------
-- 2) v_customer_adjustment_report_summary
--
--    Reconciliation summary per (season, customer, product,
--    treatment, seed_size, package_type, early_pay_bucket).
--    Packaging products (crop = 'packaging') are excluded —
--    they are tracked separately in
--    v_customer_adjustment_report_packaging.
--
--    net_units formula (identical to v_year_end_adjustments):
--      ordered - delivered - replanted + returned
-- ---------------------------------------------------------

create or replace view public.v_customer_adjustment_report_summary as
with ordered as (
  select
    o.user_id,
    o.season_year,
    o.customer_id,
    oi.product_id,
    oi.treatment_id,
    oi.seed_size,
    oi.package_type,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end                                       as early_pay_bucket,
    sum(oi.units)::integer                    as units_ordered
  from orders      o
  join order_items oi on oi.order_id = o.id
  where o.user_id = auth.uid()
  group by
    o.user_id, o.season_year, o.customer_id,
    oi.product_id, oi.treatment_id, oi.seed_size, oi.package_type,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
delivered as (
  select
    d.user_id,
    d.season_year,
    d.customer_id,
    d.product_id,
    d.treatment_id,
    d.seed_size,
    d.package_type,
    case
      when d.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end                                       as early_pay_bucket,
    sum(d.units_delivered)::integer           as units_delivered
  from deliveries  d
  left join order_items oi on oi.id = d.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where d.user_id = auth.uid()
  group by
    d.user_id, d.season_year, d.customer_id,
    d.product_id, d.treatment_id, d.seed_size, d.package_type,
    case
      when d.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
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
    case
      when rp.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end                                       as early_pay_bucket,
    sum(rp.units_replanted)::integer          as units_replanted
  from replants    rp
  left join order_items oi on oi.id = rp.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where rp.user_id = auth.uid()
  group by
    rp.user_id, rp.season_year, rp.customer_id,
    rp.product_id, rp.treatment_id, rp.seed_size, rp.package_type,
    case
      when rp.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
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
    case
      when r.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end                                       as early_pay_bucket,
    sum(r.units_returned)::integer            as units_returned
  from returns     r
  left join order_items oi on oi.id = r.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where r.user_id = auth.uid()
  group by
    r.user_id, r.season_year, r.customer_id,
    r.product_id, r.treatment_id, r.seed_size, r.package_type,
    case
      when r.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
-- Union all keys so rows appear even when activity exists in only one category
keys as (
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket
    from ordered
  union
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket
    from delivered
  union
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket
    from replanted
  union
  select user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket
    from returned
)
select
  k.user_id,
  k.season_year,
  k.customer_id,
  c.customer_name,
  c.farm_name,
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  k.seed_size,
  k.package_type,
  k.early_pay_bucket,
  coalesce(o.units_ordered,      0) as units_ordered,
  coalesce(d.units_delivered,    0) as units_delivered,
  coalesce(rep.units_replanted,  0) as units_replanted,
  coalesce(r.units_returned,     0) as units_returned,
  -- net_units matches v_year_end_adjustments formula
  coalesce(o.units_ordered,      0)
    - coalesce(d.units_delivered,    0)
    - coalesce(rep.units_replanted,  0)
    + coalesce(r.units_returned,     0)  as net_units,
  coalesce(ch.is_completed, false)       as completed
from keys k
join customers  c  on c.id = k.customer_id
join products   p  on p.id = k.product_id
join treatments t  on t.id = k.treatment_id
left join ordered   o
  on  o.user_id          = k.user_id
  and o.season_year      = k.season_year
  and o.customer_id      = k.customer_id
  and o.product_id       = k.product_id
  and o.treatment_id     = k.treatment_id
  and o.seed_size        is not distinct from k.seed_size
  and o.package_type     = k.package_type
  and o.early_pay_bucket = k.early_pay_bucket
left join delivered d
  on  d.user_id          = k.user_id
  and d.season_year      = k.season_year
  and d.customer_id      = k.customer_id
  and d.product_id       = k.product_id
  and d.treatment_id     = k.treatment_id
  and d.seed_size        is not distinct from k.seed_size
  and d.package_type     = k.package_type
  and d.early_pay_bucket = k.early_pay_bucket
left join replanted rep
  on  rep.user_id          = k.user_id
  and rep.season_year      = k.season_year
  and rep.customer_id      = k.customer_id
  and rep.product_id       = k.product_id
  and rep.treatment_id     = k.treatment_id
  and rep.seed_size        is not distinct from k.seed_size
  and rep.package_type     = k.package_type
  and rep.early_pay_bucket = k.early_pay_bucket
left join returned  r
  on  r.user_id          = k.user_id
  and r.season_year      = k.season_year
  and r.customer_id      = k.customer_id
  and r.product_id       = k.product_id
  and r.treatment_id     = k.treatment_id
  and r.seed_size        is not distinct from k.seed_size
  and r.package_type     = k.package_type
  and r.early_pay_bucket = k.early_pay_bucket
left join invoice_adjustment_checks ch
  on  ch.user_id         = k.user_id
  and ch.season_year     = k.season_year
  and ch.customer_id     = k.customer_id
  and ch.product_id      = k.product_id
  and ch.treatment_id    = k.treatment_id
  and ch.early_pay_bucket = k.early_pay_bucket
-- Exclude packaging/logistics products (pallets, seedpak containers).
-- Packaging items are identified by products.crop = 'packaging'.
-- They are tracked separately in v_customer_adjustment_report_packaging.
where coalesce(p.crop, '') <> 'packaging';


-- ---------------------------------------------------------
-- 3) v_customer_adjustment_report_packaging
--
--    Aggregated packaging movements per customer per season
--    per packaging item. Replaces the version created by the
--    prior local migration (dropped below).
--
--    Grain: (user_id, season_year, customer_id, product_id)
--    packaging_item = products.product_name (e.g. 'Pallet',
--    'Seedpak'). New packaging product types automatically
--    appear here without migration changes.
--
--    net_outstanding = units_delivered - units_returned
--    Positive = customer still holds packaging items.
-- ---------------------------------------------------------

drop view if exists public.v_customer_adjustment_report_packaging;

create view public.v_customer_adjustment_report_packaging as
with pkg_delivered as (
  select
    d.user_id,
    d.season_year,
    d.customer_id,
    d.product_id,
    sum(d.units_delivered)::integer as units_delivered
  from deliveries d
  join products   p on p.id = d.product_id
  where p.crop = 'packaging'
    and d.user_id = auth.uid()
  group by d.user_id, d.season_year, d.customer_id, d.product_id
),
pkg_returned as (
  select
    r.user_id,
    r.season_year,
    r.customer_id,
    r.product_id,
    sum(r.units_returned)::integer  as units_returned
  from returns  r
  join products p on p.id = r.product_id
  where p.crop = 'packaging'
    and r.user_id = auth.uid()
  group by r.user_id, r.season_year, r.customer_id, r.product_id
),
pkg_keys as (
  select user_id, season_year, customer_id, product_id from pkg_delivered
  union
  select user_id, season_year, customer_id, product_id from pkg_returned
)
select
  k.user_id,
  k.season_year,
  k.customer_id,
  c.customer_name,
  c.farm_name,
  k.product_id,
  p.product_name                                         as packaging_item,
  coalesce(d.units_delivered, 0)                         as units_delivered,
  coalesce(r.units_returned,  0)                         as units_returned,
  coalesce(d.units_delivered, 0) - coalesce(r.units_returned, 0) as net_outstanding
from pkg_keys k
join customers c on c.id = k.customer_id
join products  p on p.id = k.product_id
left join pkg_delivered d
  on  d.user_id     = k.user_id
  and d.season_year = k.season_year
  and d.customer_id = k.customer_id
  and d.product_id  = k.product_id
left join pkg_returned  r
  on  r.user_id     = k.user_id
  and r.season_year = k.season_year
  and r.customer_id = k.customer_id
  and r.product_id  = k.product_id;


-- ---------------------------------------------------------
-- 4) v_customer_adjustment_report_packaging_detail
--
--    Individual delivery and return rows for packaging items.
--    Provides the audit trail behind the packaging summary
--    totals. Replaces the version from the prior local migration.
--
--    movement_type: 'delivery' | 'return'
--    movement_id:   UUID of the source delivery or return row
--    units:         units_delivered or units_returned (positive)
-- ---------------------------------------------------------

drop view if exists public.v_customer_adjustment_report_packaging_detail;

create view public.v_customer_adjustment_report_packaging_detail as
select
  d.user_id,
  d.season_year,
  d.customer_id,
  c.customer_name,
  c.farm_name,
  'delivery'::text         as movement_type,
  d.delivery_date          as movement_date,
  d.id                     as movement_id,
  p.product_name           as packaging_item,
  d.units_delivered        as units,
  d.notes
from deliveries d
join customers  c on c.id = d.customer_id
join products   p on p.id = d.product_id
where p.crop = 'packaging'
  and d.user_id = auth.uid()

union all

select
  r.user_id,
  r.season_year,
  r.customer_id,
  c.customer_name,
  c.farm_name,
  'return'::text           as movement_type,
  r.return_date            as movement_date,
  r.id                     as movement_id,
  p.product_name           as packaging_item,
  r.units_returned         as units,
  r.notes
from returns   r
join customers c on c.id = r.customer_id
join products  p on p.id = r.product_id
where p.crop = 'packaging'
  and r.user_id = auth.uid();
