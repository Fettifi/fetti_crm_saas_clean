-- RLS LOCKDOWN, PART TWO — the tables the first lockdown did not reach.
--
-- 20260713153000_portal_rls_lockdown.sql closed the permissive anon policies on `leads` and
-- `applications`, and explained exactly why it had to exist: the hole had been closed by hand in
-- the Supabase dashboard, was never captured in version control, and so a `supabase db reset` or a
-- new environment would silently RE-OPEN it.
--
-- That reasoning was right and it was applied to two tables out of five. 20251210_chat_history.sql
-- and 20251203_create_memory.sql still declare, in version control, today:
--
--   create policy "Public conversations select" on conversations for select using (true);
--   create policy "Public conversations insert" on conversations for insert with check (true);
--   create policy "Public conversations update" on conversations for update using (true);
--   create policy "Public messages select"      on messages      for select using (true);
--   create policy "Public messages insert"      on messages      for insert with check (true);
--   create policy "Allow public access"         on rupee_memory  for all using (true) with check (true);
--
-- `using (true)` means the NEXT_PUBLIC anon key — which ships to every browser that loads the site —
-- can read and write those tables directly, bypassing every server route and the proxy.ts auth gate.
--
-- MEASURED AGAINST LIVE 2026-10-11, and this is the part that matters: PRODUCTION IS FINE. The anon
-- key returns ZERO rows from each of them, while the service-role key returns 13 conversations,
-- 170 messages, 1 rupee_memory row, 215 leads and 25,675 activity_log rows. So these policies were
-- dropped out-of-band in the dashboard as well — and, exactly as the first lockdown warned, that
-- was never written down. The database is safe and the REPOSITORY is not, which is the worst
-- version of this to leave alone: nothing is broken today, so nothing prompts anyone to fix it,
-- and the damage lands on whoever next rebuilds from migrations.
--
-- Same model as the first lockdown: RLS stays ENABLED with NO permissive anon policies, so the
-- browser anon key has zero table access. All server code uses the service-role key, which bypasses
-- RLS. Borrower reads/writes go through server routes. Do NOT re-add anon policies.
--
-- Verified by scripts/verify-rls-lockdown.ts, which fails if any of these policies comes back.

alter table if exists conversations enable row level security;
alter table if exists messages      enable row level security;
alter table if exists rupee_memory  enable row level security;

-- Drop the permissive public policies (idempotent).
drop policy if exists "Public conversations select" on conversations;
drop policy if exists "Public conversations insert" on conversations;
drop policy if exists "Public conversations update" on conversations;

drop policy if exists "Public messages select" on messages;
drop policy if exists "Public messages insert" on messages;
drop policy if exists "Public messages update" on messages;

drop policy if exists "Allow public access" on rupee_memory;

-- No replacement policies: with RLS enabled and no policy, anon is denied by default, which is
-- exactly the intended posture and is what production already enforces.
