-- =========================================================
-- 0019_v_customer_order_status_add_replants.sql
-- Rebuild v_delivery_customer_order_status to:
--   1) Include replanted units from the replants table
--   2) Expose package_type from order_items
--   3) Update net_units formula:
--        ordered - delivered - replanted + returned
-- Columns change → must DROP then CREATE (not REPLACE).
-- =========================================================

drop view if exists public.v_delivery_customer_order_status;

create view public.v_delivery_customer_order_status as
with delivered as (
  select d.user_id,
         d.order_item_id,
         sum(d.units_delivered)::integer as delivered_units
    from deliveries d
   where d.user_id = auth.uid()
     and d.order_item_id is not null
   group by d.user_id, d.order_item_id
),
returned as (
  select r.user_id,
         r.order_item_id,
         sum(r.units_returned)::integer as returned_units
    from returns r
   where r.user_id = auth.uid()
     and r.order_item_id is not null
   group by r.user_id, r.order_item_id
),
replanted as (
  select rp.user_id,
         rp.order_item_id,
         sum(rp.units_replanted)::integer as replanted_units
    from replants rp
   where rp.user_id = auth.uid()
     and rp.order_item_id is not null
   group by rp.user_id, rp.order_item_id
)
select
  o.season_year,
  o.customer_id,
  c.customer_name,
  o.id                                              as order_id,
  o.order_date,
  oi.id                                             as order_item_id,
  oi.product_id,
  p.product_name,
  p.crop,
  oi.treatment_id,
  t.treatment_name,
  oi.seed_size,
  oi.package_type,
  oi.units                                          as ordered_units,
  coalesce(d.delivered_units,  0)                   as delivered_units,
  coalesce(r.returned_units,   0)                   as returned_units,
  coalesce(rp.replanted_units, 0)                   as replanted_units,
  oi.units
    - coalesce(d.delivered_units,  0)
    - coalesce(rp.replanted_units, 0)
    + coalesce(r.returned_units,   0)               as net_units,
  case
    when oi.units
       - coalesce(d.delivered_units,  0)
       - coalesce(rp.replanted_units, 0)
       + coalesce(r.returned_units,   0) <= 0
    then true
    else false
  end                                               as is_complete
from orders        o
join customers     c  on c.id  = o.customer_id  and c.user_id  = o.user_id
join order_items   oi on oi.order_id = o.id     and oi.user_id = o.user_id
join products      p  on p.id  = oi.product_id
join treatments    t  on t.id  = oi.treatment_id
left join delivered  d  on d.order_item_id  = oi.id and d.user_id  = o.user_id
left join returned   r  on r.order_item_id  = oi.id and r.user_id  = o.user_id
left join replanted  rp on rp.order_item_id = oi.id and rp.user_id = o.user_id
where o.user_id = auth.uid();
