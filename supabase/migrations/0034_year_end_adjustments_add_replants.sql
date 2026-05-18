-- =========================================================
-- 0034_year_end_adjustments_add_replants.sql
--
-- Adds units_replanted to v_year_end_adjustments and updates
-- net_units to include replanted units:
--
--   net_units = units_ordered
--             - units_delivered
--             - units_replanted   ← new
--             + units_returned
--
-- Replants are non-revenue units the customer receives due to
-- field failure. They require supplier credit tracking and
-- therefore belong in the year-end adjustment reconciliation.
--
-- Early-pay bucket assignment for replants follows the same
-- rule as deliveries/returns:
--   - UNKNOWN       if order_item_id is null
--   - EARLY_PAY     if linked order has early_pay_discount_amount != 0
--                   or early_pay_pct != 0
--   - NO_EARLY_PAY  otherwise
--
-- DROP + CREATE is required because units_replanted is inserted
-- between units_delivered and units_returned (mid-list column
-- addition), which CREATE OR REPLACE VIEW does not support.
--
-- No other views depend on v_year_end_adjustments.
-- =========================================================

drop view if exists public.v_year_end_adjustments;

create view public.v_year_end_adjustments as
with ordered as (
  select
    o.season_year,
    o.customer_id,
    oi.product_id,
    oi.treatment_id,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(oi.units)::integer            as units_ordered,
    max(coalesce(o.early_pay_pct, 0))::integer as early_pay_pct
  from orders      o
  join order_items oi on oi.order_id = o.id
  where o.user_id = auth.uid()
  group by
    o.season_year, o.customer_id, oi.product_id, oi.treatment_id,
    case
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
delivered as (
  select
    d.season_year,
    d.customer_id,
    d.product_id,
    d.treatment_id,
    case
      when d.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(d.units_delivered)::integer   as units_delivered
  from deliveries  d
  left join order_items oi on oi.id = d.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where d.user_id = auth.uid()
  group by
    d.season_year, d.customer_id, d.product_id, d.treatment_id,
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
    rp.season_year,
    rp.customer_id,
    rp.product_id,
    rp.treatment_id,
    case
      when rp.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(rp.units_replanted)::integer  as units_replanted
  from replants    rp
  left join order_items oi on oi.id = rp.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where rp.user_id = auth.uid()
  group by
    rp.season_year, rp.customer_id, rp.product_id, rp.treatment_id,
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
    r.season_year,
    r.customer_id,
    r.product_id,
    r.treatment_id,
    case
      when r.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end as early_pay_bucket,
    sum(r.units_returned)::integer    as units_returned
  from returns     r
  left join order_items oi on oi.id = r.order_item_id
  left join orders      o  on o.id  = oi.order_id
  where r.user_id = auth.uid()
  group by
    r.season_year, r.customer_id, r.product_id, r.treatment_id,
    case
      when r.order_item_id is null then 'UNKNOWN'
      when coalesce(oi.early_pay_discount_amount, 0) <> 0
        or coalesce(o.early_pay_pct, 0) <> 0
      then 'EARLY_PAY'
      else 'NO_EARLY_PAY'
    end
),
keys as (
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from ordered
  union
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from delivered
  union
  select season_year, customer_id, product_id, treatment_id, early_pay_bucket from replanted
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
  coalesce(o.units_ordered,     0)  as units_ordered,
  coalesce(d.units_delivered,   0)  as units_delivered,
  coalesce(rep.units_replanted, 0)  as units_replanted,
  coalesce(r.units_returned,    0)  as units_returned,
  coalesce(o.units_ordered,     0)
    - coalesce(d.units_delivered,   0)
    - coalesce(rep.units_replanted, 0)
    + coalesce(r.units_returned,    0) as net_units,
  coalesce(ch.is_completed, false)  as is_completed,
  ch.completed_at
from keys k
join customers  c  on c.id = k.customer_id
join products   p  on p.id = k.product_id
join treatments t  on t.id = k.treatment_id
left join ordered   o
  on  o.season_year      = k.season_year
  and o.customer_id      = k.customer_id
  and o.product_id       = k.product_id
  and o.treatment_id     = k.treatment_id
  and o.early_pay_bucket = k.early_pay_bucket
left join delivered d
  on  d.season_year      = k.season_year
  and d.customer_id      = k.customer_id
  and d.product_id       = k.product_id
  and d.treatment_id     = k.treatment_id
  and d.early_pay_bucket = k.early_pay_bucket
left join replanted rep
  on  rep.season_year      = k.season_year
  and rep.customer_id      = k.customer_id
  and rep.product_id       = k.product_id
  and rep.treatment_id     = k.treatment_id
  and rep.early_pay_bucket = k.early_pay_bucket
left join returned  r
  on  r.season_year      = k.season_year
  and r.customer_id      = k.customer_id
  and r.product_id       = k.product_id
  and r.treatment_id     = k.treatment_id
  and r.early_pay_bucket = k.early_pay_bucket
left join invoice_adjustment_checks ch
  on  ch.season_year      = k.season_year
  and ch.customer_id      = k.customer_id
  and ch.product_id       = k.product_id
  and ch.treatment_id     = k.treatment_id
  and ch.early_pay_bucket = k.early_pay_bucket
  and ch.user_id          = auth.uid();
