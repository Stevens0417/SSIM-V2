-- =========================================================
-- 0012_global_rls.sql
-- RLS for GLOBAL (shared) tables: products, treatments, pricing
--
-- Rules:
--   • Authenticated users may SELECT (read).
--   • No INSERT / UPDATE / DELETE for authenticated users.
--   • Anonymous (not logged in) gets nothing.
--
-- Views that read these tables (v_pricing_seasons,
-- v_pricing_options, v_pricing_sheet_wide,
-- v_pricing_break_even_wide, etc.) use SECURITY INVOKER
-- by default, so RLS on the base tables is enforced
-- transparently — no view changes needed.
-- =========================================================

-- ---------------------------------------------------------
-- 1) public.products
-- ---------------------------------------------------------
alter table public.products enable row level security;

-- Drop if re-running
drop policy if exists "Authenticated users can read products" on public.products;

create policy "Authenticated users can read products"
  on public.products
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- 2) public.treatments
-- ---------------------------------------------------------
alter table public.treatments enable row level security;

drop policy if exists "Authenticated users can read treatments" on public.treatments;

create policy "Authenticated users can read treatments"
  on public.treatments
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- 3) public.pricing
-- ---------------------------------------------------------
alter table public.pricing enable row level security;

drop policy if exists "Authenticated users can read pricing" on public.pricing;

create policy "Authenticated users can read pricing"
  on public.pricing
  for select
  to authenticated
  using (true);
