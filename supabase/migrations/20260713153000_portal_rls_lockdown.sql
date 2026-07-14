-- RLS LOCKDOWN (codifies the live, dashboard-applied hardened state).
--
-- Earlier migrations (20251202093000_fix_rls_and_tables.sql) created PUBLIC policies
-- that granted the anon key SELECT/UPDATE/INSERT on the leads + applications tables —
-- i.e. anyone with the public anon key could read or modify every borrower's PII and
-- application. That hole was closed out-of-band in the Supabase dashboard, but it was
-- never captured in version control, so a `supabase db reset` / new environment would
-- silently RE-OPEN it. This migration makes the locked-down state reproducible.
--
-- Model: RLS stays ENABLED with NO permissive anon policies -> the browser anon key has
-- zero table access. All server code uses the service-role key, which bypasses RLS.
-- Borrower reads/writes go through server routes (/api/portal/*, /api/apply, etc.).

alter table if exists leads enable row level security;
alter table if exists applications enable row level security;

-- Drop the permissive public policies (idempotent).
drop policy if exists "Allow public select leads" on leads;
drop policy if exists "Allow public update leads" on leads;
drop policy if exists "Allow public insert leads" on leads;
drop policy if exists "Allow public select applications" on applications;
drop policy if exists "Allow public insert applications" on applications;
drop policy if exists "Allow public update applications" on applications;

-- No replacement policies: with RLS enabled and no policy, anon is denied by default,
-- which is exactly the intended posture. Do NOT re-add anon policies.
