# Customer Summary Report

## Overview

The **Customer Summary** is a simplified, customer-facing/internal report under the **Adjustments** page. It gives a quick view of the *physical product activity* for a selected customer and season — **Deliveries, Returns, and Replants only** — without any order or pricing detail.

It sits alongside the more detailed [Customer Adjustment Report](customer_adjustment_report.md) and does not replace it.

---

## Location

**Adjustments → Customer Summary tab**

The Adjustments page has three tabs:
- **Year-End Adjustments** — the original reconciliation table for all customers
- **Customer Report** — the detailed per-customer report (orders, deliveries, replants, returns, reconciliation, packaging)
- **Customer Summary** — the simplified physical-movement summary (this feature)

---

## How to Use

1. Open the **Adjustments** page.
2. Click the **Customer Summary** tab.
3. Select a **Season** (defaults to the latest season).
4. Select a **Customer** from the searchable dropdown.
5. The summary generates automatically once a customer is selected.
6. Click **Print Summary** to print.

A customer is **required**. Until one is selected the page shows:

> Select a customer to generate the summary.

---

## Report Sections

### Section 1 — Header
- Title: **Customer Summary**
- Season
- Customer name
- Farm name (if on file)
- Generated date

### Section 2 — Summary Totals
Four totals across all seed products:

| Total | Meaning |
|---|---|
| Total Units Delivered | Sum of all delivered units |
| Total Units Returned | Sum of all returned units |
| Total Units Replanted | Sum of all replanted units |
| **Net Physical Units** | `delivered + replanted − returned` |

**Net Physical Units formula:**
```
net_physical_units = units_delivered + units_replanted − units_returned
```

Deliveries and replants are units the customer physically received; returns reduce what the customer kept. (This is intentionally different from the Customer Report's *Net Units* — see [Difference from the Customer Report](#difference-from-the-customer-report).)

### Section 3 — Deliveries
Columns: Delivery Date, Delivery ID, Product, Treatment, Seed Size, Package Type, Units Delivered, Notes.
Sorted by delivery date asc, then product name asc.

### Section 4 — Returns
Columns: Return Date, Return ID, Product, Treatment, Seed Size, Package Type, Units Returned, Notes.
Sorted by return date asc, then product name asc.

### Section 5 — Replants
Columns: Replant Date, Replant ID, Product, Treatment, Seed Size, Package Type, Units Replanted, Notes.
Sorted by replant date asc, then product name asc.

### Section 6 — Movement Summary by Product
A compact table grouped by **Product + Treatment + Seed Size + Package Type**.

Columns: Product, Treatment, Seed Size, Package Type, Delivered, Returned, Replanted, Net Physical Units.

```
net_physical_units = delivered + replanted − returned
```

Sorted by product name, treatment name, seed size, package type (all asc).

### Section 7 — Packaging Summary
Appears **only when packaging activity exists**. Pallets and seedpaks are tracked separately and never mixed into the seed movement summary.

Columns: Packaging Item, Delivered, Returned, Net Outstanding.

```
net_outstanding = delivered − returned
```

A positive Net Outstanding means the customer still holds packaging that has not been returned.

---

## Empty States

- No customer selected → "Select a customer to generate the summary."
- A section with no data shows its own message: "No deliveries found.", "No returns found.", "No replants found.", "No product movement found."
- The **Packaging Summary** section is omitted entirely when there is no pallet/seedpak activity.

---

## Difference from the Customer Report

| | Customer Report | Customer Summary |
|---|---|---|
| Orders shown | Yes | No |
| Pricing / discounts | Yes | No |
| Reconciliation (`net_units`) | Yes | No |
| Early pay bucket in grain | Yes | No |
| Physical movement (deliveries/returns/replants) | Yes | Yes |
| Packaging tracked separately | Yes | Yes |
| Key metric | `net_units = ordered − delivered − replanted + returned` (outstanding to settle) | `net_physical_units = delivered + replanted − returned` (what the customer physically kept) |
| Audience | Internal reconciliation | Quick customer-facing / internal physical view |

The two metrics answer different questions:
- **Net Units** (Customer Report): how much ordered seed is still *unreconciled*.
- **Net Physical Units** (Customer Summary): how much seed the customer *physically ended up with*.

---

## Packaging Separation

Packaging items (pallets, seedpak containers) are identified by `products.crop = 'packaging'`. The seed detail views used by this summary already exclude packaging, so:

- Deliveries, Returns, Replants, and the Movement Summary contain **seed products only**.
- Packaging activity appears **only** in the separate **Packaging Summary** section.

A seed delivery whose `package_type = 'tote'` is still seed (delivered inside a Seedpak container) — it is **not** a packaging item and stays in the seed sections.

---

## Print Behavior

Clicking **Print Summary** sets a `printing-customer-summary` body class around `window.print()`. During printing:

- The sidebar, page header band, tab navigation, and filter controls are hidden.
- Only the Customer Summary content prints — header, summary totals, and all sections.
- Tables use clean black-and-white styling with full cell borders; headers repeat on each page.
- Existing print flows are unaffected: the Customer Report's **Print Report** (`printing-customer-report`) and the delivery / return / replant print forms each use their own independent print scope.

---

## Data Sources

The summary **reuses the existing Customer Adjustment Report views** — no new migration was required.

| Section | Source |
|---|---|
| Deliveries | `v_customer_adjustment_report_deliveries` |
| Returns | `v_customer_adjustment_report_returns` |
| Replants | `v_customer_adjustment_report_replants` |
| Packaging Summary | `v_customer_adjustment_report_packaging` |
| Summary Totals (Section 2) | Aggregated client-side from the detail rows |
| Movement Summary (Section 6) | Aggregated client-side from the detail rows |

The Movement Summary and Summary Totals are computed in
`src/services/customerSummary.service.ts` (`buildMovementSummary`,
`computeSummaryTotals`) — pure functions covered by
`src/services/__tests__/customerSummary.test.ts`.

See [`/docs/03_Data/customer_adjustment_report_views.md`](../03_Data/customer_adjustment_report_views.md) for full view documentation.

---

## Notes

- All data is read-only — no edits can be made from this tab.
- Scoped to the authenticated user via `user_id = auth.uid()` on every view.
- Seed size and package type are preserved throughout and used in the Movement Summary grain.
- This feature is additive: it does not change Year-End Adjustments logic or the Customer Report.
