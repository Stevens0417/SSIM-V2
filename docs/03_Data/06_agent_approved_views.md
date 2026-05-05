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
- "Show me all products where units_on_hand is negative."
- "What is the current inventory for soybean products?"
- "How many Seedpak units of [product] do we have?"

**Allowed filters:** `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_on_hand`

**Columns safe for agent:** `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_received`, `units_delivered`, `units_returned`, `units_on_hand`

**Columns to exclude:** `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- Use `package_type = 'bag'` for Bags and `package_type = 'tote'` for Seedpaks in filter values. Display as "Bag" / "Seedpak" in responses.
- A negative `units_on_hand` is valid — it means more has been delivered than received, which may indicate a recording gap.
- This view has separate rows for Bag and Seedpak — if you want a combined total, sum across package_type.

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
- This view aggregates Bag and Seedpak together into a single total. Do not use it for package-type-specific questions — use `v_on_hand_inventory` instead.
- NULL values in treatment columns mean no inventory for that combination (not zero).
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

**Allowed filters:** `customer_name`, `season_year`, `product_name`, `treatment_name`, `is_complete`

**Columns safe for agent:** `season_year`, `customer_name`, `order_date`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `ordered_units`, `delivered_units`, `returned_units`, `replanted_units`, `net_units`, `is_complete`

**Columns to exclude:** `order_id`, `order_item_id`, `customer_id`, `product_id`, `treatment_id` (internal UUIDs)

**Notes:**
- `net_units > 0` means outstanding delivery still needed.
- `net_units <= 0` means `is_complete = true` — fully delivered or over-delivered.
- Only linked deliveries/returns/replants (with `order_item_id`) appear here. Unlinked deliveries are not counted.
- Filter by `season_year` explicitly — this view covers all seasons.

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

## Agent Access Rules

1. **Read-only access only.** The agent must never INSERT, UPDATE, or DELETE via tool calls unless a dedicated, reviewed write-tool exists and has explicit permission.

2. **Always filter by `season_year` when the view spans multiple seasons.** (`v_year_end_adjustments`, `v_bayer_year_end_totals`, `v_delivery_customer_order_status`)

3. **Use display names, not UUIDs.** Agent responses should use `customer_name`, `product_name`, `treatment_name` — never raw UUIDs.

4. **Never expose raw auth.uid() or user_id values** in agent responses.

5. **Package type display:** Always render `package_type = 'bag'` as "Bag" and `package_type = 'tote'` as "Seedpak" in user-facing responses. Never say "tote" to users.

6. **Pricing views are global.** `v_pricing_options`, `v_pricing_sheet_wide`, `v_pricing_break_even_wide` do not need user authentication but should only be read within an authenticated session for consistency.

7. **Do not query raw `orders`, `deliveries`, `returns`, `replants`, or `bayer_shipment_items` tables directly.** Use the views above.
