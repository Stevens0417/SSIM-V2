-- 0005_orders.sql
-- Orders tables: orders, order_items

create extension if not exists "pgcrypto";

-- Orders (header)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  season_year int not null check (season_year >= 2000 and season_year <= 2100),
  order_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','submitted','fulfilled','cancelled')),
  notes text null,

  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_season_year on public.orders(season_year);
create index if not exists idx_orders_customer on public.orders(customer_id);

-- Order items (lines)
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  treatment_id uuid not null references public.treatments(id) on delete restrict,

  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total numeric(12,2) not null default 0 check (line_total >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_items_order_id on public.order_items(order_id);

-- updated_at triggers
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

-- Recalc functions + triggers
create or replace function public.recalc_order_totals(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(12,2);
begin
  select coalesce(sum(line_total), 0) into v_subtotal
  from public.order_items
  where order_id = p_order_id;

  update public.orders
  set subtotal = v_subtotal,
      tax = 0,
      total = v_subtotal,
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.order_items_before_write()
returns trigger
language plpgsql
as $$
begin
  new.line_total = round(new.quantity * new.unit_price, 2);
  return new;
end;
$$;

drop trigger if exists trg_order_items_before_write on public.order_items;
create trigger trg_order_items_before_write
before insert or update on public.order_items
for each row execute function public.order_items_before_write();

create or replace function public.order_items_after_write()
returns trigger
language plpgsql
as $$
begin
  perform public.recalc_order_totals(new.order_id);
  return new;
end;
$$;

drop trigger if exists trg_order_items_after_write on public.order_items;
create trigger trg_order_items_after_write
after insert or update or delete on public.order_items
for each row execute function public.order_items_after_write();
