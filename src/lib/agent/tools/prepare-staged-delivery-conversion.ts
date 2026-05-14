import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
} from "./resolve-season";

// ─── Input / Output types ─────────────────────────────────────────────────────

interface ToolInput {
  customerName?: string;
  stagedDeliveryId?: string;
  productName?: string;
  treatmentName?: string;
  seedSize?: string;
  packageType?: string;
  seasonYear?: number;
}

interface MatchedOption {
  staged_delivery_id: string;
  staged_date: string;
  customer_name: string;
  farm_name: string | null;
  item_summary: string;
  total_units_staged: number;
}

interface SelectedItem {
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_staged: number;
}

interface SelectedSummary {
  staged_delivery_id: string;
  staged_date: string;
  customer_name: string;
  farm_name: string | null;
  items: SelectedItem[];
  total_units_staged: number;
  notes: string | null;
}

type ConversionStatus =
  | "ready_for_confirmation"
  | "needs_selection"
  | "not_found"
  | "error";

interface ToolOutput {
  status: ConversionStatus;
  pending_action_type: "convert_staged_delivery";
  staged_delivery_id: string | null;
  matched_options: MatchedOption[];
  selected_summary: SelectedSummary | null;
  message: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

// ─── View row shape ───────────────────────────────────────────────────────────

interface RawViewRow {
  staged_delivery_id: string;
  staged_date: string;
  customer_name: string;
  farm_name: string | null;
  notes: string | null;
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_staged: number;
  status?: string; // only present when querying v_staged_deliveries
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDisplayPackageType(db: string | null | undefined): string | null {
  if (db === "tote") return "Seedpak";
  if (db === "bag") return "Bag";
  return db ?? null;
}

function groupByStagedDelivery(rows: RawViewRow[]): Map<string, RawViewRow[]> {
  const map = new Map<string, RawViewRow[]>();
  for (const row of rows) {
    const list = map.get(row.staged_delivery_id);
    if (list) {
      list.push(row);
    } else {
      map.set(row.staged_delivery_id, [row]);
    }
  }
  return map;
}

function buildItemSummary(rows: RawViewRow[]): string {
  const parts = rows.slice(0, 3).map((r) => {
    const tokens: string[] = [`${r.units_staged}u`, r.product_name];
    if (r.treatment_name) tokens.push(r.treatment_name);
    if (r.seed_size) tokens.push(r.seed_size);
    const pkg = toDisplayPackageType(r.package_type);
    if (pkg) tokens.push(pkg);
    return tokens.join(" ");
  });
  const suffix = rows.length > 3 ? ` +${rows.length - 3} more` : "";
  return parts.join(", ") + suffix;
}

function buildSelectedSummary(rows: RawViewRow[]): SelectedSummary {
  const anchor = rows[0];
  return {
    staged_delivery_id: anchor.staged_delivery_id,
    staged_date: anchor.staged_date,
    customer_name: anchor.customer_name,
    farm_name: anchor.farm_name,
    notes: anchor.notes,
    items: rows.map((r) => ({
      product_name: r.product_name,
      treatment_name: r.treatment_name,
      seed_size: r.seed_size,
      package_type: toDisplayPackageType(r.package_type),
      units_staged: r.units_staged,
    })),
    total_units_staged: rows.reduce((s, r) => s + r.units_staged, 0),
  };
}

// ─── Column lists ─────────────────────────────────────────────────────────────

// v_staged_deliveries exposes status — used for direct-ID lookup
const COLS_ALL_STATUSES =
  "staged_delivery_id, staged_date, customer_name, farm_name, notes, status, product_name, treatment_name, seed_size, package_type, units_staged";

// v_agent_staged_deliveries is pre-filtered to in_progress — used for customer search
const COLS_IN_PROGRESS =
  "staged_delivery_id, staged_date, customer_name, farm_name, notes, product_name, treatment_name, seed_size, package_type, units_staged";

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function makePrepareStagedDeliveryConversionTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Identifies the in-progress staged delivery the user wants to convert into an actual delivery, " +
      "and prepares a conversion confirmation summary. " +
      "Call this tool when the user says they want to convert, turn, or change a staged delivery into a real or actual delivery. " +
      "This tool does NOT perform the conversion — use convert_confirmed_staged_delivery for the actual conversion after the user confirms. " +
      "Pass customerName to search by customer or farm name. " +
      "Pass stagedDeliveryId to look up a specific staged delivery by ID. " +
      "Pass productName or treatmentName to narrow results when the customer has multiple staged deliveries.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "Customer/contact name or farm/business name. Searches customer names first (exact, then partial), then farm/business names. Partial names like 'Scott' are accepted.",
        },
        stagedDeliveryId: {
          type: "string",
          description:
            "UUID of a specific staged delivery. Use this if the staged_delivery_id is already known from an earlier tool call or conversation turn.",
        },
        productName: {
          type: "string",
          description:
            "Filter by product name (partial, case-insensitive). Use to narrow results when the customer has multiple staged deliveries.",
        },
        treatmentName: {
          type: "string",
          description: "Filter by treatment name (partial, case-insensitive).",
        },
        seedSize: {
          type: "string",
          description: "Filter by seed size (exact match, e.g. 'AR', 'AF2').",
        },
        packageType: {
          type: "string",
          description: "Filter by package type: 'Bag' or 'Seedpak'.",
        },
        seasonYear: {
          type: "number",
          description:
            "Only provide this if the user explicitly stated a specific year number. Do not guess or infer — omit and the backend resolves the correct season automatically.",
        },
      },
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const log = async (
        out: ToolOutput,
        status: string,
        errorMsg: string | null
      ): Promise<ToolOutput> => {
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "prepare_staged_delivery_conversion",
          input_json: input,
          output_json: out,
          status,
          error_message: errorMsg,
        });
        return out;
      };

      // ── Case 1: direct lookup by staged_delivery_id ───────────────────────
      if (input.stagedDeliveryId) {
        const { data, error } = await userClient
          .from("v_staged_deliveries")
          .select(COLS_ALL_STATUSES)
          .eq("staged_delivery_id", input.stagedDeliveryId);

        if (error) {
          const out: ToolOutput = {
            status: "error",
            pending_action_type: "convert_staged_delivery",
            staged_delivery_id: null,
            matched_options: [],
            selected_summary: null,
            message: `Failed to look up staged delivery: ${error.message}`,
            tool_error: true,
            tool_error_message: error.message,
          };
          return log(out, "error", error.message);
        }

        const rows = (data ?? []) as RawViewRow[];

        if (rows.length === 0) {
          const out: ToolOutput = {
            status: "not_found",
            pending_action_type: "convert_staged_delivery",
            staged_delivery_id: null,
            matched_options: [],
            selected_summary: null,
            message: `Staged delivery ${input.stagedDeliveryId} was not found or does not belong to this account.`,
          };
          return log(out, "not_found", null);
        }

        const firstStatus = rows[0].status;
        if (firstStatus !== "in_progress") {
          const out: ToolOutput = {
            status: "error",
            pending_action_type: "convert_staged_delivery",
            staged_delivery_id: null,
            matched_options: [],
            selected_summary: null,
            message: `This staged delivery has already been ${firstStatus} and cannot be converted again.`,
            tool_error: true,
            tool_error_message: `status is '${firstStatus}', not 'in_progress'`,
          };
          return log(out, "error", `status is '${firstStatus}'`);
        }

        const summary = buildSelectedSummary(rows);
        const out: ToolOutput = {
          status: "ready_for_confirmation",
          pending_action_type: "convert_staged_delivery",
          staged_delivery_id: summary.staged_delivery_id,
          matched_options: [],
          selected_summary: summary,
          message: `Found staged delivery for ${summary.customer_name} on ${summary.staged_date}. Ready for conversion confirmation.`,
        };
        return log(out, "ready_for_confirmation", null);
      }

      // ── Case 2: customer name search (or list all) ────────────────────────
      // Season resolution — identical pattern to get_staged_deliveries
      const requestedSeasonYear = input.seasonYear ?? null;
      const userExplicitSeason =
        requestedSeasonYear !== null &&
        isYearMentionedByUser(userMessage, requestedSeasonYear);

      let resolvedSeasonYear: number | null;
      if (userExplicitSeason && requestedSeasonYear !== null) {
        resolvedSeasonYear = requestedSeasonYear;
      } else {
        const resolved = await resolveDefaultSeasonForUser(userClient, serviceClient);
        resolvedSeasonYear = resolved.season_year;
      }

      if (resolvedSeasonYear === null) {
        const out: ToolOutput = {
          status: "error",
          pending_action_type: "convert_staged_delivery",
          staged_delivery_id: null,
          matched_options: [],
          selected_summary: null,
          message: "Could not resolve the current season. Please check your data.",
          tool_error: true,
          tool_error_message: "Season resolution returned null",
        };
        return log(out, "error", "Season resolution returned null");
      }

      // Build a filtered query against v_agent_staged_deliveries (in_progress only)
      const buildQuery = (
        customerFilter?: { field: "customer_name" | "farm_name" | "both"; term: string }
      ) => {
        let q = userClient
          .from("v_agent_staged_deliveries")
          .select(COLS_IN_PROGRESS)
          .eq("season_year", resolvedSeasonYear!);

        if (customerFilter) {
          const { field, term } = customerFilter;
          if (field === "customer_name") {
            q = q.ilike("customer_name", term);
          } else if (field === "farm_name") {
            q = q.ilike("farm_name", term);
          } else {
            q = q.or(`customer_name.ilike.%${term}%,farm_name.ilike.%${term}%`);
          }
        }

        if (input.productName)
          q = q.ilike("product_name", `%${input.productName}%`);
        if (input.treatmentName)
          q = q.ilike("treatment_name", `%${input.treatmentName}%`);
        if (input.seedSize) q = q.eq("seed_size", input.seedSize);
        if (input.packageType) {
          const dbPkg =
            input.packageType.toLowerCase() === "seedpak" ? "tote" : "bag";
          q = q.eq("package_type", dbPkg);
        }

        return q.order("staged_date").order("product_name").limit(200);
      };

      let rawRows: RawViewRow[] = [];
      try {
        const { customerName } = input;
        if (customerName) {
          // Step 1: exact customer_name
          const { data: r1, error: e1 } = await buildQuery({
            field: "customer_name",
            term: customerName,
          });
          if (e1) throw new Error(e1.message);

          if (r1 && r1.length > 0) {
            rawRows = r1 as unknown as RawViewRow[];
          } else {
            // Step 2: exact farm_name
            const { data: r2, error: e2 } = await buildQuery({
              field: "farm_name",
              term: customerName,
            });
            if (e2) throw new Error(e2.message);

            if (r2 && r2.length > 0) {
              rawRows = r2 as unknown as RawViewRow[];
            } else {
              // Step 3: partial on both fields
              const { data: r3, error: e3 } = await buildQuery({
                field: "both",
                term: customerName,
              });
              if (e3) throw new Error(e3.message);
              rawRows = (r3 ?? []) as unknown as RawViewRow[];
            }
          }
        } else {
          // No customer filter — list all
          const { data: rAll, error: eAll } = await buildQuery();
          if (eAll) throw new Error(eAll.message);
          rawRows = (rAll ?? []) as unknown as RawViewRow[];
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Query failed";
        const out: ToolOutput = {
          status: "error",
          pending_action_type: "convert_staged_delivery",
          staged_delivery_id: null,
          matched_options: [],
          selected_summary: null,
          message: `Failed to retrieve staged deliveries: ${msg}`,
          tool_error: true,
          tool_error_message: msg,
        };
        return log(out, "error", msg);
      }

      if (rawRows.length === 0) {
        const notFoundMsg = input.customerName
          ? `No in-progress staged deliveries found for "${input.customerName}".`
          : "No in-progress staged deliveries found.";
        const out: ToolOutput = {
          status: "not_found",
          pending_action_type: "convert_staged_delivery",
          staged_delivery_id: null,
          matched_options: [],
          selected_summary: null,
          message: notFoundMsg,
        };
        return log(out, "not_found", null);
      }

      // Group item rows by staged_delivery_id
      const grouped = groupByStagedDelivery(rawRows);

      if (grouped.size === 1) {
        // Exactly one staged delivery found — ready for confirmation
        const [, groupRows] = [...grouped.entries()][0];
        const summary = buildSelectedSummary(groupRows);
        const out: ToolOutput = {
          status: "ready_for_confirmation",
          pending_action_type: "convert_staged_delivery",
          staged_delivery_id: summary.staged_delivery_id,
          matched_options: [],
          selected_summary: summary,
          message: `Found one in-progress staged delivery for ${summary.customer_name} on ${summary.staged_date}. Ready for conversion confirmation.`,
        };
        return log(out, "ready_for_confirmation", null);
      }

      // Multiple staged deliveries — ask the user to choose
      const matchedOptions: MatchedOption[] = [];
      for (const [, groupRows] of grouped.entries()) {
        const anchor = groupRows[0];
        matchedOptions.push({
          staged_delivery_id: anchor.staged_delivery_id,
          staged_date: anchor.staged_date,
          customer_name: anchor.customer_name,
          farm_name: anchor.farm_name,
          item_summary: buildItemSummary(groupRows),
          total_units_staged: groupRows.reduce((s, r) => s + r.units_staged, 0),
        });
      }

      // Most recent first
      matchedOptions.sort((a, b) => b.staged_date.localeCompare(a.staged_date));

      const customerLabel = input.customerName ? ` for "${input.customerName}"` : "";
      const out: ToolOutput = {
        status: "needs_selection",
        pending_action_type: "convert_staged_delivery",
        staged_delivery_id: null,
        matched_options: matchedOptions,
        selected_summary: null,
        message: `Found ${grouped.size} in-progress staged deliveries${customerLabel}. Ask the user which one to convert.`,
      };
      return log(out, "needs_selection", null);
    },
  });
}
