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
  minAvailableUnits?: number;
}

interface InventoryRow {
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_on_hand: number;
  units_staged: number;
  available_units: number;
}

interface ToolOutput {
  rows: InventoryRow[];
  // Physical on hand
  total_units_on_hand: number;
  total_positive_units_on_hand: number;
  total_negative_units_on_hand: number;
  has_negative_inventory: boolean;
  negative_rows: InventoryRow[];
  // Staged
  total_units_staged: number;
  has_staged_inventory: boolean;
  // Available (physical minus staged)
  total_available_units: number;
  has_negative_available: boolean;
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
      "Returns current inventory for the authenticated user including physical units on hand, staged units (reserved for customers in staged deliveries), and available units (physical minus staged). Call this for any question about inventory levels, stock quantities, Bag or Seedpak quantities, seed sizes, or staged/reserved units. Negative available_units means more has been staged or delivered than is physically on hand — always surface this to the user.",
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
        minAvailableUnits: {
          type: "number",
          description:
            "Only include rows with at least this many available units. Omit unless the user specifies a minimum quantity.",
        },
      },
      additionalProperties: false,
    }),
    execute: async (input: ToolInput): Promise<ToolOutput> => {
      const { productName, treatmentName, packageType, seedSize, minAvailableUnits } =
        input;

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
      if (minAvailableUnits !== undefined) {
        query = query.gte("available_units", minAvailableUnits);
      }

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
          units_on_hand: row.units_on_hand as number,
          units_staged: row.units_staged as number,
          available_units: row.available_units as number,
        })
      );

      const negative_rows = rows.filter((r) => r.units_on_hand < 0);
      const positive_rows = rows.filter((r) => r.units_on_hand > 0);
      const negative_available_rows = rows.filter((r) => r.available_units < 0);

      const total_units_on_hand = rows.reduce((sum, r) => sum + r.units_on_hand, 0);
      const total_positive_units_on_hand = positive_rows.reduce(
        (sum, r) => sum + r.units_on_hand,
        0
      );
      const total_negative_units_on_hand = negative_rows.reduce(
        (sum, r) => sum + r.units_on_hand,
        0
      );
      const total_units_staged = rows.reduce((sum, r) => sum + r.units_staged, 0);
      const total_available_units = rows.reduce((sum, r) => sum + r.available_units, 0);

      const output: ToolOutput = {
        rows,
        total_units_on_hand,
        total_positive_units_on_hand,
        total_negative_units_on_hand,
        has_negative_inventory: negative_rows.length > 0,
        negative_rows,
        total_units_staged,
        has_staged_inventory: total_units_staged > 0,
        total_available_units,
        has_negative_available: negative_available_rows.length > 0,
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
