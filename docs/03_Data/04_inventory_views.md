# 04 — Inventory Views

Views that compute on-hand seed inventory from received shipments, deliveries, and returns. All are user-scoped.

---

## Inventory Formula

All inventory views use three computed inventory quantities:

```
physical_on_hand  = units_received - units_delivered + units_returned
staged_units      = sum of units_staged in in_progress staged deliveries
available_units   = physical_on_hand - staged_units
```

- **units_received** = sum of `bayer_shipment_items.units_received` (can be negative for Bayer-side corrections)
- **units_delivered** = sum of `deliveries.units_delivered`
- **units_returned** = sum of `returns.units_returned`
- **staged_units** = sum of `staged_delivery_items.units_staged` for staged deliveries with `status = 'in_progress'`

`units_on_hand` in the view is the **physical** quantity (received − delivered + returned). `available_units` is the operationally meaningful quantity — how much can still be sold or committed.

**Replants do not affect inventory.** Replanted units are consumed by the customer and do not come back into stock.

**Staged deliveries do not reduce physical inventory.** They reduce `available_units` only, reflecting product set aside but not yet formally delivered.

---

## Package Type and Seed Size in Inventory (as of migration 0022)

As of migration 0022, `package_type` is a first-class dimension in all inventory views. The key distinction:

| View | package_type | seed_size | Aggregated? |
|---|---|---|---|
| `v_on_hand_inventory` | Split by package_type | Included | No — detail rows |
| `v_on_hand_inventory_wide` | Aggregated across all package types | Aggregated | Yes — one row per product |
| `v_inventory_print_sheet` | Split by package_type | Included | No — detail rows |

---

## v_on_hand_inventory

**Purpose:** Detail-level on-hand inventory. One row per distinct (product, treatment, seed_size, package_type) combination across all of the user's shipments, deliveries, and returns.

**Source tables:** `bayer_shipment_items`, `deliveries`, `returns`, `products`, `treatments` — all filtered by `user_id = auth.uid()`.

**Grain:** One row per (product_id, treatment_id, seed_size, package_type).

**package_type included:** Yes — Bag and Seedpak appear as separate rows.

**seed_size included:** Yes — each seed size is a separate row for corn. NULL for soybean and packaging.

**Aggregates or splits:** Splits. Each unique combination is its own row.

**Key columns:**

| Column | Notes |
|---|---|
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `seed_size` | NULL for non-corn |
| `units_received` | From Bayer shipments |
| `units_delivered` | Delivered to customers |
| `units_returned` | Returned from customers |
| `units_on_hand` | Physical: `received - delivered + returned` |
| `package_type` | `'bag'` or `'tote'` (tote = Seedpak) |
| `units_staged` | Reserved in in_progress staged deliveries (added migration 0027) |
| `available_units` | `units_on_hand - units_staged` (added migration 0027) |

**Note on received seed_size:** Bayer shipment items do not carry seed_size in the received CTE (seed_size is set to `NULL` for received rows). Seed size comes from deliveries and returns. This means: if a product has been received but no deliveries or returns have been recorded, it appears without a seed_size row. The `keys` CTE unions received + delivered + returned + staged to ensure all combinations appear — including combinations that only exist in staged deliveries.

**Where used in UI:** On-Hand Inventory page (detail view). The detail table shows all columns including `units_staged` (Staged column) and `available_units` (Available column). The "Negative available only" filter and KPI cards use `available_units`. Also feeds `v_on_hand_inventory_wide`, `v_inventory_print_sheet`, and `v_agent_inventory`.

**Agent tool:** `get_on_hand_inventory` queries this view and surfaces `units_on_hand`, `units_staged`, and `available_units` per row. The agent leads responses with `available_units`. `v_agent_inventory` (SELECT * wrapper) is also available to the SQL fallback tool with the same three columns.

**Cautions when changing:**
- This view has **three dependent views** (`v_on_hand_inventory_wide`, `v_inventory_print_sheet`, and `v_agent_inventory`) that must be dropped before changing this view's column list.
- Changing the grain (adding/removing grouping dimensions) affects the wide view's aggregation.
- Any column reordering requires DROP + CREATE (not CREATE OR REPLACE) on this view and its dependents.
- Drop order: `v_agent_inventory` → `v_inventory_print_sheet` → `v_on_hand_inventory_wide` → `v_on_hand_inventory`. Recreate in reverse.

---

## v_on_hand_inventory_wide

**Purpose:** Wide/pivot format inventory — one row per product with treatment columns showing **available units** (not physical units on hand). Aggregates across **all** seed sizes and **all** package types. This is by design.

**Source tables:** `v_on_hand_inventory` (which is already user-scoped)

**Grain:** One row per product.

**package_type included:** No — intentionally aggregated across Bag and Seedpak. The wide view shows total units per product+treatment regardless of package type.

**seed_size included:** No — intentionally aggregated across all seed sizes.

**Aggregates or splits:** Fully aggregated to product level. All seed_sizes and package_types are summed together.

**Treatment columns (hardcoded pivot):**
- DIAMIDE, Fung/Insect, Fung/Insect/Ilevo, Fung/Insect/Opt, FUNGICIDE, FUNGICIDE OPTIMIZE, PONCHO, Poncho/i-374

**Filter:** Excludes `NO_TREATMENT` rows (packaging inventory not shown here).

**Where used in UI:** On-Hand Inventory page (wide format). Used by `fetchInventoryWide()`.

**Important business rule:** This view is intentionally NOT split by package_type or seed_size. It answers "how many units of DKC 45-50 FUNGICIDE are available?" without breaking down by Bag vs. Seedpak. Do not add package_type splitting to this view — use the detail view for that.

**Semantic change (migration 0027):** Treatment columns now sum `available_units` (physical on hand minus staged) instead of `units_on_hand`. This is intentional — the wide view shows the operationally meaningful quantity: how much can still be committed to another customer.

**Cautions:** Treatment columns are hardcoded in the view SQL. Adding a new treatment requires a migration to update the view.

---

## v_inventory_print_sheet

**Purpose:** Print-friendly version of on-hand inventory. Separate rows for Bag vs. Seedpak. Sorted for printing (corn first, then soybean; alphabetically within crop).

**Source tables:** `v_on_hand_inventory`, `products`

**Grain:** One row per (product, treatment, seed_size, package_type) — same as `v_on_hand_inventory`.

**package_type included:** Yes — Bag and Seedpak are separate rows.

**seed_size included:** Yes.

**Aggregates or splits:** Splits. Each unique combination is its own row.

**Key columns:**

| Column | Notes |
|---|---|
| `product_id` | |
| `crop` | From products join — used for sort order |
| `product_name` | |
| `treatment_id` / `treatment_name` | |
| `seed_size` | NULL last in sort |
| `package_type` | NULL last in sort |
| `units_on_hand` | Physical: `received - delivered + returned` |
| `units_staged` | Reserved in in_progress staged deliveries (added migration 0027) |
| `available_units` | `units_on_hand - units_staged` (added migration 0027) |

**Sort order:** `CASE WHEN crop = 'corn' THEN 0 ELSE 1 END, product_name, treatment_name, seed_size NULLS LAST, package_type NULLS LAST`

**Filter:** Excludes `NO_TREATMENT` rows.

**Where used in UI:** On-Hand Inventory page (print view). Used by `fetchInventoryPrintData()`. The print sheet shows Physical (units_on_hand), Staged (units_staged), and Available (available_units) columns. The header total reports Total Available.

---

## v_staged_deliveries

**Purpose:** Flat per-item view of all staged deliveries. Joins header fields (`staged_deliveries`) with line items (`staged_delivery_items`) plus product, treatment, and customer names. Shows all statuses — filter by `status = 'in_progress'` for the active list.

**Source tables:** `staged_deliveries`, `staged_delivery_items`, `customers`, `products`, `treatments` — all filtered by `user_id = auth.uid()`.

**Grain:** One row per staged_delivery_item.

**Key columns:**

| Column | Notes |
|---|---|
| `staged_delivery_id` | Header ID |
| `staged_delivery_item_id` | Item ID |
| `customer_id` / `customer_name` / `farm_name` | |
| `season_year` | |
| `staged_date` | Date product was staged |
| `notes` | Header-level memo |
| `status` | `'in_progress'`, `'converted'`, or `'cancelled'` |
| `converted_at` | Timestamp of conversion |
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `seed_size` | NULL for non-corn |
| `package_type` | `'bag'` or `'tote'` |
| `units_staged` | Units reserved in this item line |

**Where used in UI:** Staged Deliveries page (active list, history). Also the base of `v_agent_staged_deliveries`.

---

## v_staged_inventory_by_item

**Purpose:** Aggregated staged units per product + treatment + seed_size + package_type. Only includes `in_progress` staged deliveries — the set that reserves inventory.

**Source tables:** `staged_delivery_items`, `staged_deliveries`, `products`, `treatments` — filtered by `user_id = auth.uid()` and `status = 'in_progress'`.

**Grain:** One row per (product_id, treatment_id, seed_size, package_type) per season_year across all in_progress staged deliveries.

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `seed_size` | NULL for non-corn |
| `package_type` | `'bag'` or `'tote'` |
| `units_staged` | Total staged across all in_progress staged deliveries for this combo |

**Where used in UI:** Staged Deliveries summary widgets. Available for service layer lookups when building the conversion workflow.

---

## v_bayer_shipments

**Purpose:** Flattened view of all Bayer shipment line items with header fields. Used for the Bayer Shipments list and year-end views.

**Source tables:** `bayer_shipments`, `bayer_shipment_items`, `products`, `treatments`

**Grain:** One row per shipment item.

**Key columns:**

| Column | Notes |
|---|---|
| `shipment_id` | |
| `shipment_date` | |
| `season_year` | |
| `shipment_number` | |
| `shipment_item_id` | |
| `product_id` / `product_name` | |
| `crop` | From products join |
| `treatment_id` / `treatment_name` | |
| `seed_size` | |
| `package_type` | Added in migration 0022 |
| `units_received` | Can be negative |
| `is_verified` | Year-end verification status |
| `verified_at` / `verified_by` | |

**Filter:** `user_id = auth.uid()` on both header and items.

**Where used in UI:** Bayer Shipments page (list view). Used by `fetchBayerShipments(seasonYear)`.

**Cautions:** This view was DROP + RECREATED in migration 0022 to add `package_type`. The live DB had an extra `crop` column from a direct schema change; the migration explicitly preserves that column. If further column changes are needed, DROP + CREATE (not CREATE OR REPLACE).

---

## v_bayer_shipments_headers

**Purpose:** Header-only view of Bayer shipments (no item detail). Used for top-level shipment list.

**Source tables:** `bayer_shipments`

**Grain:** One row per shipment.

**Key columns:** `shipment_id`, `shipment_date`, `season_year`, `shipment_number`, `created_at`, `updated_at`

**Filter:** `user_id = auth.uid()`

---

## v_bayer_year_end_totals

**Purpose:** Aggregates Bayer shipment items by product + treatment + seed_size + package_type per season, joined with verification status. Used for the year-end verification workflow.

**Source tables:** `bayer_shipments`, `bayer_shipment_items`, `products`, `treatments`, `bayer_year_end_verifications`

**Grain:** One row per (season_year, product_id, treatment_id, seed_size, package_type).

**package_type included:** Yes — Bag and Seedpak are separate rows.

**seed_size included:** Yes.

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `seed_size` | |
| `package_type` | |
| `net_units` | `SUM(units_received)` across all shipments for that combo |
| `is_verified` | From bayer_year_end_verifications (default false) |
| `verified_at` / `verified_by` | |

**Filter:** `user_id = auth.uid()` (via bayer_shipments join).

**Join logic:** Left-joins `bayer_year_end_verifications` on (user_id, season_year, product_id, treatment_id, seed_size IS NOT DISTINCT FROM, package_type IS NOT DISTINCT FROM). Uses `IS NOT DISTINCT FROM` to match NULLs correctly.

**Where used in UI:** Bayer Shipments page year-end verification section. Used by `fetchYearEndTotals(seasonYear)`.

**Cautions:** This view was DROP + RECREATED in migration 0022 to add seed_size and package_type grouping. The live DB had `crop` at column position 4; the migration removed crop from this view (it is not needed for year-end totals). Always DROP + CREATE when changing column positions.
