# Agent — SQL Fallback Model

Documents the `run_approved_readonly_query` tool: when to use it, how the security model works, and what the agent is expected to do when it uses it.

---

## Purpose

The SQL fallback is a safety valve for business questions that fall outside the coverage of the four prebuilt tools. It lets the agent query a fixed set of approved, user-scoped views rather than inventing an answer or refusing to help.

---

## Tool selection — priority order

The agent always follows this hierarchy:

1. **Prebuilt tool first.** `get_on_hand_inventory`, `get_customer_current_season_orders`, `get_customer_order_fulfillment_status`, `get_staged_deliveries`. If any of them covers the question, it is called — not the SQL fallback.
2. **SQL fallback if no prebuilt tool fits.** `run_approved_readonly_query` is used only when the specific question is genuinely outside the prebuilt tools' scope.
3. **Failure means failure — never guess.** If a tool returns `tool_error: true` or `approved: false`, the agent reports the failure. It does not construct an answer from prior chat messages or training data.
4. **Chat history is context, not a data source.** Even if a prior message seems to contain the answer, the agent calls the appropriate tool.

---

## Approved views

| View | Purpose |
|---|---|
| `v_agent_customer_orders` | Order line items with pricing and profit |
| `v_agent_order_fulfillment` | Delivery fulfillment status per order line |
| `v_agent_inventory` | On-hand + staged + available inventory |
| `v_agent_customer_deliveries` | Delivery history per customer |
| `v_agent_customer_returns` | Return history per customer |
| `v_agent_customer_replants` | Replant history per customer |
| `v_agent_bayer_shipments` | Bayer shipment detail |
| `v_agent_staged_deliveries` | In-progress staged deliveries |

All views are user-scoped (`auth.uid()` enforced at the view level). The RPC executes as SECURITY INVOKER so the calling user's JWT is preserved.

Adding a new view requires updating both:
- `TOOL_DESCRIPTION` constant in `src/lib/agent/tools/run-approved-readonly-query.ts`
- `APPROVED_VIEWS` set in `src/lib/agent/sql/validate-approved-query.ts`

---

## Security model

### Layer 1 — TypeScript validator (`validate-approved-query.ts`)

Every query is checked before execution:

- Must begin with `SELECT` or `WITH`
- Every `FROM`/`JOIN` target must be an approved view or a declared CTE name
- Forbidden keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXECUTE`, `PG_SLEEP`, `DBLINK`, `PG_READ_FILE`, etc.) cause immediate rejection
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

All executions — including rejections — are logged to `agent_tool_calls`:

| Column | Value |
|---|---|
| `tool_name` | `"run_approved_readonly_query"` |
| `input_json` | `{ sql, reasoning }` |
| `output_json` | Full tool output |
| `status` | `"success"` / `"rejected"` / `"error"` |
| `error_message` | Validation reason or DB error message |

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

| Question | Why SQL fallback (not prebuilt tool) |
|---|---|
| "Which customers ordered but got no deliveries?" | Requires joining orders + fulfillment views |
| "What did Bayer ship for DKC 094-94?" | No prebuilt tool covers Bayer shipments |
| "How many units were returned this season?" | No prebuilt tool covers returns |
| "Show deliveries made in April 2026." | Date-range filter on deliveries view |
| "Which products have the most replants?" | No prebuilt tool covers replants |
| "Which products are fully staged with zero available?" | Cross-column condition on inventory view |

---

## File locations

| File | Purpose |
|---|---|
| `src/lib/agent/tools/run-approved-readonly-query.ts` | Tool factory and TOOL_DESCRIPTION (approved view list) |
| `src/lib/agent/sql/validate-approved-query.ts` | TypeScript security validator |
| `src/app/api/agent/chat/route.ts` | Tool registration and SYSTEM_PROMPT |
