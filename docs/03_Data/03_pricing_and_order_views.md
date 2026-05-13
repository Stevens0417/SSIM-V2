# 03 — Pricing and Order Views

Views that support pricing display and order management. Pricing views are global (no user_id filter). Order views are user-scoped.

---

## v_pricing_seasons

**Purpose:** List of distinct season years available in the pricing table. Used to populate season selectors.

**Source tables:** `pricing`

**Grain:** One row per season_year.

**Key columns:** `season_year` (integer)

**Pages using it:** Pricing page season selector, dashboard season selector, `fetchSeasons()` and `fetchNewestSeasonYear()` in `pricing.service.ts`.

**Business meaning:** A season exists when at least one pricing row exists for that year. Adding the first pricing row for a new year activates that year as the newest season.

**Cautions:** Do not sort ascending — the view returns `ORDER BY season_year DESC`. All season pickers expect the newest season first.

---

## v_pricing_options

**Purpose:** Long-format per-season pricing with break-even computation. This is the primary source for product/treatment dropdowns on order, delivery, return, and replant entry forms.

**Source tables:** `pricing`, `products`, `treatments`

**Grain:** One row per (season_year, product, treatment).

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `product_id` | |
| `product_name` | Display label |
| `crop` | `'corn'`, `'soybean'`, `'packaging'` |
| `treatment_id` | |
| `treatment_name` | Display label |
| `retail_price` | Price per unit |
| `break_even_price` | Computed: corn = `retail - (0.075 × retail) - 56.65`; soybean = `retail - (0.075 × retail) - 10.40` |

**Pages using it:** Orders (dropdown source), Deliveries, Returns, Replants — all use `fetchPricingOptions(seasonYear)`.

**Business meaning:** The single source of truth for which product+treatment combinations are valid for a given season, and what they cost. Forms filter this view by season_year to populate dropdowns.

**Cautions:** If a product+treatment pair is missing from `pricing` for the current season, it will not appear in dropdowns on any form. This is a common source of confusion if a new product is added to the `products` table but not priced for the season.

---

## v_pricing_sheet

**Purpose:** Long-format retail pricing sheet for a season. Equivalent to `v_pricing_options` in structure.

**Source tables:** `pricing`, `products`, `treatments`

**Grain:** One row per (season_year, product, treatment).

**Pages using it:** Pricing page (long format tab). Not used by order forms — use `v_pricing_options` for dropdowns.

---

## v_pricing_sheet_wide

**Purpose:** Pivot/wide format retail pricing. Products as rows, treatment names as columns.

**Source tables:** `pricing`, `products`, `treatments`

**Grain:** One row per product per season. Treatment columns are hardcoded pivot.

**Treatment columns (fixed):** PONCHO, FUNGICIDE, FUNGICIDE OPTIMIZE, Fung/Insect, DIAMIDE, Poncho/i-374, Fung/Insect/Opt, Fung/Insect/Ilevo

**Pages using it:** Pricing page (wide/Excel format tab). Used by `fetchPricingWide(seasonYear)`.

**Cautions:** Treatment column names are hardcoded in the view SQL. Adding a new treatment requires a view update. Do not use `CREATE OR REPLACE VIEW` if column structure changes — see schema change guidelines.

---

## v_pricing_break_even_wide

**Purpose:** Same wide/pivot format as `v_pricing_sheet_wide` but shows break-even prices instead of retail prices.

**Source tables:** Same as `v_pricing_sheet_wide`.

**Grain:** One row per product per season.

**Pages using it:** Pricing page (break-even tab). Used by `fetchBreakEvenWide(seasonYear)`.

---

## v_orders_this_season

**Purpose:** Order headers for the current season with customer details. Drives the Orders list view.

**Source tables:** `orders`, `customers`

**Grain:** One row per order.

**Filter:** `season_year = (SELECT MAX(season_year) FROM pricing)` and `user_id = auth.uid()`

**Key columns:**

| Column | Notes |
|---|---|
| `id` | order_id |
| `order_date` | |
| `customer_id` | |
| `customer_name` | From customers join |
| `farm_name` | From customers join |
| `phone_number` | From customers join |
| `brand_grower_pct` | |
| `early_pay_pct` | Non-zero = early pay order |
| `total_after_all_discounts` | Final invoice total |
| `total_profit` | |
| `total_units` | |

**Pages using it:** Orders page list view. Used by `fetchOrdersBySeason(seasonYear)`.

---

## v_order_items_this_season

**Purpose:** Order line items for the current season with full product, treatment, customer, and pricing detail.

**Source tables:** `order_items`, `orders`, `customers`, `products`, `treatments`

**Grain:** One row per order line item.

**Filter:** Current season + `user_id = auth.uid()` (via orders join).

**Key columns:**

| Column | Notes |
|---|---|
| `order_item_id` | |
| `order_id` | |
| `customer_name` | |
| `product_name` | |
| `treatment_name` | |
| `units` | Quantity ordered |
| `retail_price_per_unit` | |
| `brand_grower_pct` / `early_pay_pct` | From parent order |
| `line_total_after_all_discounts` | |
| `break_even_price_per_unit` | |
| `profit_per_unit` | |
| `line_total_profit` | |

**Pages using it:** Dashboard (not directly), order detail view. Used by `fetchOrderItemsThisSeason()`.

---

## v_dashboard_kpis_by_season

**Purpose:** Season-level aggregate KPIs for the dashboard.

**Source tables:** `orders`, `order_items`

**Grain:** One row per season_year.

**Key columns:** `season_year`, `total_units_sold`, `total_sales`, `total_profit`, `total_discounts_given`, `avg_price_per_unit`, `avg_profit_per_unit`

**Pages using it:** Dashboard. Used by `fetchDashboardKpis(seasonYear)`.

---

## v_dashboard_kpis_by_season_crop

**Purpose:** Same as above, split by crop type (corn vs soybean).

**Source tables:** `orders`, `order_items`, `products`

**Grain:** One row per (season_year, crop).

**Pages using it:** Dashboard crop breakdown. Used by `fetchCropKpis(seasonYear)`.

---

## v_dashboard_treatment_mix_by_season_crop

**Purpose:** Treatment-level sales breakdown by crop.

**Source tables:** `orders`, `order_items`, `products`, `treatments`

**Grain:** One row per (season_year, crop, treatment_name).

**Key columns:** `treatment_name`, `total_units`, `total_sales`, `total_profit`

**Pages using it:** Dashboard treatment mix chart. Used by `fetchTreatmentMix(seasonYear)`.

---

## v_dashboard_customer_volume_buckets_by_season_crop

**Purpose:** Groups customers into volume tiers per season per crop for distribution analysis.

**Source tables:** `orders`, `order_items`, `products`

**Grain:** One row per (season_year, crop, volume_bucket).

**Volume buckets:** `01: <50`, `02: 50-99`, `03: 100-249`, `04: 250-499`, `05: 500-999`, `06: 1000+` (units ordered)

**Key columns:** `volume_bucket`, `customer_count`, `bucket_total_units`, `bucket_total_sales`, `avg_price_per_unit`, `bucket_total_profit`

**Pages using it:** Dashboard volume distribution chart. Used by `fetchVolumeBuckets(seasonYear)`.

**Caution:** Only includes `crop IN ('corn', 'soybean')` — packaging excluded.

---

## v_year_end_adjustments

**Purpose:** Year-end view of ordered vs. delivered vs. returned units per customer per product per treatment, split by early_pay bucket. Used for invoice adjustment review at season close.

**Source tables:** `orders`, `order_items`, `deliveries`, `returns`, `customers`, `products`, `treatments`, `invoice_adjustment_checks`

**Grain:** One row per (season_year, customer, product, treatment, early_pay_bucket).

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `customer_id` / `customer_name` | |
| `product_id` / `product_name` | |
| `treatment_id` / `treatment_name` | |
| `early_pay_bucket` | `'EARLY_PAY'`, `'NO_EARLY_PAY'`, `'UNKNOWN'` |
| `early_pay_pct` | From order |
| `units_ordered` | |
| `units_delivered` | |
| `units_returned` | |
| `net_units` | `ordered - delivered + returned` |
| `is_completed` | From invoice_adjustment_checks |
| `completed_at` | |

**Pages using it:** Adjustments page. Used by `fetchAdjustments(seasonYear)`.

**Business meaning:** `early_pay_bucket = 'UNKNOWN'` means the delivery or return had no `order_item_id` link — these cannot be attributed to either early-pay or non-early-pay.

**Caution:** This view spans all seasons, filtered only by `user_id`. It is not restricted to the current season — the caller must pass `seasonYear` to filter results.

---

## v_agent_customer_current_season_orders

**Purpose:** Agent-approved read-only view of order items with full pricing and profit detail. Created to power the `get_customer_current_season_orders` agent tool.

**Source tables:** `order_items`, `orders`, `customers`, `products`, `treatments`

**Grain:** One row per order_item.

**Filter:** `o.user_id = auth.uid()` and `oi.user_id = auth.uid()`. NOT pre-filtered by season — the backend passes `season_year` as a filter.

**Key columns:**

| Column | Notes |
|---|---|
| `user_id` | From orders; matches auth.uid() |
| `order_item_id` | PK of order_items |
| `order_id` | |
| `season_year` | From orders |
| `order_date` | From orders |
| `customer_id` / `customer_name` / `farm_name` | From customers join |
| `product_id` / `product_name` / `crop` | From products join |
| `treatment_id` / `treatment_name` | From treatments join |
| `seed_size` / `package_type` | From order_items |
| `units_ordered` | `order_items.units` |
| `early_pay` | Boolean: `early_pay_pct > 0` |
| `early_pay_pct` / `brand_grower_pct` | From orders |
| `retail_price_per_unit` | From order_items |
| `brand_grower_discount_amount` / `tote_bulk_discount_amount` / `early_pay_discount_amount` | From order_items |
| `line_total_after_all_discounts` | From order_items |
| `break_even_price_per_unit` / `profit_per_unit` / `line_total_profit` | From order_items |
| `order_created_at` | `orders.created_at` — used for FIFO sort in allocation |

**Agent tool using it:** `get_customer_current_season_orders`

**Pages using it:** None (agent-only view).

**Cautions:**
- This view spans all seasons — always filter by `season_year` in the backend.
- Do not add a `WHERE season_year = ...` inside the view; the multi-season design is intentional so the tool can answer historical queries.
- `package_type = 'bag'` should display as "Bag"; `package_type = 'tote'` should display as "Seedpak". The tool handles this mapping.
- If modifying this view, use `DROP VIEW ... CREATE VIEW` (not `CREATE OR REPLACE`) if column order changes — see schema change guidelines.

---

## v_agent_pricing

**Purpose:** Agent-approved read-only view of retail pricing, break-even prices, and computed margins per product/treatment per season. Powers pricing queries in the SQL fallback tool.

**Source view:** `v_pricing_options`

**Grain:** One row per (season_year, product, treatment). No seed_size or package_type dimension — pricing is the same regardless of seed size or package type.

**Filter:** GLOBAL — no user_id filter. This view returns the same rows for every authenticated user. Pricing is not user-scoped.

**Key columns:**

| Column | Notes |
|---|---|
| `season_year` | |
| `product_id` | Internal UUID |
| `product_name` | Display label |
| `crop` | `'corn'`, `'soybean'`, `'packaging'` |
| `chu` | Heat units (corn products) |
| `seed_trait` | Trait label (corn products) |
| `treatment_id` | Internal UUID |
| `treatment_name` | Display label |
| `retail_price_per_unit` | Renamed from `retail_price` in `v_pricing_options` |
| `break_even_price_per_unit` | Renamed from `break_even_price` in `v_pricing_options` |
| `margin_per_unit` | `retail_price_per_unit − break_even_price_per_unit`; NULL when break_even_price is NULL |
| `margin_pct` | `margin_per_unit / retail_price_per_unit × 100`; NULL when retail_price = 0 or break_even is NULL |

**Margin field definitions:**
- `margin_per_unit` = `retail_price_per_unit − break_even_price_per_unit` — the per-unit pricing spread. This is the same for every customer; it does not account for order-level discounts.
- `margin_pct` = `margin_per_unit / retail_price_per_unit × 100` — margin as a percentage of retail price.
- Both fields are NULL for packaging/NO_TREATMENT rows where break-even is not defined.
- **Margin vs customer profit:** `margin_per_unit` is a pricing-level concept. Actual profit per customer order is lower because brand grower and early-pay discounts reduce the effective selling price. Customer-level profit is tracked in `order_items.profit_per_unit` (which factors in discounts).

**Agent use cases:**
- Primary: `get_pricing_info` tool — handles retail price, break-even, and margin questions for specific products/treatments
- SQL fallback (`run_approved_readonly_query`): for cross-product aggregation and ranking (e.g. "which products have the highest margin?", "average margin for corn products")

**Agent tool using it:** `get_pricing_info` — primary tool for retail price, break-even, and margin questions. The SQL fallback (`run_approved_readonly_query`) can also query this view for custom aggregation questions not served by the tool.

**Migration:** `0031_v_agent_pricing.sql`

**SQL fallback registration:** `APPROVED_VIEWS` in `validate-approved-query.ts`; `TOOL_DESCRIPTION` in `run-approved-readonly-query.ts`

**Cautions:**
- Pricing has no seed_size or package_type dimension — do not attempt to filter by these columns.
- `margin_per_unit` and `margin_pct` are NULL for packaging rows (NO_TREATMENT) where break_even_price is not computed.
- This view is GLOBAL (no auth.uid() filter). Unlike other agent views, it does not scope to the logged-in user — all users see the same pricing data.
