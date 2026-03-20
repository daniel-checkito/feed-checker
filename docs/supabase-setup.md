# Supabase Setup

This project now reads Supabase credentials from `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## Current status

The configured host currently returns `521 Web server is down`.  
Auth UI is wired in the app, but Supabase must be reachable for login/signup/reset to work.

## Required Supabase Auth settings

1. In Supabase, enable Email auth provider.
2. Set site URL to your app URL (for local dev: `http://localhost:3000`).
3. Add redirect URL:
   - `http://localhost:3000/#/login`

## Optional next step: user history table

Run this SQL in Supabase if you want per-user history persistence:

```sql
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

alter table public.history_entries enable row level security;

create policy "Users can read own history"
on public.history_entries
for select
using (auth.uid() = user_id);

create policy "Users can insert own history"
on public.history_entries
for insert
with check (auth.uid() = user_id);
```

