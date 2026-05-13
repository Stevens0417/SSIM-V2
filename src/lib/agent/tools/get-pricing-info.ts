import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
  type SeasonSource,
} from "./resolve-season";

const LIMIT = 100;

interface ToolInput {
  productName?: string;
  treatmentName?: string;
  seasonYear?: number;
  crop?: string;
  includeMargins?: boolean;
}

interface PricingRow {
  season_year: number;
  product_name: string;
  crop: string | null;
  treatment_name: string | null;
  retail_price_per_unit: number | null;
  break_even_price_per_unit: number | null;
  // Margin fields are always present; null for packaging rows where break-even is undefined
  margin_per_unit: number | null;
  margin_pct: number | null;
}

interface ToolOutput {
  rows: PricingRow[];
  row_count: number;
  resolved_season_year: number | null;
  season_source: SeasonSource;
  truncated: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}

export function makeGetPricingInfoTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns retail price, break-even price, and margin information for products and treatments from the approved pricing view. " +
      "Every row always includes margin_per_unit (retail minus break-even) and margin_pct (margin as a percentage of retail). " +
      "Use this tool for any pricing question: retail price, break-even price, margin per unit, margin percentage, or listing which treatments are priced for a product. " +
      "All filters are optional — pass only the filters the user specified. " +
      "If no seasonYear is provided, the backend resolves the correct season automatically — never guess a year. " +
      "Supports partial, case-insensitive product and treatment name matching. " +
      "Pricing is GLOBAL — all users see the same prices. " +
      "margin_per_unit and margin_pct are null for packaging rows where break-even is not defined. " +
      "Use the SQL fallback only when a pricing question requires custom aggregation (e.g. ranking all products by margin) not directly returned by this tool.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        productName: {
          type: "string",
          description:
            "Partial product name to filter by (case-insensitive). Only set when the user asks about a specific product.",
        },
        treatmentName: {
          type: "string",
          description:
            "Partial treatment name to filter by (case-insensitive), e.g. 'FUNGICIDE', 'PONCHO', 'DIAMIDE'. Only set when the user asks about a specific treatment.",
        },
        seasonYear: {
          type: "number",
          description:
            "The season year to query pricing for. Only set when the user explicitly states a year (e.g. '2026 pricing'). If the user did not mention a year, omit this field — the backend resolves the correct season.",
        },
        crop: {
          type: "string",
          description:
            "Crop type filter: 'corn', 'soybean', or 'packaging'. Only set when the user asks about a specific crop.",
        },
        includeMargins: {
          type: "boolean",
          description:
            "Hint that the user is asking about margin or markup. margin_per_unit and margin_pct are always returned regardless of this flag — set it to true so your response emphasizes those fields.",
        },
      },
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { productName, treatmentName, crop } = input;

      // Season resolution: honour model-provided year only if the user actually mentioned it.
      // This prevents the model from injecting a hallucinated year from its training data.
      let resolvedSeasonYear: number | null;
      let seasonSource: SeasonSource;

      if (input.seasonYear && isYearMentionedByUser(userMessage, input.seasonYear)) {
        resolvedSeasonYear = input.seasonYear;
        seasonSource = "explicit";
      } else {
        const resolved = await resolveDefaultSeasonForUser(userClient, serviceClient);
        resolvedSeasonYear = resolved.season_year;
        seasonSource = resolved.season_source;
      }

      // v_agent_pricing is global (no user_id filter), so either client works.
      // Always select all pricing columns; margin fields are conditionally included in output.
      let query = serviceClient
        .from("v_agent_pricing")
        .select(
          "season_year, product_name, crop, treatment_name, retail_price_per_unit, break_even_price_per_unit, margin_per_unit, margin_pct"
        )
        .order("product_name")
        .order("treatment_name")
        .limit(LIMIT + 1);

      if (resolvedSeasonYear) {
        query = query.eq("season_year", resolvedSeasonYear);
      }
      if (productName) {
        query = query.ilike("product_name", `%${productName}%`);
      }
      if (treatmentName) {
        query = query.ilike("treatment_name", `%${treatmentName}%`);
      }
      if (crop) {
        query = query.eq("crop", crop.toLowerCase());
      }

      const { data, error } = await query;

      if (error) {
        const errorOutput: ToolOutput = {
          rows: [],
          row_count: 0,
          resolved_season_year: resolvedSeasonYear,
          season_source: seasonSource,
          truncated: false,
          tool_error: true,
          tool_error_message: error.message,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_pricing_info",
          input_json: input,
          output_json: errorOutput,
          status: "error",
          error_message: error.message,
        });
        return errorOutput;
      }

      const truncated = data.length > LIMIT;
      const rawRows = truncated ? data.slice(0, LIMIT) : data;

      const rows: PricingRow[] = rawRows.map((r) => ({
        season_year: r.season_year as number,
        product_name: r.product_name as string,
        crop: r.crop as string | null,
        treatment_name: r.treatment_name as string | null,
        retail_price_per_unit: r.retail_price_per_unit as number | null,
        break_even_price_per_unit: r.break_even_price_per_unit as number | null,
        margin_per_unit: r.margin_per_unit as number | null,
        margin_pct: r.margin_pct as number | null,
      }));

      const output: ToolOutput = {
        rows,
        row_count: rows.length,
        resolved_season_year: resolvedSeasonYear,
        season_source: seasonSource,
        truncated,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_pricing_info",
        input_json: input,
        output_json: output,
        status: "success",
        error_message: null,
      });

      return output;
    },
  });
}
