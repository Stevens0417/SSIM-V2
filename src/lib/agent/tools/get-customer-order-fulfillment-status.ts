import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
  type SeasonSource,
} from "./resolve-season";

const LIMIT = 100;

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

function deriveFulfillmentStatus(
  unitsDelivered: number,
  unitsRemaining: number
): string {
  if (unitsRemaining <= 0) return "Complete";
  if (unitsDelivered > 0) return "In Progress";
  return "Not Started";
}

interface ToolInput {
  customerName: string;
  seasonYear?: number;
  productName?: string;
  treatmentName?: string;
  packageType?: string;
  seedSize?: string;
  openOnly?: boolean;
}

interface FulfillmentRow {
  customer_name: string;
  season_year: number;
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_ordered: number;
  units_delivered: number;
  units_returned: number;
  units_replanted: number;
  units_remaining: number;
  fulfillment_status: string;
}

interface ToolOutput {
  rows: FulfillmentRow[];
  total_units_ordered: number;
  total_units_delivered: number;
  total_units_remaining: number;
  row_count: number;
  customer_name_matched: string;
  resolved_season_year: number | null;
  season_source: SeasonSource;
  requested_season_year: number | null;
  user_explicitly_requested_season: boolean;
  truncated?: boolean;
}

async function queryFulfillment(
  userClient: SupabaseClient,
  seasonYear: number,
  customerPattern: string,
  input: ToolInput,
  exact: boolean
): Promise<Record<string, unknown>[]> {
  let query = userClient
    .from("v_delivery_customer_order_status")
    .select(
      "customer_name, season_year, product_name, treatment_name, seed_size, package_type, ordered_units, delivered_units, returned_units, replanted_units, net_units"
    )
    .eq("season_year", seasonYear)
    .ilike("customer_name", exact ? customerPattern : `%${customerPattern}%`);

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

function aggregateRows(
  rawRows: Record<string, unknown>[],
  openOnly: boolean
): FulfillmentRow[] {
  const groups = new Map<
    string,
    {
      customer_name: string;
      season_year: number;
      product_name: string;
      treatment_name: string | null;
      seed_size: string | null;
      package_type: string | null;
      units_ordered: number;
      units_delivered: number;
      units_returned: number;
      units_replanted: number;
    }
  >();

  for (const r of rawRows) {
    const key = [
      r.customer_name,
      r.season_year,
      r.product_name,
      r.treatment_name ?? "",
      r.seed_size ?? "",
      r.package_type ?? "",
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        customer_name: r.customer_name as string,
        season_year: r.season_year as number,
        product_name: r.product_name as string,
        treatment_name: (r.treatment_name as string | null) ?? null,
        seed_size: (r.seed_size as string | null) ?? null,
        package_type: (r.package_type as string | null) ?? null,
        units_ordered: 0,
        units_delivered: 0,
        units_returned: 0,
        units_replanted: 0,
      });
    }

    const g = groups.get(key)!;
    g.units_ordered += (r.ordered_units as number) ?? 0;
    g.units_delivered += (r.delivered_units as number) ?? 0;
    g.units_returned += (r.returned_units as number) ?? 0;
    g.units_replanted += (r.replanted_units as number) ?? 0;
  }

  const rows: FulfillmentRow[] = [];
  for (const g of groups.values()) {
    const net =
      g.units_ordered - g.units_delivered - g.units_replanted + g.units_returned;
    const units_remaining = Math.max(0, net);

    if (openOnly && units_remaining <= 0) continue;

    rows.push({
      customer_name: g.customer_name,
      season_year: g.season_year,
      product_name: g.product_name,
      treatment_name: g.treatment_name,
      seed_size: g.seed_size,
      package_type: toDisplayPackageType(g.package_type),
      units_ordered: g.units_ordered,
      units_delivered: g.units_delivered,
      units_returned: g.units_returned,
      units_replanted: g.units_replanted,
      units_remaining,
      fulfillment_status: deriveFulfillmentStatus(g.units_delivered, units_remaining),
    });
  }

  rows.sort((a, b) => {
    const order = { "Not Started": 0, "In Progress": 1, Complete: 2 };
    const sa = order[a.fulfillment_status as keyof typeof order] ?? 3;
    const sb = order[b.fulfillment_status as keyof typeof order] ?? 3;
    if (sa !== sb) return sa - sb;
    return a.product_name.localeCompare(b.product_name);
  });

  return rows;
}

export function makeGetCustomerOrderFulfillmentStatusTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns order fulfillment status for a specific customer — how many units were ordered, how many have been delivered, and how many remain to be delivered. Use this tool when the user asks about delivery status, outstanding balances, remaining units to deliver, or whether a customer's order is complete.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "Customer name to look up. Partial name is fine — exact match is tried first. Required.",
        },
        seasonYear: {
          type: "number",
          description:
            "Only provide this if the user explicitly stated a specific year number in their message. Do not guess or infer a year — omit this field and the backend will resolve the correct season automatically.",
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
          description:
            "Filter by package type: 'Bag' or 'Seedpak'. Only set when the user asks about a specific package type.",
        },
        seedSize: {
          type: "string",
          description:
            "Filter by exact seed size. Only set when the user specifies a seed size.",
        },
        openOnly: {
          type: "boolean",
          description:
            "Set to true to return only product lines that still have units remaining to deliver. Use when the user asks about open balances or what is left to deliver.",
        },
      },
      required: ["customerName"],
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { customerName, openOnly } = input;

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
          total_units_delivered: 0,
          total_units_remaining: 0,
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
          tool_name: "get_customer_order_fulfillment_status",
          input_json: input,
          output_json: emptyOutput,
          status: "success",
          error_message: null,
        });
        return emptyOutput;
      }

      let rawRows: Record<string, unknown>[] = [];
      let matchedExact = false;
      try {
        rawRows = await queryFulfillment(
          userClient,
          resolvedSeasonYear,
          customerName,
          input,
          true
        );
        if (rawRows.length > 0) {
          matchedExact = true;
        } else {
          rawRows = await queryFulfillment(
            userClient,
            resolvedSeasonYear,
            customerName,
            input,
            false
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_customer_order_fulfillment_status",
          input_json: input,
          output_json: null,
          status: "error",
          error_message: message,
        });
        throw new Error(`Fulfillment query failed: ${message}`);
      }

      const aggregated = aggregateRows(rawRows, openOnly ?? false);

      const truncated = aggregated.length > LIMIT;
      const rows = truncated ? aggregated.slice(0, LIMIT) : aggregated;

      const total_units_ordered = rows.reduce((s, r) => s + r.units_ordered, 0);
      const total_units_delivered = rows.reduce((s, r) => s + r.units_delivered, 0);
      const total_units_remaining = rows.reduce((s, r) => s + r.units_remaining, 0);

      const uniqueCustomers = [...new Set(rows.map((r) => r.customer_name))];
      const customer_name_matched = uniqueCustomers.join(", ");

      const output: ToolOutput = {
        rows,
        total_units_ordered,
        total_units_delivered,
        total_units_remaining,
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
        tool_name: "get_customer_order_fulfillment_status",
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
