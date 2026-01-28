-- =========================================================
-- 0004_views_pricing.sql
-- Pricing views for Phase 1
-- - Seasons list for UI tabs
-- - Retail wide sheet (Excel-like)
-- - Break-even wide sheet (computed)
-- - Pricing options helper (long format) INCLUDING IDs
--
-- NOTE: If a view's output columns change, DROP + CREATE is required.
-- =========================================================

-- Drop in dependency-safe order
drop view if exists public.v_pricing_break_even_wide;
drop view if exists public.v_pricing_sheet_wide;
drop view if exists public.v_pricing_options;
drop view if exists public.v_pricing_seasons;

-- ---------------------------------------------------------
-- 1) Seasons list (for UI tabs)
-- ---------------------------------------------------------
create view public.v_pricing_seasons as
select distinct
  season_year
from public.pricing
order by season_year desc;

-- ---------------------------------------------------------
-- Helper expression: break-even based on crop
-- Corn: retail - (0.075*retail) - 56.65
-- Soybean: retail - (0.075*retail) - 10.40
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- 2) Pricing options (long format) WITH IDs
-- Source of truth for Orders dropdowns (Phase 1)
-- ---------------------------------------------------------
create view public.v_pricing_options as
select
  pr.season_year,

  p.id as product_id,
  p.product_name,
  p.crop,
  p.chu,
  p.seed_trait,

  t.id as treatment_id,
  t.treatment_name,

  pr.retail_price,

  case
    when lower(p.crop) = 'corn'
      then pr.retail_price - (0.075 * pr.retail_price) - 56.65
    when lower(p.crop) = 'soybean'
      then pr.retail_price - (0.075 * pr.retail_price) - 10.40
    else null
  end as break_even_price

from public.pricing pr
join public.products p on p.id = pr.product_id
join public.treatments t on t.id = pr.treatment_id;

-- ---------------------------------------------------------
-- 3) Retail pricing sheet (wide / Excel-like)
-- Treatments are pivoted to columns (fixed set).
-- ---------------------------------------------------------
create view public.v_pricing_sheet_wide as
select
  pr.season_year,
  p.product_name as product,
  p.crop,
  p.chu,
  p.seed_trait,

  max(case when t.treatment_name = 'PONCHO' then pr.retail_price end) as "PONCHO",
  max(case when t.treatment_name = 'FUNGICIDE' then pr.retail_price end) as "FUNGICIDE",
  max(case when t.treatment_name = 'FUNGICIDE OPTIMIZE' then pr.retail_price end) as "FUNGICIDE OPTIMIZE",
  max(case when t.treatment_name = 'Fung/Insect' then pr.retail_price end) as "Fung/Insect",
  max(case when t.treatment_name = 'DIAMIDE' then pr.retail_price end) as "DIAMIDE",
  max(case when t.treatment_name = 'Poncho/i-374' then pr.retail_price end) as "Poncho/i-374",
  max(case when t.treatment_name = 'Fung/Insect/Opt' then pr.retail_price end) as "Fung/Insect/Opt",
  max(case when t.treatment_name = 'Fung/Insect/Ilevo' then pr.retail_price end) as "Fung/Insect/Ilevo"

from public.pricing pr
join public.products p on p.id = pr.product_id
join public.treatments t on t.id = pr.treatment_id
group by
  pr.season_year,
  p.product_name,
  p.crop,
  p.chu,
  p.seed_trait;

-- ---------------------------------------------------------
-- 4) Break-even pricing sheet (wide / Excel-like)
-- Same shape as retail wide view; values computed.
-- ---------------------------------------------------------
create view public.v_pricing_break_even_wide as
select
  pr.season_year,
  p.product_name as product,
  p.crop,
  p.chu,
  p.seed_trait,

  max(
    case when t.treatment_name = 'PONCHO' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "PONCHO",

  max(
    case when t.treatment_name = 'FUNGICIDE' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "FUNGICIDE",

  max(
    case when t.treatment_name = 'FUNGICIDE OPTIMIZE' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "FUNGICIDE OPTIMIZE",

  max(
    case when t.treatment_name = 'Fung/Insect' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "Fung/Insect",

  max(
    case when t.treatment_name = 'DIAMIDE' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "DIAMIDE",

  max(
    case when t.treatment_name = 'Poncho/i-374' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "Poncho/i-374",

  max(
    case when t.treatment_name = 'Fung/Insect/Opt' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "Fung/Insect/Opt",

  max(
    case when t.treatment_name = 'Fung/Insect/Ilevo' then
      case
        when lower(p.crop) = 'corn' then pr.retail_price - (0.075 * pr.retail_price) - 56.65
        when lower(p.crop) = 'soybean' then pr.retail_price - (0.075 * pr.retail_price) - 10.40
        else null
      end
    end
  ) as "Fung/Insect/Ilevo"

from public.pricing pr
join public.products p on p.id = pr.product_id
join public.treatments t on t.id = pr.treatment_id
group by
  pr.season_year,
  p.product_name,
  p.crop,
  p.chu,
  p.seed_trait;
