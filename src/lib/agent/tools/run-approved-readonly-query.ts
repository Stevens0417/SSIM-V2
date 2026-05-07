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

const TOOL_DESCRIPTION = `Run a read-only SQL SELECT against approved agent views. Use ONLY when a prebuilt tool cannot answer the user's question.

Approved views:
- v_agent_customer_orders: order_item_id, order_id, order_date, season_year, customer_id, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_ordered, early_pay, brand_grower_pct, early_pay_pct, retail_price_per_unit, line_total_after_all_discounts, break_even_price_per_unit, profit_per_unit, line_total_profit
- v_agent_order_fulfillment: season_year, customer_id, customer_name, farm_name, order_id, order_date, order_item_id, product_name, treatment_name, seed_size, package_type, ordered_units, delivered_units, returned_units, replanted_units, net_units, is_complete
- v_agent_inventory: product_name, treatment_name, seed_size, package_type, units_on_hand
- v_agent_customer_deliveries: delivery_id, delivery_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_delivered, order_id, order_item_id, notes
- v_agent_customer_returns: return_id, return_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_returned, order_id, order_item_id, notes
- v_agent_customer_replants: replant_id, replant_date, season_year, customer_name, farm_name, product_name, treatment_name, seed_size, package_type, units_replanted, order_id, order_item_id, notes
- v_agent_bayer_shipments: shipment_id, shipment_date, season_year, shipment_number, shipment_item_id, product_name, treatment_name, units_received, is_verified

Query rules: SELECT only, LIMIT ≤ 100 required, only approved views in FROM/JOIN. Package types in DB: 'bag' (Bags) and 'tote' (Seedpaks). Use ILIKE for case-insensitive name matching.`;

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
