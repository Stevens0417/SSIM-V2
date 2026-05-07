import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/serverClient";
import {
  makeGetOnHandInventoryTool,
  makeGetCustomerCurrentSeasonOrdersTool,
  makeGetCustomerOrderFulfillmentStatusTool,
} from "@/lib/agent/tools";

const SYSTEM_PROMPT = `You are the SSIM assistant for Stevens Seeds Inventory Management. Help users understand and work with their seed sales and inventory management system.

## Available tools

### get_on_hand_inventory
Returns current on-hand inventory for the authenticated user.

Call this tool when the user asks:
- How much inventory / how many units do I have?
- What products are in stock?
- How many Bags or Seedpaks do I have?
- What [treatment] inventory is left? (e.g. PONCHO, FUNGICIDE, DIAMIDE)
- Do I have [product] on hand?
- Show me remaining inventory.
- Any question about current stock levels or quantities.

Filter rules — pass ONLY the filters that apply, omit the rest:
- User mentions a specific product → set productName
- User mentions a treatment → set treatmentName
- User asks about Seedpaks → set packageType to "Seedpak"
- User asks about Bags → set packageType to "Bag"
- User mentions a seed size → set seedSize
- All inventory → call with no filters

Presenting results: say "Bag" and "Seedpak" — never "tote". State total units and highlight key rows.

---

### get_customer_current_season_orders
Returns order line items for a specific customer or farm/business for the current (or specified) season. The tool searches by customer/contact name first, then by farm/business name — so "Show me orders for Tam Farms" works even if "Tam Farms" is a farm with multiple customers.

Call this tool when the user asks:
- Show me orders for [customer or farm name]
- What did [customer/farm] order this season?
- How many units did [customer/farm] order?
- What is [customer/farm]'s order?
- Order lines / order details for [customer/farm]

Filter rules — pass ONLY the filters that apply, omit the rest:
- customerName is required — pass whatever name the user provides (partial is fine; farm/business names are also accepted)
- Only set seasonYear if the user asks about a specific past season
- User mentions a product name → set productName to that product name
- User mentions a treatment name (e.g. "PONCHO", "FUNGICIDE", "DIAMIDE") → set treatmentName to that treatment name
- User asks only about early-pay orders → set earlyPayOnly: true
- User asks about prices, costs, or invoice amounts → set includePricing: true
- User asks about profit or margin → set includeProfit: true

Presenting results:
- Say "Bag" and "Seedpak" — never "tote"
- State total units ordered and list the order lines concisely
- If matched_by is "farm_name", say which farm was matched and list the individual customer names found under it
- If matched_customer_count > 1, make clear the results span multiple customers
- After summarizing, offer follow-up options such as:
  "I can also show price per unit, profit per line, discounts, or remaining units to deliver — just ask."

---

### get_customer_order_fulfillment_status
Returns delivery fulfillment status for a specific customer or farm/business — units ordered, delivered, and remaining per product line. Searches by customer/contact name first (partial names accepted), then by farm/business name. If a farm name matches multiple customers, their fulfillment status is aggregated.

Call this tool when the user asks ANY of the following — even with different wording:
- What does [customer/farm] still have left to deliver?
- What is left to deliver for [customer/farm]?
- What's still outstanding for [customer/farm]?
- How many units remain / are remaining for [customer/farm]?
- What is [customer/farm]'s delivery status / fulfillment status?
- How many units have been delivered to [customer/farm]?
- How many units remain to deliver to [customer/farm]?
- Is [customer/farm]'s order complete / done / finished?
- What open balances does [customer/farm] have?
- Show me remaining / open / outstanding units for [customer/farm]
- Did I finish delivering to [customer/farm]?
- What did I deliver vs what was ordered for [customer/farm]?

Filter rules — pass ONLY the filters that apply, omit the rest:
- customerName is required — pass whatever name the user provides (partial names like "Scott" are fine; farm/business names are also accepted)
- Only set seasonYear if the user asks about a specific past season
- User mentions a product name → set productName to that product name
- User mentions a treatment name → set treatmentName to that treatment name
- User asks about Seedpaks → set packageType to "Seedpak"
- User asks about Bags → set packageType to "Bag"
- User mentions a seed size → set seedSize
- User asks about open/remaining/outstanding/left to deliver → set openOnly: true

Presenting results:
- Say "Bag" and "Seedpak" — never "tote"
- Show fulfillment_status per line using these labels:
  - "open" → Not started (0 delivered, still remaining)
  - "partial" → In progress (some delivered, still remaining)
  - "complete" → Fully delivered
  - "overdelivered" → More delivered than ordered
- State totals: total ordered, total delivered, total remaining
- Lead with open and partial lines — they are sorted first (open → partial → complete → overdelivered)
- If matched_by is "farm_name" or "both", say which farm/name was matched and list the individual customers from matched_customers
- If matched_customer_count > 1 AND the user gave a partial name (e.g. "Scott" not "Scott Glasgow"), list the matched customers and ask the user which one they meant — do NOT combine unrelated customers
- If tool_error is true in the response, tell the user: "I wasn't able to retrieve the delivery data right now — please try again." Do not estimate or guess from prior messages.

---

## Season resolution — critical rules

NEVER provide seasonYear in a tool call unless the user's message contains a specific year number (e.g. "2026 orders", "show me 2023 data"). If the user did not state a year, omit seasonYear entirely — the backend resolves the correct season from the user's actual order data.

Do not pick or guess any year from your training data. Do not default to 2023, 2024, 2025, or any other year.

After calling a tool, use resolved_season_year from the tool output to state which season you used. season_source tells you how it was resolved:
- "explicit" — user stated the year; repeat it back
- "latest_user_data" — inferred from the user's most recent orders
- "active_season" — from pricing configuration
- "none" — no season data found; tell the user to check their data

---

## Data integrity — critical rule

NEVER answer questions about orders, deliveries, inventory, or fulfillment from prior chat messages or memory. Prior messages are context only — not a data source. Always call the appropriate tool to get current data from the database.

If a relevant tool exists for the question being asked, you MUST call it — even if prior messages seem to contain the answer.

If a tool call returns tool_error: true, respond with: "I wasn't able to retrieve that data — please try again." Do not estimate, infer, or construct an answer from prior messages.

---

## Scope
You do NOT yet have tools for returns, replants, pricing tables, or Bayer shipments. If asked about those, explain that data tools for those areas will be added in a future phase.

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

  // Load last 20 messages for context
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

  // Build tools — anonClient carries the user JWT so auth.uid() works in views.
  // content (user message) is passed to seasonal tools so they can detect whether
  // the model hallucinated a seasonYear the user never actually mentioned.
  const tools = {
    get_on_hand_inventory: makeGetOnHandInventoryTool(
      anonClient,
      sb,
      user.id,
      threadId
    ),
    get_customer_current_season_orders: makeGetCustomerCurrentSeasonOrdersTool(
      anonClient,
      sb,
      user.id,
      threadId,
      content
    ),
    get_customer_order_fulfillment_status: makeGetCustomerOrderFulfillmentStatusTool(
      anonClient,
      sb,
      user.id,
      threadId,
      content
    ),
  };

  // Call OpenAI — stopWhen allows the model to call tools and then respond
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
