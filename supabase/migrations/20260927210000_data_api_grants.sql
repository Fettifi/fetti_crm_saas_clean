-- DATA API GRANTS — make this migration set reproducible after Supabase's 2026-10-30 change.
--
-- Supabase notice, 2026-09-23 (found in GoDaddy mail quarantine on 09-27, never delivered to the inbox):
--   "On October 30, Supabase will stop automatically granting Data API access to new tables in the
--    public schema for existing projects... Migrations count too. From October 30, any migration that
--    creates a table without the required grants leaves that table unreachable through the Data API.
--    That includes new projects, preview branches, and a local `supabase db reset`."
--
-- Production is NOT broken by this: tables that already exist keep the grants they were given
-- automatically. What the change breaks is REBUILDS — a new project, a preview branch, or
-- `supabase db reset` replayed from supabase/migrations/ — where these 9 tables would come back with no
-- Data API access, surfacing later as a runtime "permission denied" nowhere near its cause.
--
-- WHY THESE ROLES, AND WHY THIS IS NOT A NEW EXPOSURE.
-- This restates the grant set Supabase applied automatically before 10-30, so a rebuilt database matches
-- what production already has rather than diverging from it. GRANTs are additive and idempotent, so
-- applying this to production changes nothing there.
-- ROW LEVEL SECURITY, not the grant, decides which ROWS a role may read, and RLS is enabled on all nine
-- of these tables (verified 2026-09-27 against the migrations that create them). A grant without a
-- matching policy still returns zero rows — which is exactly the state the four radar_* tables are in:
-- RLS enabled, no policies, therefore service_role-only by design. Granting anon there is a no-op kept
-- only for parity with production.
-- Both key types are in live use, so both roles are required: lib/supabaseClient.ts, lib/authSession.ts
-- and app/api/leads/route.ts read with the anon key; lib/supabaseAdminClient.ts, lib/doctor.ts and
-- lib/eventPhotos.ts use the service-role key.
--
-- NO SEQUENCE GRANTS ARE NEEDED HERE. radar_parcels, radar_events and radar_contacts use
-- `bigint generated always as identity`, whose sequence is internally linked and needs no separate
-- privilege. If anyone later adds a `serial` column, that sequence DOES need `usage, select` — and
-- scripts/verify-supabase-grants.ts will not catch it, because it checks tables, not sequences.
--
-- Enforced going forward by `npm run verify:supabase-grants`, wired into scripts/hooks/pre-commit.

grant select, insert, update, delete on public.leads           to anon, authenticated, service_role;
grant select, insert, update, delete on public.applications    to anon, authenticated, service_role;
grant select, insert, update, delete on public.rupee_memory    to anon, authenticated, service_role;
grant select, insert, update, delete on public.conversations   to anon, authenticated, service_role;
grant select, insert, update, delete on public.messages        to anon, authenticated, service_role;

-- RLS enabled with NO policies: deny-all to anon/authenticated, reachable only by service_role, which
-- bypasses RLS. Grants kept at parity with production deliberately; the lockdown is the policy layer.
grant select, insert, update, delete on public.radar_parcels   to anon, authenticated, service_role;
grant select, insert, update, delete on public.radar_events    to anon, authenticated, service_role;
grant select, insert, update, delete on public.radar_lists     to anon, authenticated, service_role;
grant select, insert, update, delete on public.radar_contacts  to anon, authenticated, service_role;
