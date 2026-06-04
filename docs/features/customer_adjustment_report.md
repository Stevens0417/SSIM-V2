# Customer Adjustment Report

## Overview

The Customer Adjustment Report is a printable, per-customer report available under the **Adjustments** page. It shows all orders, deliveries, replants, and returns for a selected season and customer, plus a reconciliation summary. Users print it to manually review and cross-check invoice adjustments and supplier credit activity.

---

## Location

**Adjustments → Customer Report tab**

The Adjustments page has two tabs:
- **Year-End Adjustments** — the original summary reconciliation table for all customers
- **Customer Report** — the new per-customer printable report (this feature)

---

## How to Use

1. Open the **Adjustments** page.
2. Click the **Customer Report** tab.
3. Select a **Season** from the dropdown (defaults to the current/latest season).
4. Select a **Customer** from the searchable dropdown.
5. Click **Generate Report**.
6. Review the on-screen report.
7. Click **Print Report** to print.

---

## Report Sections

### Header
Shows:
- Report title
- Season year
- Customer name
- Farm name (if on file)
- Date the report was generated

### Customer Summary
Five KPI cards:
| Card | Description |
|---|---|
| Units Ordered | Total units across all order lines for this customer/season |
| Units Delivered | Total units delivered |
| Units Replanted | Total units replanted |
| Units Returned | Total units returned to dealer |
| Net Adjustment | `ordered − delivered − replanted + returned` — how many units remain unreconciled |

A non-zero Net Adjustment (shown in red) means there is outstanding seed activity that has not been fully settled.

### Orders
Detailed table of all order line items. One row per product + treatment + seed size + package type per order.

Columns: Order Date, Order ID, Product, Treatment, Seed Size, Package Type, Retail Price, Sale Price, Units Ordered, Early Pay %, Brand Grower %, Total Discount %, Line Total.

> **User workflow:** This section is spaced for manual annotation — users can cross out lines or add notes when reconciling against supplier invoices.

### Deliveries
Detailed table of all delivery lines. One row per delivery line item.

Columns: Delivery Date, Delivery ID, Product, Treatment, Seed Size, Package Type, Units Delivered, Notes.

### Replants
Detailed table of all replant records. Replants represent seed consumed in a field failure that requires a supplier credit adjustment.

Columns: Replant Date, Replant ID, Product, Treatment, Seed Size, Package Type, Units Replanted, Notes.

### Returns
Detailed table of all return records. Returns represent seed returned by the customer to the dealer.

Columns: Return Date, Return ID, Product, Treatment, Seed Size, Package Type, Units Returned, Notes.

### Reconciliation Summary
Aggregated reconciliation table. One row per product + treatment + seed size + package type + early pay bucket. This is the most important section for year-end settlement.

Columns: Product, Treatment, Seed Size, Package Type, Early Pay Bucket, Units Ordered, Units Delivered, Units Replanted, Units Returned, Net Units, Completed.

**Net Units formula:**
```
net_units = units_ordered − units_delivered − units_replanted + units_returned
```

A row with `net_units = 0` is fully reconciled. The **Completed** column shows whether the row has been checked off on the Year-End Adjustments tab.

---

## Relationship to Year-End Adjustments Tab

The Reconciliation Summary section mirrors the Year-End Adjustments tab, but scoped to one customer at a time and with seed size and package type exposed in the grain.

| | Year-End Adjustments tab | Customer Report — Reconciliation Summary |
|---|---|---|
| Scope | All customers | One customer |
| Seed size in grain | No | Yes |
| Package type in grain | No | Yes |
| Editable (completed) | Yes — checkbox | Read-only (display only) |
| Net units formula | Same | Same |

The **Completed** badges in the Customer Report are read-only. To mark rows as complete, use the Year-End Adjustments tab.

---

## Empty States

If a section has no data for the selected customer/season, it shows a message:
- "No orders found."
- "No deliveries found."
- "No replants found."
- "No returns found."
- "No reconciliation rows found."

Rows still appear in the Reconciliation Summary if activity exists in any single category (e.g., a delivery-only row with no corresponding order will appear with `units_ordered = 0` and `early_pay_bucket = UNKNOWN`).

---

## Print Behavior

Clicking **Print Report** triggers the browser print dialog. During printing:

- The app sidebar, header band, tab navigation, filters, and buttons are hidden.
- Only the report content (header, KPIs, all section tables) is printed.
- Table headers repeat on each printed page.
- Table rows have extra vertical spacing for manual annotation.
- Net Units values are underlined instead of colored (for black-and-white printing).
- Completed status prints as "Yes" / "No" badges.

---

## Data Sources

| Section | View |
|---|---|
| Orders | `v_customer_adjustment_report_orders` |
| Deliveries | `v_customer_adjustment_report_deliveries` |
| Replants | `v_customer_adjustment_report_replants` |
| Returns | `v_customer_adjustment_report_returns` |
| Reconciliation Summary + KPIs | `v_customer_adjustment_report_summary` |

See [`/docs/03_Data/customer_adjustment_report_views.md`](../03_Data/customer_adjustment_report_views.md) for full view documentation.

---

## Notes

- All data is read-only on this report. No edits can be made from this tab.
- The report is scoped to the authenticated user — no cross-user data is visible.
- Seed size is required for corn products and preserved in all sections.
- The `UNKNOWN` early pay bucket appears on rows where a delivery, replant, or return has no linked order item (cannot be attributed to an early-pay tier).
