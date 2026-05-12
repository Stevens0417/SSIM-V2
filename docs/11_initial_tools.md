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

**Inputs (all optional):** `productName`, `treatmentName`, `packageType` (Bag/Seedpak), `seedSize`

**Note:** `minAvailableUnits` was removed. Filtering by available_units at query level excluded staged-only rows (physical=0, staged>0, available<0) which caused incorrect totals. All rows are always returned.

**Output:** `rows[]`, `total_physical_units_on_hand`, `total_staged_units`, `total_available_units`, `has_staged_inventory`, `has_negative_physical_inventory`, `has_negative_available_inventory`, `negative_available_rows[]`, `row_count`, optional `truncated`

**Multi-row aggregation:**
- A product filter can return multiple rows (different seed sizes, package types, or staged-only combinations that exist in staged deliveries but not in received shipments).
- The `total_*` fields aggregate ALL matching rows including rows where `physical_units_on_hand = 0` and `staged_units > 0`.
- The agent must use `total_available_units` as the headline answer — never an individual row's `available_units` field.
- When `row_count > 1` for a single product, the agent shows the breakdown after the headline total.

**Staged-only rows:**
- `v_on_hand_inventory` includes rows where `physical_units_on_hand = 0` and `staged_units > 0`. These are product/treatment/seed_size combinations that exist in staged deliveries but have no corresponding Bayer shipment receipt.
- These rows have negative `available_units` and MUST contribute to `total_available_units`. They must never be filtered out.
- If `has_staged_inventory: true`, the agent must mention staged units and must NOT say "no units are currently staged."

**Negative inventory handling:**
- `has_negative_available_inventory: true` — available_units is negative for at least one row (staged or delivered more than received). The agent warns about each row in `negative_available_rows`.
- `has_negative_physical_inventory: true` — physical on-hand is negative (deliveries/adjustments exceed received). Separate warning.
- The agent must never say "zero units" or "no inventory" when either negative flag is true.

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
- "What is the weighted average brand grower discount for [customer]?" (set `includePricing: true`)
- "What discounts did [customer] receive?" (set `includePricing: true`)
- "What is the price per unit for [customer]'s order?" (set `includePricing: true`)
- "What is the profit on [customer]'s order?" (set `includeProfit: true`)

**Inputs:** `customerName` (required), `seasonYear`, `productName`, `treatmentName`, `earlyPayOnly`, `includePricing`, `includeProfit`

**Output:** `rows[]`, `total_units_ordered`, `row_count`, `customer_name_matched`, `matched_by`, `matched_customer_count`, `resolved_season_year`, `season_source`, `requested_season_year`, `user_explicitly_requested_season`, optional `truncated`

**Pricing/discount aggregates (when `includePricing: true`):** `weighted_avg_brand_grower_discount_pct`, `weighted_avg_early_pay_discount_pct`, `total_line_total_after_all_discounts` — pre-computed in the tool from row-level data so the model doesn't need to do arithmetic.

**Profit aggregates (when `includeProfit: true`):** `total_profit` (sum of `line_total_profit`), `weighted_avg_profit_per_unit` (sum(units × profit_per_unit) / sum(units)) — pre-computed so the model doesn't need to do arithmetic.

**Weighted average formulas:** All weighted averages use `units_ordered` as the weight. Only rows where the target field is non-null are included. Formula: `sum(units × field) / sum(units)`.

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

### get_staged_deliveries ✅

**View:** `v_agent_staged_deliveries`
**File:** `src/lib/agent/tools/get-staged-deliveries.ts`
**Status:** Live

**Use cases:**
- "What staged deliveries do I have for Scott?"
- "Show me staged deliveries for Scott Glasgow."
- "What deliveries are currently staged?"
- "How many units are staged for DKC 103-93?"
- "Which customers have staged deliveries?"
- "What products are staged but not yet delivered?"

**Inputs (all optional):** `customerName`, `productName`, `treatmentName`, `packageType` (Bag/Seedpak), `seedSize`, `seasonYear`

**Output:** `resolved_season_year`, `season_source`, `rows[]`, `total_units_staged`, `staged_delivery_count` (unique staged_delivery_ids), `row_count`, `matched_customers[]`, `matched_by`

**Row fields:** `staged_delivery_id`, `staged_delivery_item_id`, `staged_date`, `customer_name`, `farm_name`, `product_name`, `treatment_name`, `seed_size`, `package_type` (Bag/Seedpak), `units_staged`, `notes`, `status` (always "in_progress")

**View pre-filter:** `v_agent_staged_deliveries` is pre-filtered to `status = 'in_progress'`. Converted and cancelled staged deliveries are not returned.

**Customer matching (three-step):** Same pattern as fulfillment tool — exact `customer_name` → exact `farm_name` → partial match on either field. `customerName` is optional; omit it to return all staged deliveries for the season.

**Season resolution:** Same two-layer defense as other seasonal tools. Season year is used to filter — staged deliveries are tagged with `season_year` from when they were created.

**`matched_customers`:** Array of `{customer_name, farm_name}` for every distinct customer in the result.

**`matched_by`:** `"customer_name"` | `"farm_name"` | `"both"` | `"none"` | `""` (empty when no customerName filter was applied).

**Security:** View uses `auth.uid()` (inherited from `v_staged_deliveries`); queried via user-session client.

---

### draft_delivery_from_chat ✅

**Views:** `customers` table (user-scoped), `v_pricing_options` (global), `v_on_hand_inventory` (user-scoped)
**File:** `src/lib/agent/tools/draft-delivery-from-chat.ts`
**Status:** Live (Phase 1 — validates and builds draft, does NOT save)

**Use cases:**
- "I delivered 5 units of DKC 103-93 FUNGICIDE to Scott Glasgow today"
- "Record a delivery for John Smith: DKC 94-94 PONCHO, 10 units, Bag"
- "Enter a delivery — customer Adam Stevens, DKC 100-01 FUNGICIDE 3 units AR size, yesterday"
- "Log multi-line delivery: [product/treatment/units] and [product/treatment/units] for [customer]"

**Inputs:**
- `customerName` (required) — customer or farm name, partial OK
- `deliveryDate` (required) — pass exactly what the user said: "today", "yesterday", "tomorrow", or a YYYY-MM-DD string. Never convert relative words to ISO; the backend resolves them.
- `items` (required) — array of `{productName, treatmentName, units, seedSize?, packageType?}`
- `seasonYear` (optional) — only if user explicitly stated a year
- `notes` (optional)

**Output:** `customer` (CustomerDraft), `delivery_date` (DateDraft), `season_year` (SeasonDraft), `items[]` (ResolvedItem), `missing_fields[]`, `warnings[]`, `ready_for_confirmation`

**Draft sub-objects:**
- `CustomerDraft`: `{status: "resolved"|"ambiguous"|"missing", resolved_customer_id, resolved_customer_name, farm_name, candidates?[]}`
- `DateDraft`: `{resolved_date: string, date_source: "explicit"|"today_default", user_explicitly_requested_date: boolean, status: "resolved"}`
- `ResolvedItem.product`: `{status: "resolved"|"ambiguous"|"missing", resolved_product_id, resolved_product_name, options?[]}`
- `ResolvedItem.treatment`: `{status: "resolved"|"ambiguous"|"missing", resolved_treatment_id, resolved_treatment_name, options?[]}`
- `ResolvedItem.seed_size`: `{status: "resolved"|"missing"|"not_required"|"ambiguous", resolved_seed_size, options[]}`
- `ResolvedItem.package_type`: defaults to "Bag" when not specified
- `ResolvedItem.units_delivered`: `{status: "resolved"|"missing"|"invalid", resolved_units}`
- `ResolvedItem.warnings[]` — inventory availability warnings per line

**Resolution logic:**
- Customer: three-step matching (exact customer_name → exact farm_name → partial OR both)
- Product: ILIKE filter against current season's `v_pricing_options` rows
- Treatment: ILIKE filter on product's pricing rows; returns available treatments on miss
- Seed size: only required for corn (`crop = 'corn'`). Options fetched from `v_on_hand_inventory` by product_id + treatment_id.
- Package type: defaults to Bag when not specified by user
- Units: must be a positive whole number

**Date resolution:** Uses `resolveAgentDate()` from `resolve-date.ts`. Two-layer hallucination defense:
1. If the user's raw message contains no date reference, always use server today — ignores whatever value the model passed.
2. If the user mentioned a date, interprets the model's `deliveryDate` using real server time ("today" → `new Date()`, not training-data date).
`date_source: "today_default"` indicates the date was not user-specified; `"explicit"` indicates the user stated it.

**Inventory availability check:** After all fields resolve, queries `v_on_hand_inventory` by exact (product_id, treatment_id, seed_size, package_type) key to check available_units. Adds a warning per line if the delivery would exceed available inventory.

**ready_for_confirmation:** `true` when `missing_fields` is empty. The agent should present the full summary and ask for confirmation. After user confirms, the agent informs them that saving is not yet available.

**draft_id:** When `ready_for_confirmation: true`, the output includes `draft_id` — the UUID of the `agent_tool_calls` row that logged this call. The model passes this to `save_confirmed_delivery`. The stored `output_json` in `agent_tool_calls` does not include `draft_id` itself (it is set after logging to avoid a self-referential circular dependency).

**Season resolution:** Same two-layer defense as other tools — explicit year from user message, or `resolveDefaultSeasonForUser()` fallback.

**Logging:** Tool calls logged to `agent_tool_calls` with status `"validation_pass"`, `"validation_fail"`, or `"error"`. `logCall` returns the inserted row UUID which is used as `draft_id`.

**Security:** Customer and inventory queries use user-session client (auth.uid() in views). Pricing query uses service client (global view, no user scope needed).

---

### save_confirmed_delivery ✅

**Tables:** `deliveries` (insert), `agent_tool_calls` (read draft), `orders` + `v_delivery_customer_order_status` (order matching)
**File:** `src/lib/agent/tools/save-confirmed-delivery.ts`
**Status:** Live (Phase 2)

**Use cases:**
- User says "yes", "confirm", "save it", "looks good", or similar after reviewing a complete delivery draft
- Called only after `draft_delivery_from_chat` returned `ready_for_confirmation: true` and the user explicitly confirmed

**Inputs:**
- `draft_id` (required) — UUID from `draft_delivery_from_chat` output when `ready_for_confirmation` was true
- `confirmation_text` (required) — exact text from the user's confirmation message

**Output:** `{ success, delivery_ids[], lines_saved, unmatched_lines, not_confirmed?, tool_error?, tool_error_message? }`

**Confirmation guard (double-checked):**
Two independent checks must both agree before saving:
1. `confirmation_text` contains a CONFIRM_PATTERN match (yes, confirm, save it, looks good, correct, go ahead, do it, yep, yup)
2. OR `userMessage` (the raw user message passed at tool construction time) contains a CONFIRM_PATTERN match

If neither matches → returns `{ success: false, not_confirmed: true }` without writing anything. Logged as status `"not_confirmed"`.

**Draft lookup:**
Queries `agent_tool_calls` by `id = draft_id` AND `tool_name = 'draft_delivery_from_chat'` via `userClient`. RLS (`user_id = auth.uid()`) enforces ownership — a user cannot look up another user's draft.

**Re-validation of the draft:**
- Checks `output_json.ready_for_confirmation === true`
- Checks all required header fields present: `customer.resolved_customer_id`, `delivery_date.resolved_date`, `season_year.resolved_season_year`
- Checks all items have resolved `product_id`, `treatment_id`, `units`
- Returns `tool_error` if any check fails

**Order matching:**
Server-side port of `findOrderLineMatches` from `orderMatching.service.ts`. Identical logic, but accepts a `SupabaseClient` parameter instead of calling `getSupabaseBrowserClient()`. Priority: early-pay lines first → oldest `order_date` → earliest `created_at` → stable `order_id` tiebreak. Shared `openUnits` map prevents over-allocation across multiple delivery lines in the same request.

**Delivery rows:**
- One row per matched order allocation (linked: `order_id` + `order_item_id` set)
- One unlinked row for any units not covered by open order lines (`order_id: null`, `order_item_id: null`)
- All rows inserted in a single `.insert(rows)` call — atomic at the Postgres statement level
- `user_id` is set by the `trg_deliveries_set_user_id` trigger (`set_child_user_id()`) — not passed explicitly
- RLS policy `deliveries_insert_own` checks `user_id = auth.uid()` — satisfied by the trigger

**Notes:** Read from `input_json.notes` of the draft tool-call row. Applied to all delivery rows for this request.

**No duplicate guard:** The tool does not detect duplicate saves. The user is responsible for reviewing the summary before confirming.

**Logging:** Logged to `agent_tool_calls` with status `"success"`, `"not_confirmed"`, or `"error"`.

**Security:** Draft lookup and order matching use user-session client (RLS). Insert uses user-session client (trigger + RLS). Logging uses service client.

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