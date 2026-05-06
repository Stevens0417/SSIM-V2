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
import { useSpeechToText } from "@/hooks/useSpeechToText";
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
  const [isNewChat, setIsNewChat] = useState(false);

  const messageListRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // When true the next non-empty messages render should snap instantly (thread switch / initial load)
  const snapNextScrollRef = useRef(false);
  // Captures the input value at the moment listening starts so interim results can be appended cleanly
  const inputBeforeRecognitionRef = useRef("");

  const { supported: speechSupported, listening, startListening, stopListening } = useSpeechToText({
    onResult: useCallback((transcript: string, isFinal: boolean) => {
      const base = inputBeforeRecognitionRef.current;
      const joined = base ? base.trimEnd() + " " + transcript : transcript;
      setInput(joined);
      if (isFinal) {
        // Commit so the next interim result appends to this phrase rather than replacing it
        inputBeforeRecognitionRef.current = joined;
      }
    }, []),
  });

  const handleMicClick = () => {
    if (listening) {
      stopListening();
    } else {
      inputBeforeRecognitionRef.current = input;
      startListening();
    }
  };

  // Scroll the message container — instant for thread switches, smooth for new messages
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = messageListRef.current;
    if (!el) return;
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

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

  // Scroll when messages change.
  // Use instant scroll for the first render after a thread switch (snapNextScrollRef),
  // smooth scroll for incremental additions (new user/assistant messages).
  useEffect(() => {
    if (messages.length === 0) return;
    const behavior: ScrollBehavior = snapNextScrollRef.current ? "instant" : "smooth";
    snapNextScrollRef.current = false;
    scrollToBottom(behavior);
  }, [messages, scrollToBottom]);

  // Scroll when the typing indicator appears or disappears so it stays visible
  useEffect(() => {
    scrollToBottom("smooth");
  }, [isSending, scrollToBottom]);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setIsNewChat(false);
    setError(null);
    setMessages([]);
    snapNextScrollRef.current = true;
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

    if (listening) stopListening();

    setInput("");
    setError(null);

    // Show user message immediately (optimistic) before the API round-trip completes
    const optimisticUserMsg: AgentMessage = {
      id: "pending-user",
      thread_id: activeThreadId ?? "",
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
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
      // Replace optimistic user message with server-confirmed messages
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== "pending-user"),
        userMsg,
        assistantMsg,
      ]);

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
      // Remove optimistic message so the user can retry without a duplicate
      setMessages((prev) => prev.filter((m) => m.id !== "pending-user"));
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

  const handleDelete = async (e: React.MouseEvent, threadId: string) => {
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
  const chatTitle = isNewChat ? "New Chat" : activeThread?.title ?? "New Chat";

  return (
    <div className={styles.root}>
      {/* ---- Thread list (desktop only — hidden on mobile via CSS) ---- */}
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
        <div className={styles.chatHeader}>
          {/* Mobile thread selector — hidden on desktop via CSS */}
          <div className={styles.mobileThreadBar}>
            <select
              className={styles.mobileThreadSelect}
              value={activeThreadId ?? "__new__"}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  startNewChat();
                } else {
                  selectThread(e.target.value);
                }
              }}
            >
              <option value="__new__">New Chat</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {truncate(t.title ?? "New Chat", 30)}
                </option>
              ))}
            </select>
            <button
              className={styles.mobileNewChatBtn}
              onClick={startNewChat}
              aria-label="Start new chat"
            >
              + New
            </button>
          </div>
          {/* Desktop title — hidden on mobile via CSS */}
          <span className={styles.chatHeaderTitle}>{chatTitle}</span>
        </div>

        {/* Messages */}
        <div ref={messageListRef} className={styles.messageList}>
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
              <div className={styles.messageBubble}>
                <span className={styles.typingIndicator}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </span>
              </div>
            </div>
          )}
          <div ref={messageEndRef} />
        </div>

        {/* Error */}
        {error && <div className={styles.error}>{error}</div>}

        {/* Input composer */}
        <div className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            className={styles.textInput}
            rows={1}
            placeholder={listening ? "Listening…" : "Ask a question..."}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // If user edits manually while listening, anchor the base to current value
              if (listening) inputBeforeRecognitionRef.current = e.target.value;
            }}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          {speechSupported && (
            <button
              className={`${styles.micBtn} ${listening ? styles.micBtnActive : ""}`}
              onClick={handleMicClick}
              disabled={isSending}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              title={listening ? "Stop listening" : "Voice input"}
              type="button"
            >
              {listening ? (
                /* Stop / square icon when active */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                /* Microphone icon when idle */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          )}
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
