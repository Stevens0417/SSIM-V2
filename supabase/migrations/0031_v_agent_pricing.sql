-- =========================================================
-- 0031_v_agent_pricing.sql
--
-- Agent-approved pricing view for the SQL fallback tool.
--
-- Source: v_pricing_options (which joins pricing + products
--         + treatments and computes break_even_price).
--
-- v_agent_pricing wraps v_pricing_options and adds:
--   - margin_per_unit  = retail_price - break_even_price
--   - margin_pct       = margin_per_unit / retail_price × 100
--
-- Grain:
--   One row per (season_year, product, treatment).
--   Pricing has no seed_size or package_type dimension —
--   all treatments for a product are priced the same per unit
--   regardless of seed size or package type.
--
-- User scope:
--   Pricing is GLOBAL — no user_id column exists in the
--   pricing table. This view returns the same rows for every
--   authenticated user. This is by design and matches
--   v_pricing_options behavior.
--
-- Security:
--   The SQL fallback TypeScript validator allows only
--   v_agent_* approved views, so raw pricing tables and
--   other non-agent views cannot be queried directly.
-- =========================================================


create or replace view public.v_agent_pricing as
select
  po.season_year,
  po.product_id,
  po.product_name,
  po.crop,
  po.chu,
  po.seed_trait,
  po.treatment_id,
  po.treatment_name,
  po.retail_price                                              as retail_price_per_unit,
  po.break_even_price                                          as break_even_price_per_unit,
  -- margin_per_unit: how much above break-even the retail price sits
  case when po.break_even_price is not null
    then round(po.retail_price - po.break_even_price, 2)
  end                                                          as margin_per_unit,
  -- margin_pct: margin as a percentage of retail price (null for packaging rows)
  case when po.retail_price > 0 and po.break_even_price is not null
    then round(
      (po.retail_price - po.break_even_price) / po.retail_price * 100,
      2
    )
  end                                                          as margin_pct
from public.v_pricing_options po;
