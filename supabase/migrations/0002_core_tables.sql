-- 0002_core_tables.sql
-- Core tables: customers, products, treatments, pricing

create extension if not exists "pgcrypto";

-- Customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text null,
  phone text null,
  address_line1 text null,
  address_line2 text null,
  city text null,
  province text null,
  postal_code text null,
  country text null default 'Canada',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_customers_name unique (name)
);

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  crop text null,
  chu text null,
  seed_trait text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_products_name unique (product_name)
);

-- Treatments
create table if not exists public.treatments (
  id uuid primary key default gen_random_uuid(),
  treatment_name text not null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_treatments_name unique (treatment_name)
);

-- Pricing (product + treatment pairing per season)
create table if not exists public.pricing (
  id uuid primary key default gen_random_uuid(),
  season_year int not null check (season_year >= 2000 and season_year <= 2100),
  product_id uuid not null references public.products(id) on delete restrict,
  treatment_id uuid not null references public.treatments(id) on delete restrict,
  retail_price numeric(10,2) not null check (retail_price >= 0),
  cost_price numeric(10,2) null check (cost_price is null or cost_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pricing_unique_pair unique (season_year, product_id, treatment_id)
);

create index if not exists idx_pricing_season_year on public.pricing(season_year);
create index if not exists idx_pricing_product on public.pricing(product_id);
create index if not exists idx_pricing_treatment on public.pricing(treatment_id);

-- updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_treatments_updated_at on public.treatments;
create trigger trg_treatments_updated_at
before update on public.treatments
for each row execute function public.set_updated_at();

drop trigger if exists trg_pricing_updated_at on public.pricing;
create trigger trg_pricing_updated_at
before update on public.pricing
for each row execute function public.set_updated_at();
