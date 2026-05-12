import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ToolInput {
  delivery_id: string;
}

interface ToolOutput {
  delivery_id: string;
  print_url: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

export function makeGetDeliveryPrintLinkTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns the print URL for a saved delivery. " +
      "Pass any one of the delivery_ids from save_confirmed_delivery — the print page " +
      "automatically groups all lines from the same delivery batch. " +
      "Call this only when the user has confirmed they want to print.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        delivery_id: {
          type: "string",
          description:
            "A delivery ID from save_confirmed_delivery's delivery_ids array. " +
            "Pass the first item in the array.",
        },
      },
      required: ["delivery_id"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // Verify the delivery exists and belongs to this user (RLS enforces ownership)
      const { data, error } = await userClient
        .from("deliveries")
        .select("id")
        .eq("id", input.delivery_id)
        .single();

      if (error || !data) {
        const msg = error?.message ?? "Delivery not found";
        const out: ToolOutput = {
          delivery_id: input.delivery_id,
          print_url: "",
          tool_error: true,
          tool_error_message: msg,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_delivery_print_link",
          input_json: input,
          output_json: out,
          status: "error",
          error_message: msg,
        });
        return out;
      }

      const out: ToolOutput = {
        delivery_id: input.delivery_id,
        print_url: `/deliveries/print/${input.delivery_id}`,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_delivery_print_link",
        input_json: input,
        output_json: out,
        status: "success",
        error_message: null,
      });

      return out;
    },
  });
}
