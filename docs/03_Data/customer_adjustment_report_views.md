# Customer Adjustment Report Views

Seven read-only views power the Customer Adjustment Report under the Adjustments page. Five views expose seed product detail and the reconciliation summary. Two packaging views track pallets and seedpak containers separately from seed net units.

Migrations:
- `0035_customer_adjustment_report_views.sql` — detail views (orders, deliveries, replants, returns); summary view without packaging exclusion
- `0036_customer_adjustment_report_packaging.sql` — creates the 5 views correctly (summary with packaging exclusion); replaces packaging views from a prior local migration

For feature-level documentation (how to use the report, print behavior, user workflow), see [`/docs/features/customer_adjustment_report.md`](../features/customer_adjustment_report.md).

These same views also power the simplified **Customer Summary** report — see [Reuse by the Customer Summary report](#reuse-by-the-customer-summary-report) below and [`/docs/features/customer_summary_report.md`](../features/customer_summary_report.md).

> **Related:** the **Corn Summary** and **Bean Summary** tabs on the Adjustments page are powered by a separate, movement-only view family — see [`crop_customer_movement_summary_views.md`](./crop_customer_movement_summary_views.md). Those views use a different (movement) net formula and group by crop; they do not consume the reconciliation views below.

---

## Views

### v_customer_adjustment_report_orders

**Purpose:** One row per order line item for a customer and season. Packaging products (`products.crop = 'packaging'`) are excluded.

**Grain:** `(order_id, order_item_id)` — one row per product + treatment + seed_size + package_type per order.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season (e.g. `2025`) |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `order_id` / `order_date` | Order reference |
| `product_id` / `product_name` | Product |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size (`AR`, `AF`, etc.) — null for soybeans |
| `package_type` | `bag` or `tote` (display `tote` as "Seedpak") |
| `retail_price_per_unit` | List price |
| `sale_price_per_unit` | After brand_grower and tote/bulk discounts |
| `units_ordered` | Units on order line |
| `early_pay_discount_pct` | Order-level early pay % |
| `brand_grower_discount_pct` | Order-level brand grower % |
| `total_discount_pct` | `brand_grower_pct + early_pay_pct` |
| `line_total` | `line_total_after_all_discounts` |
| `notes` | Order notes |

---

### v_customer_adjustment_report_deliveries

**Purpose:** One row per delivery line item for a customer and season. Packaging products are excluded — packaging deliveries appear only in `v_customer_adjustment_report_packaging_detail`.

**Grain:** `(delivery_id)` — one row per product + treatment + seed_size + package_type per delivery.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `delivery_header_id` | Groups lines by the customer-facing delivery form |
| `delivery_id` | Individual delivery line PK |
| `delivery_date` | Date delivered |
| `product_id` / `product_name` | Product |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size — null for soybeans |
| `package_type` | `bag` or `tote` |
| `units_delivered` | Units delivered |
| `notes` | Line-level notes |

---

### v_customer_adjustment_report_replants

**Purpose:** One row per replant line item for a customer and season.

**Grain:** `(replant_id)` — one row per product + treatment + seed_size + package_type per replant event.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `replant_id` | Replant line PK |
| `replant_date` | Date of replant |
| `product_id` / `product_name` | Product |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size — null for soybeans |
| `package_type` | `bag` or `tote` |
| `units_replanted` | Units replanted |
| `notes` | Notes |

---

### v_customer_adjustment_report_returns

**Purpose:** One row per return line item for a customer and season. Packaging products are excluded — packaging returns appear only in `v_customer_adjustment_report_packaging_detail`.

**Grain:** `(return_id)` — one row per product + treatment + seed_size + package_type per return event.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `return_id` | Return line PK |
| `return_date` | Date of return |
| `product_id` / `product_name` | Product |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size — null for soybeans |
| `package_type` | `bag` or `tote` |
| `units_returned` | Units returned |
| `notes` | Notes |

---

### v_customer_adjustment_report_summary

**Purpose:** Reconciliation summary for a customer and season. Seed products only — packaging items (`products.crop = 'packaging'`) are excluded and tracked in `v_customer_adjustment_report_packaging` instead. One row per unique combination of product, treatment, seed size, package type, and early pay bucket. Rows appear whenever any activity exists in any category — delivery-only, return-only, or replant-only rows are all included.

**Grain:** `(user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket)`

**Packaging exclusion:** `WHERE coalesce(p.crop, '') <> 'packaging'` on the outer SELECT (after joining to `products`). Added in migration 0036.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `product_id` / `product_name` | Seed products only |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size — null for soybeans |
| `package_type` | `bag` or `tote` |
| `early_pay_bucket` | `EARLY_PAY`, `NO_EARLY_PAY`, or `UNKNOWN` |
| `units_ordered` | Sum of ordered units |
| `units_delivered` | Sum of delivered units |
| `units_replanted` | Sum of replanted units |
| `units_returned` | Sum of returned units |
| `net_units` | See formula below |
| `completed` | Pulled from `invoice_adjustment_checks.is_completed` |

---

### v_customer_adjustment_report_packaging

**Purpose:** Aggregated packaging movements (pallets, seedpak containers) per customer per season. Tracks how many were delivered, returned, and how many are still outstanding. Packaging items are identified by `products.crop = 'packaging'`.

**Migration:** `0036_customer_adjustment_report_packaging.sql`

**Grain:** `(user_id, season_year, customer_id, product_id)` — one row per packaging item type per customer per season.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `product_id` | UUID of the packaging product |
| `packaging_item` | `products.product_name` — e.g., `'Pallet'`, `'Seedpak'` |
| `units_delivered` | Total packaging units delivered this season |
| `units_returned` | Total packaging units returned |
| `net_outstanding` | `units_delivered - units_returned` |

**net_outstanding:** Positive = customer still holds packaging items. Zero or negative = all returned or overcredited.

**New packaging types:** Adding a new product with `crop = 'packaging'` automatically appears here without view changes.

---

### v_customer_adjustment_report_packaging_detail

**Purpose:** Individual delivery and return rows for packaging items. Provides the audit trail behind the packaging summary totals.

**Migration:** `0036_customer_adjustment_report_packaging.sql`

**Grain:** One row per packaging delivery or return transaction.

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `movement_type` | `'delivery'` or `'return'` |
| `movement_date` | `delivery_date` or `return_date` |
| `movement_id` | UUID of the source delivery or return row |
| `packaging_item` | `products.product_name` |
| `units` | `units_delivered` or `units_returned` (positive integer) |
| `notes` | From the delivery or return record |

---

## Net Units Formula

```
net_units = units_ordered - units_delivered - units_replanted + units_returned
```

This formula is identical to `v_year_end_adjustments`. It represents outstanding seed that has been ordered but not yet settled:

- **Subtract delivered:** seed the customer physically received.
- **Subtract replanted:** seed consumed in a field failure (triggers supplier credit — does not come back).
- **Add back returned:** seed returned to the dealer (available again).

A `net_units = 0` row means the order line is fully reconciled.

---

## Relationship to v_year_end_adjustments

`v_customer_adjustment_report_summary` is the customer-scoped, seed-size-aware sibling of `v_year_end_adjustments`. Differences:

| | `v_year_end_adjustments` | `v_customer_adjustment_report_summary` |
|---|---|---|
| `seed_size` | Not in grain | Included in grain |
| `package_type` | Not in grain | Included in grain |
| `user_id` exposed | No | Yes |
| `farm_name` | No | Yes |
| `completed` source | `invoice_adjustment_checks` | Same |

Both views use the same net_units formula and early_pay_bucket logic. The summary view is additive — it does not replace or alter `v_year_end_adjustments`. Both views exclude packaging products.

---

## Reuse by the Customer Summary report

The simplified **Customer Summary** report (Adjustments → Customer Summary) reuses a subset of these views directly. **No new view or migration was created** for it — the existing views already provide all the data it needs:

| Customer Summary section | View reused |
|---|---|
| Deliveries | `v_customer_adjustment_report_deliveries` |
| Returns | `v_customer_adjustment_report_returns` |
| Replants | `v_customer_adjustment_report_replants` |
| Packaging Summary | `v_customer_adjustment_report_packaging` |

The **Summary Totals** and the **Movement Summary by Product** (grouped by product + treatment + seed_size + package_type) are aggregated **client-side** from the detail rows in `src/services/customerSummary.service.ts` (`computeSummaryTotals`, `buildMovementSummary`). Because the seed detail views already exclude packaging, the movement summary is seed-only by construction and packaging never mixes in.

The Customer Summary uses a different headline metric than the reconciliation summary:

```
net_physical_units = units_delivered + units_replanted − units_returned
```

This measures what the customer physically kept, versus the reconciliation `net_units` (below) which measures what is still unsettled. The two are intentionally different and the Customer Summary does **not** consume `v_customer_adjustment_report_summary` (it carries orders/early-pay grain that the simplified summary deliberately omits).

> **Note:** The recommended `v_customer_movement_summary` and `v_customer_packaging_summary` views from the original feature brief were **not** created. Client-side aggregation over the existing detail/packaging views fully satisfies the requirement (small per-customer/season row counts) and avoids adding redundant database objects.

---

## Packaging Identification

Packaging items are identified by `products.crop = 'packaging'`. This is the canonical field used throughout the codebase.

**Packaging vs. package_type distinction:**

| Field | Meaning | Appears in |
|---|---|---|
| `products.crop = 'packaging'` | The product IS a packaging item (Pallet, Seedpak container) | `v_customer_adjustment_report_packaging` |
| `deliveries.package_type = 'tote'` | Seed was delivered IN a Seedpak container | `v_customer_adjustment_report_summary` (seed row) |

A corn delivery with `package_type = 'tote'` is still a seed row — it is NOT a packaging item.
