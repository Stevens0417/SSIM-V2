-- 0011_v_replants_this_season.sql
-- View for replants in the current season

CREATE OR REPLACE VIEW public.v_replants_this_season AS
SELECT
  r.id AS replant_id,
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
FROM public.replants r
JOIN public.customers c ON c.id = r.customer_id
JOIN public.products p ON p.id = r.product_id
JOIN public.treatments t ON t.id = r.treatment_id
WHERE r.season_year = (SELECT MAX(season_year) FROM public.pricing);
