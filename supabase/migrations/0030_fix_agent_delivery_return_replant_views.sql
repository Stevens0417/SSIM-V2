-- =========================================================
-- 0030_fix_agent_delivery_return_replant_views.sql
--
-- Bug fix: v_agent_customer_deliveries, v_agent_customer_returns,
-- and v_agent_customer_replants were using oi.seed_size and
-- oi.package_type from a LEFT JOIN on order_items.
--
-- Effect of the bug:
--   Unlinked deliveries/returns/replants (no order_item_id) had
--   NULL seed_size and package_type even though those values are
--   stored directly on the deliveries/returns/replants rows.
--   Agent SQL fallback queries aggregating by seed_size or
--   package_type would therefore under-count unlinked records.
--
-- Fix:
--   Use the source table's own seed_size and package_type columns
--   (d.seed_size / d.package_type, r.seed_size / r.package_type,
--   rp.seed_size / rp.package_type).
--   The LEFT JOIN on order_items is no longer needed and is removed.
--
-- Column structure is unchanged (same names and types) so
-- CREATE OR REPLACE is safe.
-- =========================================================


-- ---------------------------------------------------------
-- v_agent_customer_deliveries — use d.seed_size / d.package_type
-- ---------------------------------------------------------
create or replace view public.v_agent_customer_deliveries as
select
  d.id                as delivery_id,
  d.delivery_date,
  d.season_year,
  d.customer_id,
  c.customer_name,
  c.farm_name,
  d.product_id,
  p.product_name,
  d.treatment_id,
  t.treatment_name,
  d.seed_size,
  d.package_type,
  d.units_delivered,
  d.order_id,
  d.order_item_id,
  d.notes,
  d.created_at
from deliveries d
join customers  c  on c.id = d.customer_id and c.user_id = d.user_id
join products   p  on p.id = d.product_id
join treatments t  on t.id = d.treatment_id
where d.user_id = auth.uid();


-- ---------------------------------------------------------
-- v_agent_customer_returns — use r.seed_size / r.package_type
-- ---------------------------------------------------------
create or replace view public.v_agent_customer_returns as
select
  r.id                as return_id,
  r.return_date,
  r.season_year,
  r.customer_id,
  c.customer_name,
  c.farm_name,
  r.product_id,
  p.product_name,
  r.treatment_id,
  t.treatment_name,
  r.seed_size,
  r.package_type,
  r.units_returned,
  r.order_id,
  r.order_item_id,
  r.notes,
  r.created_at
from returns    r
join customers  c  on c.id = r.customer_id and c.user_id = r.user_id
join products   p  on p.id = r.product_id
join treatments t  on t.id = r.treatment_id
where r.user_id = auth.uid();


-- ---------------------------------------------------------
-- v_agent_customer_replants — use rp.seed_size / rp.package_type
-- ---------------------------------------------------------
create or replace view public.v_agent_customer_replants as
select
  rp.id               as replant_id,
  rp.replant_date,
  rp.season_year,
  rp.customer_id,
  c.customer_name,
  c.farm_name,
  rp.product_id,
  p.product_name,
  rp.treatment_id,
  t.treatment_name,
  rp.seed_size,
  rp.package_type,
  rp.units_replanted,
  rp.order_id,
  rp.order_item_id,
  rp.notes,
  rp.created_at
from replants   rp
join customers  c  on c.id = rp.customer_id and c.user_id = rp.user_id
join products   p  on p.id = rp.product_id
join treatments t  on t.id = rp.treatment_id
where rp.user_id = auth.uid();
