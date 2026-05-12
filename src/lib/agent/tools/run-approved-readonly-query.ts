import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateApprovedQuery } from "../sql/validate-approved-query";

interface ToolInput {
  sql: string;
  reasoning: string;
}

interface ToolOutput {
  rows: Record<string, unknown>[];
  row_count: number;
  // Populated when the query was rejected by the validator
  approved?: boolean;
  reason_rejected?: string;
  // Populated when the DB call itself fails
  tool_error?: boolean;
  tool_error_message?: string;
}

const TOOL_DESCRIPTION = `Run a read-only SQL SELECT against approved agent views. Use this tool whenever a prebuilt tool cannot answer the user's question — do NOT say the question is unanswerable without first attempting a query.

Approved views (all user-scoped — only the current user's data is returned):

v_agent_inventory — on-hand, staged, and available seed inventory
  Columns: product_name, treatment_name, seed_size, package_type, units_on_hand, units_staged, available_units
  Notes: units_on_hand = physical (received−delivered+returned); units_staged = reserved in active staged deliveries; available_units = units_on_hand − units_staged

v_agent_staged_deliveries — in-progress staged deliveries only
  Columns: staged_delivery_id, customer_name, farm_name, season_year, staged_date, notes, product_name, treatment_name, seed_size, package_type, units_staged, created_at

v_agent_customer_orders — order line items with pricing and profit
  Columns: order_item_id, order_id, order_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_ordered, early_pay, early_pay_pct, brand_grower_pct, retail_price_per_unit, line_total_after_all_discounts, break_even_price_per_unit, profit_per_unit, line_total_profit

v_agent_order_fulfillment — delivery fulfillment status per order line
  Columns: season_year, customer_name, farm_name, order_date, product_name, treatment_name, seed_size, package_type, ordered_units, delivered_units, returned_units, replanted_units, net_units, is_complete

v_agent_customer_deliveries — delivery history
  Columns: delivery_id, delivery_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_delivered, order_id, order_item_id, notes

v_agent_customer_returns — return history
  Columns: return_id, return_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_returned, order_id, order_item_id, notes

v_agent_customer_replants — replant history
  Columns: replant_id, replant_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_replanted, order_id, order_item_id, notes

v_agent_bayer_shipments — Bayer shipment line items
  Columns: shipment_id, shipment_date, season_year, shipment_number, shipment_item_id, product_name, treatment_name, seed_size, package_type, units_received, is_verified, verified_at

v_agent_pricing — retail pricing, break-even, and margin per product/treatment (GLOBAL — not user-scoped; same rows for every user)
  Columns: season_year, product_id, product_name, crop, chu, seed_trait, treatment_id, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct
  Notes: grain is one row per (season_year, product, treatment) — no seed_size or package_type dimension (pricing is the same regardless of seed size or package type); margin_per_unit = retail_price_per_unit − break_even_price_per_unit; margin_pct = margin_per_unit / retail_price_per_unit × 100

Query rules:
- SELECT only — no writes
- LIMIT ≤ 100 required on every query
- Only approved views in FROM/JOIN clauses
- Package types stored as 'bag' (display: Bag) and 'tote' (display: Seedpak)
- Use ILIKE for case-insensitive name matching: customer_name ILIKE '%smith%'
- Filter by season_year (integer) for season-specific questions
- available_units from v_agent_inventory is the primary inventory answer field

Example queries:
-- Which customers have the most staged units?
SELECT customer_name, SUM(units_staged) AS total_staged FROM v_agent_staged_deliveries GROUP BY customer_name ORDER BY total_staged DESC LIMIT 20;

-- Which products have negative available inventory?
SELECT product_name, treatment_name, seed_size, package_type, available_units FROM v_agent_inventory WHERE available_units < 0 ORDER BY available_units LIMIT 50;

-- Which products have I delivered the most of this season?
SELECT product_name, treatment_name, SUM(units_delivered) AS total_delivered FROM v_agent_customer_deliveries WHERE season_year = 2026 GROUP BY product_name, treatment_name ORDER BY total_delivered DESC LIMIT 20;

-- Customers with orders but no deliveries this season
SELECT DISTINCT f.customer_name FROM v_agent_order_fulfillment f WHERE f.season_year = 2026 AND f.delivered_units = 0 LIMIT 50;

-- Total units returned this season
SELECT SUM(units_returned) AS total_returned FROM v_agent_customer_returns WHERE season_year = 2026 LIMIT 1;

-- Bayer shipments for a specific product
SELECT shipment_date, product_name, treatment_name, seed_size, package_type, units_received FROM v_agent_bayer_shipments WHERE product_name ILIKE '%094-94%' ORDER BY shipment_date LIMIT 50;

-- Retail price and margin for all products this season
SELECT product_name, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct FROM v_agent_pricing WHERE season_year = 2026 ORDER BY product_name, treatment_name LIMIT 100;

-- Which products have the highest margin?
SELECT product_name, treatment_name, margin_per_unit, margin_pct FROM v_agent_pricing WHERE season_year = 2026 ORDER BY margin_per_unit DESC LIMIT 20;

-- What is the break-even price for a specific product and treatment?
SELECT product_name, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit FROM v_agent_pricing WHERE season_year = 2026 AND product_name ILIKE '%103-93%' AND treatment_name ILIKE '%fungicide%' LIMIT 10;`;

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
        sql: {
          type: "string",
          description:
            "A read-only SELECT query using only approved views. Must include LIMIT ≤ 100. No writes, no system tables.",
        },
        reasoning: {
          type: "string",
          description:
            "Brief explanation of why prebuilt tools cannot answer this question and what this query retrieves.",
        },
      },
      required: ["sql", "reasoning"],
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { sql, reasoning } = input;

      // TypeScript validator is the primary security gate
      const validation = validateApprovedQuery(sql);
      if (!validation.valid) {
        const rejectedOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          approved: false,
          reason_rejected: validation.reason,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "run_approved_readonly_query",
          input_json: { sql, reasoning },
          output_json: rejectedOutput,
          status: "rejected",
          error_message: validation.reason,
        });
        return rejectedOutput;
      }

      // Execute via RPC — SECURITY INVOKER ensures auth.uid() resolves
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
        const message = err instanceof Error ? err.message : "Query execution failed";
        const errorOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          tool_error: true,
          tool_error_message: message,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "run_approved_readonly_query",
          input_json: { sql, reasoning },
          output_json: errorOutput,
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
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "run_approved_readonly_query",
        input_json: { sql, reasoning },
        output_json: output,
        status: "success",
        error_message: null,
      });

      return output;
    },
  });
}
