import { tool, jsonSchema, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateApprovedQuery } from "../sql/validate-approved-query";
import { AGENT_SQL_MODEL } from "../model-config";

// Input the main model provides — natural language, no SQL writing required.
interface ToolInput {
  question: string;
  reasoning: string;
}

// Structured output the SQL model produces before the query is executed.
interface SqlPlan {
  sql: string;
  reason: string;
  expected_result: string;
  method_summary: string;
}

interface ToolOutput {
  rows: Record<string, unknown>[];
  row_count: number;
  method_summary?: string;
  // Populated when the query was rejected by the validator
  approved?: boolean;
  reason_rejected?: string;
  // Populated when the SQL model itself could not produce a valid plan
  sql_generation_error?: boolean;
  sql_generation_error_message?: string;
  // Populated when the DB call itself fails
  tool_error?: boolean;
  tool_error_message?: string;
}

// System prompt given to the SQL reasoning model.
// The main model never sees this — it only receives TOOL_DESCRIPTION below.
const SQL_MODEL_SYSTEM_PROMPT = `You are a SQL query generator for Stevens Seeds Inventory Management (SSIM), a seed inventory and sales system. Your only job is to produce a valid, safe SELECT query against the approved views listed below.

## Approved views

v_agent_inventory — on-hand, staged, and available seed inventory (user-scoped)
  Columns: product_name TEXT, treatment_name TEXT, seed_size TEXT (NULL for soybean/packaging), package_type TEXT ('bag'=Bag, 'tote'=Seedpak), units_on_hand INT, units_staged INT, available_units INT
  Notes: units_on_hand = received−delivered+returned; units_staged = reserved in active staged deliveries; available_units = units_on_hand − units_staged

v_agent_staged_deliveries — in-progress staged deliveries only (user-scoped)
  Columns: staged_delivery_id UUID, customer_name TEXT, farm_name TEXT, season_year INT, staged_date DATE, notes TEXT, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_staged INT, created_at TIMESTAMPTZ

v_agent_customer_orders — order line items with pricing and profit (user-scoped)
  Columns: order_item_id UUID, order_id UUID, order_date DATE, season_year INT, customer_name TEXT, farm_name TEXT, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_ordered INT, early_pay BOOLEAN, early_pay_pct NUMERIC, brand_grower_pct NUMERIC, retail_price_per_unit NUMERIC, line_total_after_all_discounts NUMERIC, break_even_price_per_unit NUMERIC, profit_per_unit NUMERIC, line_total_profit NUMERIC

v_agent_order_fulfillment — delivery fulfillment status per order line (user-scoped)
  Columns: season_year INT, customer_name TEXT, farm_name TEXT, order_date DATE, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, ordered_units INT, delivered_units INT, returned_units INT, replanted_units INT, net_units INT, is_complete BOOLEAN

v_agent_customer_deliveries — delivery history (user-scoped)
  Columns: delivery_id UUID, delivery_date DATE, season_year INT, customer_name TEXT, farm_name TEXT, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_delivered INT, order_id UUID, order_item_id UUID, notes TEXT

v_agent_customer_returns — return history (user-scoped)
  Columns: return_id UUID, return_date DATE, season_year INT, customer_name TEXT, farm_name TEXT, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_returned INT, order_id UUID, order_item_id UUID, notes TEXT

v_agent_customer_replants — replant history (user-scoped)
  Columns: replant_id UUID, replant_date DATE, season_year INT, customer_name TEXT, farm_name TEXT, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_replanted INT, order_id UUID, order_item_id UUID, notes TEXT

v_agent_bayer_shipments — Bayer shipment line items (user-scoped)
  Columns: shipment_id UUID, shipment_date DATE, season_year INT, shipment_number TEXT, shipment_item_id UUID, product_name TEXT, treatment_name TEXT, seed_size TEXT, package_type TEXT, units_received INT, is_verified BOOLEAN, verified_at TIMESTAMPTZ

v_agent_pricing — retail pricing, break-even, and margin per product/treatment (GLOBAL — same rows for every user)
  Columns: season_year INT, product_id UUID, product_name TEXT, crop TEXT, chu TEXT, seed_trait TEXT, treatment_id UUID, treatment_name TEXT, retail_price_per_unit NUMERIC, break_even_price_per_unit NUMERIC, margin_per_unit NUMERIC, margin_pct NUMERIC
  Notes: one row per (season_year, product, treatment); margin_per_unit = retail − break_even; margin_pct = margin_per_unit / retail_price_per_unit × 100

## Query rules (ALL must be satisfied)
- SELECT only — no writes of any kind
- LIMIT ≤ 100 required on every query (LIMIT clause is mandatory)
- Only approved views in FROM/JOIN clauses — no system tables, no raw base tables
- CTEs (WITH ... AS (...)) are allowed; CTE names may appear in subsequent FROM/JOIN
- Use ILIKE for case-insensitive name matching: customer_name ILIKE '%smith%'
- Package types in DB: 'bag' (display: Bag) and 'tote' (display: Seedpak)
- season_year is a plain integer column — filter with WHERE season_year = 2026
- Do NOT SELECT * — list only the columns needed to answer the question
- Standard SQL aggregates are allowed: SUM, COUNT, AVG, MIN, MAX, GROUP BY, ORDER BY, HAVING

## Season year guidance
- If the question names a specific year, filter by that year.
- If the question says "this season" or is implicitly current without naming a year, omit the season_year filter (the user's most recent data is what appears).
- Never fabricate a year — only use a year if the question or reasoning contains one.

## Output format
You must return a JSON object with these four fields:
- sql: the complete SELECT query (string)
- reason: one sentence explaining what view(s) and filters are used and why (string)
- expected_result: one sentence describing what the rows will contain (string)
- method_summary: one sentence the assistant can show the user explaining how the answer was obtained (string — written in first person, e.g. "I queried the approved deliveries view filtered by customer name and season.")

## Example outputs

Question: Which customers have the most staged units?
{
  "sql": "SELECT customer_name, SUM(units_staged) AS total_staged FROM v_agent_staged_deliveries GROUP BY customer_name ORDER BY total_staged DESC LIMIT 20",
  "reason": "Aggregate units_staged from v_agent_staged_deliveries grouped by customer.",
  "expected_result": "Customer names with their total staged units, highest first.",
  "method_summary": "I aggregated staged deliveries by customer from the approved staged deliveries view."
}

Question: Which products have negative available inventory?
{
  "sql": "SELECT product_name, treatment_name, seed_size, package_type, available_units FROM v_agent_inventory WHERE available_units < 0 ORDER BY available_units LIMIT 50",
  "reason": "Filter v_agent_inventory where available_units is negative.",
  "expected_result": "Product rows where more has been staged or delivered than physically received.",
  "method_summary": "I queried the approved inventory view for rows where available units are negative."
}

Question: What is our total profit this season?
{
  "sql": "SELECT SUM(line_total_profit) AS total_profit FROM v_agent_customer_orders LIMIT 1",
  "reason": "Sum line_total_profit across all order lines in v_agent_customer_orders for all seasons (no season filter — uses all user data).",
  "expected_result": "A single row with total profit in dollars.",
  "method_summary": "I summed all order line profits from the approved orders view."
}

Question: Which products have the highest margin this season?
{
  "sql": "SELECT product_name, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct FROM v_agent_pricing ORDER BY margin_per_unit DESC NULLS LAST LIMIT 20",
  "reason": "Order v_agent_pricing by margin_per_unit descending for all seasons (pricing is global and not year-filtered unless specified).",
  "expected_result": "Products and treatments ranked by per-unit margin, highest first.",
  "method_summary": "I queried the approved pricing view and sorted by margin per unit descending."
}`;

const TOOL_DESCRIPTION = `Run a read-only SQL query against approved agent views for business questions that prebuilt tools cannot answer.

Use this tool when a prebuilt tool (get_on_hand_inventory, get_customer_current_season_orders, get_customer_order_fulfillment_status, get_staged_deliveries, get_pricing_info) cannot answer the question. Do NOT say the question is unanswerable without first attempting a query.

Available data via this tool:
- Delivery history (all customers, date ranges, product totals)
- Return history (units returned, by customer/product/season)
- Replant history
- Bayer shipment detail
- Cross-customer aggregates and rankings (e.g. who has the most staged units?)
- Custom pricing aggregations not covered by get_pricing_info (e.g. average margin across all corn products)
- Cross-domain analytical questions (e.g. customers with orders but no deliveries)

Examples of questions that need this tool:
- "Which customers have the most staged units?"
- "Which products have negative available inventory?"
- "Which products have I delivered the most of this season?"
- "Which customers have ordered but haven't received any deliveries yet?"
- "What did Bayer ship for DKC 094-94?"
- "How many units were returned across all customers this season?"
- "Show me all deliveries made in April 2026."
- "Which products have had the most replants?"
- "Which customers received [product] this season?"
- "What is our total profit this season?"
- "Which products have the highest margin across all products?"
- "What is the average margin for corn products this season?"

Do NOT use this tool when a prebuilt tool already covers the question.

How to call:
- question: the user's question in natural language (include any year or filter the user stated)
- reasoning: one sentence explaining why no prebuilt tool covers this question`;

export function makeRunApprovedReadonlyQueryTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description: TOOL_DESCRIPTION,
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "The user's business question in natural language. Include any year, customer name, product name, or other filter the user stated.",
        },
        reasoning: {
          type: "string",
          description:
            "One sentence explaining why no prebuilt tool can answer this question.",
        },
      },
      required: ["question", "reasoning"],
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { question, reasoning } = input;

      // Step 1 — SQL model generates a structured query plan.
      let sqlPlan: SqlPlan;
      try {
        const { object } = await generateObject({
          model: openai(AGENT_SQL_MODEL),
          schema: jsonSchema({
            type: "object",
            properties: {
              sql: { type: "string" },
              reason: { type: "string" },
              expected_result: { type: "string" },
              method_summary: { type: "string" },
            },
            required: ["sql", "reason", "expected_result", "method_summary"],
            additionalProperties: false,
          }),
          system: SQL_MODEL_SYSTEM_PROMPT,
          prompt: `Question: ${question}\nReasoning: ${reasoning}`,
        });
        sqlPlan = object as SqlPlan;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "SQL generation failed";
        const errorOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          sql_generation_error: true,
          sql_generation_error_message: message,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "run_approved_readonly_query",
          input_json: { question, reasoning },
          output_json: { ...errorOutput, model_used: AGENT_SQL_MODEL },
          status: "error",
          error_message: `SQL model error: ${message}`,
        });
        return errorOutput;
      }

      const { sql, method_summary } = sqlPlan;

      // Step 2 — TypeScript validator is the primary security gate.
      const validation = validateApprovedQuery(sql);
      if (!validation.valid) {
        const rejectedOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          approved: false,
          reason_rejected: validation.reason,
          method_summary,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "run_approved_readonly_query",
          input_json: { question, reasoning, generated_sql: sql },
          output_json: { ...rejectedOutput, model_used: AGENT_SQL_MODEL },
          status: "rejected",
          error_message: validation.reason,
        });
        return rejectedOutput;
      }

      // Step 3 — Execute via RPC. SECURITY INVOKER ensures auth.uid() resolves
      // to the calling user's JWT so view-level user scoping works.
      let rawResult: unknown;
      try {
        const { data, error } = await userClient.rpc(
          "execute_agent_readonly_query",
          { p_sql: sql }
        );
        if (error) throw new Error(error.message);
        rawResult = data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Query execution failed";
        const errorOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          tool_error: true,
          tool_error_message: message,
          method_summary,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "run_approved_readonly_query",
          input_json: { question, reasoning, generated_sql: sql },
          output_json: { ...errorOutput, model_used: AGENT_SQL_MODEL },
          status: "error",
          error_message: message,
        });
        // Return structured error — do NOT throw so the model gets a clean signal
        // instead of falling back to prior context to "helpfully" answer.
        return errorOutput;
      }

      const rows = Array.isArray(rawResult)
        ? (rawResult as Record<string, unknown>[])
        : [];

      const output: ToolOutput = {
        rows,
        row_count: rows.length,
        approved: true,
        method_summary,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "run_approved_readonly_query",
        input_json: { question, reasoning, generated_sql: sql },
        output_json: { ...output, model_used: AGENT_SQL_MODEL },
        status: "success",
        error_message: null,
      });

      return output;
    },
  });
}
