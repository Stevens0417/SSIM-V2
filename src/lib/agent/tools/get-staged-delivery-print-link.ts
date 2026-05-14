import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ToolInput {
  staged_delivery_id: string;
}

interface ToolOutput {
  staged_delivery_id: string;
  print_url: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

export function makeGetStagedDeliveryPrintLinkTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns the print URL for a saved staged delivery. " +
      "Pass the staged_delivery_id returned by save_confirmed_staged_delivery. " +
      "Call this only when the user has confirmed they want to print.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        staged_delivery_id: {
          type: "string",
          description:
            "The staged_delivery_id returned by save_confirmed_staged_delivery.",
        },
      },
      required: ["staged_delivery_id"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // Verify the staged delivery exists and belongs to this user (RLS enforces ownership)
      const { data, error } = await userClient
        .from("staged_deliveries")
        .select("id")
        .eq("id", input.staged_delivery_id)
        .single();

      if (error || !data) {
        const msg = error?.message ?? "Staged delivery not found";
        const out: ToolOutput = {
          staged_delivery_id: input.staged_delivery_id,
          print_url: "",
          tool_error: true,
          tool_error_message: msg,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_staged_delivery_print_link",
          input_json: input,
          output_json: out,
          status: "error",
          error_message: msg,
        });
        return out;
      }

      const out: ToolOutput = {
        staged_delivery_id: input.staged_delivery_id,
        print_url: `/staged-deliveries/print/${input.staged_delivery_id}`,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_staged_delivery_print_link",
        input_json: input,
        output_json: out,
        status: "success",
        error_message: null,
      });

      return out;
    },
  });
}
