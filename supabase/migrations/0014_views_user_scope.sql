-- =========================================================
-- 0014_views_user_scope.sql
-- Re-create user-scoped views with explicit auth.uid()
-- filters so each user only sees their own data.
--
-- GLOBAL views (unchanged — RLS on base tables is enough):
--   v_pricing_seasons, v_pricing_options, v_pricing_sheet,
--   v_pricing_sheet_wide, v_pricing_break_even_wide,
--   v_current_season
--
-- USER-SCOPED views (updated below):
--   v_all_seasons
--   v_bayer_shipments, v_bayer_shipments_headers
--   v_orders_this_season, v_order_items_this_season
--   v_deliveries_this_season
--   v_returns_this_season, v_replants_this_season
--   v_on_hand_inventory, v_on_hand_inventory_wide
--   v_dashboard_kpis_by_season, v_dashboard_kpis_by_season_crop
--   v_dashboard_crop_summary_by_season
--   v_dashboard_treatment_mix_by_season_crop
--   v_dashboard_customer_volume_buckets_by_season
--   v_dashboard_customer_volume_buckets_by_season_crop
--   v_year_end_adjustments
--
-- Why explicit auth.uid() instead of relying on base-table
-- RLS alone?  Views owned by the postgres superuser bypass
-- RLS on the underlying tables. Adding auth.uid() in the
-- view SQL guarantees correct filtering regardless of
-- view ownership.
-- =========================================================


-- ---------------------------------------------------------
-- 1) v_all_seasons
--    Global pricing branch is unfiltered; user-scoped
--    branches filter by user_id.
-- ---------------------------------------------------------
create or replace view public.v_all_seasons as
  select season_year from v_pricing_seasons
union
  select distinct season_year
    from orders
   where user_id = auth.uid()
union
  select distinct season_year
    from deliveries
   where user_id = auth.uid()
union
  select distinct season_year
    from returns
   where user_id = auth.uid()
union
  select distinct season_year
    from replants
   where user_id = auth.uid()
union
  select distinct extract(year from shipment_date)::integer as season_year
    from bayer_shipments
   where user_id = auth.uid()
order by 1 desc;


-- ---------------------------------------------------------
-- 2) v_bayer_shipments
-- ---------------------------------------------------------
create or replace view public.v_bayer_shipments as
select
  s.id            as shipment_id,
  s.shipment_date,
  extract(year from s.shipment_date)::integer as season_year,
  s.shipment_number,
  i.id            as shipment_item_id,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  i.units_received,
  s.created_at,
  s.updated_at
from bayer_shipments      s
join bayer_shipment_items i on i.shipment_id = s.id
join products             p on p.id = i.product_id
join treatments           t on t.id = i.treatment_id
where s.user_id = auth.uid();


-- ---------------------------------------------------------
-- 3) v_bayer_shipments_headers
-- ---------------------------------------------------------
create or replace view public.v_bayer_shipments_headers as
select
  id as shipment_id,
  shipment_date,
  extract(year from shipment_date)::integer as season_year,
  shipment_number,
  created_at,
  updated_at
from bayer_shipments s
where s.user_id = auth.uid();


-- ---------------------------------------------------------
-- 4) v_orders_this_season
-- ---------------------------------------------------------
create or replace view public.v_orders_this_season as
select
  o.id,
  o.order_date,
  o.customer_id,
  o.brand_grower_pct,
  o.early_pay_pct,
  o.subtotal_before_discounts,
  o.brand_grower_discount_total,
  o.tote_bulk_discount_total,
  o.subtotal_after_discounts_before_early_pay,
  o.early_pay_discount_total,
  o.total_after_all_discounts,
  o.total_profit,
  o.avg_profit_per_unit,
  o.total_units,
  o.created_at,
  o.updated_at,
  o.season_year,
  c.customer_name,
  c.farm_name,
  c.phone_number
from orders    o
join customers c on c.id = o.customer_id
where o.season_year = (select max(season_year) from pricing)
  and o.user_id = auth.uid();


-- ---------------------------------------------------------
-- 5) v_order_items_this_season
-- ---------------------------------------------------------
create or replace view public.v_order_items_this_season as
select
  oi.id as order_item_id,
  oi.order_id,
  o.order_date,
  o.customer_id,
  c.customer_name,
  oi.product_id,
  p.product_name,
  oi.treatment_id,
  t.treatment_name,
  oi.units,
  oi.retail_price_per_unit,
  o.brand_grower_pct,
  o.early_pay_pct,
  oi.brand_grower_discount_amount,
  oi.tote_bulk_discount_amount,
  oi.early_pay_discount_amount,
  oi.line_total_after_discounts_before_early_pay,
  oi.line_total_after_all_discounts,
  oi.break_even_price_per_unit,
  oi.profit_per_unit,
  oi.total_profit as line_total_profit
from order_items oi
join orders      o on o.id = oi.order_id
join customers   c on c.id = o.customer_id
join products    p on p.id = oi.product_id
join treatments  t on t.id = oi.treatment_id
where o.season_year = (select max(season_year) from v_pricing_seasons)
  and o.user_id = auth.uid();


-- ---------------------------------------------------------
-- 6) v_deliveries_this_season
-- ---------------------------------------------------------
create or replace view public.v_deliveries_this_season as
select
  d.id as delivery_id,
  d.delivery_date,
  d.season_year,
  d.customer_id,
  c.customer_name,
  d.product_id,
  p.product_name,
  d.treatment_id,
  t.treatment_name,
  d.units_delivered,
  d.order_id,
  d.order_item_id,
  d.notes,
  d.created_at,
  d.updated_at
from deliveries d
join customers  c on c.id = d.customer_id
join products   p on p.id = d.product_id
join treatments t on t.id = d.treatment_id
where d.season_year = (select max(season_year) from v_pricing_seasons)
  and d.user_id = auth.uid();


-- ---------------------------------------------------------
-- 7) v_returns_this_season
-- ---------------------------------------------------------
create or replace view public.v_returns_this_season as
select
  r.id as return_id,
  r.return_date,
  r.season_year,
  r.customer_id,
  c.customer_name,
  r.product_id,
  p.product_name,
  r.treatment_id,
  t.treatment_name,
  r.units_returned,
  r.order_id,
  r.order_item_id,
  r.notes,
  r.created_at,
  r.updated_at
from returns    r
join customers  c on c.id = r.customer_id
join products   p on p.id = r.product_id
join treatments t on t.id = r.treatment_id
where r.season_year = (select max(season_year) from v_pricing_seasons)
  and r.user_id = auth.uid();


-- ---------------------------------------------------------
-- 8) v_replants_this_season
-- ---------------------------------------------------------
create or replace view public.v_replants_this_season as
select
  r.id as replant_id,
  r.replant_date,
  r.season_year,
  r.customer_id,
  c.customer_name,
  r.product_id,
  p.product_name,
  r.treatment_id,
  t.treatment_name,
  r.units_replanted,
  r.order_id,
  r.order_item_id,
  r.notes,
  r.created_at,
  r.updated_at
from replants   r
join customers  c on c.id = r.customer_id
join products   p on p.id = r.product_id
join treatments t on t.id = r.treatment_id
where r.season_year = (select max(season_year) from v_pricing_seasons)
  and r.user_id = auth.uid();


-- ---------------------------------------------------------
-- 9) v_on_hand_inventory
--    Each CTE filters by user_id so only the current
--    user's shipments, deliveries, and returns count.
-- ---------------------------------------------------------
drop view if exists public.v_on_hand_inventory_wide;
drop view if exists public.v_on_hand_inventory;

create view public.v_on_hand_inventory as
with received as (
  select i.product_id,
         i.treatment_id,
         sum(i.units_received)::integer as units_received
    from bayer_shipment_items i
   where i.user_id = auth.uid()
   group by i.product_id, i.treatment_id
),
delivered as (
  select d.product_id,
         d.treatment_id,
         sum(d.units_delivered)::integer as units_delivered
    from deliveries d
   where d.user_id = auth.uid()
   group by d.product_id, d.treatment_id
),
returned as (
  select r.product_id,
         r.treatment_id,
         sum(r.units_returned)::integer as units_returned
    from returns r
   where r.user_id = auth.uid()
   group by r.product_id, r.treatment_id
),
keys as (
  select product_id, treatment_id from received
  union
  select product_id, treatment_id from delivered
  union
  select product_id, treatment_id from returned
)
select
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  coalesce(rc.units_received,  0) as units_received,
  coalesce(dv.units_delivered, 0) as units_delivered,
  coalesce(rt.units_returned,  0) as units_returned,
  coalesce(rc.units_received, 0)
    - coalesce(dv.units_delivered, 0)
    + coalesce(rt.units_returned, 0) as units_on_hand
from keys k
join products   p  on p.id  = k.product_id
join treatments t  on t.id  = k.treatment_id
left join received  rc on rc.product_id  = k.product_id and rc.treatment_id  = k.treatment_id
left join delivered dv on dv.product_id  = k.product_id and dv.treatment_id  = k.treatment_id
left join returned  rt on rt.product_id  = k.product_id and rt.treatment_id  = k.treatment_id;


-- ---------------------------------------------------------
-- 10) v_on_hand_inventory_wide
--     Reads from v_on_hand_inventory which is already
--     filtered by auth.uid().
-- ---------------------------------------------------------
create view public.v_on_hand_inventory_wide as
select
  v.product_id,
  v.product_name,
  max(case when t.treatment_name = 'DIAMIDE'            then v.units_on_hand end) as "DIAMIDE",
  max(case when t.treatment_name = 'Fung/Insect'        then v.units_on_hand end) as "Fung/Insect",
  max(case when t.treatment_name = 'Fung/Insect/Ilevo'  then v.units_on_hand end) as "Fung/Insect/Ilevo",
  max(case when t.treatment_name = 'Fung/Insect/Opt'    then v.units_on_hand end) as "Fung/Insect/Opt",
  max(case when t.treatment_name = 'FUNGICIDE'          then v.units_on_hand end) as "FUNGICIDE",
  max(case when t.treatment_name = 'FUNGICIDE OPTIMIZE' then v.units_on_hand end) as "FUNGICIDE OPTIMIZE",
  max(case when t.treatment_name = 'PONCHO'             then v.units_on_hand end) as "PONCHO",
  max(case when t.treatment_name = 'Poncho/i-374'       then v.units_on_hand end) as "Poncho/i-374"
from v_on_hand_inventory v
join treatments t on t.id = v.treatment_id
group by v.product_id, v.product_name
order by v.product_name;


-- ---------------------------------------------------------
-- 11) v_dashboard_kpis_by_season
-- ---------------------------------------------------------
create or replace view public.v_dashboard_kpis_by_season as
select
  o.season_year,
  coalesce(sum(oi.units), 0)::integer as total_units_sold,
  coalesce(sum(oi.line_total_after_all_discounts), 0::numeric) as total_sales,
  coalesce(sum(oi.total_profit), 0::numeric) as total_profit,
  coalesce(sum(
    coalesce(oi.brand_grower_discount_amount, 0)
    + coalesce(oi.tote_bulk_discount_amount, 0)
    + coalesce(oi.early_pay_discount_amount, 0)
  ), 0::numeric) as total_discounts_given,
  case
    when coalesce(sum(oi.units), 0) = 0 then 0::numeric
    else round(sum(oi.line_total_after_all_discounts) / nullif(sum(oi.units), 0)::numeric, 2)
  end as avg_price_per_unit,
  case
    when coalesce(sum(oi.units), 0) = 0 then 0::numeric
    else round(sum(oi.total_profit) / nullif(sum(oi.units), 0)::numeric, 2)
  end as avg_profit_per_unit
from orders o
join order_items oi on oi.order_id = o.id
where o.user_id = auth.uid()
group by o.season_year;


-- ---------------------------------------------------------
-- 12) v_dashboard_kpis_by_season_crop
-- ---------------------------------------------------------
create or replace view public.v_dashboard_kpis_by_season_crop as
select
  o.season_year,
  p.crop,
  coalesce(sum(oi.units), 0)::integer as total_units_sold,
  coalesce(sum(oi.line_total_after_all_discounts), 0::numeric) as total_sales,
  coalesce(sum(oi.total_profit), 0::numeric) as total_profit,
  coalesce(sum(
    coalesce(oi.brand_grower_discount_amount, 0)
    + coalesce(oi.tote_bulk_discount_amount, 0)
    + coalesce(oi.early_pay_discount_amount, 0)
  ), 0::numeric) as total_discounts_given,
  case
    when coalesce(sum(oi.units), 0) = 0 then 0::numeric
    else round(sum(oi.line_total_after_all_discounts) / nullif(sum(oi.units), 0)::numeric, 2)
  end as avg_price_per_unit,
  case
    when coalesce(sum(oi.units), 0) = 0 then 0::numeric
    else round(sum(oi.total_profit) / nullif(sum(oi.units), 0)::numeric, 2)
  end as avg_profit_per_unit
from orders      o
join order_items oi on oi.order_id = o.id
join products    p  on p.id = oi.product_id
where o.user_id = auth.uid()
group by o.season_year, p.crop;


-- ---------------------------------------------------------
-- 13) v_dashboard_crop_summary_by_season
-- ---------------------------------------------------------
create or replace view public.v_dashboard_crop_summary_by_season as
select
  o.season_year,
  p.crop,
  coalesce(sum(oi.units), 0)::integer       as total_units,
  coalesce(sum(oi.line_total_after_all_discounts), 0::numeric) as total_sales,
  coalesce(sum(oi.total_profit), 0::numeric) as total_profit
from orders      o
join order_items oi on oi.order_id = o.id
join products    p  on p.id = oi.product_id
where o.user_id = auth.uid()
group by o.season_year, p.crop;


-- ---------------------------------------------------------
-- 14) v_dashboard_treatment_mix_by_season_crop
-- ---------------------------------------------------------
create or replace view public.v_dashboard_treatment_mix_by_season_crop as
select
  o.season_year,
  p.crop,
  t.treatment_name,
  coalesce(sum(oi.units), 0)::integer       as total_units,
  coalesce(sum(oi.line_total_after_all_discounts), 0::numeric) as total_sales,
  coalesce(sum(oi.total_profit), 0::numeric) as total_profit
from orders      o
join order_items oi on oi.order_id = o.id
join products    p  on p.id = oi.product_id
join treatments  t  on t.id = oi.treatment_id
where o.user_id = auth.uid()
group by o.season_year, p.crop, t.treatment_name;


-- ---------------------------------------------------------
-- 15) v_dashboard_customer_volume_buckets_by_season
-- ---------------------------------------------------------
create or replace view public.v_dashboard_customer_volume_buckets_by_season as
with customer_totals as (
  select
    o.season_year,
    o.customer_id,
    sum(oi.units)::integer                    as customer_units,
    sum(oi.line_total_after_all_discounts)    as customer_sales,
    sum(oi.total_profit)                      as customer_profit
  from orders      o
  join order_items oi on oi.order_id = o.id
  where o.user_id = auth.uid()
  group by o.season_year, o.customer_id
),
season_stats as (
  select
    season_year,
    greatest(1::numeric, ceil(max(customer_units)::numeric / 6.0))::integer as bucket_size,
    max(customer_units) as max_units
  from customer_totals
  group by season_year
),
bucketed as (
  select
    ct.season_year,
    ct.customer_id,
    ct.customer_units,
    ct.customer_sales,
    ct.customer_profit,
    ss.bucket_size,
    ss.max_units,
    least(5, floor(((ct.customer_units - 1) / nullif(ss.bucket_size, 0))::double precision)::integer) as bucket_idx
  from customer_totals ct
  join season_stats    ss on ss.season_year = ct.season_year
),
bucket_ranges as (
  select
    x.season_year,
    x.bucket_size,
    x.max_units,
    x.bucket_idx,
    x.bucket_idx * x.bucket_size + 1                          as bucket_start,
    least((x.bucket_idx + 1) * x.bucket_size, x.max_units)   as bucket_end
  from (select distinct season_year, bucket_size, max_units, bucket_idx from bucketed) x
)
select
  b.season_year,
  b.bucket_idx,
  br.bucket_start::text || '-' || br.bucket_end::text as bucket_label,
  count(*)::integer                                    as customer_count,
  coalesce(sum(b.customer_units),  0)::integer         as total_units,
  coalesce(sum(b.customer_sales),  0::numeric)         as total_sales,
  coalesce(sum(b.customer_profit), 0::numeric)         as total_profit,
  case
    when coalesce(sum(b.customer_units), 0) = 0 then 0::numeric
    else round(sum(b.customer_sales)  / nullif(sum(b.customer_units), 0)::numeric, 2)
  end as avg_price_per_unit,
  case
    when coalesce(sum(b.customer_units), 0) = 0 then 0::numeric
    else round(sum(b.customer_profit) / nullif(sum(b.customer_units), 0)::numeric, 2)
  end as avg_profit_per_unit
from bucketed      b
join bucket_ranges br on br.season_year = b.season_year and br.bucket_idx = b.bucket_idx
group by b.season_year, b.bucket_idx, br.bucket_start, br.bucket_end
order by b.season_year desc, b.bucket_idx;


-- ---------------------------------------------------------
-- 16) v_dashboard_customer_volume_buckets_by_season_crop
-- ---------------------------------------------------------
create or replace view public.v_dashboard_customer_volume_buckets_by_season_crop as
with customer_totals as (
  select
    o.season_year,
    p.crop,
    o.customer_id,
    sum(oi.units)::integer                    as customer_units,
    sum(oi.line_total_after_all_discounts)    as customer_sales,
    sum(oi.total_profit)                      as customer_profit
  from orders      o
  join order_items oi on oi.order_id = o.id
  join products    p  on p.id = oi.product_id
  where o.user_id = auth.uid()
  group by o.season_year, p.crop, o.customer_id
),
season_stats as (
  select
    season_year,
    crop,
    greatest(1::numeric, ceil(max(customer_units)::numeric / 6.0))::integer as bucket_size,
    max(customer_units) as max_units
  from customer_totals
  group by season_year, crop
),
bucketed as (
  select
    ct.season_year,
    ct.crop,
    ct.customer_id,
    ct.customer_units,
    ct.customer_sales,
    ct.customer_profit,
    ss.bucket_size,
    ss.max_units,
    least(5, floor(((ct.customer_units - 1) / nullif(ss.bucket_size, 0))::double precision)::integer) as bucket_idx
  from customer_totals ct
  join season_stats    ss on ss.season_year = ct.season_year and ss.crop = ct.crop
),
bucket_ranges as (
  select
    x.season_year,
    x.crop,
    x.bucket_size,
    x.max_units,
    x.bucket_idx,
    x.bucket_idx * x.bucket_size + 1                          as bucket_start,
    least((x.bucket_idx + 1) * x.bucket_size, x.max_units)   as bucket_end
  from (select distinct season_year, crop, bucket_size, max_units, bucket_idx from bucketed) x
)
select
  b.season_year,
  b.crop,
  b.bucket_idx,
  br.bucket_start::text || '-' || br.bucket_end::text as bucket_label,
  count(*)::integer                                    as customer_count,
  coalesce(sum(b.customer_units),  0)::integer         as total_units,
  coalesce(sum(b.customer_sales),  0::numeric)         as total_sales,
  coalesce(sum(b.customer_profit), 0::numeric)         as total_profit,
  case
    when coalesce(sum(b.customer_units), 0) = 0 then 0::numeric
    else round(sum(b.customer_sales)  / nullif(sum(b.customer_units), 0)::numeric, 2)
  end as avg_price_per_unit,
  case
    when coalesce(sum(b.customer_units), 0) = 0 then 0::numeric
    else round(sum(b.customer_profit) / nullif(sum(b.customer_units), 0)::numeric, 2)
  end as avg_profit_per_unit
from bucketed      b
join bucket_ranges br on br.season_year = b.season_year and br.crop = b.crop and br.bucket_idx = b.bucket_idx
group by b.season_year, b.crop, b.bucket_idx, br.bucket_start, br.bucket_end
order by b.season_year desc, b.crop, b.bucket_idx;


-- ---------------------------------------------------------
-- 17) v_year_end_adjustments
--     Each CTE filters its driving table by user_id.
--     invoice_adjustment_checks join also filters by user_id.
-- ---------------------------------------------------------
create or replace view public.v_year_end_adjustments as
with ordered as (
  select
    o_1.season_year,
    o_1.customer_id,
    oi.product_id,
    oi.treatment_id,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(oi.units)::integer as units_ordered,
    max(coalesce(o_1.early_pay_pct, 0))::integer as early_pay_pct
  from orders      o_1
  join order_items oi on oi.order_id = o_1.id
  where o_1.user_id = auth.uid()
  group by o_1.season_year, o_1.customer_id, oi.product_id, oi.treatment_id,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
delivered as (
  select
    d_1.season_year,
    d_1.customer_id,
    d_1.product_id,
    d_1.treatment_id,
    case
      when d_1.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(d_1.units_delivered)::integer as units_delivered
  from deliveries  d_1
  left join order_items oi on oi.id = d_1.order_item_id
  left join orders      o_1 on o_1.id = oi.order_id
  where d_1.user_id = auth.uid()
  group by d_1.season_year, d_1.customer_id, d_1.product_id, d_1.treatment_id,
    case
      when d_1.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
returned as (
  select
    r_1.season_year,
    r_1.customer_id,
    r_1.product_id,
    r_1.treatment_id,
    case
      when r_1.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(r_1.units_returned)::integer as units_returned
  from returns     r_1
  left join order_items oi on oi.id = r_1.order_item_id
  left join orders      o_1 on o_1.id = oi.order_id
  where r_1.user_id = auth.uid()
  group by r_1.season_year, r_1.customer_id, r_1.product_id, r_1.treatment_id,
    case
      when r_1.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o_1.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
keys as (
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from ordered
  union
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from delivered
  union
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from returned
)
select
  k.season_year,
  k.customer_id,
  c.customer_name,
  k.product_id,
  p.product_name,
  k.treatment_id,
  t.treatment_name,
  k.early_pay_bucket,
  o.early_pay_pct,
  coalesce(o.units_ordered,   0) as units_ordered,
  coalesce(d.units_delivered, 0) as units_delivered,
  coalesce(r.units_returned,  0) as units_returned,
  coalesce(o.units_ordered, 0) - coalesce(d.units_delivered, 0) + coalesce(r.units_returned, 0) as net_units,
  coalesce(ch.is_completed, false) as is_completed,
  ch.completed_at
from keys k
join customers c on c.id = k.customer_id
join products  p on p.id = k.product_id
join treatments t on t.id = k.treatment_id
left join ordered   o  on o.season_year = k.season_year and o.customer_id = k.customer_id
                        and o.product_id = k.product_id and o.treatment_id = k.treatment_id
                        and o.early_pay_bucket = k.early_pay_bucket
left join delivered d  on d.season_year = k.season_year and d.customer_id = k.customer_id
                        and d.product_id = k.product_id and d.treatment_id = k.treatment_id
                        and d.early_pay_bucket = k.early_pay_bucket
left join returned  r  on r.season_year = k.season_year and r.customer_id = k.customer_id
                        and r.product_id = k.product_id and r.treatment_id = k.treatment_id
                        and r.early_pay_bucket = k.early_pay_bucket
left join invoice_adjustment_checks ch
  on  ch.season_year      = k.season_year
  and ch.customer_id      = k.customer_id
  and ch.product_id       = k.product_id
  and ch.treatment_id     = k.treatment_id
  and ch.early_pay_bucket = k.early_pay_bucket
  and ch.user_id          = auth.uid();
