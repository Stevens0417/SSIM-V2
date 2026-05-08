import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
  type SeasonSource,
} from "./resolve-season";

const LIMIT = 200;

function toDbPackageType(userInput: string): string {
  const lc = userInput.toLowerCase().trim();
  if (lc === "seedpak" || lc === "tote") return "tote";
  if (lc === "bag") return "bag";
  return lc;
}

function toDisplayPackageType(dbValue: string | null): string | null {
  if (dbValue === "tote") return "Seedpak";
  if (dbValue === "bag") return "Bag";
  return dbValue;
}

type MatchedBy = "customer_name" | "farm_name" | "both" | "none" | "";

interface MatchedCustomer {
  customer_name: string;
  farm_name: string | null;
}

interface ToolInput {
  customerName?: string;
  productName?: string;
  treatmentName?: string;
  packageType?: string;
  seedSize?: string;
  seasonYear?: number;
}

interface StagedDeliveryRow {
  staged_delivery_id: string;
  staged_delivery_item_id: string;
  staged_date: string;
  customer_name: string;
  farm_name: string | null;
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null; // display: "Bag" or "Seedpak"
  units_staged: number;
  notes: string | null;
  status: string; // always "in_progress" — view is pre-filtered
}

interface ToolOutput {
  resolved_season_year: number | null;
  season_source: SeasonSource;
  rows: StagedDeliveryRow[];
  total_units_staged: number;
  staged_delivery_count: number; // unique staged_delivery_ids
  row_count: number;
  matched_customers: MatchedCustomer[];
  matched_by: MatchedBy;
  tool_error?: boolean;
  tool_error_message?: string;
}

// Columns selected from v_agent_staged_deliveries
const SELECT_COLS =
  "staged_delivery_id, staged_delivery_item_id, customer_name, farm_name, season_year, staged_date, notes, product_name, treatment_name, seed_size, package_type, units_staged";

async function queryView(
  userClient: SupabaseClient,
  seasonYear: number,
  customerFilter: { type: "customer_name" | "farm_name" | "both"; term: string } | null,
  input: ToolInput
): Promise<Record<string, unknown>[]> {
  let query = userClient
    .from("v_agent_staged_deliveries")
    .select(SELECT_COLS)
    .eq("season_year", seasonYear)
    .order("customer_name")
    .order("staged_date")
    .order("product_name")
    .limit(LIMIT);

  if (customerFilter) {
    const { type, term } = customerFilter;
    if (type === "customer_name") {
      query = query.ilike("customer_name", term);
    } else if (type === "farm_name") {
      query = query.ilike("farm_name", term);
    } else {
      // "both" — partial match on either field
      query = query.or(`customer_name.ilike.%${term}%,farm_name.ilike.%${term}%`);
    }
  }

  if (input.productName) {
    query = query.ilike("product_name", `%${input.productName}%`);
  }
  if (input.treatmentName) {
    query = query.ilike("treatment_name", `%${input.treatmentName}%`);
  }
  if (input.packageType) {
    query = query.eq("package_type", toDbPackageType(input.packageType));
  }
  if (input.seedSize) {
    query = query.eq("seed_size", input.seedSize);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

function mapRow(r: Record<string, unknown>): StagedDeliveryRow {
  return {
    staged_delivery_id: r.staged_delivery_id as string,
    staged_delivery_item_id: r.staged_delivery_item_id as string,
    staged_date: r.staged_date as string,
    customer_name: r.customer_name as string,
    farm_name: (r.farm_name as string | null) ?? null,
    product_name: r.product_name as string,
    treatment_name: (r.treatment_name as string | null) ?? null,
    seed_size: (r.seed_size as string | null) ?? null,
    package_type: toDisplayPackageType(r.package_type as string | null),
    units_staged: r.units_staged as number,
    notes: (r.notes as string | null) ?? null,
    status: "in_progress", // view is pre-filtered to in_progress
  };
}

function buildMatchedCustomers(rows: StagedDeliveryRow[]): MatchedCustomer[] {
  const seen = new Map<string, MatchedCustomer>();
  for (const r of rows) {
    if (!seen.has(r.customer_name)) {
      seen.set(r.customer_name, { customer_name: r.customer_name, farm_name: r.farm_name });
    }
  }
  return [...seen.values()];
}

export function makeGetStagedDeliveriesTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns all in-progress staged deliveries (prepared/reserved deliveries not yet formally delivered) for the authenticated user. " +
      "A staged delivery is product physically set aside for a customer but not yet entered as an actual delivery. " +
      "Call this tool when the user asks: what staged deliveries do I have, show me staged deliveries for [customer], " +
      "what deliveries are currently staged, how many units are staged for [product], which customers have staged deliveries, " +
      "what products are staged/prepared/reserved, or any question about deliveries that are set aside but not yet delivered. " +
      "All results are in_progress (active) staged deliveries only — converted and cancelled staged deliveries are excluded. " +
      "customerName is optional — omit it to return all staged deliveries across all customers.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "Customer/contact name or farm/business name to filter by. The tool searches customer names first (exact, then partial), then farm/business names. Partial names like 'Scott' are accepted. Omit to return staged deliveries for all customers.",
        },
        productName: {
          type: "string",
          description:
            "Filter by product name (partial, case-insensitive). Only set when the user asks about a specific product.",
        },
        treatmentName: {
          type: "string",
          description:
            "Filter by treatment name (partial, case-insensitive). Only set when the user asks about a specific treatment.",
        },
        packageType: {
          type: "string",
          description: "Filter by package type: 'Bag' or 'Seedpak'. Omit if not specified.",
        },
        seedSize: {
          type: "string",
          description: "Filter by exact seed size. Omit if not specified.",
        },
        seasonYear: {
          type: "number",
          description:
            "Only provide this if the user explicitly stated a specific year number in their message. Do not guess or infer a year — omit this field and the backend will resolve the correct season automatically.",
        },
      },
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { customerName } = input;

      // Year validation: only honour model-provided year if user actually said it
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

      if (resolvedSeasonYear === null) {
        const emptyOutput: ToolOutput = {
          resolved_season_year: null,
          season_source: "none",
          rows: [],
          total_units_staged: 0,
          staged_delivery_count: 0,
          row_count: 0,
          matched_customers: [],
          matched_by: "",
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_staged_deliveries",
          input_json: input,
          output_json: emptyOutput,
          status: "success",
          error_message: null,
        });
        return emptyOutput;
      }

      // Three-step customer matching (only when customerName is provided):
      // 1. Exact match on customer_name
      // 2. Exact match on farm_name
      // 3. Partial match on customer_name OR farm_name
      let rawRows: Record<string, unknown>[] = [];
      let matchedBy: MatchedBy = "";

      try {
        if (customerName) {
          rawRows = await queryView(
            userClient, resolvedSeasonYear,
            { type: "customer_name", term: customerName },
            input
          );
          if (rawRows.length > 0) {
            matchedBy = "customer_name";
          } else {
            rawRows = await queryView(
              userClient, resolvedSeasonYear,
              { type: "farm_name", term: customerName },
              input
            );
            if (rawRows.length > 0) {
              matchedBy = "farm_name";
            } else {
              rawRows = await queryView(
                userClient, resolvedSeasonYear,
                { type: "both", term: customerName },
                input
              );
              matchedBy = rawRows.length > 0 ? "both" : "none";
            }
          }
        } else {
          // No customer filter — return all staged deliveries for the season
          rawRows = await queryView(userClient, resolvedSeasonYear, null, input);
          matchedBy = "";
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        const errorOutput: ToolOutput = {
          tool_error: true,
          tool_error_message: message,
          resolved_season_year: resolvedSeasonYear,
          season_source: seasonSource,
          rows: [],
          total_units_staged: 0,
          staged_delivery_count: 0,
          row_count: 0,
          matched_customers: [],
          matched_by: "none",
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_staged_deliveries",
          input_json: input,
          output_json: errorOutput,
          status: "error",
          error_message: message,
        });
        // Return structured error — do NOT throw. Throwing lets the model fall back to
        // prior context to "helpfully" answer, which is wrong for business data.
        return errorOutput;
      }

      const rows = rawRows.map(mapRow);
      const total_units_staged = rows.reduce((s, r) => s + r.units_staged, 0);
      const staged_delivery_count = new Set(rows.map((r) => r.staged_delivery_id)).size;
      const matched_customers = buildMatchedCustomers(rows);

      const output: ToolOutput = {
        resolved_season_year: resolvedSeasonYear,
        season_source: seasonSource,
        rows,
        total_units_staged,
        staged_delivery_count,
        row_count: rows.length,
        matched_customers,
        matched_by: matchedBy,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_staged_deliveries",
        input_json: {
          ...input,
          _matched_by: matchedBy,
          _matched_customer_count: matched_customers.length,
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
