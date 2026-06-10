# Agent — Prebuilt Tools Reference

Documents the four prebuilt agent tools: when to use them, what they return, and how they relate to the SQL fallback.

---

## Tool selection hierarchy

Every business data question follows this order:

1. **Use a prebuilt tool** if it covers the question.
2. **Use `run_approved_readonly_query`** (SQL fallback) if no prebuilt tool fits.
3. **Explain why it cannot be answered** only if neither option can retrieve the data safely.

The agent must never say "I cannot retrieve this" without first attempting a query.

---

## Prebuilt tool 1 — `get_on_hand_inventory`

**Source view:** `v_on_hand_inventory`

**Use for:**
- "How many units of [product] do I have?"
- "What inventory is available for [treatment]?"
- "How many Bags/Seedpaks do I have?"
- "Which products are fully staged?"
- Any question about current stock levels

**Does NOT cover:** delivery history, returns, replants, Bayer shipments, cross-customer aggregates.

**Key output fields:**
- `total_available_units` — primary answer to "how many do I have?" (physical minus staged)
- `total_physical_units_on_hand` — warehouse count only (`received − delivered − replanted + returned`)
- `total_replanted_units` — seed handed to customers to re-plant failed fields (already subtracted from physical)
- `total_staged_units` — reserved in active staged deliveries
- `rows[]` — one row per (product/treatment/seed_size/package_type); each row carries `seed_size` (null for soybeans), `package_type`, and `replanted_units`

**Row-level display rules (seed_size is required):**
- Every inventory response must include a per-row breakdown after the total headline.
- Each row must show: treatment / seed_size (use "—" when null) / package_type / physical / staged / available. Include replanted units when explaining how physical was derived.
- Rows with different seed sizes must be listed separately — never combined.
- This is operationally required: users need seed_size to create deliveries and make fulfillment decisions for corn products.

**Physical formula:** `physical_units_on_hand = received − delivered − replanted + returned` (replants subtract — the seed left the warehouse). `available_units = physical − staged`. Replanted is distinct from staged: replanted already left the warehouse; staged is still on hand but reserved.

**Aggregation rules by query type:**
1. Product-only question → headline total + breakdown by treatment / seed_size / package_type for every row
2. Product + treatment question → headline total for that treatment + breakdown by seed_size / package_type
3. Product + treatment + seed_size question → single matching row with physical / staged / available

**See also:** [inventory-tool.md](inventory-tool.md) for full response patterns.

---

## Prebuilt tool 2 — `get_customer_current_season_orders`

**Source view:** `v_agent_customer_current_season_orders`

**Use for:**
- "What did [customer/farm] order this season?"
- "Show me [customer]'s order lines."
- "What is [customer]'s total invoice?"
- "What is the profit on [customer]'s order?"
- Questions about order quantities, pricing, discounts, or profit per customer

**Does NOT cover:** fulfillment status, how many units have been delivered, returns, inventory.

**Key output fields:**
- `rows[]` — one row per order line item
- `total_units_ordered`, `total_line_total_after_all_discounts`, `total_profit`
- `weighted_avg_brand_grower_discount_pct`, `weighted_avg_early_pay_discount_pct`
- `matched_customers[]`, `matched_by` — customer resolution metadata

**Tool parameters:**
- `customerName` — required; partial names and farm names accepted
- `seasonYear` — optional; omit to use the current season
- `productName`, `treatmentName`, `earlyPayOnly` — optional filters
- `includePricing: true` — required for price/discount questions
- `includeProfit: true` — required for profit/margin questions

---

## Prebuilt tool 3 — `get_customer_order_fulfillment_status`

**Source view:** `v_delivery_customer_order_status`

**Use for:**
- "What does [customer] still have left to deliver?"
- "What is [customer]'s outstanding balance?"
- "Is [customer]'s order complete?"
- "How many units have been delivered to [customer]?"
- Any question about open/remaining/delivered units per customer

**Does NOT cover:** full delivery history, returns history, inventory levels.

**Key output fields:**
- `rows[]` — one row per (customer/product/treatment/size/pkg) aggregated from order lines
- `fulfillment_status` per row: `"open"` | `"partial"` | `"complete"` | `"overdelivered"`
- `total_units_ordered`, `total_units_delivered`, `total_units_remaining`
- `matched_customers[]`, `matched_by`

**Tool parameters:**
- `customerName` — required; partial names and farm names accepted
- `seasonYear`, `productName`, `treatmentName`, `packageType`, `seedSize` — optional
- `openOnly: true` — show only incomplete lines

---

## Prebuilt tool 4 — `get_staged_deliveries`

**Source view:** `v_agent_staged_deliveries`

**Use for:**
- "What staged deliveries do I have for [customer]?"
- "How many units are staged for [product]?"
- "Which customers have staged deliveries?"
- "What's been prepared but not delivered?"

**Does NOT cover:** cross-customer aggregates/rankings, converted/cancelled staged deliveries.

**Key output fields:**
- `rows[]` — one row per staged delivery line item
- `total_units_staged`
- `matched_customers[]`, `matched_by`

**Tool parameters:**
- `customerName` — optional; omit for all staged deliveries
- `productName`, `treatmentName`, `packageType`, `seedSize`, `seasonYear` — optional

---

## Prebuilt tool 5 — `get_pricing_info`

**Source view:** `v_agent_pricing`

**Use for:**
- "What is the retail price for [product] / [product + treatment]?"
- "What is the break-even price for [product]?"
- "What is the margin / markup on [product] [treatment]?"
- "What treatments are priced for [product]?"
- "Show me pricing for [product] in [year]."
- Any question about retail price, break-even price, margin per unit, or margin percentage

**Does NOT cover:** custom pricing aggregations across all products (e.g. "average margin for all corn products" → SQL fallback), delivery history, inventory, orders.

**Key output fields:**
- `rows[]` — one row per (product, treatment) for the resolved season
- `retail_price_per_unit` — the price charged per unit
- `break_even_price_per_unit` — computed cost floor (corn/soybean formula)
- `margin_per_unit` — retail minus break-even; always present in every row (null for packaging)
- `margin_pct` — margin as percentage of retail; always present in every row (null for packaging)
- `resolved_season_year`, `season_source` — which season was used and how it was resolved

**Margin vs customer profit:**
- `margin_per_unit` is a **pricing-level** concept: retail − break-even. It is the same for every customer.
- Customer **profit** on an actual order is lower because brand grower and early-pay discounts reduce the effective selling price. Use `get_customer_current_season_orders` with `includeProfit: true` for per-customer order profit.

**Tool parameters:**
- `productName` — optional partial name, case-insensitive
- `treatmentName` — optional partial name, case-insensitive
- `seasonYear` — optional; omit unless user explicitly stated a year
- `crop` — optional; `'corn'`, `'soybean'`, or `'packaging'`
- `includeMargins` — hint that the user is asking about margin; margin fields are always returned regardless

**Pricing is GLOBAL** — all users see the same prices. No user-scoping on this view.

---

## When the SQL fallback is needed instead

The main model does NOT write SQL — it passes `question` (natural language) and `reasoning` to the tool. A dedicated SQL reasoning model (`AGENT_SQL_MODEL`) generates the query internally before it is validated and executed.

Use `run_approved_readonly_query` when a prebuilt tool cannot answer:

| Question | Why SQL fallback |
|---|---|
| "Which customers have the most staged units?" | Prebuilt tool returns detail rows, not rankings |
| "Which products have negative available inventory?" | No prebuilt tool surfaces this cross-product view |
| "Which products have I delivered the most of?" | No prebuilt tool covers delivery history aggregates |
| "What did Bayer ship for DKC 094-94?" | No prebuilt tool covers Bayer shipments |
| "How many returns did I have this season?" | No prebuilt tool covers returns |
| "Which customers received product X this season?" | Requires delivery history — not in fulfillment tool |
| "What is our total profit this season?" | Requires aggregating all order lines |
| "Which products have the highest margin?" | Custom ordering across all pricing rows — SQL fallback |
| "What is the average margin for corn this season?" | Aggregation across all products — SQL fallback |

See [06_sql_fallback_model.md](06_sql_fallback_model.md) for full SQL fallback documentation.

---

## Logging

All prebuilt tool calls are logged to `agent_tool_calls` with:
- `tool_name` — tool identifier
- `input_json` — full input parameters
- `output_json` — full tool output (including error fields if any)
- `status` — `"success"` | `"error"` | `"not_found"` depending on tool

---

## File locations

| File | Purpose |
|---|---|
| `src/lib/agent/tools/get-on-hand-inventory.ts` | Inventory tool factory |
| `src/lib/agent/tools/get-customer-current-season-orders.ts` | Orders tool factory |
| `src/lib/agent/tools/get-customer-order-fulfillment-status.ts` | Fulfillment tool factory |
| `src/lib/agent/tools/get-staged-deliveries.ts` | Staged deliveries tool factory |
| `src/lib/agent/tools/get-pricing-info.ts` | Pricing tool factory |
| `src/lib/agent/tools/index.ts` | Tool exports |
| `src/app/api/agent/chat/route.ts` | Tool registration and system prompt |
