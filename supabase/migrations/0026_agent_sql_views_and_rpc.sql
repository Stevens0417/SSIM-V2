-- =========================================================
-- 0026_agent_sql_views_and_rpc.sql
--
-- Approved agent views (thin wrappers + new activity views)
-- and execute_agent_readonly_query() RPC for the SQL fallback
-- tool (run_approved_readonly_query).
--
-- Security model:
--   SECURITY INVOKER on the RPC → auth.uid() resolves to the
--   calling user's JWT, so all view auth.uid() WHERE clauses
--   work correctly.
--
--   TypeScript validator is the primary gate: approved-views
--   whitelist + forbidden keyword check + LIMIT enforcement.
--
--   DB adds statement_timeout = 5s as safety net against
--   long-running queries from the model.
-- =========================================================


-- ---------------------------------------------------------
-- Thin wrappers around existing user-scoped views
-- These give the SQL fallback a stable, consistently-named
-- v_agent_* namespace.
-- ---------------------------------------------------------

create or replace view public.v_agent_customer_orders as
select * from public.v_agent_customer_current_season_orders;

create or replace view public.v_agent_order_fulfillment as
select * from public.v_delivery_customer_order_status;

create or replace view public.v_agent_inventory as
select * from public.v_on_hand_inventory;

create or replace view public.v_agent_bayer_shipments as
select * from public.v_bayer_shipments;


-- ---------------------------------------------------------
-- v_agent_customer_deliveries
-- Grain: one row per delivery record.
-- Includes seed_size and package_type via LEFT JOIN on
-- order_items when the delivery is linked to an order item.
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
  oi.seed_size,
  oi.package_type,
  d.units_delivered,
  d.order_id,
  d.order_item_id,
  d.notes,
  d.created_at
from deliveries   d
join customers    c  on c.id = d.customer_id and c.user_id = d.user_id
join products     p  on p.id = d.product_id
join treatments   t  on t.id = d.treatment_id
left join order_items oi on oi.id = d.order_item_id and oi.user_id = d.user_id
where d.user_id = auth.uid();


-- ---------------------------------------------------------
-- v_agent_customer_returns
-- Grain: one row per return record.
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
  oi.seed_size,
  oi.package_type,
  r.units_returned,
  r.order_id,
  r.order_item_id,
  r.notes,
  r.created_at
from returns      r
join customers    c  on c.id = r.customer_id and c.user_id = r.user_id
join products     p  on p.id = r.product_id
join treatments   t  on t.id = r.treatment_id
left join order_items oi on oi.id = r.order_item_id and oi.user_id = r.user_id
where r.user_id = auth.uid();


-- ---------------------------------------------------------
-- v_agent_customer_replants
-- Grain: one row per replant record.
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
  oi.seed_size,
  oi.package_type,
  rp.units_replanted,
  rp.order_id,
  rp.order_item_id,
  rp.notes,
  rp.created_at
from replants     rp
join customers    c  on c.id = rp.customer_id and c.user_id = rp.user_id
join products     p  on p.id = rp.product_id
join treatments   t  on t.id = rp.treatment_id
left join order_items oi on oi.id = rp.order_item_id and oi.user_id = rp.user_id
where rp.user_id = auth.uid();


-- ---------------------------------------------------------
-- RPC: execute_agent_readonly_query
--
-- Called by the run_approved_readonly_query agent tool after
-- TypeScript validation has passed.
--
-- SECURITY INVOKER: runs as the calling user so auth.uid()
-- resolves correctly inside all v_agent_* views.
--
-- statement_timeout = 5s: prevents runaway queries from the
-- model consuming server resources.
--
-- Returns: JSON array of rows ([] if no results).
-- ---------------------------------------------------------
create or replace function public.execute_agent_readonly_query(p_sql text)
returns json
language plpgsql
security invoker
as $$
declare
  v_result json;
begin
  -- Reject anything that isn't a SELECT or WITH statement.
  -- TypeScript is the primary validator; this is a last-resort
  -- db-level check in case the validator has a gap.
  if lower(ltrim(p_sql)) not like 'select%'
     and lower(ltrim(p_sql)) not like 'with%'
  then
    raise exception 'Only SELECT queries are permitted';
  end if;

  -- 5-second budget per query — prevents runaway model output
  set local statement_timeout = '5000';

  execute format(
    'select coalesce(json_agg(row_to_json(q)), ''[]''::json) from (%s) q',
    p_sql
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.execute_agent_readonly_query(text) to authenticated;
