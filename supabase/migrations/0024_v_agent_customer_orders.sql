-- =========================================================
-- 0024_v_agent_customer_orders.sql
--
-- Agent-approved read-only view of order items with full
-- pricing and profit detail.
--
-- Design notes:
--   - NOT pre-filtered by season — the backend passes
--     season_year as a filter parameter.
--   - User-scoped via auth.uid() on both orders and
--     order_items joins.
--   - Grain: one row per order_item.
--   - Includes all pricing/profit columns already present
--     on order_items so the agent can answer pricing and
--     profit questions without any additional view.
-- =========================================================

create view public.v_agent_customer_current_season_orders as
select
  o.user_id,
  oi.id                              as order_item_id,
  oi.order_id,
  o.season_year,
  o.order_date,
  o.customer_id,
  c.customer_name,
  c.farm_name,
  oi.product_id,
  p.product_name,
  p.crop,
  oi.treatment_id,
  t.treatment_name,
  oi.seed_size,
  oi.package_type,
  oi.units                           as units_ordered,
  (o.early_pay_pct > 0)             as early_pay,
  o.early_pay_pct,
  o.brand_grower_pct,
  oi.retail_price_per_unit,
  oi.brand_grower_discount_amount,
  oi.tote_bulk_discount_amount,
  oi.early_pay_discount_amount,
  oi.line_total_after_all_discounts,
  oi.break_even_price_per_unit,
  oi.profit_per_unit,
  oi.total_profit                    as line_total_profit,
  o.created_at                       as order_created_at
from order_items oi
join orders      o  on o.id  = oi.order_id
join customers   c  on c.id  = o.customer_id
join products    p  on p.id  = oi.product_id
join treatments  t  on t.id  = oi.treatment_id
where o.user_id  = auth.uid()
  and oi.user_id = auth.uid();
