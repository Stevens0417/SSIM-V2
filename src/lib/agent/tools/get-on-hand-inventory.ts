import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

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

interface ToolInput {
  productName?: string;
  treatmentName?: string;
  packageType?: string;
  seedSize?: string;
}

interface InventoryRow {
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  // physical_units_on_hand = received − delivered + returned (warehouse stock)
  physical_units_on_hand: number;
  // staged_units = reserved in in_progress staged deliveries (set aside, not yet delivered)
  staged_units: number;
  // available_units = physical_units_on_hand − staged_units (what can still be committed)
  available_units: number;
}

interface ToolOutput {
  rows: InventoryRow[];
  // Physical stock totals (warehouse counts — NOT the answer to "how many do I have?")
  total_physical_units_on_hand: number;
  has_negative_physical_inventory: boolean;
  // Staged totals
  total_staged_units: number;
  has_staged_inventory: boolean;
  // Available totals — ALWAYS lead with these when answering "how many do I have?"
  total_available_units: number;
  has_negative_available_inventory: boolean;
  negative_available_rows: InventoryRow[];
  // Meta
  row_count: number;
  truncated?: boolean;
}

export function makeGetOnHandInventoryTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns current inventory for the authenticated user. " +
      "IMPORTANT — multi-row aggregation: a product filter can return MULTIPLE rows (different seed sizes, package types, or staged-only combinations). " +
      "The pre-computed `total_*` fields aggregate ALL matching rows including rows where physical_units_on_hand = 0 but staged_units > 0. " +
      "Always use `total_available_units` as the headline answer — never an individual row's `available_units`. " +
      "Each row includes: `physical_units_on_hand` (warehouse stock = received − delivered + returned), " +
      "`staged_units` (reserved in active staged deliveries, set aside for customers but not yet delivered), and " +
      "`available_units` (physical_units_on_hand − staged_units — what can still be committed). " +
      "Rows where physical_units_on_hand = 0 AND staged_units > 0 are included and MUST contribute to the totals — they represent product set aside for delivery that was never formally received into inventory at that seed size. " +
      "Negative `available_units` means more has been staged or delivered than is physically on hand — surface this as a warning. " +
      "Call this tool for any question about inventory levels, stock quantities, Bag or Seedpak quantities, seed sizes, or staged/reserved units.",
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
            "Partial treatment name to filter by (case-insensitive), e.g. 'PONCHO', 'FUNGICIDE', 'DIAMIDE'. Only set when the user asks about a specific treatment.",
        },
        packageType: {
          type: "string",
          description:
            "Package type filter. Use 'Bag' when user asks about bags, 'Seedpak' when user asks about seedpaks. Omit if not specified.",
        },
        seedSize: {
          type: "string",
          description:
            "Exact seed size to filter by. Only set when the user specifies a seed size.",
        },
      },
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { productName, treatmentName, packageType, seedSize } = input;

      // userClient carries the user's JWT so auth.uid() resolves correctly in the view
      let query = userClient
        .from("v_on_hand_inventory")
        .select(
          "product_name, treatment_name, seed_size, package_type, units_on_hand, units_staged, available_units"
        )
        .order("product_name")
        .order("treatment_name")
        .limit(LIMIT + 1); // fetch one extra to detect truncation

      if (productName) {
        query = query.ilike("product_name", `%${productName}%`);
      }
      if (treatmentName) {
        query = query.ilike("treatment_name", `%${treatmentName}%`);
      }
      if (packageType) {
        query = query.eq("package_type", toDbPackageType(packageType));
      }
      if (seedSize) {
        query = query.eq("seed_size", seedSize);
      }
      // No available_units filter at query level — staged-only rows with negative
      // available_units (physical=0, staged>0) must always be included so the
      // totals are correct. Filtering them out causes the tool to over-report availability.

      const { data, error } = await query;

      if (error) {
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_on_hand_inventory",
          input_json: input,
          output_json: null,
          status: "error",
          error_message: error.message,
        });
        throw new Error(`Inventory query failed: ${error.message}`);
      }

      const truncated = data.length > LIMIT;
      const rows: InventoryRow[] = (truncated ? data.slice(0, LIMIT) : data).map(
        (row) => ({
          product_name: row.product_name as string,
          treatment_name: row.treatment_name as string | null,
          seed_size: row.seed_size as string | null,
          package_type: toDisplayPackageType(row.package_type as string | null),
          // Map DB column names → output field names that are unambiguous for the LLM
          physical_units_on_hand: row.units_on_hand as number,
          staged_units: row.units_staged as number,
          available_units: row.available_units as number,
        })
      );

      const negative_physical_rows = rows.filter((r) => r.physical_units_on_hand < 0);
      const negative_available_rows = rows.filter((r) => r.available_units < 0);

      const total_physical_units_on_hand = rows.reduce(
        (sum, r) => sum + r.physical_units_on_hand,
        0
      );
      const total_staged_units = rows.reduce((sum, r) => sum + r.staged_units, 0);
      const total_available_units = rows.reduce((sum, r) => sum + r.available_units, 0);

      const output: ToolOutput = {
        rows,
        total_physical_units_on_hand,
        has_negative_physical_inventory: negative_physical_rows.length > 0,
        total_staged_units,
        has_staged_inventory: total_staged_units > 0,
        total_available_units,
        has_negative_available_inventory: negative_available_rows.length > 0,
        negative_available_rows,
        row_count: rows.length,
        ...(truncated ? { truncated: true } : {}),
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_on_hand_inventory",
        input_json: input,
        output_json: output,
        status: "success",
        error_message: null,
      });

      return output;
    },
  });
}
