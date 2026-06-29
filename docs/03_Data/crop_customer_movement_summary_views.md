# Crop Customer Movement Summary Views

Two read-only views power the new **Corn Summary** and **Bean Summary** tabs on the Adjustments page. They provide a season-level, **movement-only** picture of every customer and variety: how much was delivered, returned, and replanted, split by crop so the frontend can render a corn tab and a bean tab from the same view.

Migration:
- `0038_crop_customer_movement_summary_views.sql` — creates both views. No existing views are modified.

---

## Purpose

The Corn Summary and Bean Summary tabs answer: *"For this season, what physical seed movement happened per customer and variety?"* This is distinct from the Year-End Adjustments / Customer Adjustment Report, which reconcile **ordered vs. settled** units. These views deliberately **exclude orders and pricing** — they are movement-only.

| Tab | Filter |
|---|---|
| Corn Summary | `crop_group = 'corn'` |
| Bean Summary | `crop_group = 'beans'` |

---

## Views

### v_crop_customer_movement_summary

**Purpose:** One row per customer + variety combination that had any movement in a season, with delivered / returned / replanted totals and a movement net.

**Grain:** `(user_id, season_year, crop, customer_id, product_id, treatment_id, seed_size, package_type)`

**Row inclusion:** A row appears whenever **any** movement exists in **any** category — delivery-only, return-only, replant-only, or any combination. This is achieved by `UNION`-ing the keys from the delivered, returned, and replanted CTEs, then `LEFT JOIN`-ing each total back (so missing categories read `0`).

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season (e.g. `2025`) |
| `crop` | Raw `products.crop` value (e.g. `'corn'`, `'soybean'`) |
| `crop_group` | Normalized bucket the frontend filters on: `'corn'` or `'beans'` |
| `customer_id` / `customer_name` / `farm_name` | Customer identity |
| `product_id` / `product_name` | Seed product (packaging excluded) |
| `treatment_id` / `treatment_name` | Treatment |
| `seed_size` | Corn seed size (`AR`, `AF`, …) — `NULL` for soybeans |
| `package_type` | `bag` or `tote` (display `tote` as "Seedpak") |
| `units_delivered` | Sum of delivered units (0 if none) |
| `units_returned` | Sum of returned units (0 if none) |
| `units_replanted` | Sum of replanted units (0 if none) |
| `net_units` | `units_delivered + units_replanted − units_returned` |

---

### v_crop_customer_movement_totals

**Purpose:** Top-of-page totals per crop group, to power summary header cards on each tab. Built directly on `v_crop_customer_movement_summary` so the totals can never drift from the detail rows.

**Grain:** `(user_id, season_year, crop_group)`

**Key columns:**

| Column | Description |
|---|---|
| `user_id` | Scoped via the underlying view (`auth.uid()`) |
| `season_year` | Season |
| `crop_group` | `'corn'` or `'beans'` |
| `total_units_delivered` | Sum of `units_delivered` |
| `total_units_returned` | Sum of `units_returned` |
| `total_units_replanted` | Sum of `units_replanted` |
| `total_net_units` | Sum of `net_units` |
| `customer_count` | `COUNT(DISTINCT customer_id)` with movement |
| `product_count` | `COUNT(DISTINCT product_id)` with movement |

> This view is optional — the same totals can be aggregated client-side from `v_crop_customer_movement_summary`. It exists so the header cards have a single, authoritative source.

---

## Net Units Formula

```
net_units = units_delivered + units_replanted − units_returned
```

This measures **what the customer physically kept** (the "net physical units" metric used by the Customer Summary report):

- **Add delivered:** seed the customer physically received.
- **Add replanted:** seed the customer received to re-plant a failed field (also leaves the warehouse).
- **Subtract returned:** seed the customer gave back.

> **Important — different sign convention from reconciliation.** `v_year_end_adjustments` and `v_customer_adjustment_report_summary` use `ordered − delivered − replanted + returned`, which measures *outstanding units still to settle*. These movement views measure *physical units kept* and therefore flip the signs of replanted and returned. The two answer different questions and are intentionally not interchangeable.

---

## crop_group Logic

`crop_group` normalizes the raw `products.crop` value so the frontend can filter reliably on two stable strings:

```sql
case lower(coalesce(p.crop, ''))
  when 'corn'     then 'corn'
  when 'soybean'  then 'beans'
  when 'soybeans' then 'beans'
  when 'bean'     then 'beans'
  when 'beans'    then 'beans'
  else lower(coalesce(p.crop, ''))
end
```

The raw `crop` column is preserved alongside `crop_group`, so the source value is always available. Because packaging is excluded (below), every row has `crop_group` of `'corn'` or `'beans'` under the current product catalog.

---

## Packaging Exclusion

Packaging / non-seed products (Pallet, Seedpak containers, etc.) are excluded via the canonical codebase field:

```sql
where coalesce(p.crop, '') <> 'packaging'
```

This is the same identifier used by `v_customer_adjustment_report_summary` and `v_year_end_adjustments`. Pallet and Seedpak products carry `crop = 'packaging'` and therefore never appear in these movement summaries. They are tracked separately in `v_customer_adjustment_report_packaging`.

> **Packaging vs. `package_type`:** a corn delivery with `package_type = 'tote'` is still a seed row and appears here — only products whose `crop = 'packaging'` are excluded.

---

## Relationship to the Adjustments Page

The Adjustments page hosts several tabs over the same season data:

| Tab | Backing view(s) | Metric |
|---|---|---|
| Year-End Adjustments | `v_year_end_adjustments` | Reconciliation `net = ordered − delivered − replanted + returned` |
| Customer Adjustment Report | `v_customer_adjustment_report_*` | Same reconciliation, per-customer detail |
| **Corn Summary** | `v_crop_customer_movement_summary` (filter `crop_group = 'corn'`) + `v_crop_customer_movement_totals` | Movement `net = delivered + replanted − returned` |
| **Bean Summary** | `v_crop_customer_movement_summary` (filter `crop_group = 'beans'`) + `v_crop_customer_movement_totals` | Same movement metric |

The Corn/Bean Summary views are **additive**. They do not modify or depend on the Year-End Adjustments or Customer Adjustment Report views, and existing Adjustments behavior is unchanged.

---

## Validation

Logical validation was run against a temporary harness (stub tables, fixed `user_id` in place of `auth.uid()`) covering every required scenario:

| Test | Result |
|---|---|
| Corn movement appears under `crop_group = 'corn'` | ✅ |
| Bean movement appears under `crop_group = 'beans'` | ✅ |
| Pallet / Seedpak (`crop = 'packaging'`) rows excluded | ✅ |
| Replant-only row appears (delivered 0, returned 0, replanted > 0) | ✅ |
| Return-only row appears (returned > 0) | ✅ |
| `net_units = delivered + replanted − returned` | ✅ |
| `seed_size` / `package_type` grain preserved (separate bag vs. tote rows) | ✅ |
| Rows scoped to the requesting `user_id` only | ✅ |
