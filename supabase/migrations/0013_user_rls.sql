-- =========================================================
-- 0013_user_rls.sql
-- RLS for USER-SCOPED tables
--
-- All 9 tables below have:
--   user_id UUID NOT NULL  (FK → auth.users, ON DELETE CASCADE)
--   btree index on user_id (already exists)
--
-- Tables: customers, orders, order_items, deliveries,
--         returns, replants, bayer_shipments,
--         bayer_shipment_items, invoice_adjustment_checks
--
-- Policies:
--   SELECT  — WHERE user_id = auth.uid()
--   INSERT  — WITH CHECK (user_id = auth.uid())
--   UPDATE  — WHERE user_id = auth.uid()
--   DELETE  — WHERE user_id = auth.uid()
--
-- Also sets DEFAULT auth.uid() on user_id so the app
-- does not need to pass it manually on inserts.
-- =========================================================

-- =========================================================
-- Helper: set default auth.uid() on user_id columns
-- (indexes already exist — verified from live schema)
-- =========================================================

alter table public.customers
  alter column user_id set default auth.uid();

alter table public.orders
  alter column user_id set default auth.uid();

alter table public.order_items
  alter column user_id set default auth.uid();

alter table public.deliveries
  alter column user_id set default auth.uid();

alter table public.returns
  alter column user_id set default auth.uid();

alter table public.replants
  alter column user_id set default auth.uid();

alter table public.bayer_shipments
  alter column user_id set default auth.uid();

alter table public.bayer_shipment_items
  alter column user_id set default auth.uid();

alter table public.invoice_adjustment_checks
  alter column user_id set default auth.uid();


-- =========================================================
-- 1) customers
-- =========================================================
alter table public.customers enable row level security;

drop policy if exists "Users can read own customers"   on public.customers;
drop policy if exists "Users can insert own customers"  on public.customers;
drop policy if exists "Users can update own customers"  on public.customers;
drop policy if exists "Users can delete own customers"  on public.customers;

create policy "Users can read own customers"
  on public.customers for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own customers"
  on public.customers for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own customers"
  on public.customers for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own customers"
  on public.customers for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 2) orders
-- =========================================================
alter table public.orders enable row level security;

drop policy if exists "Users can read own orders"   on public.orders;
drop policy if exists "Users can insert own orders"  on public.orders;
drop policy if exists "Users can update own orders"  on public.orders;
drop policy if exists "Users can delete own orders"  on public.orders;

create policy "Users can read own orders"
  on public.orders for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own orders"
  on public.orders for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own orders"
  on public.orders for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own orders"
  on public.orders for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 3) order_items
-- =========================================================
alter table public.order_items enable row level security;

drop policy if exists "Users can read own order_items"   on public.order_items;
drop policy if exists "Users can insert own order_items"  on public.order_items;
drop policy if exists "Users can update own order_items"  on public.order_items;
drop policy if exists "Users can delete own order_items"  on public.order_items;

create policy "Users can read own order_items"
  on public.order_items for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own order_items"
  on public.order_items for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own order_items"
  on public.order_items for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own order_items"
  on public.order_items for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 4) deliveries
-- =========================================================
alter table public.deliveries enable row level security;

drop policy if exists "Users can read own deliveries"   on public.deliveries;
drop policy if exists "Users can insert own deliveries"  on public.deliveries;
drop policy if exists "Users can update own deliveries"  on public.deliveries;
drop policy if exists "Users can delete own deliveries"  on public.deliveries;

create policy "Users can read own deliveries"
  on public.deliveries for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own deliveries"
  on public.deliveries for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own deliveries"
  on public.deliveries for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own deliveries"
  on public.deliveries for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 5) returns
-- =========================================================
alter table public.returns enable row level security;

drop policy if exists "Users can read own returns"   on public.returns;
drop policy if exists "Users can insert own returns"  on public.returns;
drop policy if exists "Users can update own returns"  on public.returns;
drop policy if exists "Users can delete own returns"  on public.returns;

create policy "Users can read own returns"
  on public.returns for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own returns"
  on public.returns for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own returns"
  on public.returns for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own returns"
  on public.returns for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 6) replants
-- =========================================================
alter table public.replants enable row level security;

drop policy if exists "Users can read own replants"   on public.replants;
drop policy if exists "Users can insert own replants"  on public.replants;
drop policy if exists "Users can update own replants"  on public.replants;
drop policy if exists "Users can delete own replants"  on public.replants;

create policy "Users can read own replants"
  on public.replants for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own replants"
  on public.replants for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own replants"
  on public.replants for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own replants"
  on public.replants for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 7) bayer_shipments
-- =========================================================
alter table public.bayer_shipments enable row level security;

drop policy if exists "Users can read own bayer_shipments"   on public.bayer_shipments;
drop policy if exists "Users can insert own bayer_shipments"  on public.bayer_shipments;
drop policy if exists "Users can update own bayer_shipments"  on public.bayer_shipments;
drop policy if exists "Users can delete own bayer_shipments"  on public.bayer_shipments;

create policy "Users can read own bayer_shipments"
  on public.bayer_shipments for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own bayer_shipments"
  on public.bayer_shipments for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own bayer_shipments"
  on public.bayer_shipments for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own bayer_shipments"
  on public.bayer_shipments for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 8) bayer_shipment_items
-- =========================================================
alter table public.bayer_shipment_items enable row level security;

drop policy if exists "Users can read own bayer_shipment_items"   on public.bayer_shipment_items;
drop policy if exists "Users can insert own bayer_shipment_items"  on public.bayer_shipment_items;
drop policy if exists "Users can update own bayer_shipment_items"  on public.bayer_shipment_items;
drop policy if exists "Users can delete own bayer_shipment_items"  on public.bayer_shipment_items;

create policy "Users can read own bayer_shipment_items"
  on public.bayer_shipment_items for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own bayer_shipment_items"
  on public.bayer_shipment_items for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own bayer_shipment_items"
  on public.bayer_shipment_items for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own bayer_shipment_items"
  on public.bayer_shipment_items for delete to authenticated
  using (user_id = auth.uid());


-- =========================================================
-- 9) invoice_adjustment_checks
-- =========================================================
alter table public.invoice_adjustment_checks enable row level security;

drop policy if exists "Users can read own invoice_adjustment_checks"   on public.invoice_adjustment_checks;
drop policy if exists "Users can insert own invoice_adjustment_checks"  on public.invoice_adjustment_checks;
drop policy if exists "Users can update own invoice_adjustment_checks"  on public.invoice_adjustment_checks;
drop policy if exists "Users can delete own invoice_adjustment_checks"  on public.invoice_adjustment_checks;

create policy "Users can read own invoice_adjustment_checks"
  on public.invoice_adjustment_checks for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own invoice_adjustment_checks"
  on public.invoice_adjustment_checks for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own invoice_adjustment_checks"
  on public.invoice_adjustment_checks for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own invoice_adjustment_checks"
  on public.invoice_adjustment_checks for delete to authenticated
  using (user_id = auth.uid());
