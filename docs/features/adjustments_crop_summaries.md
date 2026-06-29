# Corn Summary & Bean Summary Tabs

## Overview

**Corn Summary** and **Bean Summary** are two crop-specific tabs under the **Adjustments** page. Each gives a quick, season-level view of *physical product movement* — **Deliveries, Returns, and Replants** — for every customer and variety of that crop, with no order or pricing detail.

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
4. Optionally type in the **Search** box to filter by customer, farm, product, or treatment.
5. The table and the top totals update automatically.

---

## What It Shows

**Top totals (KPI cards):**
- Total Units Delivered
- Total Units Returned
- Total Units Replanted
- **Net Units** = Delivered + Replanted − Returned
- Customers (distinct count)
- Varieties (distinct product count)

Totals always reflect the **currently visible rows** (i.e. after any search filter is applied).

**Main table columns:**

| Column | Notes |
|---|---|
| Customer | |
| Farm Name | `—` when not set |
| Product / Variety | |
| Treatment | |
| Seed Size | `—` for soybeans (corn-only dimension) |
| Package Type | Bag or Seedpak (`tote` displays as "Seedpak") |
| Units Delivered | |
| Units Returned | |
| Units Replanted | |
| Net Units | Delivered + Replanted − Returned |

**Default sort:** Customer → Product → Treatment → Seed Size (all ascending).

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

The view normalizes the raw `products.crop` value into `crop_group` (`corn` / `beans`) and **excludes packaging products** (`products.crop = 'packaging'`, e.g. Pallet and Seedpak), so packaging never appears on either tab.

---

## Behavior Notes

- **Read-only.** These tabs do not edit any data.
- **No orders or pricing.** Movement only.
- **Per-user scoped** via `auth.uid()` in the underlying view.
- Existing Adjustments tabs (Year-End, Customer Report, Customer Summary) and their behaviors (including the completed checkbox) are unchanged.

---

## QA Status

Full QA was performed at both the database and application layers — see the [Validation section of the views doc](../03_Data/crop_customer_movement_summary_views.md#validation) for the worked example and the complete scenario checklist (crop filtering, mixed-crop customers, packaging exclusion, totals, season filter, user scoping). Static checks pass: TypeScript clean, lint clean, 44/44 unit tests, production build succeeds.
