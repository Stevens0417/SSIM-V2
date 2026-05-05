# 02 — Operational Tables

Transactional tables that record business events. All are user-scoped.

---

## orders

**Purpose:** Records a customer seed purchase order for a season. An order is the intent to buy — it does not represent physical delivery.

**Grain:** One row per order (header). Line items are in `order_items`.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `customer_id` | uuid FK → customers | `ON DELETE RESTRICT` |
| `season_year` | integer | |
| `order_date` | date | Date of the order |
| `brand_grower_pct` | numeric | Brand grower discount % (e.g., 5 = 5%) |
| `early_pay_pct` | numeric | Early pay discount % (e.g., 3 = 3%) |
| `subtotal_before_discounts` | numeric | Sum of line item retail prices |
| `brand_grower_discount_total` | numeric | Total brand grower discount |
| `tote_bulk_discount_total` | numeric | Total bulk/Seedpak discount |
| `subtotal_after_discounts_before_early_pay` | numeric | |
| `early_pay_discount_total` | numeric | |
| `total_after_all_discounts` | numeric | Final invoice total |
| `total_profit` | numeric | Total profit across all line items |
| `avg_profit_per_unit` | numeric | |
| `total_units` | integer | Total units ordered |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

**Note:** The original migration (0005) had simpler columns (`status`, `subtotal`, `tax`, `total`). The live schema has extended discount and profit columns as listed above. Verify in current schema.

**How rows are created:** Via the Orders page new order form. The service layer (`order.service.ts → saveOrder`) creates the order header and all items in a single operation.

**Business rules:**
- `early_pay_pct > 0` marks an order as an early-pay order. This is the key field used by the delivery auto-allocation system to prioritize early-pay lines first.
- An order without `order_items` should not exist in practice.

---

## order_items

**Purpose:** Line items on an order. Each row is one product + treatment combination ordered.

**Grain:** One row per product + treatment + seed_size + package_type per order.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `order_id` | uuid FK → orders | `ON DELETE CASCADE` |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `seed_size` | text \| null | Corn only: `AR`, `AR2`, `AF`, `AF2`, `P26`. NULL for soybean. |
| `package_type` | text | `'bag'` or `'tote'`. `'tote'` = Seedpak. |
| `units` | integer | Quantity ordered |
| `retail_price_per_unit` | numeric | |
| `brand_grower_discount_amount` | numeric | Per-unit amount |
| `tote_bulk_discount_amount` | numeric | Per-unit Seedpak discount |
| `early_pay_discount_amount` | numeric | Per-unit amount |
| `line_total_after_discounts_before_early_pay` | numeric | |
| `line_total_after_all_discounts` | numeric | |
| `break_even_price_per_unit` | numeric | Computed from pricing formula |
| `profit_per_unit` | numeric | |
| `total_profit` | numeric | |
| `created_at` / `updated_at` | timestamptz | |

**How rows are created:** Via the order form's items table. Deleted and replaced when an order is edited.

**Business rules:**
- `seed_size` is only relevant for corn products.
- `package_type = 'tote'` (stored value) = "Seedpak" (user-facing label). Always display as "Seedpak" in UI.
- These rows are the targets for delivery allocation — `deliveries.order_item_id` links a delivery to a specific order line.

---

## deliveries

**Purpose:** Records an actual seed delivery event to a customer. Optionally linked to a specific order_item.

**Grain:** One row per product + treatment + seed_size + package_type delivered in a single delivery transaction. A single form submission may create multiple rows (one per line item, and potentially multiple rows per line item if split across order lines by the auto-allocation system).

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `delivery_date` | date | |
| `season_year` | integer | |
| `customer_id` | uuid FK → customers | |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `units_delivered` | integer | |
| `seed_size` | text \| null | Corn only |
| `package_type` | text | `'bag'` or `'tote'` |
| `order_id` | uuid FK → orders \| null | Optional link to order |
| `order_item_id` | uuid FK → order_items \| null | Optional link to specific order line |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

**How rows are created:** Via the Deliveries page. The auto-allocation system (`orderMatching.service.ts`) attempts to link each delivery line to open order lines. A single form line item may produce multiple delivery rows if it spans more than one order line (split allocation). Unmatched units are saved with `order_id = null`.

**Allocation priority rule:** Early-pay order lines are fulfilled first, then oldest order date first. See `orderMatching.service.ts` for implementation.

**Effect on inventory:** Reduces `units_on_hand` in all inventory views.

**Effect on order status:** Linked deliveries (with `order_item_id`) reduce `net_units` in `v_delivery_customer_order_status`. Unlinked deliveries (no `order_item_id`) reduce `v_on_hand_inventory` but do not appear in order status.

---

## returns

**Purpose:** Records seed returned by a customer. Optionally linked to the original order line.

**Grain:** One row per return event per product + treatment + seed_size + package_type.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `return_date` | date | |
| `season_year` | integer | |
| `customer_id` | uuid FK → customers | |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `units_returned` | integer | |
| `seed_size` | text \| null | Corn only |
| `package_type` | text | `'bag'` or `'tote'` |
| `order_id` | uuid FK → orders \| null | Optional |
| `order_item_id` | uuid FK → order_items \| null | Optional |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

**How rows are created:** Via the Returns page. The system uses the same order-matching logic as deliveries (highest-priority order line = first allocation), but returns always link to a single order line (no split).

**Effect on inventory:** Increases `units_on_hand` in all inventory views.

**Effect on order status:** Linked returns increase `net_units` in `v_delivery_customer_order_status` (returned units come back to the customer's remaining balance).

---

## replants

**Purpose:** Records seeds replanted by a customer due to field failure. Semantically distinct from returns — replanted seeds do not come back into inventory.

**Grain:** One row per replant event per product + treatment + seed_size + package_type.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `replant_date` | date | |
| `season_year` | integer | |
| `customer_id` | uuid FK → customers | |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `units_replanted` | integer | |
| `seed_size` | text \| null | Corn only |
| `package_type` | text | `'bag'` or `'tote'` |
| `order_id` | uuid FK → orders \| null | Optional |
| `order_item_id` | uuid FK → order_items \| null | Optional |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

**How rows are created:** Via the Replants page. Same order-matching logic as returns.

**Effect on inventory:** Does NOT increase `units_on_hand`. Replanted units are consumed, not returned.

**Effect on order status:** Linked replants reduce `net_units` in `v_delivery_customer_order_status` (i.e., replanted units count as "used up" alongside deliveries). Formula: `net_units = ordered - delivered - replanted + returned`.

---

## bayer_shipments

**Purpose:** Header record for a Bayer seed shipment received. Groups one or more shipment item lines.

**Grain:** One row per shipment received.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `shipment_date` | date | Date shipment was received |
| `season_year` | integer | Explicitly set; not derived from date |
| `shipment_number` | text \| null | Bayer reference/shipment number |
| `created_at` / `updated_at` | timestamptz | |

**How rows are created:** Via the Bayer Shipments page. Header + items saved together.

---

## bayer_shipment_items

**Purpose:** Individual product lines within a Bayer shipment. Each row is one product + treatment + seed_size + package_type received.

**Grain:** One row per product + treatment + seed_size + package_type per shipment.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `shipment_id` | uuid FK → bayer_shipments | `ON DELETE CASCADE` |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `seed_size` | text \| null | Corn only |
| `package_type` | text \| null | `'bag'` or `'tote'`. Default `'bag'` in unique index. |
| `units_received` | integer | Can be negative (adjustments/returns to Bayer) |
| `is_verified` | boolean | Whether item has been year-end verified |
| `verified_at` | timestamptz \| null | Auto-set by trigger on verify |
| `verified_by` | uuid FK → auth.users \| null | Auto-set by trigger |
| `created_at` / `updated_at` | timestamptz | |

**Unique index (v3):** `(shipment_id, product_id, treatment_id, COALESCE(seed_size,''), COALESCE(package_type,'bag'))`

This index allows the same product + treatment to appear twice on the same shipment with different package types (e.g., Bag and Seedpak). Previous index (v2) did not include package_type and caused save failures when both types were present.

**Effect on inventory:** Increases `units_on_hand` in all inventory views. Negative `units_received` reduces inventory (used for Bayer-side returns/corrections).

---

## bayer_year_end_verifications

**Purpose:** Tracks whether a user has verified each product+treatment+seed_size+package_type combination total for a season's Bayer shipments.

**Grain:** One row per (user, season, product, treatment, seed_size, package_type).

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS-enforced |
| `season_year` | integer | |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `seed_size` | text \| null | Added in migration 0022 |
| `package_type` | text \| null | Added in migration 0022 |
| `is_verified` | boolean | |
| `verified_at` | timestamptz \| null | Auto-set by trigger |
| `verified_by` | uuid FK → auth.users \| null | Auto-set by trigger |
| `created_at` / `updated_at` | timestamptz | |

**Unique constraint:** `UNIQUE NULLS NOT DISTINCT (user_id, season_year, product_id, treatment_id, seed_size, package_type)`

`NULLS NOT DISTINCT` (PostgreSQL 15+) means two NULL values compare as equal in the constraint — required so upsert conflict detection works when seed_size or package_type is NULL.

**How rows are created:** Via the Year-End Verification section on the Bayer Shipments page. The service uses an upsert on the 6-column conflict target.
