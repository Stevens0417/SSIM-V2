import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/serverClient";

const SYSTEM_PROMPT =
  "You are the SSIM assistant. Help users understand and work with their seed sales and inventory management system. In this phase, you do not have access to live business data or database tools yet. If the user asks for specific data, explain that data tools will be added in a future phase.";

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

  // Call OpenAI
  let assistantText: string;
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      messages: contextMessages,
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
