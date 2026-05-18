-- =========================================================
-- 0033_delivery_headers.sql
--
-- Creates an explicit delivery header table so multi-line
-- delivery forms can be grouped, edited, and printed as
-- one saved unit.
--
-- Audit ref: docs/03_Data/delivery_grouping_audit.md
--
-- Changes:
--   1. delivery_headers table (new)
--   2. deliveries.delivery_header_id (new nullable column)
--   3. Indexes
--   4. RLS for delivery_headers (user_id-scoped)
--   5. v_deliveries_this_season — DROP + rebuild
--      Adds seed_size, package_type (were missing from 0014
--      definition but present in live DB), and delivery_header_id
--   6. v_delivery_headers_this_season (new summary view)
--
-- Backward compatibility:
--   Existing deliveries rows keep delivery_header_id = NULL.
--   All queries, views, and inventory calculations that read
--   from deliveries are unaffected — the column is nullable.
--   Single-row print/edit treats NULL delivery_header_id as
--   a legacy record and falls back to created_at grouping.
-- =========================================================


-- ---------------------------------------------------------
-- 1) delivery_headers
-- ---------------------------------------------------------
create table if not exists public.delivery_headers (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users on delete cascade,
  customer_id    uuid        not null references public.customers on delete restrict,
  delivery_date  date        not null,
  season_year    integer     not null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);


-- ---------------------------------------------------------
-- 2) deliveries.delivery_header_id  (nullable)
--    NULL for all historical rows — those remain intact.
-- ---------------------------------------------------------
alter table public.deliveries
  add column if not exists delivery_header_id uuid
    references public.delivery_headers (id) on delete set null;


-- ---------------------------------------------------------
-- 3) Indexes
-- ---------------------------------------------------------
create index if not exists delivery_headers_user_id_idx
  on public.delivery_headers (user_id);

create index if not exists delivery_headers_customer_id_idx
  on public.delivery_headers (customer_id);

create index if not exists delivery_headers_date_season_idx
  on public.delivery_headers (delivery_date, season_year);

create index if not exists deliveries_delivery_header_id_idx
  on public.deliveries (delivery_header_id)
  where delivery_header_id is not null;


-- ---------------------------------------------------------
-- 4) RLS for delivery_headers
-- ---------------------------------------------------------
alter table public.delivery_headers enable row level security;

alter table public.delivery_headers
  alter column user_id set default auth.uid();

drop policy if exists "Users can read own delivery_headers"
  on public.delivery_headers;
drop policy if exists "Users can insert own delivery_headers"
  on public.delivery_headers;
drop policy if exists "Users can update own delivery_headers"
  on public.delivery_headers;
drop policy if exists "Users can delete own delivery_headers"
  on public.delivery_headers;

create policy "Users can read own delivery_headers"
  on public.delivery_headers for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own delivery_headers"
  on public.delivery_headers for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own delivery_headers"
  on public.delivery_headers for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own delivery_headers"
  on public.delivery_headers for delete to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------
-- 5) v_deliveries_this_season  (DROP + rebuild)
--
--    The original definition (0014) did not include
--    seed_size or package_type — those were added to the
--    live database outside of a migration.  This rebuild
--    makes the migration-tracked definition match reality
--    and also adds delivery_header_id.
--
--    Column order: delivery_id, delivery_date, season_year,
--    customer_id, customer_name, product_id, product_name,
--    treatment_id, treatment_name, units_delivered,
--    seed_size, package_type,           ← restored
--    order_id, order_item_id, notes,
--    delivery_header_id,                ← new
--    created_at, updated_at
-- ---------------------------------------------------------
drop view if exists public.v_deliveries_this_season;

create view public.v_deliveries_this_season as
select
  d.id                  as delivery_id,
  d.delivery_date,
  d.season_year,
  d.customer_id,
  c.customer_name,
  d.product_id,
  p.product_name,
  d.treatment_id,
  t.treatment_name,
  d.units_delivered,
  d.seed_size,
  d.package_type,
  d.order_id,
  d.order_item_id,
  d.notes,
  d.delivery_header_id,
  d.created_at,
  d.updated_at
from deliveries d
join customers  c on c.id = d.customer_id
join products   p on p.id = d.product_id
join treatments t on t.id = d.treatment_id
where d.season_year = (select max(season_year) from v_pricing_seasons)
  and d.user_id = auth.uid();


-- ---------------------------------------------------------
-- 6) v_delivery_headers_this_season  (new)
--    One row per header; shows item count and total units.
--    Used for a future "Saved Deliveries" list that groups
--    by header rather than by individual delivery rows.
-- ---------------------------------------------------------
create or replace view public.v_delivery_headers_this_season as
select
  h.id                                as header_id,
  h.delivery_date,
  h.season_year,
  h.customer_id,
  c.customer_name,
  h.notes,
  count(d.id)::integer                as item_count,
  coalesce(sum(d.units_delivered), 0)::integer as total_units,
  h.created_at,
  h.updated_at
from public.delivery_headers h
join public.customers  c  on c.id = h.customer_id
left join public.deliveries d on d.delivery_header_id = h.id
where h.season_year = (select max(season_year) from public.v_pricing_seasons)
  and h.user_id = auth.uid()
group by
  h.id, h.delivery_date, h.season_year,
  h.customer_id, c.customer_name, h.notes,
  h.created_at, h.updated_at;
