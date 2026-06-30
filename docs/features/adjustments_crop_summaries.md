# Corn Summary & Bean Summary Tabs

## Overview

**Corn Summary** and **Bean Summary** are two crop-specific tabs under the **Adjustments** page. Each gives a quick, season-level view of *physical product movement* — **Deliveries, Returns, and Replants** — aggregated by **customer + farm name + package type** for that crop, with no order or pricing detail.

> **Grain (updated):** As of migration `0039_crop_customer_package_summary.sql`, these tabs aggregate to **customer + farm name + package type only**. Product/variety, treatment, and seed size have been **removed** from the crop summaries. (The earlier grain split rows by product/variety, treatment, and seed size.)

They sit alongside the existing Adjustments tabs and do not replace any of them.

---

## Location

**Adjustments → Corn Summary** and **Adjustments → Bean Summary**

The Adjustments page now has five tabs:
- **Year-End Adjustments** — reconciliation table for all customers
- **Customer Report** — detailed per-customer report (orders, deliveries, replants, returns, reconciliation, packaging)
- **Customer Summary** — simplified per-customer physical-movement summary
- **Corn Summary** — all-customer corn movement summary (this feature)
- **Bean Summary** — all-customer bean/soybean movement summary (this feature)

---

## How to Use

1. Open the **Adjustments** page.
2. Click **Corn Summary** or **Bean Summary**.
3. Select a **Season** (defaults to the latest season).
4. Optionally type in the **Search** box to filter by customer, farm, or package type.
5. The table and the top totals update automatically.

---

## What It Shows

**Top totals (KPI cards):**
- Total Units Delivered
- Total Units Returned
- Total Units Replanted
- **Net Units** = Delivered + Replanted − Returned
- Customers (distinct count)
- Package Types (distinct count)

Totals always reflect the **currently visible rows** (i.e. after any search filter is applied).

**Main table columns:**

| Column | Notes |
|---|---|
| Customer | |
| Farm Name | `—` when not set |
| Package Type | Bag or Seedpak (`tote` displays as "Seedpak") |
| Units Delivered | |
| Units Returned | |
| Units Replanted | |
| Net Units | Delivered + Replanted − Returned |

> Product/variety, treatment, and seed size are **no longer shown** — the summary aggregates across them.

**Default sort:** Customer → Farm Name → Package Type (all ascending).

**Empty state:** "No corn movement found for this season." / "No bean movement found for this season."

---

## Net Units Formula

```
Net Units = Delivered + Replanted − Returned
```

This is a **movement** metric — what the customer physically kept — and is intentionally the **opposite sign convention** from the Year-End Adjustments / Customer Report reconciliation net (`ordered − delivered − replanted + returned`, which measures outstanding units to settle). The two answer different questions.

---

## Data Source

Both tabs read the same view, filtered by crop:

| Tab | Filter |
|---|---|
| Corn Summary | `crop_group = 'corn'` |
| Bean Summary | `crop_group = 'beans'` |

- View: `v_crop_customer_movement_summary` (see [`/docs/03_Data/crop_customer_movement_summary_views.md`](../03_Data/crop_customer_movement_summary_views.md))
- Service: `src/services/cropMovementSummary.service.ts`
- Component: `src/components/adjustments/CropSummaryTab.tsx` (one reusable component, parameterized by `cropGroup`)

The view normalizes the raw `products.crop` value into `crop_group` (`corn` / `beans`), **aggregates to customer + package type** (product/variety, treatment, and seed size are summed away), and **excludes packaging products** (`products.crop = 'packaging'`, e.g. Pallet and Seedpak), so packaging never appears on either tab.

The current view grain is defined by migration `0039_crop_customer_package_summary.sql`. The views were authored from the repo's migration/schema/docs files, not from a live Supabase connection.

---

## Behavior Notes

- **Read-only.** These tabs do not edit any data.
- **No orders or pricing.** Movement only.
- **Per-user scoped** via `auth.uid()` in the underlying view.
- Existing Adjustments tabs (Year-End, Customer Report, Customer Summary) and their behaviors (including the completed checkbox) are unchanged.

---

## QA Status

Full QA was performed at both the database and application layers — see the [Validation section of the views doc](../03_Data/crop_customer_movement_summary_views.md#final-qa-results) for the complete scenario checklist (multi-variety aggregation, Bag/Seedpak split, packaging exclusion, bean filtering, totals, the net-units formula, season/user isolation, and the legacy `NULL` package_type case). The view DDL was exercised against a throwaway local PostgreSQL harness rebuilt from the repo's migration files — **no live Supabase connection was used**.

**Bug fixed during final QA:** `package_type` is nullable on the base movement tables, and the view's key `UNION` + equality `LEFT JOIN`s would have dropped the units of any legacy `NULL`-package row (since `NULL = NULL` is not true in SQL). Each CTE now normalizes `package_type` with `coalesce(package_type, 'bag')`, matching `v_on_hand_inventory` and the `fmtPackageType` display helper. See the [package_type Normalization section](../03_Data/crop_customer_movement_summary_views.md#package_type-normalization-null--bag) of the views doc.

Static checks pass: TypeScript clean, lint clean, 44/44 unit tests, production build succeeds.
