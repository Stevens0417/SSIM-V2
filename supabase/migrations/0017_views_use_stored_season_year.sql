-- =========================================================
-- 0017_views_use_stored_season_year.sql
-- Switch bayer_shipments views from extract(year from shipment_date)
-- to the stored season_year column.
--
-- v_bayer_shipments + v_bayer_shipments_headers were already
-- updated in-place; this migration catches v_all_seasons and
-- ensures all three views are authoritative.
-- =========================================================


-- ---------------------------------------------------------
-- 1) v_all_seasons — use s.season_year instead of EXTRACT
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
  select distinct s.season_year
    from bayer_shipments s
   where s.user_id = auth.uid()
order by 1 desc;


-- ---------------------------------------------------------
-- 2) v_bayer_shipments — use s.season_year, filter both tables
-- ---------------------------------------------------------
create or replace view public.v_bayer_shipments as
select
  s.id            as shipment_id,
  s.shipment_date,
  s.season_year,
  s.shipment_number,
  i.id            as shipment_item_id,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  i.units_received,
  i.is_verified,
  i.verified_at,
  i.verified_by,
  s.created_at,
  s.updated_at
from bayer_shipments      s
join bayer_shipment_items i on i.shipment_id = s.id
join products             p on p.id = i.product_id
join treatments           t on t.id = i.treatment_id
where s.user_id = auth.uid()
  and i.user_id = auth.uid();


-- ---------------------------------------------------------
-- 3) v_bayer_shipments_headers — use s.season_year
-- ---------------------------------------------------------
create or replace view public.v_bayer_shipments_headers as
select
  id as shipment_id,
  shipment_date,
  season_year,
  shipment_number,
  created_at,
  updated_at
from bayer_shipments s
where user_id = auth.uid();
