# Agent — Overview

High-level architecture of the SSIM AI assistant: models, tools, security model, and data flow.

---

## Purpose

The SSIM assistant answers business questions about seed inventory and sales, and can create delivery, replant, and return records — all on behalf of the authenticated user. It never accesses data outside the user's own records (enforced at the database level via RLS).

---

## Two-model architecture

The agent uses two separate language models to separate concerns:

| Role | Model | Env var | Default | Responsibility |
|---|---|---|---|---|
| Main model | `AGENT_MAIN_MODEL` | `gpt-4o-mini` | Yes | Conversation, tool selection, composing replies, draft workflows |
| SQL model | `AGENT_SQL_MODEL` | `gpt-4o` | Yes | Generating safe SQL queries inside `run_approved_readonly_query` |

**Main model** handles everything the user sees: understanding the question, picking the right tool, interpreting results, and forming a reply. It does not write SQL.

**SQL model** is invoked only when the `run_approved_readonly_query` tool is called. It receives the full approved-view schema and query rules, and produces a structured plan `{ sql, reason, expected_result, method_summary }`. The generated SQL passes through a TypeScript validator before execution — the SQL model cannot bypass the security layer.

Model identifiers are sourced from environment variables (`AGENT_MAIN_MODEL`, `AGENT_SQL_MODEL`) so they can be updated without code changes. Both default safely if the env vars are absent.

---

## Tool categories

### Prebuilt data tools (always try these first)
1. `get_on_hand_inventory` — current stock levels per product/treatment/seed_size/package_type
2. `get_customer_current_season_orders` — order lines with pricing and profit per customer
3. `get_customer_order_fulfillment_status` — units ordered vs delivered vs remaining per customer
4. `get_staged_deliveries` — in-progress staged deliveries
5. `get_pricing_info` — retail price, break-even, and margin per product/treatment

### SQL fallback
6. `run_approved_readonly_query` — natural-language question routed to the SQL model, which generates a SELECT against 9 approved views; all queries validated before execution

### Draft creation tools (two-step: draft → confirm → save)
7. `draft_delivery_from_chat` / `save_confirmed_delivery` / `get_delivery_print_link`
8. `draft_replant_from_chat` / `save_confirmed_replant` / `get_replant_print_link`
9. `draft_return_from_chat` / `save_confirmed_return` / `get_return_print_link`

---

## Tool selection hierarchy

Every business data question follows this order:

1. **Prebuilt tool** — if it covers the question, call it.
2. **SQL fallback** — if no prebuilt tool fits, `run_approved_readonly_query` must be attempted. The agent never says "I cannot retrieve this" without first trying a query.
3. **Explain the limitation** — only if neither option can retrieve the data safely.

---

## Security model

| Layer | Mechanism |
|---|---|
| Authentication | Supabase session cookie; unauthenticated requests rejected at route level |
| View-level RLS | All user-scoped views filter by `auth.uid()` — no cross-user data leakage |
| TypeScript validator | Every SQL query validated before execution: SELECT-only, approved views only, LIMIT ≤ 100, no forbidden keywords |
| SECURITY INVOKER RPC | `execute_agent_readonly_query` runs as the calling user so `auth.uid()` resolves correctly |
| SQL model isolation | SQL model generates proposals only — it never executes queries directly |
| No frontend exposure | Model names, API keys, and service role key never sent to the client |

---

## Data flow for a SQL fallback query

```
User message
  → Main model selects run_approved_readonly_query
      → Tool execute() called with { question, reasoning }
          → SQL model (AGENT_SQL_MODEL) generates { sql, reason, expected_result, method_summary }
              → validateApprovedQuery(sql) — TypeScript security gate
                  → execute_agent_readonly_query RPC (SECURITY INVOKER)
                      → approved views (auth.uid() scoped)
          → result rows returned to main model
  → Main model composes reply using rows + method_summary
```

---

## Pending draft injection

When a draft (delivery, replant, or return) has been validated but not yet confirmed, its `draft_id` is injected into the main model's system prompt at request time. This allows the model to call the save tool directly on the user's next confirmation without re-running the draft tool.

---

## Logging

All tool calls are logged to `agent_tool_calls`:
- `tool_name` — which tool was called
- `input_json` — full input parameters (SQL fallback includes `generated_sql`)
- `output_json` — full tool output (SQL fallback includes `model_used`)
- `status` — `"success"` | `"error"` | `"rejected"` | `"validation_pass"` (drafts)
- `error_message` — populated on error or rejection

---

## File locations

| File | Purpose |
|---|---|
| `src/lib/agent/model-config.ts` | `AGENT_MAIN_MODEL` and `AGENT_SQL_MODEL` env var defaults |
| `src/app/api/agent/chat/route.ts` | POST handler, SYSTEM_PROMPT, tool registration, generateText call |
| `src/lib/agent/tools/` | All tool factories (one file per tool) |
| `src/lib/agent/tools/run-approved-readonly-query.ts` | SQL fallback: SQL model call, validator, executor |
| `src/lib/agent/sql/validate-approved-query.ts` | TypeScript SQL security validator |

See also:
- [03_initial_tools.md](03_initial_tools.md) — prebuilt tool reference
- [06_sql_fallback_model.md](06_sql_fallback_model.md) — SQL fallback deep dive
