import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
  type SeasonSource,
} from "./resolve-season";

const LIMIT = 200;

function toDisplayPackageType(dbValue: string | null): string | null {
  if (dbValue === "tote") return "Seedpak";
  if (dbValue === "bag") return "Bag";
  return dbValue;
}

interface ToolInput {
  customerName: string;
  seasonYear?: number;
  productName?: string;
  treatmentName?: string;
  earlyPayOnly?: boolean;
  includePricing?: boolean;
  includeProfit?: boolean;
}

interface OrderRow {
  order_item_id: string;
  order_id: string;
  order_date: string;
  season_year: number;
  customer_name: string;
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_ordered: number;
  early_pay: boolean | null;
  retail_price_per_unit?: number | null;
  brand_grower_discount_pct?: number | null;
  early_pay_discount_pct?: number | null;
  line_total_after_all_discounts?: number | null;
  break_even_price_per_unit?: number | null;
  profit_per_unit?: number | null;
  line_total_profit?: number | null;
}

interface ToolOutput {
  rows: OrderRow[];
  total_units_ordered: number;
  row_count: number;
  customer_name_matched: string;
  resolved_season_year: number | null;
  season_source: SeasonSource;
  requested_season_year: number | null;
  user_explicitly_requested_season: boolean;
  truncated?: boolean;
}

async function queryOrders(
  userClient: SupabaseClient,
  seasonYear: number,
  customerPattern: string,
  input: ToolInput,
  exact: boolean
): Promise<Record<string, unknown>[]> {
  const selectCols = [
    "order_item_id",
    "order_id",
    "order_date",
    "season_year",
    "customer_name",
    "product_name",
    "treatment_name",
    "seed_size",
    "package_type",
    "units_ordered",
    "early_pay",
    // always fetch pricing/profit columns — filter in JS so we don't need two queries
    "retail_price_per_unit",
    "brand_grower_pct",
    "early_pay_pct",
    "line_total_after_all_discounts",
    "break_even_price_per_unit",
    "profit_per_unit",
    "line_total_profit",
  ].join(", ");

  let query = userClient
    .from("v_agent_customer_current_season_orders")
    .select(selectCols)
    .eq("season_year", seasonYear)
    .ilike("customer_name", exact ? customerPattern : `%${customerPattern}%`)
    .order("order_date")
    .order("customer_name")
    .order("product_name")
    .limit(LIMIT + 1);

  if (input.productName) {
    query = query.ilike("product_name", `%${input.productName}%`);
  }
  if (input.treatmentName) {
    query = query.ilike("treatment_name", `%${input.treatmentName}%`);
  }
  if (input.earlyPayOnly) {
    query = query.eq("early_pay", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

export function makeGetCustomerCurrentSeasonOrdersTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns order line items for a specific customer for the current (or specified) season. Use this tool whenever the user asks about customer orders, what a customer ordered, how many units a customer ordered, or order-level details for a specific customer.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "Customer name to look up. Partial name is fine — the tool tries an exact match first, then a partial match. Required.",
        },
        seasonYear: {
          type: "number",
          description:
            "Only provide this if the user explicitly stated a specific year number in their message. Do not guess or infer a year — omit this field and the backend will resolve the correct season automatically.",
        },
        productName: {
          type: "string",
          description:
            "Partial product name to filter by (case-insensitive). Only set when the user asks about a specific product.",
        },
        treatmentName: {
          type: "string",
          description:
            "Partial treatment name to filter by (case-insensitive). Only set when the user asks about a specific treatment.",
        },
        earlyPayOnly: {
          type: "boolean",
          description:
            "Set to true to return only early-pay order lines. Omit unless the user specifically asks about early-pay orders.",
        },
        includePricing: {
          type: "boolean",
          description:
            "Set to true to include retail price, discounts, and line totals in each row. Use when the user asks about prices, costs, or invoice amounts.",
        },
        includeProfit: {
          type: "boolean",
          description:
            "Set to true to include profit per unit and total profit per line. Use when the user asks about profit or margin.",
        },
      },
      required: ["customerName"],
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { customerName, includePricing, includeProfit } = input;

      // Only honour the model-provided year if the user's actual message contains it.
      // GPT-4o-mini often injects a year from its training data (e.g. 2023) even when
      // the user never mentioned one. Backend resolution is always the source of truth.
      const requestedSeasonYear = input.seasonYear ?? null;
      const userExplicitlyRequestedSeason =
        requestedSeasonYear !== null &&
        isYearMentionedByUser(userMessage, requestedSeasonYear);

      let resolvedSeasonYear: number | null;
      let seasonSource: SeasonSource;

      if (userExplicitlyRequestedSeason && requestedSeasonYear !== null) {
        resolvedSeasonYear = requestedSeasonYear;
        seasonSource = "explicit";
      } else {
        const resolved = await resolveDefaultSeasonForUser(userClient, serviceClient);
        resolvedSeasonYear = resolved.season_year;
        seasonSource = resolved.season_source;
      }

      // If no season could be determined, return early
      if (resolvedSeasonYear === null) {
        const emptyOutput: ToolOutput = {
          rows: [],
          total_units_ordered: 0,
          row_count: 0,
          customer_name_matched: "",
          resolved_season_year: null,
          season_source: "none",
          requested_season_year: requestedSeasonYear,
          user_explicitly_requested_season: userExplicitlyRequestedSeason,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_customer_current_season_orders",
          input_json: input,
          output_json: emptyOutput,
          status: "success",
          error_message: null,
        });
        return emptyOutput;
      }

      // Try exact match first, fall back to partial
      let rawRows: Record<string, unknown>[] = [];
      let matchedExact = false;
      try {
        rawRows = await queryOrders(userClient, resolvedSeasonYear, customerName, input, true);
        if (rawRows.length > 0) {
          matchedExact = true;
        } else {
          rawRows = await queryOrders(userClient, resolvedSeasonYear, customerName, input, false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_customer_current_season_orders",
          input_json: input,
          output_json: null,
          status: "error",
          error_message: message,
        });
        throw new Error(`Order query failed: ${message}`);
      }

      const truncated = rawRows.length > LIMIT;
      const sliced = truncated ? rawRows.slice(0, LIMIT) : rawRows;

      const rows: OrderRow[] = sliced.map((r) => {
        const base: OrderRow = {
          order_item_id: r.order_item_id as string,
          order_id: r.order_id as string,
          order_date: r.order_date as string,
          season_year: r.season_year as number,
          customer_name: r.customer_name as string,
          product_name: r.product_name as string,
          treatment_name: (r.treatment_name as string | null) ?? null,
          seed_size: (r.seed_size as string | null) ?? null,
          package_type: toDisplayPackageType(r.package_type as string | null),
          units_ordered: r.units_ordered as number,
          early_pay: (r.early_pay as boolean | null) ?? null,
        };

        if (includePricing) {
          base.retail_price_per_unit = (r.retail_price_per_unit as number | null) ?? null;
          base.brand_grower_discount_pct = (r.brand_grower_pct as number | null) ?? null;
          base.early_pay_discount_pct = (r.early_pay_pct as number | null) ?? null;
          base.line_total_after_all_discounts =
            (r.line_total_after_all_discounts as number | null) ?? null;
          base.break_even_price_per_unit =
            (r.break_even_price_per_unit as number | null) ?? null;
        }

        if (includeProfit) {
          base.profit_per_unit = (r.profit_per_unit as number | null) ?? null;
          base.line_total_profit = (r.line_total_profit as number | null) ?? null;
        }

        return base;
      });

      const total_units_ordered = rows.reduce(
        (sum, r) => sum + (r.units_ordered ?? 0),
        0
      );

      const uniqueCustomers = [...new Set(rows.map((r) => r.customer_name))];
      const customer_name_matched = uniqueCustomers.join(", ");

      const output: ToolOutput = {
        rows,
        total_units_ordered,
        row_count: rows.length,
        customer_name_matched,
        resolved_season_year: resolvedSeasonYear,
        season_source: seasonSource,
        requested_season_year: requestedSeasonYear,
        user_explicitly_requested_season: userExplicitlyRequestedSeason,
        ...(truncated ? { truncated: true } : {}),
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_customer_current_season_orders",
        input_json: {
          ...input,
          _matched_exact: matchedExact,
          _resolved_season: resolvedSeasonYear,
          _season_source: seasonSource,
          _user_explicit: userExplicitlyRequestedSeason,
        },
        output_json: output,
        status: "success",
        error_message: null,
      });

      return output;
    },
  });
}
