import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ToolInput {
  return_id: string;
}

interface ToolOutput {
  return_id: string;
  print_url: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

export function makeGetReturnPrintLinkTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Returns the print URL for a saved return. " +
      "Pass any one of the return_ids from save_confirmed_return — the print page " +
      "automatically groups all lines from the same return batch. " +
      "Call this immediately after save_confirmed_return succeeds — do not wait for the user to ask.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        return_id: {
          type: "string",
          description:
            "A return ID from save_confirmed_return's return_ids array. " +
            "Pass the first item in the array.",
        },
      },
      required: ["return_id"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // Verify the return exists and belongs to this user (RLS enforces ownership)
      const { data, error } = await userClient
        .from("returns")
        .select("id")
        .eq("id", input.return_id)
        .single();

      if (error || !data) {
        const msg = error?.message ?? "Return not found";
        const out: ToolOutput = {
          return_id: input.return_id,
          print_url: "",
          tool_error: true,
          tool_error_message: msg,
        };
        await serviceClient.from("agent_tool_calls").insert({
          thread_id: threadId,
          message_id: null,
          user_id: userId,
          tool_name: "get_return_print_link",
          input_json: input,
          output_json: out,
          status: "error",
          error_message: msg,
        });
        return out;
      }

      const out: ToolOutput = {
        return_id: input.return_id,
        print_url: `/returns/print/${input.return_id}`,
      };

      await serviceClient.from("agent_tool_calls").insert({
        thread_id: threadId,
        message_id: null,
        user_id: userId,
        tool_name: "get_return_print_link",
        input_json: input,
        output_json: out,
        status: "success",
        error_message: null,
      });

      return out;
    },
  });
}
