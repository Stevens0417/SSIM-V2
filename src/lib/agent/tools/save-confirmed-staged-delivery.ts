import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Confirmation guard ───────────────────────────────────────────────────────

const CONFIRM_PATTERNS = [
  /\byes\b/i,
  /\bconfirm\b/i,
  /\bsave it\b/i,
  /\bsave staged delivery\b/i,
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
  draft_type: "staged_delivery";
  staged_delivery_id: string | null;
  lines_saved: number;
  not_confirmed?: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}

// Shape of a resolved item stored in agent_tool_calls.output_json
interface StoredResolvedItem {
  product: { resolved_product_id: string | null; status: string };
  treatment: { resolved_treatment_id: string | null; status: string };
  seed_size: { resolved_seed_size: string | null; status: string };
  package_type: { resolved_package_type: string | null; status: string };
  units_staged: { resolved_units: number | null; status: string };
}

// Shape of the full draft stored in agent_tool_calls.output_json
interface StoredDraftOutput {
  draft_type?: string;
  ready_for_confirmation: boolean;
  customer: { resolved_customer_id: string | null; status: string };
  staged_date: { resolved_date: string | null; status: string };
  season_year: { resolved_season_year: number | null; status: string };
  items: StoredResolvedItem[];
}

// Shape of the draft input stored in agent_tool_calls.input_json
interface StoredDraftInput {
  notes?: string;
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
    tool_name: "save_confirmed_staged_delivery",
    input_json: input,
    output_json: output,
    status,
    error_message: errorMessage,
  });
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function makeSaveConfirmedStagedDeliveryTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Saves a validated staged delivery draft to the database after the user has explicitly confirmed it. " +
      "A staged delivery is product set aside for a customer that is NOT yet an actual delivery. " +
      "MUST only be called when the user's current message is an unambiguous confirmation (yes, confirm, looks good, save it, etc.). " +
      "Requires a draft_id from a previous draft_staged_delivery_from_chat call where ready_for_confirmation was true. " +
      "Writes to staged_deliveries and staged_delivery_items — does NOT run order matching (that only happens at conversion). " +
      "Do NOT call this speculatively or before the user has confirmed the staged delivery summary.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        draft_id: {
          type: "string",
          description:
            "The draft_id returned by draft_staged_delivery_from_chat when ready_for_confirmation was true. Required.",
        },
        confirmation_text: {
          type: "string",
          description:
            "The exact text from the user's current message confirming the staged delivery. " +
            "Must be an unambiguous approval — 'yes', 'confirm', 'save it', 'looks good', 'correct', 'go ahead'. " +
            "Do not pass vague responses like 'ok', 'maybe', or 'sure'.",
        },
      },
      required: ["draft_id", "confirmation_text"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // ── 1. Confirmation guard (double-checked on model text and raw message) ──
      const confirmed =
        isConfirmation(input.confirmation_text) || isConfirmation(userMessage);

      if (!confirmed) {
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
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
        .eq("tool_name", "draft_staged_delivery_from_chat")
        .single();

      if (draftErr || !draftRow) {
        const msg = draftErr?.message ?? "Draft not found";
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: `Draft not found or does not belong to this user. ${msg}`,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const draft = draftRow.output_json as StoredDraftOutput;
      const draftInput = draftRow.input_json as StoredDraftInput;
      const notes = draftInput.notes ?? null;

      // ── 3. Verify this is a staged delivery draft ─────────────────────────
      if (draft.draft_type !== undefined && draft.draft_type !== "staged_delivery") {
        const msg = `Draft is not a staged delivery draft — draft_type is "${draft.draft_type}".`;
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 4. Verify draft is complete ───────────────────────────────────────
      if (!draft.ready_for_confirmation) {
        const msg = "Draft is not ready for confirmation — missing or invalid fields.";
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 5. Duplicate save guard ───────────────────────────────────────────
      const { data: existingSave } = await serviceClient
        .from("agent_tool_calls")
        .select("id")
        .eq("tool_name", "save_confirmed_staged_delivery")
        .eq("status", "success")
        .contains("input_json", { draft_id: input.draft_id })
        .limit(1);

      if (existingSave && existingSave.length > 0) {
        const msg = "This staged delivery draft has already been saved.";
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const customerId = draft.customer.resolved_customer_id;
      const stagedDate = draft.staged_date.resolved_date;
      const seasonYear = draft.season_year.resolved_season_year;

      if (!customerId || !stagedDate || !seasonYear) {
        const msg = "Draft is missing required header fields (customer, date, or season).";
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      // ── 6. Verify all items are fully resolved ────────────────────────────
      for (const item of draft.items) {
        if (
          !item.product.resolved_product_id ||
          !item.treatment.resolved_treatment_id ||
          !item.units_staged.resolved_units
        ) {
          const msg =
            "Draft contains unresolved line items — call draft_staged_delivery_from_chat to resolve them first.";
          const out: ToolOutput = {
            success: false,
            draft_type: "staged_delivery",
            staged_delivery_id: null,
            lines_saved: 0,
            tool_error: true,
            tool_error_message: msg,
          };
          await logCall(serviceClient, threadId, userId, input, out, "error", msg);
          return out;
        }
      }

      // ── 7. Insert staged_deliveries header ────────────────────────────────
      // Use userClient so user_id = auth.uid() is set by the DB column default and RLS.
      const { data: headerData, error: headerErr } = await userClient
        .from("staged_deliveries")
        .insert({
          customer_id: customerId,
          season_year: seasonYear,
          staged_date: stagedDate,
          notes,
          status: "in_progress",
        })
        .select("id")
        .single();

      if (headerErr || !headerData) {
        const msg = headerErr?.message ?? "Failed to create staged delivery header";
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: null,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const stagedDeliveryId = (headerData as { id: string }).id;

      // ── 8. Insert staged_delivery_items ───────────────────────────────────
      interface StagedItemInsertRow {
        staged_delivery_id: string;
        product_id: string;
        treatment_id: string;
        seed_size: string | null;
        package_type: string;
        units_staged: number;
      }

      const itemRows: StagedItemInsertRow[] = draft.items.map((item) => {
        const displayPkg = item.package_type.resolved_package_type ?? "Bag";
        const packageType =
          displayPkg.toLowerCase() === "seedpak" ? "tote" : "bag";
        const seedSize =
          item.seed_size.status === "not_required"
            ? null
            : (item.seed_size.resolved_seed_size ?? null);

        return {
          staged_delivery_id: stagedDeliveryId,
          product_id: item.product.resolved_product_id!,
          treatment_id: item.treatment.resolved_treatment_id!,
          seed_size: seedSize,
          package_type: packageType,
          units_staged: item.units_staged.resolved_units!,
        };
      });

      const { error: itemsErr } = await userClient
        .from("staged_delivery_items")
        .insert(itemRows);

      if (itemsErr) {
        const msg = itemsErr.message ?? "Failed to insert staged delivery items";
        // Header was already inserted — report the partial failure clearly.
        // The header row has no items and will not affect inventory since the
        // staged CTE in v_on_hand_inventory joins through staged_delivery_items.
        const out: ToolOutput = {
          success: false,
          draft_type: "staged_delivery",
          staged_delivery_id: stagedDeliveryId,
          lines_saved: 0,
          tool_error: true,
          tool_error_message: `Header was saved (${stagedDeliveryId}) but items failed: ${msg}. Please check the Staged Deliveries page.`,
        };
        await logCall(serviceClient, threadId, userId, input, out, "error", msg);
        return out;
      }

      const out: ToolOutput = {
        success: true,
        draft_type: "staged_delivery",
        staged_delivery_id: stagedDeliveryId,
        lines_saved: itemRows.length,
      };
      await logCall(serviceClient, threadId, userId, input, out, "success", null);
      return out;
    },
  });
}
