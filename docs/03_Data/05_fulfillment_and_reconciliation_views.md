# 05 — Fulfillment and Reconciliation Views

Views that track order fulfillment status, delivery history, and season-end reconciliation. All are user-scoped.

---

## v_delivery_customer_order_status

**Purpose:** Per-order-item fulfillment status. Shows how many units have been ordered, delivered, returned, and replanted for each order line. The primary view used to determine whether an order line is complete.

**Source tables:** `orders`, `order_items`, `deliveries`, `returns`, `replants`, `customers`, `products`, `treatments`

**Grain:** One row per order_item.

**Migration history:** `0025_v_customer_order_status_add_farm_name.sql` added `farm_name` (from `customers` join) — required a DROP + CREATE because the column list changed.

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `order_id` | |
| `order_item_id` | |
| `customer_id` / `customer_name` | |
| `farm_name` | From customers join (added migration 0025) |
| `order_date` | From orders |
| `product_id` / `product_name` | |
| `crop` | From products join |
| `treatment_id` / `treatment_name` | |
| `seed_size` | From order_items |
| `package_type` | From order_items |
| `ordered_units` | `order_items.units` |
| `delivered_units` | Sum of linked deliveries |
| `returned_units` | Sum of linked returns |
| `replanted_units` | Sum of linked replants |
| `net_units` | `ordered - delivered - replanted + returned` |
| `is_complete` | `true` when `net_units <= 0` |

**Net units formula:**
```
net_units = ordered_units - delivered_units - replanted_units + returned_units
```

This view only counts deliveries/returns/replants where `order_item_id IS NOT NULL`. Unlinked transactions do not appear in order status.

**Filter:** `user_id = auth.uid()` applied in all CTEs (delivered, returned, replanted) and in the orders join.

**Agent tool using it:** `get_customer_order_fulfillment_status` — aggregates from order_item grain to customer+product+treatment+seed_size+package_type grain in TypeScript. Exposes `matched_customers[]` with `customer_id`, `customer_name`, `farm_name`. Fulfillment status values: `"open" | "partial" | "complete" | "overdelivered"`. `units_remaining` can be negative (overdelivered — not clamped).

**Where used in UI:**
- Deliveries page — "Customer Order Status" table shown when a customer is selected.
- Order allocation system (`orderMatching.service.ts`) queries this view to determine open quantity per order_item before allocating.
- Used by `fetchCustomerOrderStatus(customerId, seasonYear)`.

**How the delivery allocation system uses this view:**

When recording a delivery, `orderMatching.service.ts` queries `v_delivery_customer_order_status` filtered by the customer's order_ids to get current `net_units` per order_item. It then allocates delivery units greedily across order lines in priority order:

1. **Early-pay order lines first** (orders where `early_pay_pct > 0`)
2. **Within early-pay: oldest `order_date` first**, then `created_at` ASC, then `order_id` ASC as tiebreak
3. **After all early-pay lines are exhausted, non-early-pay lines** (same sort within group)

If total delivery units exceed all open order quantities, the remainder is saved as an unlinked delivery row (`order_id = null`, `order_item_id = null`).

**Caution about unlinked deliveries:** If deliveries are saved without `order_item_id` (no matching order found, or customer had no open orders), they do NOT appear in this view. They still reduce inventory via `v_on_hand_inventory` but do not update order fulfillment status.

---

## v_deliveries_this_season

**Purpose:** Flat list of all delivery records for the current season with customer, product, and treatment names.

**Source tables:** `deliveries`, `customers`, `products`, `treatments`

**Grain:** One row per delivery record. Note: a single form submission may create multiple delivery records (one per form line item, and potentially multiple per line item if split-allocated across order lines).

**Filter:** `season_year = (SELECT MAX(season_year) FROM v_pricing_seasons)` and `user_id = auth.uid()`

**Key columns:**

| Column | Notes |
|---|---|
| `delivery_id` | |
| `delivery_date` | |
| `season_year` | |
| `customer_id` / `customer_name` | |
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `units_delivered` | |
| `seed_size` | |
| `package_type` | |
| `order_id` | NULL if unlinked |
| `order_item_id` | NULL if unlinked |
| `notes` | |

**Note on seed_size / package_type:** These columns are present in the service layer (`DeliveryViewRow` interface) but may have been added to the view definition after migration 0014. Verify in current schema.

**Where used in UI:** Deliveries page "This Season Deliveries" list. Used by `fetchDeliveriesThisSeason()`.

---

## v_returns_this_season

**Purpose:** Flat list of all return records for the current season.

**Source tables:** `returns`, `customers`, `products`, `treatments`

**Grain:** One row per return record.

**Filter:** Current season + `user_id = auth.uid()`

**Key columns:** `return_id`, `return_date`, `season_year`, `customer_id`, `customer_name`, `product_id`, `product_name`, `treatment_id`, `treatment_name`, `units_returned`, `seed_size`, `package_type`, `order_id`, `order_item_id`, `notes`

**Where used in UI:** Returns page "This Season Returns" list. Used by `fetchReturnsThisSeason()`.

---

## v_replants_this_season

**Purpose:** Flat list of all replant records for the current season.

**Source tables:** `replants`, `customers`, `products`, `treatments`

**Grain:** One row per replant record.

**Filter:** Current season + `user_id = auth.uid()`

**Key columns:** `replant_id`, `replant_date`, `season_year`, `customer_id`, `customer_name`, `product_id`, `product_name`, `treatment_id`, `treatment_name`, `units_replanted`, `seed_size`, `package_type`, `order_id`, `order_item_id`, `notes`

**Where used in UI:** Replants page "This Season Replants" list. Used by `fetchReplantsThisSeason()`.

---

## v_year_end_adjustments

**Purpose:** Season-level reconciliation of ordered vs. delivered vs. replanted vs. returned units per customer per product per treatment, split into early-pay and non-early-pay buckets. Used to identify invoice adjustments needed at season close.

*(Full documentation in [03_pricing_and_order_views.md](03_pricing_and_order_views.md) — this view is listed there as it is driven primarily by order logic.)*

**Used by:** Adjustments page (`fetchAdjustments(seasonYear)`), `invoice_adjustment_checks` table.

**Key business rule:**
- `early_pay_bucket = 'EARLY_PAY'` — customer ordered under early-pay terms
- `early_pay_bucket = 'NO_EARLY_PAY'` — standard order
- `early_pay_bucket = 'UNKNOWN'` — delivery, replant, or return has no order link; cannot determine bucket

**net_units formula (as of migration 0034):** `units_ordered - units_delivered - units_replanted + units_returned`

**units_replanted:** Replanted units are non-revenue units the customer received due to field failure. They reduce `net_units` because they represent seed the customer has consumed but will not pay for — the dealer requires a supplier credit for these units.

---

## v_all_seasons

**Purpose:** Union of all season years across pricing, orders, deliveries, returns, replants, and bayer_shipments. Used to populate season selectors in the UI.

**Source tables:** `v_pricing_seasons`, `orders`, `deliveries`, `returns`, `replants`, `bayer_shipments`

**Grain:** One row per distinct season_year.

**Sort:** `ORDER BY season_year DESC`

**Where used in UI:** Dashboard season picker. Used by `fetchDashboardSeasons()`.

**Note:** This is the broadest season list — it includes seasons with only Bayer shipments or only deliveries, not just pricing seasons. This allows users to view historical data even if pricing rows have been removed.
