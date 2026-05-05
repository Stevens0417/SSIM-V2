# Agent System Overview

## Purpose
The agent chatbot allows users to ask natural language questions about their data (inventory, orders, deliveries, returns, etc.) and receive clear answers.

The system is designed to be:
- Safe (no direct database access from the model)
- Transparent (all actions logged)
- Scalable (structured conversation storage)
- Extensible (tools first, SQL fallback later)

---

## Core Principles

1. **Tools-first access**
   - The agent must use approved backend tools to answer questions
   - Tools are built on top of approved database views

2. **No direct SQL execution by the agent**
   - The agent cannot execute raw SQL
   - All data access must go through backend-controlled tools

3. **Store everything, send only what is needed**
   - Full conversation history is stored
   - Only relevant context is sent to the model

4. **User-scoped data**
   - All data is filtered by `user_id`
   - No cross-user data access is allowed

---

## System Components

- Chat UI (frontend)
- Agent API (backend)
- Tools layer (approved data access)
- Database (Supabase)
- Conversation storage (threads, messages, tool calls)

---

## Initial Scope (Phase 1–2)

Included:
- Chat UI
- Thread + message storage
- Tool-based answers
- Tool call logging

Not included yet:
- SQL fallback
- Summaries
- Long-term memory