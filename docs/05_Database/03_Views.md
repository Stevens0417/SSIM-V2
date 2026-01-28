# Views

SSIM uses Postgres views to keep UI logic simple and consistent. Views are the preferred place for:
- pricing presentation shapes (Excel-style)
- break-even calculations
- dropdown helper datasets (valid product+treatment combos)

This prevents business logic from being duplicated across frontend components.

---

## Important Rule: View Output Contract Changes
Postgres does **not** allow `CREATE OR REPLACE VIEW` to change existing view column names/order reliably.

**Rule:**
- If changing **only SQL logic** but keeping the same columns → use `CREATE OR REPLACE VIEW`
- If changing **columns** (add/remove/rename/reorder) → use `DROP VIEW` then `CREATE VIEW`

We follow this in migrations to avoid errors like:
> "cannot change name of view column ..."

---

## Pricing Views (Phase 1)

### 1) `v_pricing_seasons`
**Purpose**
- Provides the list of available `season_year` values for the Pricing page tabs.
- UI defaults to the newest season.

**Columns**
- `season_year`

**UI Usage**
- Pricing page: load tabs and default to newest year.

---

### 2) `v_pricing_sheet_wide`
**Purpose**
- Excel-like pricing sheet layout for **Retail Price**.
- Rows are products; columns are treatments.

**Columns (core)**
- `season_year`
- `product` (product_name)
- `crop`
- `chu`
- `seed_trait`
- Treatment columns (fixed set, may be updated yearly if treatment offerings change)

**UI Usage**
- Pricing page Retail mode:
  - filter by season tab
  - sort in UI (corn first, then soybeans; then product number/string)

**Notes**
- This view is intended for display only.
- It is okay to maintain a “fixed column set” in this view; when treatments evolve, update the view.

---

### 3) `v_pricing_break_even_wide`
**Purpose**
- Same shape as `v_pricing_sheet_wide`, but values are **break-even** prices computed from agreed rules.

**Break-even rules**
- Corn: `retail - (0.075 * retail) - 56.65`
- Soybean: `retail - (0.075 * retail) - 10.40`

**UI Usage**
- Pricing page toggle:
  - Retail: `v_pricing_sheet_wide`
  - Break-even: `v_pricing_break_even_wide`

---

### 4) `v_pricing_options`
**Purpose**
- “Long format” helper dataset used by the Orders UI.
- Defines what product+treatment combos are allowed for a given season.
- Provides both display metadata and prices for auto-fill.

**This view is the source of truth for dropdowns (Phase 1)**
- Product options: distinct products from this view filtered by season
- Treatment options: filtered by season + product

**Columns**
- `season_year`
- `product_id`, `product_name`, `crop`, `chu`, `seed_trait`
- `treatment_id`, `treatment_name`
- `retail_price`
- `break_even_price`

**UI Usage**
- Orders page:
  1) Product dropdown = distinct `(product_id, product_name)` where `season_year = X`
  2) Treatment dropdown = rows where `season_year = X AND product_id = selected`
  3) Price auto-fill = single row where `season_year + product_id + treatment_id` match

**Why we chose this**
- Pricing defines what is sellable for a season.
- Using `products` alone would allow selecting items with no price for that season.

---
