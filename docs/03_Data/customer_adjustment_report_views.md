# Customer Adjustment Report Views

These five read-only views power the printable Customer Adjustment Report under the Adjustments page. They expose the underlying detail behind the Year-End Adjustments tab so users can review invoice adjustments and validate reconciliation totals per customer and season.

Migration: `0035_customer_adjustment_report_views.sql`

For feature-level documentation (how to use the report, print behavior, user workflow), see [`/docs/features/customer_adjustment_report.md`](../features/customer_adjustment_report.md).

---

## Views

### v_customer_adjustment_report_orders

**Purpose:** One row per order line item for a customer and season.

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

**Purpose:** One row per delivery line item for a customer and season.

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

**Purpose:** One row per return line item for a customer and season.

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

**Purpose:** Reconciliation summary for a customer and season. One row per unique combination of product, treatment, seed size, package type, and early pay bucket. Rows appear whenever any activity exists in any category — delivery-only, return-only, or replant-only rows are all included.

**Grain:** `(user_id, season_year, customer_id, product_id, treatment_id, seed_size, package_type, early_pay_bucket)`

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `product_id` / `product_name` | Product |
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

Both views use the same net_units formula and early_pay_bucket logic. The summary view is additive — it does not replace or alter `v_year_end_adjustments`.
