# Agent Tool Set

All tools query approved views only (never raw tables). All tools are user-scoped. Tool calls are logged to `agent_tool_calls`.

---

## Implemented

### get_on_hand_inventory ✅

**View:** `v_on_hand_inventory`
**File:** `src/lib/agent/tools/get-on-hand-inventory.ts`
**Status:** Live

**Use cases:**
- "How much inventory do I have?"
- "What do I have left for DKC 094-94?"
- "How many Seedpaks do I have?"
- "Do I have any PONCHO treated seed left?"

**Inputs (all optional):** `productName`, `treatmentName`, `packageType` (Bag/Seedpak), `seedSize`, `minUnitsOnHand`

**Output:** `rows[]`, `total_units_on_hand`, `row_count`, optional `truncated`

**Security:** View uses `auth.uid()` in WHERE clauses; queried via user-session client.

---

### get_customer_current_season_orders ✅

**View:** `v_agent_customer_current_season_orders`
**File:** `src/lib/agent/tools/get-customer-current-season-orders.ts`
**Migration:** `0024_v_agent_customer_orders.sql`
**Status:** Live

**Use cases:**
- "Show me the orders for Smith Farms." (farm/business name lookup)
- "What did Adam Stevens order this season?"
- "How many units did [customer or farm] order?"
- "Show me [customer]'s PONCHO order lines."
- "What is the price per unit for [customer]'s order?" (set `includePricing: true`)
- "What is the profit on [customer]'s order?" (set `includeProfit: true`)

**Inputs:** `customerName` (required), `seasonYear`, `productName`, `treatmentName`, `earlyPayOnly`, `includePricing`, `includeProfit`

**Output:** `rows[]`, `total_units_ordered`, `row_count`, `customer_name_matched`, `matched_by`, `matched_customer_count`, `resolved_season_year`, `season_source`, `requested_season_year`, `user_explicitly_requested_season`, optional `truncated`

**Customer matching (three-step):**
1. Exact case-insensitive match on `customer_name` — most specific
2. Exact case-insensitive match on `farm_name` — returns all customers under that farm/business
3. Partial match on `customer_name` OR `farm_name` — broadest fallback

`matched_by` reports which strategy succeeded (`"customer_name"`, `"farm_name"`, or `"partial"`). `matched_customer_count` is the number of distinct customers in the result. `customer_name_matched` lists all unique customer names.

**Pricing/profit:** Always queried from the view but only surfaced in the response when `includePricing` / `includeProfit` is true.

**Season resolution:** Uses `resolveDefaultSeasonForUser()` from `resolve-season.ts`. Priority: (1) explicit `seasonYear` input → source `"explicit"`, (2) latest `season_year` in user's `orders` table → source `"latest_user_data"`, (3) latest from `v_pricing_seasons` → source `"active_season"`, (4) null → source `"none"`. The model must not guess a year — always use `resolved_season_year` from the output.

**Security:** View uses `auth.uid()` on both orders and order_items joins; queried via user-session client. Season year is always required in the query.

**Follow-up options the assistant should offer:**
- Price per unit / invoice totals (`includePricing: true`)
- Profit per line / total profit (`includeProfit: true`)
- Early-pay breakdown (`earlyPayOnly: true`)
- Remaining units to deliver (`get_customer_order_fulfillment_status`)

---

### get_customer_order_fulfillment_status ✅

**View:** `v_delivery_customer_order_status`
**File:** `src/lib/agent/tools/get-customer-order-fulfillment-status.ts`
**Status:** Live

**Use cases:**
- "What is the delivery status for [customer]?"
- "How many units have been delivered to [customer]?"
- "What is still outstanding for [customer]?"
- "Is [customer]'s order complete?"
- "Show me open balances for [customer]."

**Inputs:** `customerName` (required), `seasonYear`, `productName`, `treatmentName`, `packageType`, `seedSize`, `openOnly`

**Output:** `rows[]`, `total_units_ordered`, `total_units_delivered`, `total_units_remaining`, `row_count`, `customer_name_matched`, `matched_by`, `matched_customer_count`, `matched_customers[]`, `resolved_season_year`, `season_source`, `requested_season_year`, `user_explicitly_requested_season`, optional `truncated`

**Season resolution:** Same two-layer defense as `get_customer_current_season_orders` — see Season resolution section below.

**Fulfillment status values:**
- `"open"` — 0 delivered, remaining > 0 (not started)
- `"partial"` — some delivered, remaining > 0 (in progress)
- `"complete"` — remaining = 0 (fully delivered)
- `"overdelivered"` — remaining < 0 (more delivered than ordered)

**`units_remaining`** — can be negative for overdelivered lines (not clamped to 0). Mirrors view formula: `ordered - delivered - replanted + returned`.

**`matched_customers`** — array of `{customer_id, customer_name, farm_name}` for every distinct customer in the result. Allows the assistant to name which customers were included when a farm name matched multiple contacts.

**`matched_by`** — `"customer_name"` | `"farm_name"` | `"both"` | `"none"`. `"both"` = partial match across both fields (broadest fallback). `"none"` = no results found.

**Aggregation:** View is at order_item grain. Tool aggregates to customer+product+treatment+seed_size+package_type grain in TypeScript. `openOnly` filter is applied after aggregation (not at query level) so partial-completion scenarios are handled correctly.

**Sort:** open → partial → complete → overdelivered, then by customer_name, then by product_name.

**Customer matching (three-step):** exact `customer_name` → exact `farm_name` → partial OR both fields. `farm_name` is included in each `FulfillmentRow` and carried through aggregation.

**Migration:** `0025_v_customer_order_status_add_farm_name.sql` adds `farm_name` to `v_delivery_customer_order_status`.

**Security:** View uses `auth.uid()` in all CTEs; queried via user-session client.

---

## Planned (not yet implemented)

### get_customer_order_status
*(Superseded by `get_customer_order_fulfillment_status` above)*

### get_customer_activity_summary
Returns deliveries, returns, and replants summary for a customer.
View candidate: `v_deliveries_this_season`, `v_returns_this_season`, `v_replants_this_season`

### get_this_season_deliveries
Returns delivery records for the current season.

### get_this_season_returns
Returns return records for the current season.

---

## Notes

- All tools must use views (not raw tables)
- All tools must filter by `user_id` (via auth.uid() in view or explicit filter)
- Tools should return clean, structured data
- Tool calls are logged to `agent_tool_calls` with input/output JSON and status

## Season resolution

Season-based tools use the shared helpers in `src/lib/agent/tools/resolve-season.ts`.

### Two-layer defense against model-hallucinated years

**Layer 1 — schema description:** `seasonYear` field description explicitly says "Only provide this if the user explicitly stated a specific year in their message." This instructs the model not to fill in a default year.

**Layer 2 — backend validation:** Even if the model provides `seasonYear`, `isYearMentionedByUser(userMessage, year)` checks whether that specific year number appears in the user's raw message text. If not, the model-provided value is discarded and the backend resolves the season independently.

This two-layer approach prevents GPT-4o-mini from hallucinating years from its training data (e.g. providing `seasonYear: 2023` when the user said nothing about a year).

### Resolution priority

1. Model provides `seasonYear` AND user message contains that year → `season_source: "explicit"`
2. Latest `season_year` from user's `orders` table (user-scoped via RLS on `userClient`) → `season_source: "latest_user_data"`
3. Latest `season_year` from `v_pricing_seasons` (global) → `season_source: "active_season"`
4. None found → `season_source: "none"`, `resolved_season_year: null`

**Why orders first:** A user may enter orders for a new season before pricing data is fully configured. Using pricing as the default would return a stale year (e.g. 2023) when 2026 orders already exist.

### Tool output season fields

All season-based tools return:
- `resolved_season_year` — the year actually used for the query (or null)
- `season_source` — how it was resolved
- `requested_season_year` — the raw value the model provided (or null)
- `user_explicitly_requested_season` — whether the user's message contained that year

**Model rule:** The system prompt instructs the model to cite `resolved_season_year` from tool output and never guess or provide a default year.