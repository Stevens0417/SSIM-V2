import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface AgentThread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageAction {
  type: "link";
  label: string;
  href: string;
}

export interface AgentMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: { actions?: MessageAction[] } | null;
  created_at: string;
}

export async function fetchThreads(): Promise<AgentThread[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("agent_threads")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "Failed to load threads");
  return (data ?? []) as AgentThread[];
}

export async function fetchMessages(threadId: string): Promise<AgentMessage[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("agent_messages")
    .select("id, thread_id, role, content, metadata, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "Failed to load messages");
  return (data ?? []) as AgentMessage[];
}

export async function createThread(title: string): Promise<AgentThread> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("agent_threads")
    .insert({ title })
    .select("id, title, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message || "Failed to create thread");
  return data as AgentThread;
}

export async function sendMessage(
  threadId: string,
  content: string
): Promise<{ userMsg: AgentMessage; assistantMsg: AgentMessage }> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Failed to send message");
  }
  return res.json();
}

export async function deleteThread(threadId: string): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const { error } = await sb
    .from("agent_threads")
    .delete()
    .eq("id", threadId);
  if (error) throw new Error(error.message || "Failed to delete thread");
}
