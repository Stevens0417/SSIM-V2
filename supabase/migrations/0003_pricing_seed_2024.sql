-- 0003_pricing_seed_2024.sql
-- Dev seed data for 2024 season

-- Treatments (sample)
insert into public.treatments (treatment_name, description)
values
  ('Standard', 'Base seed treatment'),
  ('Premium', 'Upgraded treatment package'),
  ('None', 'No treatment')
on conflict on constraint uq_treatments_name do nothing;

-- Products (sample)
insert into public.products (product_name, crop)
values
  ('DKC 45-50', 'Corn'),
  ('PIONEER 021', 'Soybean'),
  ('DKC 50-20', 'Corn')
on conflict on constraint uq_products_name do nothing;

-- Pricing pairs for 2024 (sample)
insert into public.pricing (season_year, product_id, treatment_id, retail_price)
select
  2024,
  p.id,
  t.id,
  x.retail_price
from (
  values
    ('DKC 45-50',    'Standard', 410.00::numeric),
    ('DKC 45-50',    'Premium',  425.00::numeric),
    ('DKC 45-50',    'None',     395.00::numeric),
    ('PIONEER 021',  'Standard',  78.00::numeric),
    ('PIONEER 021',  'Premium',   84.00::numeric),
    ('PIONEER 021',  'None',      72.00::numeric),
    ('DKC 50-20',    'Standard', 415.00::numeric),
    ('DKC 50-20',    'Premium',  430.00::numeric),
    ('DKC 50-20',    'None',     400.00::numeric)
) as x(product_name, treatment_name, retail_price)
join public.products p on p.product_name = x.product_name
join public.treatments t on t.treatment_name = x.treatment_name
on conflict on constraint uq_pricing_unique_pair do update
  set retail_price = excluded.retail_price,
      updated_at = now();
