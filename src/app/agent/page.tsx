"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchThreads,
  fetchMessages,
  createThread,
  sendMessage,
  deleteThread,
  type AgentThread,
  type AgentMessage,
} from "@/services/agent.service";
import styles from "./agent.module.css";

const MAX_TITLE_LEN = 40;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + "…";
}

export default function AgentPage() {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNewChat, setIsNewChat] = useState(false); // true = pending thread (no db row yet)

  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load threads on mount
  useEffect(() => {
    fetchThreads()
      .then((data) => {
        setThreads(data);
        if (data.length > 0) {
          selectThread(data[0].id);
        } else {
          setIsNewChat(true);
        }
      })
      .catch(() => setError("Failed to load conversations."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setIsNewChat(false);
    setError(null);
    setMessages([]);
    fetchMessages(threadId)
      .then(setMessages)
      .catch(() => setError("Failed to load messages."));
  }, []);

  const startNewChat = () => {
    setActiveThreadId(null);
    setMessages([]);
    setIsNewChat(true);
    setError(null);
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isSending) return;

    setInput("");
    setError(null);
    setIsSending(true);

    try {
      let threadId = activeThreadId;

      // Create thread on first message
      if (!threadId) {
        const title = truncate(content, MAX_TITLE_LEN);
        const thread = await createThread(title);
        threadId = thread.id;
        setActiveThreadId(thread.id);
        setIsNewChat(false);
        setThreads((prev) => [thread, ...prev]);
      }

      const { userMsg, assistantMsg } = await sendMessage(threadId, content);
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Update thread updated_at in local list (float to top)
      setThreads((prev) => {
        const updated = prev.map((t) =>
          t.id === threadId
            ? { ...t, updated_at: new Date().toISOString() }
            : t
        );
        return [...updated].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDelete = async (
    e: React.MouseEvent,
    threadId: string
  ) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await deleteThread(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
        setIsNewChat(true);
      }
    } catch {
      setError("Failed to delete conversation.");
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const chatTitle = isNewChat
    ? "New Chat"
    : activeThread?.title ?? "New Chat";

  return (
    <div className={styles.root}>
      {/* ---- Thread list ---- */}
      <div className={styles.threadPane}>
        <div className={styles.threadPaneHeader}>
          <span className={styles.threadPaneTitle}>Conversations</span>
          <button className={styles.newChatBtn} onClick={startNewChat}>
            + New
          </button>
        </div>
        <div className={styles.threadList}>
          {threads.length === 0 ? (
            <div className={styles.threadEmpty}>No conversations yet</div>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                className={`${styles.threadItem} ${
                  t.id === activeThreadId ? styles.threadItemActive : ""
                }`}
                onClick={() => selectThread(t.id)}
              >
                <span className={styles.threadItemTitle}>
                  {t.title ?? "New Chat"}
                </span>
                <button
                  className={styles.threadItemDelete}
                  onClick={(e) => handleDelete(e, t.id)}
                  title="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---- Chat pane ---- */}
      <div className={styles.chatPane}>
        <div className={styles.chatHeader}>{chatTitle}</div>

        {/* Messages */}
        <div className={styles.messageList}>
          {messages.length === 0 && !isSending ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateTitle}>
                {isNewChat ? "Start a conversation" : "No messages"}
              </span>
              <span>
                {isNewChat
                  ? "Type a message below to begin."
                  : "This conversation is empty."}
              </span>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`${styles.message} ${
                  msg.role === "user"
                    ? styles.messageUser
                    : styles.messageAssistant
                }`}
              >
                <span className={styles.messageRole}>
                  {msg.role === "user" ? "You" : "Agent"}
                </span>
                <div className={styles.messageBubble}>{msg.content}</div>
              </div>
            ))
          )}
          {isSending && (
            <div className={`${styles.message} ${styles.messageAssistant}`}>
              <span className={styles.messageRole}>Agent</span>
              <div className={styles.messageBubble}>…</div>
            </div>
          )}
          <div ref={messageEndRef} />
        </div>

        {/* Error */}
        {error && <div className={styles.error}>{error}</div>}

        {/* Input */}
        <div className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            className={styles.textInput}
            rows={1}
            placeholder="Ask a question… (Enter to send, Shift+Enter for new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || isSending}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
