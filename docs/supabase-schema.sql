-- Run this in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.history_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  uploaded_at timestamptz not null default now(),
  row_count int,
  header_count int,
  score int,
  issues_count int
);

create table if not exists public.feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_email text,
  contact text,
  route text,
  file_name text,
  message text not null,
  status text not null default 'Open',
  created_at timestamptz not null default now()
);

alter table public.history_entries enable row level security;
alter table public.feedback_tickets enable row level security;

drop policy if exists "history_select_own" on public.history_entries;
create policy "history_select_own"
on public.history_entries
for select
using (auth.uid() = user_id);

drop policy if exists "history_insert_own" on public.history_entries;
create policy "history_insert_own"
on public.history_entries
for insert
with check (auth.uid() = user_id);

-- Ticket visibility currently open to signed-in users
drop policy if exists "tickets_select_authenticated" on public.feedback_tickets;
create policy "tickets_select_authenticated"
on public.feedback_tickets
for select
using (auth.uid() is not null);

drop policy if exists "tickets_insert_authenticated" on public.feedback_tickets;
create policy "tickets_insert_authenticated"
on public.feedback_tickets
for insert
with check (auth.uid() is not null or reporter_email is not null);

