# Crop Customer Movement Summary Views

Two read-only views power the **Corn Summary** and **Bean Summary** tabs on the Adjustments page. They provide a season-level, **movement-only** picture of every customer: how much was delivered, returned, and replanted, split by crop and **package type** so the frontend can render a corn tab and a bean tab from the same view.

Migrations:
- `0038_crop_customer_movement_summary_views.sql` — original views (grain included product/variety, treatment, seed size).
- `0039_crop_customer_package_summary.sql` — **re-grains** both views to **customer + farm name + package type only**. Product/variety, treatment, and seed size are removed from the summary. This is the current shape.

> **Authoring note.** These views were authored from the repo's migration / schema / docs files (the SQL DDL of migration 0038, the `products`/`customers`/`deliveries`/`returns`/`replants` definitions, and the existing packaging logic in the customer report views) — **not** from a live Supabase connection. The Supabase connection may point at the wrong project, so the codebase is the source of truth.

---

## Purpose

The Corn Summary and Bean Summary tabs answer: *"For this season, what physical seed movement happened per customer and package type?"* This is distinct from the Year-End Adjustments / Customer Adjustment Report, which reconcile **ordered vs. settled** units. These views deliberately **exclude orders and pricing** — they are movement-only.

| Tab | Filter |
|---|---|
| Corn Summary | `crop_group = 'corn'` |
| Bean Summary | `crop_group = 'beans'` |

---

## Grain change (migration 0039)

The summary previously split a customer's movement across product/variety, treatment, and seed size. The new grain collapses all of those out:

| | Old grain (0038) | New grain (0039) |
|---|---|---|
| Keys | `user_id, season_year, crop, customer_id, product_id, treatment_id, seed_size, package_type` | `user_id, season_year, crop_group, customer_id, package_type` |
| Product / variety | column | **removed** |
| Treatment | column | **removed** |
| Seed size | column | **removed** |
| Package type | preserved | **preserved** |

`customer_name` and `farm_name` are customer attributes carried for display; they are functionally determined by `customer_id` and do not affect the grain.

Because the previous `v_crop_customer_movement_totals` view depended on the summary view and referenced `product_id` (which no longer exists), migration 0039 **drops both views in dependency order** (totals first, then summary) and recreates them. `CREATE OR REPLACE VIEW` is not safe when columns are removed/reordered, so a drop/recreate is used.

---

## Views

### v_crop_customer_movement_summary

**Purpose:** One row per **customer + package type** that had any movement in a season for a crop, with delivered / returned / replanted totals and a movement net.

**Grain:** `(user_id, season_year, crop_group, customer_id, package_type)`

**Row inclusion:** A row appears whenever **any** movement exists in **any** category — delivery-only, return-only, replant-only, or any combination. This is achieved by `UNION`-ing the keys from the delivered, returned, and replanted CTEs, then `LEFT JOIN`-ing each total back (so missing categories read `0`).

**Columns (exactly these):**

| Column | Description |
|---|---|
| `user_id` | Scoped to `auth.uid()` |
| `season_year` | Season (e.g. `2025`) |
| `crop_group` | Normalized bucket the frontend filters on: `'corn'` or `'beans'` |
| `customer_id` | Customer identity |
| `customer_name` | Customer name (display) |
| `farm_name` | Farm name (display; `NULL` when not set) |
| `package_type` | `bag` or `tote` (display `tote` as "Seedpak") |
| `units_delivered` | Sum of delivered units (0 if none) |
| `units_returned` | Sum of returned units (0 if none) |
| `units_replanted` | Sum of replanted units (0 if none) |
| `net_units` | `units_delivered + units_replanted − units_returned` |

> There is **no** `product_id`, `product_name`, `treatment_id`, `treatment_name`, `seed_size`, or raw `crop` column. The raw `products.crop` value is used internally only to derive `crop_group` and to exclude packaging, then aggregated away (multiple raw spellings such as `soybean` / `soybeans` collapse into the single `beans` bucket, so the raw value is no longer meaningful at this grain).

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
| `package_count` | `COUNT(DISTINCT package_type)` with movement (replaces the old `product_count`, which is meaningless now that product is not in the grain) |

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

> **Important — different sign convention from reconciliation.** `v_year_end_adjustments` and `v_customer_adjustment_report_summary` use `ordered − delivered − replanted + returned`, which measures *outstanding units still to settle*. These movement views measure *physical units kept* and therefore flip the signs of replanted and returned. The two answer different questions and are intentionally not interchangeable. **Year-End Adjustments logic is unchanged by migration 0039.**

---

## crop_group Logic

`crop_group` normalizes the raw `products.crop` value so the frontend can filter reliably on two stable strings. Because product is no longer part of the grain, `crop` is derived per movement row (via a join to `products`) purely to bucket the row into the corn or bean tab, then aggregated away:

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

Because packaging is excluded (below), every row has `crop_group` of `'corn'` or `'beans'` under the current product catalog.

---

## Packaging Exclusion

Packaging / non-seed products (Pallet, Seedpak containers, etc.) are excluded via the canonical codebase field, applied inside every movement CTE:

```sql
where coalesce(p.crop, '') <> 'packaging'
```

This is the same identifier used by `v_customer_adjustment_report_summary` and `v_year_end_adjustments`. **Pallet and Seedpak products carry `crop = 'packaging'`** and therefore never appear as crop rows in these movement summaries. They are tracked separately in `v_customer_adjustment_report_packaging`.

> **Packaging vs. `package_type`:** a corn delivery with `package_type = 'tote'` is still a seed row and appears here — only products whose `crop = 'packaging'` are excluded.

---

## Relationship to the Adjustments Page

The Adjustments page hosts several tabs over the same season data:

| Tab | Backing view(s) | Metric |
|---|---|---|
| Year-End Adjustments | `v_year_end_adjustments` | Reconciliation `net = ordered − delivered − replanted + returned` |
| Customer Report | `v_customer_adjustment_report_*` | Same reconciliation, per-customer detail |
| Customer Summary | per-customer physical-movement summary | Movement |
| **Corn Summary** | `v_crop_customer_movement_summary` (filter `crop_group = 'corn'`) + `v_crop_customer_movement_totals` | Movement `net = delivered + replanted − returned`, by customer + package |
| **Bean Summary** | `v_crop_customer_movement_summary` (filter `crop_group = 'beans'`) + `v_crop_customer_movement_totals` | Same movement metric |

Migration 0039 only re-grains the two Corn/Bean Summary views. It does **not** modify or depend on the Year-End Adjustments, Customer Report, or Customer Summary views, and their behavior is unchanged.

The frontend tabs that consume these views are documented in [`/docs/features/adjustments_crop_summaries.md`](../features/adjustments_crop_summaries.md).

---

## Validation

Migration `0039_crop_customer_package_summary.sql` ships the following read-only validation queries (in its trailing comment block) to run manually in Supabase after applying. They check, for each requirement:

1. **Corn rows grouped by customer / package** — select corn rows for a season, ordered by customer and package type; confirm no product/treatment/seed-size split.
2. **Bean rows grouped by customer / package** — same for `crop_group = 'beans'`.
3. **No Pallet / Seedpak rows included** — a `NOT EXISTS` probe that must return **zero** rows, plus a check that `Pallet` / `Seedpak` products carry `crop = 'packaging'` and are therefore filtered.
4. **Totals equal delivered + replanted − returned** — a count of rows where `net_units <> units_delivered + units_replanted − units_returned`, which must be **0**.
5. **No product / treatment / seed_size columns exist** — an `information_schema.columns` query that must return **zero** rows for `product_id`, `product_name`, `treatment_id`, `treatment_name`, `seed_size`, `crop`.

The expected full column set of `v_crop_customer_movement_summary` is exactly:

```
user_id, season_year, crop_group, customer_id, customer_name,
farm_name, package_type, units_delivered, units_returned,
units_replanted, net_units
```

Static checks after the change: `tsc --noEmit` clean, `next lint` clean, `vitest` 44/44 passing.

> The migration is intended to be **run manually in Supabase**; it was not executed against any database during authoring.
