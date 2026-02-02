create table public.orders (
  id uuid not null default gen_random_uuid (),
  order_date date not null,
  customer_id uuid not null,
  brand_grower_pct numeric(6, 3) not null default 0,
  early_pay_pct numeric(6, 3) not null default 0,
  subtotal_before_discounts numeric(12, 2) not null default 0,
  brand_grower_discount_total numeric(12, 2) not null default 0,
  tote_bulk_discount_total numeric(12, 2) not null default 0,
  subtotal_after_discounts_before_early_pay numeric(12, 2) not null default 0,
  early_pay_discount_total numeric(12, 2) not null default 0,
  total_after_all_discounts numeric(12, 2) not null default 0,
  total_profit numeric(12, 2) not null default 0,
  avg_profit_per_unit numeric(12, 4) not null default 0,
  total_units integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint orders_pkey primary key (id),
  constraint orders_customer_id_fkey foreign KEY (customer_id) references customers (id) on delete RESTRICT,
  constraint orders_brand_grower_pct_chk check (
    (
      (brand_grower_pct >= (0)::numeric)
      and (brand_grower_pct <= (100)::numeric)
    )
  ),
  constraint orders_early_pay_pct_chk check (
    (
      early_pay_pct = any (array[(0)::numeric, (5)::numeric])
    )
  ),
  constraint orders_total_units_chk check ((total_units >= 0))
) TABLESPACE pg_default;

create index IF not exists orders_customer_date_idx on public.orders using btree (customer_id, order_date desc) TABLESPACE pg_default;

create trigger trg_orders_updated_at BEFORE
update on orders for EACH row
execute FUNCTION set_updated_at ();