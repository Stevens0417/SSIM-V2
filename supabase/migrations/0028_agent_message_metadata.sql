-- =========================================================
-- 0028_agent_message_metadata.sql
--
-- Adds an optional metadata jsonb column to agent_messages.
-- Used to store server-generated action buttons (e.g. print
-- delivery slip) that are rendered in the chat UI.
-- Metadata is populated by the API route from tool results —
-- never from free-form model text — so URLs are safe.
-- =========================================================

alter table public.agent_messages
  add column if not exists metadata jsonb;
