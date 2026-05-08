# 06 — Agent-Approved Views

This document is for the **future agent chatbot** tooling. It defines which views are safe for read-only agent queries, what questions each view can answer, and what guardrails apply.

The agent should **never query raw tables directly** unless an approved tool explicitly requires it for an insert/update. All read access should go through the views listed here.

All views in this document are user-scoped — they automatically filter by `auth.uid()`. The agent must run queries in the context of an authenticated Supabase session for the correct user.

---

## Approved Views for Agent Read Access

---

### v_pricing_options

| Property | Value |
|---|---|
| **Table** | `v_pricing_options` |
| **Access type** | Read-only |
| **User-scoped** | No (global pricing) |

**Safe use cases:**
- "What treatments are available for DKC 45-50 this season?"
- "What is the retail price for soybean with PONCHO treatment?"
- "List all products available for 2025."
- "What is the break-even price for corn FUNGICIDE?"

**Allowed filters:** `season_year`, `crop`, `product_name`, `treatment_name`

**Columns safe for agent:** `season_year`, `product_name`, `crop`, `treatment_name`, `retail_price`, `break_even_price`

**Columns to exclude:** `product_id`, `treatment_id` (internal UUIDs — not useful for users)

**Notes:** This is the correct view for pricing lookups. Do not query the raw `pricing` table — it lacks product and treatment names.

---

### v_on_hand_inventory

| Property | Value |
|---|---|
| **Table** | `v_on_hand_inventory` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "How many units of DKC 45-50 FUNGICIDE Bag do we have on hand?"
- "Show me all products where available_units is negative."
- "What is the current inventory for soybean products?"
- "How many Seedpak units of [product] do we have?"

**Allowed filters:** `product_name`, `treatment_name`, `seed_size`, `package_type`, `available_units`

**Columns safe for agent:** `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_received`, `units_delivered`, `units_returned`, `units_on_hand`, `units_staged`, `available_units`

**Columns to exclude:** `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- Use `package_type = 'bag'` for Bags and `package_type = 'tote'` for Seedpaks in filter values. Display as "Bag" / "Seedpak" in responses.
- `units_on_hand` is **physical** inventory (received − delivered + returned) — the warehouse count. The tool exposes this as `physical_units_on_hand`.
- `units_staged` is the quantity reserved in in_progress staged deliveries. The tool exposes this as `staged_units`.
- `available_units = units_on_hand − units_staged` — this is the primary operational quantity. The `get_on_hand_inventory` tool always leads responses with `total_available_units`.
- This view has separate rows for Bag and Seedpak — if you want a combined total, sum across package_type.
- **Staged-only rows:** The view includes rows where `units_on_hand = 0` and `units_staged > 0` (i.e., product staged for delivery at a seed_size or package_type that has no received inventory). These rows have `available_units < 0` and must NOT be filtered out — they reduce total available inventory. The `get_on_hand_inventory` tool always returns all rows so the pre-computed `total_available_units` is correct. Do not apply `WHERE available_units >= 0` in SQL fallback queries — use `total_available_units` from the tool instead.
- **Agent aggregation rule:** When the tool returns multiple rows for the same product (different seed sizes), the agent uses `total_available_units` (the pre-computed sum of all rows) as the headline — never an individual row's `available_units` value.

---

### v_on_hand_inventory_wide

| Property | Value |
|---|---|
| **Table** | `v_on_hand_inventory_wide` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "Give me a summary of all inventory by product and treatment."
- "Which products have FUNGICIDE inventory?"
- "Show me a table of on-hand inventory."

**Allowed filters:** `product_name`

**Columns safe for agent:** `product_name`, all treatment columns (DIAMIDE, Fung/Insect, Fung/Insect/Ilevo, Fung/Insect/Opt, FUNGICIDE, FUNGICIDE OPTIMIZE, PONCHO, Poncho/i-374)

**Notes:**
- Treatment columns show `available_units` (physical on hand minus staged) as of migration 0027 — the operationally meaningful committable quantity.
- This view aggregates Bag and Seedpak together. Do not use it for package-type-specific questions — use `v_on_hand_inventory` instead.
- NULL values in treatment columns mean no available inventory for that combination (not zero).
- Excludes NO_TREATMENT (packaging) rows.

---

### v_delivery_customer_order_status

| Property | Value |
|---|---|
| **Table** | `v_delivery_customer_order_status` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "What is the outstanding balance for customer [name]?"
- "Which order lines are not yet fully delivered?"
- "How many units of [product] have been delivered to [customer] this season?"
- "Is [customer]'s order complete?"
- "Show me all incomplete order lines."

**Allowed filters:** `customer_name`, `farm_name`, `season_year`, `product_name`, `treatment_name`, `is_complete`

**Columns safe for agent:** `season_year`, `customer_name`, `farm_name`, `order_date`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `ordered_units`, `delivered_units`, `returned_units`, `replanted_units`, `net_units`, `is_complete`

**Columns to exclude:** `order_id`, `order_item_id`, `customer_id`, `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- `net_units > 0` means outstanding delivery still needed.
- `net_units <= 0` means `is_complete = true` — fully delivered or over-delivered.
- Only linked deliveries/returns/replants (with `order_item_id`) appear here. Unlinked deliveries are not counted.
- Filter by `season_year` explicitly — this view covers all seasons.
- `farm_name` added in migration 0025 to support farm/business name lookups.

**Agent tool using it:** `get_customer_order_fulfillment_status` — uses three-step matching: exact `customer_name` → exact `farm_name` → partial OR both fields (`matched_by: "both"`). Aggregates from order_item grain to customer+product+treatment+seed_size+package_type grain in TypeScript. Returns `matched_customers[]` with `customer_id`, `customer_name`, `farm_name` for every distinct customer in results. Fulfillment status values: `"open"`, `"partial"`, `"complete"`, `"overdelivered"` (units_remaining can be negative).

---

### v_orders_this_season

| Property | Value |
|---|---|
| **Table** | `v_orders_this_season` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "List all orders for this season."
- "What is [customer]'s total order value?"
- "Which customers have early-pay orders?"
- "What is our total revenue for the current season?"

**Allowed filters:** `customer_name`, `early_pay_pct`

**Columns safe for agent:** `order_date`, `customer_name`, `farm_name`, `brand_grower_pct`, `early_pay_pct`, `total_after_all_discounts`, `total_profit`, `total_units`

**Columns to exclude:** `id`, `customer_id` (internal UUIDs)

**Notes:**
- This view is pre-filtered to the current season only (max season_year in pricing).
- `early_pay_pct > 0` means this is an early-pay order.

---

### v_bayer_year_end_totals

| Property | Value |
|---|---|
| **Table** | `v_bayer_year_end_totals` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "How many units of [product] did we receive from Bayer this season?"
- "Which Bayer items have not been verified yet?"
- "Show me all unverified year-end Bayer totals."

**Allowed filters:** `season_year`, `product_name`, `treatment_name`, `is_verified`

**Columns safe for agent:** `season_year`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `net_units`, `is_verified`, `verified_at`

**Columns to exclude:** `product_id`, `treatment_id`, `verified_by` (internal UUID)

**Notes:**
- Filter by `season_year` explicitly.
- `net_units` is the total received across all shipments for that product+treatment+seed_size+package_type.
- Negative `net_units` means Bayer returns or corrections.

---

### v_year_end_adjustments

| Property | Value |
|---|---|
| **Table** | `v_year_end_adjustments` |
| **Access type** | Read-only |
| **User-scoped** | Yes |

**Safe use cases:**
- "Show outstanding adjustments for [customer] this season."
- "Which early-pay customers still have net units outstanding?"
- "Has [customer]'s adjustment been signed off?"

**Allowed filters:** `season_year`, `customer_name`, `product_name`, `early_pay_bucket`, `is_completed`

**Columns safe for agent:** `season_year`, `customer_name`, `product_name`, `treatment_name`, `early_pay_bucket`, `early_pay_pct`, `units_ordered`, `units_delivered`, `units_returned`, `net_units`, `is_completed`, `completed_at`

**Columns to exclude:** `customer_id`, `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- Filter by `season_year` — this view covers all seasons.
- `early_pay_bucket = 'UNKNOWN'` rows represent unlinked deliveries/returns — cannot be attributed to a pricing tier.
- `net_units > 0` means customer still has outstanding seed (ordered but not delivered or returned).

---

### v_agent_customer_current_season_orders

| Property | Value |
|---|---|
| **Table** | `v_agent_customer_current_season_orders` |
| **Access type** | Read-only |
| **User-scoped** | Yes — `auth.uid()` on both orders and order_items |

**Safe use cases:**
- "Show me the orders for Smith Farms." (farm/business name — matches via `farm_name`)
- "What did Adam Stevens order this season?"
- "How many units did [customer or farm] order?"
- "Show me [customer]'s order lines for PONCHO."
- "What early-pay orders does [customer] have?"
- "What is the price per unit for [customer]'s order?"
- "What is the profit on [customer]'s order?"

**Allowed filters (all optional except customerName):** `customer_name` (partial OK), `farm_name` (partial OK), `season_year`, `product_name`, `treatment_name`, `early_pay`

**Columns safe for agent:** `order_item_id`, `order_id`, `order_date`, `season_year`, `customer_name`, `farm_name`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_ordered`, `early_pay`, `early_pay_pct`, `brand_grower_pct`, `retail_price_per_unit`, `brand_grower_discount_amount`, `tote_bulk_discount_amount`, `early_pay_discount_amount`, `line_total_after_all_discounts`, `break_even_price_per_unit`, `profit_per_unit`, `line_total_profit`

**Columns to exclude from responses:** `user_id`, `customer_id`, `product_id`, `treatment_id`, `order_created_at` (internal UUIDs / timestamps — not useful in user-facing responses)

**Notes:**
- This view is NOT pre-filtered by season. The backend must always filter by `season_year`.
- Customer name matching (three-step): exact `customer_name` → exact `farm_name` → partial OR both fields. This lets "Tam Farms" return all customers associated with that farm.
- If multiple customers match, all results are returned; the assistant clarifies using `customer_name_matched` and `matched_customer_count`.
- Package type `'bag'` → display "Bag"; `'tote'` → display "Seedpak".
- Pricing and profit fields are always present in the view but should only be surfaced in agent responses when the user explicitly asks (controlled by `includePricing` / `includeProfit` tool parameters).

**Agent tool using it:** `get_customer_current_season_orders`

---

### v_agent_staged_deliveries

| Property | Value |
|---|---|
| **Table** | `v_agent_staged_deliveries` |
| **Access type** | Read-only |
| **User-scoped** | Yes (inherits from `v_staged_deliveries`) |

**Safe use cases:**
- "What product has been staged for [customer]?"
- "How many units of [product] are currently staged?"
- "Which customers have staged deliveries this season?"
- "Show me all staged deliveries for [customer or farm]."

**Allowed filters:** `customer_name`, `farm_name`, `season_year`, `product_name`, `treatment_name`, `seed_size`, `package_type`

**Columns safe for agent:** `staged_delivery_id`, `customer_name`, `farm_name`, `season_year`, `staged_date`, `notes`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_staged`, `created_at`

**Columns to exclude:** `staged_delivery_item_id`, `customer_id`, `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- This view is pre-filtered to `status = 'in_progress'` staged deliveries only. Converted and cancelled staged deliveries are not included.
- Package type `'bag'` → display "Bag"; `'tote'` → display "Seedpak".
- Use ILIKE for customer/farm name matching: `customer_name ILIKE '%smith%'`.
- Filter by `season_year` explicitly when asking about a specific season.
- **Primary agent tool:** `get_staged_deliveries` uses this view directly with three-step customer name matching. The SQL fallback (`run_approved_readonly_query`) can also query this view for cross-domain or aggregation questions.

---

## Agent Access Rules

1. **Read-only access only.** The agent must never INSERT, UPDATE, or DELETE via tool calls unless a dedicated, reviewed write-tool exists and has explicit permission.

2. **Always filter by `season_year` when the view spans multiple seasons.** (`v_year_end_adjustments`, `v_bayer_year_end_totals`, `v_delivery_customer_order_status`, `v_agent_customer_current_season_orders`) — all four views span multiple seasons and require an explicit `season_year` filter in every query.

3. **Use display names, not UUIDs.** Agent responses should use `customer_name`, `product_name`, `treatment_name` — never raw UUIDs.

4. **Never expose raw auth.uid() or user_id values** in agent responses.

5. **Package type display:** Always render `package_type = 'bag'` as "Bag" and `package_type = 'tote'` as "Seedpak" in user-facing responses. Never say "tote" to users.

6. **Pricing views are global.** `v_pricing_options`, `v_pricing_sheet_wide`, `v_pricing_break_even_wide` do not need user authentication but should only be read within an authenticated session for consistency.

7. **Do not query raw `orders`, `deliveries`, `returns`, `replants`, `bayer_shipment_items`, `staged_deliveries`, or `staged_delivery_items` tables directly.** Use the views above.

8. **SQL fallback approved views** (for `run_approved_readonly_query` tool): `v_agent_customer_orders`, `v_agent_order_fulfillment`, `v_agent_inventory`, `v_agent_customer_deliveries`, `v_agent_customer_returns`, `v_agent_customer_replants`, `v_agent_bayer_shipments`, `v_agent_staged_deliveries`. `v_agent_inventory` includes `units_on_hand` (physical), `units_staged`, and `available_units` (added migration 0027). Note: in SQL queries use the DB column names (`units_on_hand`, `units_staged`); the `get_on_hand_inventory` tool renames these to `physical_units_on_hand` and `staged_units` in its output to avoid LLM confusion. `v_agent_staged_deliveries` lists all in_progress staged deliveries. Adding a new view to the SQL fallback requires updating both the `TOOL_DESCRIPTION` in `run-approved-readonly-query.ts` and the `APPROVED_VIEWS` set in `validate-approved-query.ts`.
