# Agent — SQL Fallback Model

Documents the `run_approved_readonly_query` tool: when to use it, how the two-model routing works, how the security model works, and what the agent is expected to do when it uses it.

---

## Purpose

The SQL fallback is a safety valve for business questions that fall outside the coverage of the prebuilt tools. It lets the agent query a fixed set of approved, user-scoped views rather than inventing an answer or refusing to help.

---

## Two-model routing

SQL generation is delegated to a dedicated reasoning model so the main orchestration model does not write SQL directly.

| Role | Model | Env var | Task |
|---|---|---|---|
| Main model | `AGENT_MAIN_MODEL` (default `gpt-4o-mini`) | Yes | Orchestration, tool selection, composing replies |
| SQL model | `AGENT_SQL_MODEL` (default `gpt-4o`) | Yes | Generating safe SQL inside `run_approved_readonly_query` |

When the main model selects `run_approved_readonly_query`, it passes a natural-language `question` and `reasoning` — it does NOT write SQL. Inside the tool's `execute` function, the SQL model receives the full approved-view schema and query rules, and produces a structured plan: `{ sql, reason, expected_result, method_summary }`. The generated SQL then passes through the TypeScript validator before execution — the SQL model has no path to bypass the security layer.

`model_used` is recorded in the `output_json` column of `agent_tool_calls` for every SQL fallback call.

---

## Tool selection — priority order

The agent always follows this hierarchy:

1. **Prebuilt tool first.** `get_on_hand_inventory`, `get_customer_current_season_orders`, `get_customer_order_fulfillment_status`, `get_staged_deliveries`, `get_pricing_info`. If any of them covers the question, it is called — not the SQL fallback.
2. **SQL fallback if no prebuilt tool fits.** `run_approved_readonly_query` MUST be attempted for any business data question not covered by a prebuilt tool. The agent must not say "I cannot retrieve this" without first trying a query.
3. **Rejection retry.** If the tool returns `approved: false` with a fixable issue, the agent retries once with a clarified question. If the rejection is due to an inherently unsafe request (write operation), the agent stops and explains.
4. **SQL model error.** If `sql_generation_error: true`, the agent reports that it could not generate a query and asks the user to rephrase.
5. **Failure means failure — never guess.** If a tool returns `tool_error: true` after a valid attempt, the agent reports the failure. It does not construct an answer from prior chat messages or training data.
6. **Chat history is context, not a data source.** Even if a prior message seems to contain the answer, the agent calls the appropriate tool.

---

## Approved views

| View | Key columns | Purpose |
|---|---|---|
| `v_agent_inventory` | product_name, treatment_name, seed_size, package_type, units_on_hand, units_staged, available_units | On-hand + staged + available inventory |
| `v_agent_staged_deliveries` | customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_staged, staged_date, season_year | In-progress staged deliveries |
| `v_agent_customer_orders` | customer_name, product_name, treatment_name, units_ordered, retail_price_per_unit, line_total_after_all_discounts, profit_per_unit, line_total_profit, season_year | Order line items with pricing and profit |
| `v_agent_order_fulfillment` | customer_name, product_name, treatment_name, ordered_units, delivered_units, net_units, is_complete, season_year | Delivery fulfillment status per order line |
| `v_agent_customer_deliveries` | customer_name, product_name, treatment_name, seed_size, package_type, units_delivered, delivery_date, season_year | Delivery history per customer |
| `v_agent_customer_returns` | customer_name, product_name, treatment_name, seed_size, package_type, units_returned, return_date, season_year | Return history per customer |
| `v_agent_customer_replants` | customer_name, product_name, treatment_name, seed_size, package_type, units_replanted, replant_date, season_year | Replant history per customer |
| `v_agent_bayer_shipments` | product_name, treatment_name, seed_size, package_type, units_received, shipment_date, season_year, is_verified | Bayer shipment detail |
| `v_agent_pricing` | product_name, treatment_name, crop, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct, season_year | Retail price, break-even, and margin per product/treatment (**GLOBAL** — not user-scoped) |

All views except `v_agent_pricing` are user-scoped (`auth.uid()` enforced at the view level). `v_agent_pricing` is global — pricing is the same for every authenticated user. The RPC executes as SECURITY INVOKER so the calling user's JWT is preserved.

Adding a new view requires updating both:
- `TOOL_DESCRIPTION` constant in `src/lib/agent/tools/run-approved-readonly-query.ts`
- `APPROVED_VIEWS` set in `src/lib/agent/sql/validate-approved-query.ts`

---

## Security model

### Layer 1 — TypeScript validator (`validate-approved-query.ts`)

Every query is checked before execution:

- Must begin with `SELECT` or `WITH`
- Every `FROM`/`JOIN` target must be an approved view or a declared CTE name
- Forbidden keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXECUTE`, `CALL`, `PG_SLEEP`, `DBLINK`, `PG_READ_FILE`, etc.) cause immediate rejection
- `LIMIT` clause required; max value is 100
- String literals are stripped before keyword scanning to prevent false positives (e.g. a customer named "DROP" won't trigger the guard)

Rejected queries return `approved: false` with a `reason_rejected` field. They are logged to `agent_tool_calls` with `status: "rejected"`.

### Layer 2 — Supabase RPC (`execute_agent_readonly_query`)

Executes as SECURITY INVOKER — `auth.uid()` resolves to the calling user's session. Views apply their own `auth.uid()` WHERE clauses, so a user can only see their own data even if they somehow craft a query against another user's rows (the view filters it out).

### Layer 3 — Structured error returns

The tool never `throw`s. Execution errors return `tool_error: true` with a message. This gives the model a clean signal rather than an exception that might cause it to hallucinate a fallback answer.

---

## Query rules (enforced)

| Rule | Detail |
|---|---|
| SELECT only | No writes permitted |
| Approved views only | Any other table/view name causes rejection |
| LIMIT required | Maximum 100 rows |
| CTE support | `WITH ... AS (...)` CTEs are parsed and allowed as FROM targets |
| String safety | String literals are stripped before keyword scanning |

---

## Logging

All executions — including rejections and SQL model errors — are logged to `agent_tool_calls`:

| Column | Value |
|---|---|
| `tool_name` | `"run_approved_readonly_query"` |
| `input_json` | `{ question, reasoning, generated_sql }` — `generated_sql` populated after SQL model step |
| `output_json` | Full tool output plus `model_used` (the SQL model identifier) |
| `status` | `"success"` / `"rejected"` / `"error"` |
| `error_message` | Validation reason, SQL model error, or DB error message |

---

## Agent "show method" requirement

When the SQL fallback is used, the agent's response must include a one-sentence explanation of how the answer was obtained. This makes the agent transparent about its data source and helps users trust the output.

Examples:
- "I checked the approved deliveries view and filtered to April 2026."
- "I queried the approved inventory view for products where available units are zero or negative."
- "I joined the orders and fulfillment views to find customers with orders but no deliveries yet."

The method note appears after the data summary, not before it.

---

## Example use cases

| Question | Approved view | Example SQL |
|---|---|---|
| "Which customers have the most staged units?" | `v_agent_staged_deliveries` | `SELECT customer_name, SUM(units_staged) AS total FROM v_agent_staged_deliveries GROUP BY customer_name ORDER BY total DESC LIMIT 20` |
| "Which products have negative available inventory?" | `v_agent_inventory` | `SELECT product_name, treatment_name, available_units FROM v_agent_inventory WHERE available_units < 0 ORDER BY available_units LIMIT 50` |
| "Which products have I delivered the most of?" | `v_agent_customer_deliveries` | `SELECT product_name, SUM(units_delivered) AS total FROM v_agent_customer_deliveries WHERE season_year = 2026 GROUP BY product_name ORDER BY total DESC LIMIT 20` |
| "Customers with orders but no deliveries?" | `v_agent_order_fulfillment` | `SELECT DISTINCT customer_name FROM v_agent_order_fulfillment WHERE season_year = 2026 AND delivered_units = 0 LIMIT 50` |
| "What did Bayer ship for DKC 094-94?" | `v_agent_bayer_shipments` | `SELECT shipment_date, product_name, treatment_name, seed_size, package_type, units_received FROM v_agent_bayer_shipments WHERE product_name ILIKE '%094-94%' ORDER BY shipment_date LIMIT 50` |
| "How many units were returned this season?" | `v_agent_customer_returns` | `SELECT SUM(units_returned) AS total FROM v_agent_customer_returns WHERE season_year = 2026 LIMIT 1` |
| "Show deliveries made in April 2026." | `v_agent_customer_deliveries` | `SELECT customer_name, product_name, units_delivered, delivery_date FROM v_agent_customer_deliveries WHERE delivery_date BETWEEN '2026-04-01' AND '2026-04-30' ORDER BY delivery_date LIMIT 100` |
| "Which products have the most replants?" | `v_agent_customer_replants` | `SELECT product_name, SUM(units_replanted) AS total FROM v_agent_customer_replants GROUP BY product_name ORDER BY total DESC LIMIT 20` |
| "Which products are fully staged with zero available?" | `v_agent_inventory` | `SELECT product_name, treatment_name, units_staged, available_units FROM v_agent_inventory WHERE units_staged > 0 AND available_units <= 0 LIMIT 50` |
| "What is the retail price for DKC 103-93 FUNGICIDE?" | `v_agent_pricing` | `SELECT product_name, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct FROM v_agent_pricing WHERE season_year = 2026 AND product_name ILIKE '%103-93%' AND treatment_name ILIKE '%fungicide%' LIMIT 10` |
| "Which products have the highest margin this season?" | `v_agent_pricing` | `SELECT product_name, treatment_name, margin_per_unit, margin_pct FROM v_agent_pricing WHERE season_year = 2026 ORDER BY margin_per_unit DESC LIMIT 20` |
| "Show me all pricing for this season." | `v_agent_pricing` | `SELECT product_name, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct FROM v_agent_pricing WHERE season_year = 2026 ORDER BY product_name, treatment_name LIMIT 100` |

---

## File locations

| File | Purpose |
|---|---|
| `src/lib/agent/model-config.ts` | `AGENT_MAIN_MODEL` and `AGENT_SQL_MODEL` from env vars |
| `src/lib/agent/tools/run-approved-readonly-query.ts` | Tool factory, SQL_MODEL_SYSTEM_PROMPT, and TOOL_DESCRIPTION |
| `src/lib/agent/sql/validate-approved-query.ts` | TypeScript security validator (unchanged) |
| `src/app/api/agent/chat/route.ts` | Tool registration, SYSTEM_PROMPT, uses `AGENT_MAIN_MODEL` |
