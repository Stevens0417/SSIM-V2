-- =========================================================
-- 0032_seed_size_required_for_corn.sql
--
-- Adds database-level enforcement: corn products must have
-- a non-null, non-empty seed_size on every insert or update.
--
-- Affected tables:
--   order_items, deliveries, returns, replants,
--   bayer_shipment_items, staged_delivery_items
--
-- Approach: BEFORE INSERT OR UPDATE trigger that joins the
-- products table and raises an exception when a corn row
-- arrives without seed_size.  Existing rows are NOT touched
-- (triggers fire only on future writes).
--
-- =========================================================
-- DIAGNOSTIC QUERY — run manually before applying this
-- migration to identify existing bad rows that would violate
-- the new rule if they were re-saved.  Do NOT auto-fix;
-- review each row and correct via the UI or a targeted UPDATE.
--
-- SELECT 'order_items'      AS source_table,
--        oi.id,
--        oi.order_id        AS parent_id,
--        p.product_name,
--        p.crop,
--        oi.seed_size,
--        o.season_year,
--        o.customer_id
-- FROM   order_items  oi
-- JOIN   products     p  ON p.id = oi.product_id
-- JOIN   orders       o  ON o.id = oi.order_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(oi.seed_size, '')) = ''
--
-- UNION ALL
--
-- SELECT 'deliveries'       AS source_table,
--        d.id,
--        d.order_id         AS parent_id,
--        p.product_name,
--        p.crop,
--        d.seed_size,
--        d.season_year,
--        d.customer_id
-- FROM   deliveries   d
-- JOIN   products     p  ON p.id = d.product_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(d.seed_size, '')) = ''
--
-- UNION ALL
--
-- SELECT 'returns'          AS source_table,
--        r.id,
--        r.order_id         AS parent_id,
--        p.product_name,
--        p.crop,
--        r.seed_size,
--        r.season_year,
--        r.customer_id
-- FROM   returns      r
-- JOIN   products     p  ON p.id = r.product_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(r.seed_size, '')) = ''
--
-- UNION ALL
--
-- SELECT 'replants'         AS source_table,
--        rp.id,
--        rp.order_id        AS parent_id,
--        p.product_name,
--        p.crop,
--        rp.seed_size,
--        rp.season_year,
--        rp.customer_id
-- FROM   replants     rp
-- JOIN   products     p  ON p.id = rp.product_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(rp.seed_size, '')) = ''
--
-- UNION ALL
--
-- SELECT 'bayer_shipment_items' AS source_table,
--        bsi.id,
--        bsi.shipment_id        AS parent_id,
--        p.product_name,
--        p.crop,
--        bsi.seed_size,
--        bs.season_year,
--        null::uuid             AS customer_id
-- FROM   bayer_shipment_items bsi
-- JOIN   products              p   ON p.id  = bsi.product_id
-- JOIN   bayer_shipments       bs  ON bs.id = bsi.shipment_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(bsi.seed_size, '')) = ''
--
-- UNION ALL
--
-- SELECT 'staged_delivery_items' AS source_table,
--        sdi.id,
--        sdi.staged_delivery_id AS parent_id,
--        p.product_name,
--        p.crop,
--        sdi.seed_size,
--        sd.season_year,
--        sd.customer_id
-- FROM   staged_delivery_items sdi
-- JOIN   products               p   ON p.id  = sdi.product_id
-- JOIN   staged_deliveries      sd  ON sd.id = sdi.staged_delivery_id
-- WHERE  lower(p.crop) = 'corn'
--   AND  trim(coalesce(sdi.seed_size, '')) = ''
--
-- ORDER BY source_table, id;
-- =========================================================


-- ---------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------
create or replace function public.validate_required_seed_size_for_corn()
returns trigger
language plpgsql
as $$
declare
  v_crop text;
begin
  -- Only enforce when a product_id is present
  if NEW.product_id is null then
    return NEW;
  end if;

  select lower(coalesce(crop, ''))
  into   v_crop
  from   public.products
  where  id = NEW.product_id;

  if v_crop = 'corn' and trim(coalesce(NEW.seed_size, '')) = '' then
    raise exception 'Seed size is required for corn products.'
      using errcode = 'check_violation',
            hint    = 'Provide a seed_size value (AR, AR2, AF, AF2, or P26) for corn products.';
  end if;

  return NEW;
end;
$$;


-- ---------------------------------------------------------
-- order_items
-- ---------------------------------------------------------
drop trigger if exists trg_order_items_seed_size_corn on public.order_items;
create trigger trg_order_items_seed_size_corn
  before insert or update on public.order_items
  for each row execute function public.validate_required_seed_size_for_corn();


-- ---------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------
drop trigger if exists trg_deliveries_seed_size_corn on public.deliveries;
create trigger trg_deliveries_seed_size_corn
  before insert or update on public.deliveries
  for each row execute function public.validate_required_seed_size_for_corn();


-- ---------------------------------------------------------
-- returns
-- ---------------------------------------------------------
drop trigger if exists trg_returns_seed_size_corn on public.returns;
create trigger trg_returns_seed_size_corn
  before insert or update on public.returns
  for each row execute function public.validate_required_seed_size_for_corn();


-- ---------------------------------------------------------
-- replants
-- ---------------------------------------------------------
drop trigger if exists trg_replants_seed_size_corn on public.replants;
create trigger trg_replants_seed_size_corn
  before insert or update on public.replants
  for each row execute function public.validate_required_seed_size_for_corn();


-- ---------------------------------------------------------
-- bayer_shipment_items
-- ---------------------------------------------------------
drop trigger if exists trg_bayer_shipment_items_seed_size_corn on public.bayer_shipment_items;
create trigger trg_bayer_shipment_items_seed_size_corn
  before insert or update on public.bayer_shipment_items
  for each row execute function public.validate_required_seed_size_for_corn();


-- ---------------------------------------------------------
-- staged_delivery_items
-- ---------------------------------------------------------
drop trigger if exists trg_staged_delivery_items_seed_size_corn on public.staged_delivery_items;
create trigger trg_staged_delivery_items_seed_size_corn
  before insert or update on public.staged_delivery_items
  for each row execute function public.validate_required_seed_size_for_corn();
