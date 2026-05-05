-- =========================================================
-- 0023_agent_tables.sql
--
-- Phase 1 agent chatbot persistence layer.
--
-- Tables:
--   1. agent_threads    — one row per conversation
--   2. agent_messages   — messages within a thread
--   3. agent_tool_calls — future tool call logging (stub)
--
-- All tables are user-scoped (user_id = auth.uid()) with
-- RLS following the existing project pattern.
-- =========================================================


-- ---------------------------------------------------------
-- 1) agent_threads
-- ---------------------------------------------------------
create table if not exists public.agent_threads (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text        null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.agent_threads
  alter column user_id set default auth.uid();

create index if not exists idx_agent_threads_user_updated
  on public.agent_threads (user_id, updated_at desc);

-- updated_at trigger
create or replace function public.set_agent_threads_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_agent_threads_updated_at on public.agent_threads;
create trigger trg_agent_threads_updated_at
  before update on public.agent_threads
  for each row execute function public.set_agent_threads_updated_at();


-- ---------------------------------------------------------
-- 2) agent_messages
-- ---------------------------------------------------------
create table if not exists public.agent_messages (
  id          uuid        primary key default gen_random_uuid(),
  thread_id   uuid        not null references public.agent_threads(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null check (role in ('user', 'assistant', 'system', 'tool')),
  content     text        not null,
  created_at  timestamptz not null default now()
);

alter table public.agent_messages
  alter column user_id set default auth.uid();

create index if not exists idx_agent_messages_thread_created
  on public.agent_messages (thread_id, created_at);


-- ---------------------------------------------------------
-- 3) agent_tool_calls  (stub for Phase 2+)
-- ---------------------------------------------------------
create table if not exists public.agent_tool_calls (
  id            uuid        primary key default gen_random_uuid(),
  thread_id     uuid        not null references public.agent_threads(id) on delete cascade,
  message_id    uuid        null     references public.agent_messages(id) on delete set null,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  tool_name     text        not null,
  input_json    jsonb       null,
  output_json   jsonb       null,
  status        text        not null default 'success',
  error_message text        null,
  created_at    timestamptz not null default now()
);

alter table public.agent_tool_calls
  alter column user_id set default auth.uid();

create index if not exists idx_agent_tool_calls_thread_created
  on public.agent_tool_calls (thread_id, created_at);


-- ---------------------------------------------------------
-- RLS — agent_threads
-- ---------------------------------------------------------
alter table public.agent_threads enable row level security;

drop policy if exists "Users can read own agent_threads"   on public.agent_threads;
drop policy if exists "Users can insert own agent_threads" on public.agent_threads;
drop policy if exists "Users can update own agent_threads" on public.agent_threads;
drop policy if exists "Users can delete own agent_threads" on public.agent_threads;

create policy "Users can read own agent_threads"
  on public.agent_threads for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own agent_threads"
  on public.agent_threads for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own agent_threads"
  on public.agent_threads for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own agent_threads"
  on public.agent_threads for delete to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------
-- RLS — agent_messages
-- ---------------------------------------------------------
alter table public.agent_messages enable row level security;

drop policy if exists "Users can read own agent_messages"   on public.agent_messages;
drop policy if exists "Users can insert own agent_messages" on public.agent_messages;
drop policy if exists "Users can delete own agent_messages" on public.agent_messages;

create policy "Users can read own agent_messages"
  on public.agent_messages for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own agent_messages"
  on public.agent_messages for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete own agent_messages"
  on public.agent_messages for delete to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------
-- RLS — agent_tool_calls
-- ---------------------------------------------------------
alter table public.agent_tool_calls enable row level security;

drop policy if exists "Users can read own agent_tool_calls"   on public.agent_tool_calls;
drop policy if exists "Users can insert own agent_tool_calls" on public.agent_tool_calls;

create policy "Users can read own agent_tool_calls"
  on public.agent_tool_calls for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own agent_tool_calls"
  on public.agent_tool_calls for insert to authenticated
  with check (user_id = auth.uid());
