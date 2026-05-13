import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ToolInput {
  replant_id: string;
}

interface ToolOutput {
  replant_id: string;
  print_url: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

export function makeGetReplantPrintLinkTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns the print URL for a saved replant. " +
      "Pass any one of the replant_ids from save_confirmed_replant — the print page " +
      "automatically groups all lines from the same replant batch. " +
      "Call this only when the user has confirmed they want to print.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        replant_id: {
          type: "string",
          description:
            "A replant ID from save_confirmed_replant's replant_ids array. " +
            "Pass the first item in the array.",
        },
      },
      required: ["replant_id"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // Verify the replant exists and belongs to this user (RLS enforces ownership)
      const { data, error } = await userClient
        .from("replants")
        .select("id")
        .eq("id", input.replant_id)
        .single();

      if (error || !data) {
        const msg = error?.message ?? "Replant not found";
        const out: ToolOutput = {
          replant_id: input.replant_id,
          print_url: "",
          tool_error: true,
          tool_error_message: msg,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_replant_print_link",
          input_json: input,
          output_json: out,
          status: "error",
          error_message: msg,
        });
        return out;
      }

      const out: ToolOutput = {
        replant_id: input.replant_id,
        print_url: `/replants/print/${input.replant_id}`,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_replant_print_link",
        input_json: input,
        output_json: out,
        status: "success",
        error_message: null,
      });

      return out;
    },
  });
}
