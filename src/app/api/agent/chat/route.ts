import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/serverClient";
import { makeGetOnHandInventoryTool } from "@/lib/agent/tools";

const SYSTEM_PROMPT = `You are the SSIM assistant for Stevens Seeds Inventory Management. Help users understand and work with their seed sales and inventory management system.

## Available tool: get_on_hand_inventory

Call this tool whenever the user asks about current inventory — including:
- How much inventory / how many units do I have?
- What products are in stock?
- How many Bags or Seedpaks do I have?
- What [treatment] inventory is left? (e.g. PONCHO, FUNGICIDE, DIAMIDE)
- Do I have [product] on hand?
- Show me remaining inventory.
- Any other question about current stock levels or quantities.

### Filter rules — pass ONLY the filters that apply, omit the rest:
- User mentions a product name → set productName (partial name is fine)
- User mentions a treatment (e.g. "PONCHO", "FUNGICIDE") → set treatmentName
- User asks about "Seedpak" or "seedpaks" → set packageType to "Seedpak"
- User asks about "Bag" or "bags" → set packageType to "Bag"
- User mentions a seed size → set seedSize
- User asks about all inventory → call with no filters

### Presenting results:
- Package types are "Bag" and "Seedpak" — never say "tote".
- State total units on hand and highlight key rows.
- If results are truncated, mention that more rows exist.
- For large result sets, summarize by product or treatment rather than listing every row.

## Scope
You do NOT yet have tools for orders, deliveries, customers, pricing, or Bayer shipments. If asked about those topics, explain that data tools for those areas will be added in a future phase.

Respond in a concise, business-friendly tone.`;

export async function POST(req: NextRequest) {
  // Authenticate user via session cookie
  const cookieStore = cookies();
  const anonClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );
  const {
    data: { user },
  } = await anonClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let threadId: string, content: string;
  try {
    ({ threadId, content } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!threadId || !content) {
    return NextResponse.json(
      { error: "threadId and content are required" },
      { status: 400 }
    );
  }

  const sb = getSupabaseServerClient();

  // Verify thread belongs to user
  const { data: thread, error: threadErr } = await sb
    .from("agent_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", user.id)
    .single();
  if (threadErr || !thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Save user message
  const { data: userRow, error: userErr } = await sb
    .from("agent_messages")
    .insert({ thread_id: threadId, user_id: user.id, role: "user", content })
    .select("id, thread_id, role, content, created_at")
    .single();
  if (userErr || !userRow) {
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }

  // Load last 20 messages for context (includes the user message just saved)
  const { data: recentMsgs } = await sb
    .from("agent_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(20);

  const contextMessages = (recentMsgs ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Build tools — anonClient carries the user JWT so auth.uid() works in views
  const tools = {
    get_on_hand_inventory: makeGetOnHandInventoryTool(
      anonClient,
      sb,
      user.id,
      threadId
    ),
  };

  // Call OpenAI — maxSteps allows the model to call a tool and then respond
  let assistantText: string;
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      messages: contextMessages,
      tools,
      stopWhen: stepCountIs(5),
    });
    assistantText = text;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI model error" },
      { status: 502 }
    );
  }

  // Save assistant response
  const { data: asstRow, error: asstErr } = await sb
    .from("agent_messages")
    .insert({
      thread_id: threadId,
      user_id: user.id,
      role: "assistant",
      content: assistantText,
    })
    .select("id, thread_id, role, content, created_at")
    .single();
  if (asstErr || !asstRow) {
    return NextResponse.json({ error: "Failed to save response" }, { status: 500 });
  }

  // Update thread timestamp so it floats to the top of the list
  await sb
    .from("agent_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  return NextResponse.json({ userMsg: userRow, assistantMsg: asstRow });
}
