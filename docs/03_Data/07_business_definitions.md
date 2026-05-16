# 07 — Business Definitions

Key terms and concepts used throughout the SSIM system. This document is the authoritative reference for domain language.

---

## Season

A **season** is a calendar year representing a single crop-year sales cycle (e.g., 2024, 2025). All transactional data (orders, deliveries, returns, etc.) is tagged with an explicit `season_year` integer.

The **current season** is determined by `MAX(season_year)` in the `pricing` table. A new season is activated by adding the first pricing row for the new year.

Seasons are not closed — historical data from prior seasons remains accessible and queryable. Views labelled "this season" or "current" filter to the maximum pricing year only.

---

## Product

A **product** is a specific seed variety sold by the dealer. Each product has a name (e.g., DKC 45-50 RIB), a crop type (corn or soybean), and optional metadata (CHU, seed trait). Products are shared across all users and seasons.

A product must be paired with a treatment and entered in the `pricing` table for a given season before it can appear in order/delivery/return forms.

Products with `crop = 'packaging'` are non-seed items (e.g., Seedpak containers). They use the `NO_TREATMENT` treatment and are tracked separately from seed inventory.

---

## Treatment

A **treatment** is the seed coating or protection applied to a product (e.g., FUNGICIDE, PONCHO, DIAMIDE). Every order line item and delivery line requires a product + treatment pair.

**Special treatment:** `NO_TREATMENT` — used for packaging products and for items explicitly designated as having no seed treatment. Inventory views typically exclude `NO_TREATMENT` rows from display.

Treatments are shared globally across all users.

---

## Seed Size

**Seed size** is a corn-specific classification of seed kernel size used to match planter requirements. Only corn products carry a seed size.

Valid seed size values: `AR`, `AR2`, `AF`, `AF2`, `P26`

Soybean and packaging products have `seed_size = NULL`. Forms show the seed size field only for corn products.

Seed size is tracked as a dimension in delivery, return, replant, Bayer shipment, and on-hand inventory records. `bayer_shipment_items.seed_size` stores the actual seed size for each shipment line item. As of migration 0029, the inventory received CTE preserves this value — received units are grouped at the correct (product, treatment, seed_size, package_type) grain, matching deliveries and staged deliveries.

**Enforcement (as of migration 0032):** Corn products must have a non-null, non-empty `seed_size` on every insert and update. This is enforced at two layers:
- **Frontend:** All five item-table components block save and highlight the missing field.
- **Database:** The trigger function `validate_required_seed_size_for_corn()` raises a `check_violation` exception on `order_items`, `deliveries`, `returns`, `replants`, `bayer_shipment_items`, and `staged_delivery_items`. The database layer catches any path that bypasses the UI (agent tools, direct API calls, future code paths).

---

## Package Type

**Package type** describes the physical container the seed is shipped in.

| Stored value | User-facing label | Description |
|---|---|---|
| `'bag'` | **Bag** | Standard bag unit |
| `'tote'` | **Seedpak** | Bulk container / tote bag |

**Always display `'tote'` as "Seedpak" in all user-facing UI and documentation.** The internal stored value is `'tote'` for legacy/database reasons. Do not use the word "Tote" in user-facing contexts.

Package type is a first-class inventory dimension as of migration 0022. Bag and Seedpak inventory are tracked separately in all detail-level views.

---

## Bag

A **Bag** is the standard seed packaging unit. Stored as `package_type = 'bag'`.

---

## Seedpak

A **Seedpak** is a bulk seed container (larger quantity per unit than a bag). Stored as `package_type = 'tote'` in the database.

Always use "Seedpak" in user-facing text, labels, and documentation. The word "Tote" may appear in legacy migration comments or internal code; treat it as a synonym for Seedpak.

---

## Order

An **order** is a record of a customer's intent to purchase seed for a season. An order:
- Belongs to one customer and one season year
- Contains one or more order line items (one per product + treatment + seed_size + package_type)
- May carry discount terms: brand grower discount and/or early pay discount
- Does **not** represent physical delivery — it is a purchase commitment

An order is fulfilled when all its order_items have `net_units <= 0` in `v_delivery_customer_order_status`.

---

## Delivery

A **delivery** is a record of physical seed delivered to a customer. A delivery:
- Records actual units moved to a customer
- May be linked to an order line item (via `order_item_id`) for fulfillment tracking
- May be unlinked (no order reference) for ad hoc deliveries
- Reduces on-hand inventory
- A single delivery form submission may produce multiple database rows (one per form line, potentially more if units are split across order lines by the allocation system)

---

## Return

A **return** is a record of seed returned by a customer. A return:
- Increases on-hand inventory (seed comes back into stock)
- May be linked to the original order line
- Increases `net_units` on the linked order line (returned units are available to redeliver)

Returns are entered on the Returns page.

---

## Replant

A **replant** is a record of seed that was replanted by a customer due to field failure (poor germination, weather damage, etc.). A replant:
- Does **not** increase on-hand inventory — replanted seeds are consumed, not returned
- Reduces `net_units` on the linked order line alongside delivered units
- Is semantically distinct from a return: a replant means "we gave them more seed" not "they gave seed back"

Formula impact: `net_units = ordered - delivered - replanted + returned`

Replants are entered on the Replants page.

---

## Bayer Shipment

A **Bayer shipment** is a record of seed received from the Bayer supplier. It consists of:
- A header (shipment date, season year, shipment number)
- One or more item lines (product + treatment + seed_size + package_type + units_received)

Bayer shipments are the **source** of on-hand inventory. Units received in shipments minus units delivered to customers plus units returned equals units on hand.

Negative `units_received` values are valid — they represent corrections or returns to Bayer.

---

## On-Hand Inventory (Physical)

**On-hand inventory** (also called **physical on hand**) is the computed quantity of seed physically in stock at any point in time.

Formula: `units_on_hand = units_received - units_delivered + units_returned`

This is always computed in real time from the underlying tables — it is not a stored value. The `units_on_hand` column in `v_on_hand_inventory` and `v_inventory_print_sheet` uses this formula.

Replanted units do not affect on-hand inventory. Staged deliveries do not affect physical on-hand inventory (see Available Units below).

**In the UI:** The On-Hand Inventory detail view shows Physical On Hand, Staged, and Available columns. KPI cards report Total Physical On Hand, Total Staged, Total Available, and Negative Available count. The wide view pivots Available Units (not physical) — it answers "how much can still be committed?" The print sheet shows all three columns with Total Available in the header.

---

## Staged Delivery

A **staged delivery** is product physically set aside for a specific customer but not yet recorded as an actual delivery. It represents the dealer's intent to deliver — product has been pulled from the shelf, but paperwork has not been finalized.

A staged delivery consists of:
- A header (`staged_deliveries` table) with a customer, season, date, and status
- One or more item lines (`staged_delivery_items` table) at the same grain as deliveries: product + treatment + seed_size + package_type + units

**Status lifecycle:**
- `in_progress` — actively reserved; reduces `available_units` in inventory
- `converted` — promoted to actual delivery records; no longer reserves inventory
- `cancelled` — abandoned; no longer reserves inventory

Staged deliveries are distinct from deliveries: they do not reduce physical on-hand inventory and are not counted in order fulfillment status until converted.

---

## Staged/Reserved Units

**Staged units** (also called **reserved units**) is the total quantity of a product+treatment+seed_size+package_type combination reserved in all `in_progress` staged deliveries for the current user.

Formula: `units_staged = SUM(staged_delivery_items.units_staged) WHERE staged_delivery.status = 'in_progress'`

Computed in the `staged` CTE of `v_on_hand_inventory`. Exposed as the `units_staged` column.

---

## Available Units

**Available units** is the quantity of a product that can still be committed to a new customer — physical on-hand minus what has been staged (reserved).

Formula: `available_units = units_on_hand - units_staged`

This is the operationally meaningful inventory quantity for selling decisions. `v_on_hand_inventory_wide` and `v_inventory_print_sheet` both surface `available_units` for this reason.

A negative `available_units` means more has been staged (or delivered) than what is physically on hand, indicating a recording gap or over-commitment.

**Agent behavior:** When the agent answers "how many do we have?", it leads with `available_units`. If staging is present it explains both the physical quantity and the staged quantity. See `docs/agent/inventory-tool.md` for full response patterns.

---

---

## Early Pay

**Early pay** is a discount term offered to customers who pay their invoice before a specified date. On an order:
- `early_pay_pct` stores the discount percentage (e.g., 3 for 3%)
- `early_pay_pct > 0` marks the order as an early-pay order
- `early_pay_discount_amount` on each order_item stores the per-unit dollar amount

**Early-pay order lines are prioritized during delivery allocation.** When a customer has both early-pay and non-early-pay order lines, deliveries are allocated to early-pay lines first (oldest first within that group), then non-early-pay lines.

---

## Brand/Grower Discount

A **brand grower discount** (also called brand grower percentage) is a volume or loyalty discount applied at the order level. Stored as `brand_grower_pct` on the order. Applied per-unit to each order line item as `brand_grower_discount_amount`.

---

## Break-Even Price

The **break-even price** is the minimum retail price at which the dealer covers their costs. It is computed in pricing views using these formulas:

- **Corn:** `break_even = retail_price - (0.075 × retail_price) - 56.65`
- **Soybean:** `break_even = retail_price - (0.075 × retail_price) - 10.40`

The 7.5% deduction represents Bayer's margin, and the fixed deduction represents the dealer's per-unit cost structure.

---

## Profit Per Unit

**Profit per unit** is `retail_price_per_unit - break_even_price_per_unit` after all applicable discounts. Stored on each `order_item` row. Total order profit is the sum of `profit_per_unit × units` across all line items.

---

## Year-End Verification

**Year-end verification** is the process of confirming that the Bayer shipment totals on record match what was physically received. Done once per season per product + treatment + seed_size + package_type combination.

Managed via:
- `bayer_year_end_verifications` table (stores verification status per combination)
- `v_bayer_year_end_totals` view (shows totals + current verification status)
- The Bayer Shipments page year-end section in the UI

A verification is toggled (verified/unverified) per line. Verification metadata (verified_at, verified_by) is auto-set by a database trigger.

---

## tote_bulk_discount

A **tote/bulk discount** (displayed as a Seedpak discount in UI) is a per-unit discount applied when a customer orders in Seedpak (tote) format. Stored as `tote_bulk_discount_amount` on order_items and `tote_bulk_discount_total` on the order header. This discount reflects the lower per-unit packaging cost for bulk containers.
