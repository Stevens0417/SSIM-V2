import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Confirmation guard ───────────────────────────────────────────────────────

const CONFIRM_PATTERNS = [
  /\byes\b/i,
  /\bconfirm\b/i,
  /\bconvert it\b/i,
  /\byes,?\s*convert\b/i,
  /\bsave as delivery\b/i,
  /\bmake it a real delivery\b/i,
  /\blooks good\b/i,
  /\bcorrect\b/i,
  /\bgo ahead\b/i,
  /\bdo it\b/i,
  /\byep\b/i,
  /\byup\b/i,
];

function isConfirmation(text: string): boolean {
  return CONFIRM_PATTERNS.some((p) => p.test(text));
}

// ─── Input / Output types ─────────────────────────────────────────────────────

interface ToolInput {
  staged_delivery_id: string;
  confirmation_text: string;
}

interface ToolOutput {
  success: boolean;
  staged_delivery_id: string;
  delivery_ids: string[];
  delivery_id: string | null;
  delivery_rows_created: number;
  customer_name: string | null;
  converted_at: string | null;
  print_url: string | null;
  not_confirmed?: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}

// ─── Server-safe order matching ───────────────────────────────────────────────
// Duplicated from save-confirmed-delivery.ts — server-only tools each carry
// their own copy so there is no cross-tool import coupling.

interface ConvLine {
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
  units: number;
}

interface OrderLineAllocation {
  order_id: string;
  order_item_id: string;
  units: number;
}

type OrderMeta = {
  id: string;
  order_date: string;
  created_at: string;
  early_pay_pct: number | null;
};

type StatusRow = {
  order_id: string;
  order_item_id: string;
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string | null;
  net_units: number;
};

async function serverFindOrderLineMatches(
  userClient: SupabaseClient,
  customerId: string,
  seasonYear: number,
  lines: ConvLine[]
): Promise<OrderLineAllocation[][]> {
  const { data: orders, error: ordersError } = await userClient
    .from("orders")
    .select("id, order_date, created_at, early_pay_pct")
    .eq("customer_id", customerId)
    .eq("season_year", seasonYear);

  if (ordersError)
    throw new Error(ordersError.message || "Failed to fetch orders for matching");

  const orderList = (orders ?? []) as OrderMeta[];
  if (orderList.length === 0) return lines.map(() => []);

  const orderIds = orderList.map((o) => o.id);
  const orderMeta = new Map(orderList.map((o) => [o.id, o]));

  const { data: statusRows, error: statusError } = await userClient
    .from("v_delivery_customer_order_status")
    .select(
      "order_id, order_item_id, product_id, treatment_id, seed_size, package_type, net_units"
    )
    .in("order_id", orderIds);

  if (statusError)
    throw new Error(statusError.message || "Failed to fetch order status for matching");

  const statusList = (statusRows ?? []) as StatusRow[];

  const openUnits = new Map<string, number>(
    statusList.map((r) => [r.order_item_id, Math.max(0, r.net_units)])
  );

  function prioritySort(a: StatusRow, b: StatusRow): number {
    const am = orderMeta.get(a.order_id)!;
    const bm = orderMeta.get(b.order_id)!;
    const aEarly = (am.early_pay_pct ?? 0) > 0 ? 1 : 0;
    const bEarly = (bm.early_pay_pct ?? 0) > 0 ? 1 : 0;
    if (bEarly !== aEarly) return bEarly - aEarly;
    if (am.order_date !== bm.order_date) return am.order_date < bm.order_date ? -1 : 1;
    if (am.created_at !== bm.created_at) return am.created_at < bm.created_at ? -1 : 1;
    return a.order_id < b.order_id ? -1 : 1;
  }

  return lines.map((line) => {
    const candidates = statusList
      .filter(
        (r) =>
          r.product_id === line.product_id &&
          r.treatment_id === line.treatment_id &&
          (r.seed_size ?? null) === (line.seed_size ?? null) &&
          (r.package_type ?? "bag") === line.package_type &&
          (openUnits.get(r.order_item_id) ?? 0) > 0
      )
      .sort(prioritySort);

    if (candidates.length === 0) return [];

    const allocations: OrderLineAllocation[] = [];
    let remaining = line.units;

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const available = openUnits.get(candidate.order_item_id) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      allocations.push({
        order_id: candidate.order_id,
        order_item_id: candidate.order_item_id,
        units: take,
      });
      openUnits.set(candidate.order_item_id, available - take);
      remaining -= take;
    }

    return allocations;
  });
}

// ─── View row shape ───────────────────────────────────────────────────────────

interface StagedDeliveryViewRow {
  staged_delivery_id: string;
  staged_date: string;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  notes: string | null;
  status: string;
  season_year: number;
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
  units_staged: number;
}

// ─── Delivery row shape for insert ───────────────────────────────────────────

interface DeliveryInsertRow {
  delivery_date: string;
  season_year: number;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_delivered: number;
  seed_size: string | null;
  package_type: string;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
  delivery_header_id: string | null;
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function makeConvertConfirmedStagedDeliveryTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Converts a confirmed staged delivery into an actual delivery by running order matching, " +
      "inserting delivery rows, and marking the staged delivery as converted. " +
      "Call this tool ONLY after the user has explicitly confirmed conversion of a specific staged delivery. " +
      "Requires a staged_delivery_id from prepare_staged_delivery_conversion where status was 'ready_for_confirmation'.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        staged_delivery_id: {
          type: "string",
          description:
            "The staged_delivery_id from prepare_staged_delivery_conversion output where status was 'ready_for_confirmation'.",
        },
        confirmation_text: {
          type: "string",
          description:
            "The exact text of the user's confirmation message — 'yes', 'confirm', 'looks good', etc.",
        },
      },
      required: ["staged_delivery_id", "confirmation_text"],
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
          tool_name: "convert_confirmed_staged_delivery",
          input_json: input,
          output_json: out,
          status,
          error_message: errorMsg,
        });
        return out;
      };

      // ── Step 1: Confirmation guard ────────────────────────────────────────
      if (!isConfirmation(input.confirmation_text) && !isConfirmation(userMessage)) {
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: null,
          converted_at: null,
          print_url: null,
          not_confirmed: true,
        };
        return log(out, "not_confirmed", null);
      }

      // ── Step 2: Fetch staged delivery rows via userClient (RLS-enforced) ─
      const { data: viewData, error: viewError } = await userClient
        .from("v_staged_deliveries")
        .select(
          "staged_delivery_id, staged_date, customer_id, customer_name, farm_name, notes, status, season_year, product_id, treatment_id, seed_size, package_type, units_staged"
        )
        .eq("staged_delivery_id", input.staged_delivery_id);

      if (viewError) {
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: null,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: `Failed to fetch staged delivery: ${viewError.message}`,
        };
        return log(out, "error", viewError.message);
      }

      const rows = (viewData ?? []) as StagedDeliveryViewRow[];

      if (rows.length === 0) {
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: null,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message:
            "Staged delivery not found or does not belong to this account.",
        };
        return log(out, "error", "not_found");
      }

      const anchor = rows[0];

      // ── Step 3: Verify status is in_progress ─────────────────────────────
      if (anchor.status !== "in_progress") {
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: anchor.customer_name,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: `This staged delivery has already been ${anchor.status} and cannot be converted again.`,
        };
        return log(out, "error", `status is '${anchor.status}'`);
      }

      // ── Step 4: Build lines for order matching ────────────────────────────
      const lines: ConvLine[] = rows.map((r) => ({
        product_id: r.product_id,
        treatment_id: r.treatment_id,
        seed_size: r.seed_size ?? null,
        package_type: r.package_type,
        units: r.units_staged,
      }));

      // ── Step 5: Run server-safe order matching ────────────────────────────
      let allocationsPerLine: OrderLineAllocation[][];
      try {
        allocationsPerLine = await serverFindOrderLineMatches(
          userClient,
          anchor.customer_id,
          anchor.season_year,
          lines
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Order matching failed";
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: anchor.customer_name,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: msg,
        };
        return log(out, "error", msg);
      }

      // ── Step 6a: Create delivery header ──────────────────────────────────
      const { data: headerData, error: headerErr } = await userClient
        .from("delivery_headers")
        .insert({
          customer_id: anchor.customer_id,
          delivery_date: anchor.staged_date,
          season_year: anchor.season_year,
          notes: anchor.notes ?? null,
        })
        .select("id")
        .single();

      if (headerErr || !headerData) {
        const msg = headerErr?.message ?? "Failed to create delivery header";
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: anchor.customer_name,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: msg,
        };
        return log(out, "error", msg);
      }

      const headerId = (headerData as { id: string }).id;

      // ── Step 6b: Build delivery insert rows ──────────────────────────────
      const deliveryRows: DeliveryInsertRow[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const allocations = allocationsPerLine[i];
        const shared: Omit<DeliveryInsertRow, "units_delivered" | "order_id" | "order_item_id"> = {
          delivery_date: anchor.staged_date,
          season_year: anchor.season_year,
          customer_id: anchor.customer_id,
          product_id: row.product_id,
          treatment_id: row.treatment_id,
          seed_size: row.seed_size ?? null,
          package_type: row.package_type,
          notes: anchor.notes ?? null,
          delivery_header_id: headerId,
        };

        if (allocations.length === 0) {
          deliveryRows.push({
            ...shared,
            units_delivered: row.units_staged,
            order_id: null,
            order_item_id: null,
          });
        } else {
          let allocated = 0;
          for (const alloc of allocations) {
            deliveryRows.push({
              ...shared,
              units_delivered: alloc.units,
              order_id: alloc.order_id,
              order_item_id: alloc.order_item_id,
            });
            allocated += alloc.units;
          }
          const remainder = row.units_staged - allocated;
          if (remainder > 0) {
            deliveryRows.push({
              ...shared,
              units_delivered: remainder,
              order_id: null,
              order_item_id: null,
            });
          }
        }
      }

      // ── Step 7: Insert delivery rows via userClient ───────────────────────
      // user_id is set by DB DEFAULT auth.uid() — do not include it in the insert.
      const { data: insertedDeliveries, error: insertError } = await userClient
        .from("deliveries")
        .insert(deliveryRows)
        .select("id");

      if (insertError || !insertedDeliveries) {
        const msg = insertError?.message ?? "Failed to insert delivery rows";
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: [],
          delivery_id: null,
          delivery_rows_created: 0,
          customer_name: anchor.customer_name,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: msg,
        };
        return log(out, "error", msg);
      }

      const deliveryIds = (insertedDeliveries as Array<{ id: string }>).map((r) => r.id);

      // ── Step 8: Mark staged delivery as converted ─────────────────────────
      // AND status = 'in_progress' guard prevents a race condition where two
      // concurrent conversion attempts could both succeed.
      const convertedAt = new Date().toISOString();
      const { error: updateError } = await userClient
        .from("staged_deliveries")
        .update({ status: "converted", converted_at: convertedAt })
        .eq("id", input.staged_delivery_id)
        .eq("status", "in_progress");

      if (updateError) {
        const msg =
          "Delivery rows were created but the staged delivery could not be marked as converted. " +
          "Check the Deliveries page and refresh the Staged Deliveries list. Error: " +
          updateError.message;
        const out: ToolOutput = {
          success: false,
          staged_delivery_id: input.staged_delivery_id,
          delivery_ids: deliveryIds,
          delivery_id: deliveryIds[0] ?? null,
          delivery_rows_created: deliveryIds.length,
          customer_name: anchor.customer_name,
          converted_at: null,
          print_url: null,
          tool_error: true,
          tool_error_message: msg,
        };
        return log(out, "error", updateError.message);
      }

      // ── Step 9: Build print URL and return ───────────────────────────────
      const firstDeliveryId = deliveryIds[0] ?? null;
      const printUrl = firstDeliveryId ? `/deliveries/print/${firstDeliveryId}` : null;

      const out: ToolOutput = {
        success: true,
        staged_delivery_id: input.staged_delivery_id,
        delivery_ids: deliveryIds,
        delivery_id: firstDeliveryId,
        delivery_rows_created: deliveryIds.length,
        customer_name: anchor.customer_name,
        converted_at: convertedAt,
        print_url: printUrl,
      };
      return log(out, "success", null);
    },
  });
}
