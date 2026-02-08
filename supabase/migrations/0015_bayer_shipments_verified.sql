-- =========================================================
-- 0015_bayer_shipments_verified.sql
-- Add verification tracking to bayer_shipment_items
--
-- New columns:
--   is_verified  BOOLEAN  NOT NULL DEFAULT false
--   verified_at  TIMESTAMPTZ  nullable
--   verified_by  UUID  nullable (FK → auth.users)
--
-- A BEFORE UPDATE trigger (trg_bayer_shipment_items_verified_meta)
-- auto-sets verified_at and verified_by from auth context,
-- so the app only needs to write is_verified.
--
-- Also updates v_bayer_shipments to expose these fields.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Add columns
-- ---------------------------------------------------------
alter table public.bayer_shipment_items
  add column if not exists is_verified boolean not null default false;

alter table public.bayer_shipment_items
  add column if not exists verified_at timestamptz;

alter table public.bayer_shipment_items
  add column if not exists verified_by uuid;

-- FK: verified_by → auth.users (set null on delete)
alter table public.bayer_shipment_items
  drop constraint if exists bayer_shipment_items_verified_by_fkey;

alter table public.bayer_shipment_items
  add constraint bayer_shipment_items_verified_by_fkey
  foreign key (verified_by) references auth.users (id) on delete set null;


-- ---------------------------------------------------------
-- 2) Trigger: auto-set verified_at + verified_by on toggle
-- ---------------------------------------------------------
create or replace function public.set_bayer_shipment_item_verified_meta()
returns trigger as $$
begin
  if NEW.is_verified then
    NEW.verified_at := now();
    NEW.verified_by := auth.uid();
  else
    NEW.verified_at := null;
    NEW.verified_by := null;
  end if;
  return NEW;
end;
$$ language plpgsql security invoker;

drop trigger if exists trg_bayer_shipment_items_verified_meta
  on public.bayer_shipment_items;

create trigger trg_bayer_shipment_items_verified_meta
  before update of is_verified on public.bayer_shipment_items
  for each row
  execute function public.set_bayer_shipment_item_verified_meta();


-- ---------------------------------------------------------
-- 3) Update v_bayer_shipments to include verified fields
--    (no WHERE — relies on RLS on underlying tables)
-- ---------------------------------------------------------
create or replace view public.v_bayer_shipments as
select
  s.id            as shipment_id,
  s.shipment_date,
  extract(year from s.shipment_date)::integer as season_year,
  s.shipment_number,
  i.id            as shipment_item_id,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  i.units_received,
  i.is_verified,
  i.verified_at,
  i.verified_by,
  s.created_at,
  s.updated_at
from bayer_shipments      s
join bayer_shipment_items i on i.shipment_id = s.id
join products             p on p.id = i.product_id
join treatments           t on t.id = i.treatment_id;
