# 00 — Database Overview

## Purpose

Supabase Postgres database backing the SSIM (Stevens Seeds Inventory Management) web application. The system is an internal tool for a single agricultural seed dealer to manage pricing, customer orders, seed deliveries, returns, replants, and Bayer shipment inventory for each sales season.

---

## Business Workflows Supported

| Workflow | Description |
|---|---|
| **Pricing** | Set retail prices per product + treatment per season year |
| **Orders** | Record customer seed purchase orders with line items and discounts |
| **Deliveries** | Record actual seed delivery events against orders or standalone |
| **Returns** | Record seed returned by customers |
| **Replants** | Record seeds replanted due to field failure (separate from returns) |
| **Bayer Shipments** | Track seed received from Bayer supplier by shipment |
| **Inventory** | Compute on-hand stock from shipments minus deliveries plus returns |
| **Year-End Verification** | Verify Bayer totals and outstanding customer adjustments at season close |
| **Dashboard** | Season-level KPIs, crop breakdown, treatment mix, volume buckets |

---

## High-Level Entity Map

```
                    [pricing]
                      ↑ season_year × product × treatment
 [products] ──────────┤
 [treatments] ─────────┘

 [customers] ──── [orders] ──── [order_items]
                               ↓ (linked optionally)
               [deliveries] ←──┘
               [returns]
               [replants]

 [bayer_shipments] ──── [bayer_shipment_items]
                                   ↓
                    (feeds into v_on_hand_inventory)

 [bayer_year_end_verifications]  (year-end audit table)
 [invoice_adjustment_checks]     (early-pay adjustment sign-off)
```

---

## User Scoping

Every user-owned table has a `user_id uuid` column.

- Default: `user_id` is set automatically to `auth.uid()` on insert.
- Row Level Security (RLS) is enabled on all user-scoped tables.
- Each table has four RLS policies: SELECT, INSERT, UPDATE, DELETE — all filtered by `user_id = auth.uid()`.
- User-scoped **views** add an explicit `WHERE user_id = auth.uid()` (or equivalent CTE filter) in addition to table-level RLS. This is intentional: views owned by the postgres role bypass table RLS, so the view SQL must repeat the filter.

**User-scoped tables:** `customers`, `orders`, `order_items`, `deliveries`, `returns`, `replants`, `bayer_shipments`, `bayer_shipment_items`, `bayer_year_end_verifications`, `invoice_adjustment_checks`

**Global tables (no user_id, shared):** `products`, `treatments`, `pricing`

---

## How Seasons Are Handled

- `season_year` is an explicit integer column on all transactional tables (not derived from a date).
- The active/current season is defined as `MAX(season_year)` from the `pricing` table.
- "This season" views filter by `(select max(season_year) from pricing)` or `(select max(season_year) from v_pricing_seasons)`.
- `v_all_seasons` is a union of all seasons across pricing, orders, deliveries, returns, replants, and bayer_shipments — used for season pickers in the UI.
- Historical data is retained across seasons; season_year is the isolation key.

---

## How Tables and Views Work Together

```
Raw data → transactional tables (orders, deliveries, returns, replants, bayer_shipment_items)
         ↓
User-scoped event views (v_deliveries_this_season, v_orders_this_season, etc.)
         ↓
Aggregated inventory views (v_on_hand_inventory, v_on_hand_inventory_wide, v_inventory_print_sheet)
         ↓
Status/reconciliation views (v_delivery_customer_order_status, v_year_end_adjustments)
         ↓
Dashboard KPI views (v_dashboard_kpis_by_season, etc.)
```

- **Pricing views** (`v_pricing_options`, `v_pricing_sheet_wide`) are globally shared — they serve the pricing page and order entry form dropdowns.
- **Event views** (`v_deliveries_this_season`, etc.) are user-scoped and drive the "this season" list tables.
- **Inventory views** compute on-hand stock in real time from shipments, deliveries, and returns.
- **Reconciliation views** compare ordered vs. delivered vs. returned to show fulfillment status.
- Application code reads exclusively from views and tables via the Supabase browser client. Views are the intended data access layer; raw tables are not queried directly from the UI except for inserts/updates.
