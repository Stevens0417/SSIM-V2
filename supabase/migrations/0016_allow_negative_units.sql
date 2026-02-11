-- =========================================================
-- 0016_allow_negative_units.sql
-- Allow negative units on bayer_shipment_items (returns).
--
-- Old constraint: units_received > 0
-- New constraint: units_received <> 0  (any non-zero integer)
-- =========================================================

alter table public.bayer_shipment_items
  drop constraint if exists bayer_shipment_items_units_chk;

alter table public.bayer_shipment_items
  add constraint bayer_shipment_items_units_chk
  check (units_received <> 0);
