-- =========================================================
-- 1) Store per-user verification status for year-end totals
-- =========================================================

create table if not exists public.bayer_year_end_verifications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  season_year integer not null,
  product_id uuid not null,
  treatment_id uuid not null,
  is_verified boolean not null default false,
  verified_at timestamp with time zone null,
  verified_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bayer_year_end_verifications_pkey primary key (id),
  constraint bayer_year_end_verifications_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint bayer_year_end_verifications_verified_by_fkey foreign key (verified_by) references auth.users (id) on delete set null,
  constraint bayer_year_end_verifications_product_id_fkey foreign key (product_id) references public.products (id) on delete restrict,
  constraint bayer_year_end_verifications_treatment_id_fkey foreign key (treatment_id) references public.treatments (id) on delete restrict,
  constraint bayer_year_end_verifications_season_year_chk check (season_year >= 2000 and season_year <= 2100),
  constraint bayer_year_end_verifications_unique unique (user_id, season_year, product_id, treatment_id)
);

create index if not exists bayer_year_end_verifications_user_season_idx
  on public.bayer_year_end_verifications (user_id, season_year);

create index if not exists bayer_year_end_verifications_product_treatment_idx
  on public.bayer_year_end_verifications (product_id, treatment_id);

-- Keep updated_at fresh (uses your existing function)
drop trigger if exists trg_bayer_year_end_verifications_updated_at on public.bayer_year_end_verifications;
create trigger trg_bayer_year_end_verifications_updated_at
before update on public.bayer_year_end_verifications
for each row execute function set_updated_at();

-- Set verified metadata when is_verified toggles
create or replace function public.set_year_end_verification_meta()
returns trigger
language plpgsql
as $$
begin
  if new.is_verified is distinct from old.is_verified then
    if new.is_verified = true then
      new.verified_at := now();
      new.verified_by := auth.uid();
    else
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bayer_year_end_verifications_verified_meta on public.bayer_year_end_verifications;
create trigger trg_bayer_year_end_verifications_verified_meta
before update of is_verified on public.bayer_year_end_verifications
for each row execute function public.set_year_end_verification_meta();


-- =========================
-- 2) RLS: no data leakage
-- =========================
alter table public.bayer_year_end_verifications enable row level security;

drop policy if exists "year_end_verifications_select_own" on public.bayer_year_end_verifications;
create policy "year_end_verifications_select_own"
on public.bayer_year_end_verifications
for select
using (user_id = auth.uid());

drop policy if exists "year_end_verifications_insert_own" on public.bayer_year_end_verifications;
create policy "year_end_verifications_insert_own"
on public.bayer_year_end_verifications
for insert
with check (user_id = auth.uid());

drop policy if exists "year_end_verifications_update_own" on public.bayer_year_end_verifications;
create policy "year_end_verifications_update_own"
on public.bayer_year_end_verifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ===========================================
-- 3) Aggregation view for UI (net totals)
--    Net = sum(units_received) (negatives = returns)
--    Includes packaging (Pallet/Seedpak) via product_id
-- ===========================================

create or replace view public.v_bayer_year_end_totals as
select
  s.season_year,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  sum(i.units_received)::integer as net_units,
  coalesce(v.is_verified, false) as is_verified,
  v.verified_at,
  v.verified_by
from public.bayer_shipments s
join public.bayer_shipment_items i on i.shipment_id = s.id
join public.products p on p.id = i.product_id
join public.treatments t on t.id = i.treatment_id
left join public.bayer_year_end_verifications v
  on v.user_id = s.user_id
 and v.season_year = s.season_year
 and v.product_id = i.product_id
 and v.treatment_id = i.treatment_id
where s.user_id = auth.uid()
group by
  s.season_year,
  i.product_id,
  p.product_name,
  i.treatment_id,
  t.treatment_name,
  v.is_verified,
  v.verified_at,
  v.verified_by;
