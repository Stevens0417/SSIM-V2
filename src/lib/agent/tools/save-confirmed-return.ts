import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Confirmation guard ───────────────────────────────────────────────────────

const CONFIRM_PATTERNS = [
  /\byes\b/i,
  /\bconfirm\b/i,
  /\bsave it\b/i,
  /\bsave return\b/i,
  /\bsave this\b/i,
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
  draft_id: string;
  confirmation_text: string;
}

interface ToolOutput {
  success: boolean;
  return_ids: string[];
  lines_saved: number;
  unlinked_lines: number;
  not_confirmed?: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}

// Shape of a resolved item stored in agent_tool_calls.output_json by draft_return_from_chat
interface StoredResolvedItem {
  product: { resolved_product_id: string | null; status: string };
  treatment: { resolved_treatment_id: string | null; status: string };
  seed_size: { resolved_seed_size: string | null; status: string };
  package_type: { resolved_package_type: string | null; status: string };
  units_returned: { resolved_units: number | null; status: string };
}

// Shape of the full draft output stored in agent_tool_calls.output_json
interface StoredDraftOutput {
  draft_type?: string;
  ready_for_confirmation: boolean;
  customer: { resolved_customer_id: string | null; status: string };
  return_date: { resolved_date: string | null; status: string };
  season_year: { resolved_season_year: number | null; status: string };
  items: StoredResolvedItem[];
}

interface StoredDraftInput {
  notes?: string;
}

// ─── Server-side order matching ───────────────────────────────────────────────
// Same FIFO allocation logic as deliveries and replants.

interface SaveLine {
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
  lines: SaveLine[]
): Promise<OrderLineAllocation[][]> {
  const { data: orders, error: ordersError } = await userClient
    .from("orders")
    .select("id, order_date, created_at, early_pay_pct")
    .eq("customer_id", customerId)
    .eq("season_year", seasonYear);

  if (ordersError) throw new Error(ordersError.message || "Failed to fetch orders for matching");

  const orderList = (orders ?? []) as OrderMeta[];
  if (orderList.length === 0) return lines.map(() => []);

  const orderIds = orderList.map((o) => o.id);
  const orderMeta = new Map(orderList.map((o) => [o.id, o]));

  const { data: statusRows, error: statusError } = await userClient
    .from("v_delivery_customer_order_status")
    .select("order_id, order_item_id, product_id, treatment_id, seed_size, package_type, net_units")
    .in("order_id", orderIds);

  if (statusError) throw new Error(statusError.message || "Failed to fetch order status for matching");

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

// ─── Logging helper ───────────────────────────────────────────────────────────

async function logCall(
  serviceClient: SupabaseClient,
  threadId: string,
  userId: string,
  input: ToolInput,
  output: ToolOutput,
  status: string,
  errorMessage: string | null
): Promise<void> {
  await serviceClient.from("agent_tool_calls").insert({
    thread_id: threadId,
    message_id: null,
    user_id: userId,
    tool_name: "save_confirmed_return",
    input_json: input,
    output_json: output,
    status,
    error_message: errorMessage,
  });
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function makeSaveConfirmedReturnTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Saves a validated return draft to the database after the user has explicitly confirmed it. " +
      "MUST only be called when the user's current message is an unambiguous confirmation (yes, confirm, looks good, save it, etc.). " +
      "Requires a draft_id from a previous draft_return_from_chat call where ready_for_confirmation was true. " +
      "Runs order matching before inserting — early-pay lines first, then oldest order. " +
      "Do NOT call this speculatively or before the user has confirmed the return summary.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        draft_id: {
          type: "string",
          description:
            "The draft_id returned by draft_return_from_chat when ready_for_confirmation was true. Required.",
        },
        confirmation_text: {
          type: "string",
          description:
            "The exact text from the user's current message confirming the return. " +
            "Must be an unambiguous approval — 'yes', 'confirm', 'save it', 'looks good', 'correct', 'go ahead'. " +
            "Do not pass vague responses like 'ok', 'maybe', or 'sure'.",
        },
      },
      required: ["draft_id", "confirmation_text"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // ── 1. Confirmation guard — checked on both model text and raw user message ──
      const confirmed =
        isConfirmation(input.confirmation_text) || isConfirmation(userMessage);

      if (!confirmed) {
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          not_confirmed: true,
        };
        await logCall(serviceClient, threadId, userId, input, out, "not_confirmed", null);
        return out;
      }

      // ── 2. Load draft — userClient enforces RLS (user can only read own rows) ──
      const { data: draftRow, error: draftErr } = await userClient
        .from("agent_tool_calls")
        .select("input_json, output_json")
        .eq("id", input.draft_id)
        .eq("tool_name", "draft_return_from_chat")
        .single();

      if (draftErr || !draftRow) {
        const msg = draftErr?.message ?? "Draft not found";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: `Return draft not found or does not belong to this user. ${msg}`,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const draft = draftRow.output_json as StoredDraftOutput;
      const draftInput = draftRow.input_json as StoredDraftInput;
      const notes = draftInput.notes ?? null;

      // ── 3. Verify this is a return draft and it is complete ───────────────────
      if (draft.draft_type !== "return") {
        const msg = "Draft is not a return draft — draft_type mismatch.";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      if (!draft.ready_for_confirmation) {
        const msg = "Return draft is not ready for confirmation — missing or invalid fields.";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 4. Check for duplicate save — prevent re-saving the same draft ────────
      const { data: existingSave } = await serviceClient
        .from("agent_tool_calls")
        .select("id")
        .eq("tool_name", "save_confirmed_return")
        .eq("status", "success")
        .contains("input_json", { draft_id: input.draft_id })
        .limit(1);

      if (existingSave && existingSave.length > 0) {
        const msg = "This return draft has already been saved.";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const customerId = draft.customer.resolved_customer_id;
      const returnDate = draft.return_date.resolved_date;
      const seasonYear = draft.season_year.resolved_season_year;

      if (!customerId || !returnDate || !seasonYear) {
        const msg = "Return draft is missing required header fields (customer, date, or season).";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 5. Build save lines from resolved items ───────────────────────────────
      const saveLines: SaveLine[] = [];

      for (const item of draft.items) {
        const productId = item.product.resolved_product_id;
        const treatmentId = item.treatment.resolved_treatment_id;
        const units = item.units_returned.resolved_units;

        if (!productId || !treatmentId || !units) {
          const msg = "Return draft contains unresolved line items — call draft_return_from_chat to resolve them first.";
          const out: ToolOutput = {
            success: false,
            return_ids: [],
            lines_saved: 0,
            unlinked_lines: 0,
            tool_error: true,
            tool_error_message: msg,
          };
          await logCall(serviceClient, threadId, userId, input, out, "error", msg);
          return out;
        }

        const displayPkg = item.package_type.resolved_package_type ?? "Bag";
        const packageType = displayPkg.toLowerCase() === "seedpak" ? "tote" : "bag";
        const seedSize =
          item.seed_size.status === "not_required"
            ? null
            : (item.seed_size.resolved_seed_size ?? null);

        saveLines.push({ product_id: productId, treatment_id: treatmentId, seed_size: seedSize, package_type: packageType, units });
      }

      // ── 6. Order matching ─────────────────────────────────────────────────────
      let allocationsByLine: OrderLineAllocation[][];
      try {
        allocationsByLine = await serverFindOrderLineMatches(
          userClient,
          customerId,
          seasonYear,
          saveLines
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Order matching failed";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 7. Build return insert rows ───────────────────────────────────────────
      interface ReturnInsertRow {
        return_date: string;
        season_year: number;
        customer_id: string;
        product_id: string;
        treatment_id: string;
        units_returned: number;
        seed_size: string | null;
        package_type: string;
        order_id: string | null;
        order_item_id: string | null;
        notes: string | null;
      }

      const insertRows: ReturnInsertRow[] = [];
      let unlinkedLines = 0;

      for (let i = 0; i < saveLines.length; i++) {
        const line = saveLines[i];
        const allocations = allocationsByLine[i] ?? [];

        const baseRow = {
          return_date: returnDate,
          season_year: seasonYear,
          customer_id: customerId,
          product_id: line.product_id,
          treatment_id: line.treatment_id,
          seed_size: line.seed_size,
          package_type: line.package_type,
          notes,
        };

        if (allocations.length === 0) {
          unlinkedLines++;
          insertRows.push({ ...baseRow, units_returned: line.units, order_id: null, order_item_id: null });
        } else {
          let remaining = line.units;
          for (const alloc of allocations) {
            insertRows.push({ ...baseRow, units_returned: alloc.units, order_id: alloc.order_id, order_item_id: alloc.order_item_id });
            remaining -= alloc.units;
          }
          if (remaining > 0) {
            unlinkedLines++;
            insertRows.push({ ...baseRow, units_returned: remaining, order_id: null, order_item_id: null });
          }
        }
      }

      // ── 8. Atomic insert ──────────────────────────────────────────────────────
      const { data: inserted, error: insertErr } = await userClient
        .from("returns")
        .insert(insertRows)
        .select("id");

      if (insertErr || !inserted) {
        const msg = insertErr?.message ?? "Failed to insert return rows";
        const out: ToolOutput = {
          success: false,
          return_ids: [],
          lines_saved: 0,
          unlinked_lines: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const returnIds = (inserted as Array<{ id: string }>).map((r) => r.id);
      const out: ToolOutput = {
        success: true,
        return_ids: returnIds,
        lines_saved: insertRows.length,
        unlinked_lines: unlinkedLines,
      };
      await logCall(serviceClient, threadId, userId, input, out, "success", null);
      return out;
    },
  });
}
