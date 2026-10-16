-- THE CREDENTIAL STORE IS NOT IN VERSION CONTROL. IT IS THE ONE TABLE THAT MOST NEEDS TO BE.
--
-- `app_settings` is the runtime config store behind lib/settings.ts — getSetting, setSetting,
-- casSetting, cfg. Measured with the service role on 2026-10-15: 1,501 rows, and the key names
-- include META_APP_SECRET, MS_GRAPH_CLIENT_SECRET, ANTHROPIC_API_KEY, CARTESIA_API_KEY,
-- GEMINI_API_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN, META_ACCESS_TOKEN,
-- VOICE_INGEST_TOKEN, PRICING_FEED_TOKEN, EMAIL_INBOUND_SECRET and OUTLOOK_ADDIN_KEY. One
-- permissive policy on this table hands a browser the mailbox, the ad accounts and the model keys
-- at once. A grep of supabase/migrations/ for "app_settings" on 2026-10-15 returned NOTHING.
--
-- PRODUCTION IS CORRECT TODAY, AND THAT IS NOT THE POINT. Measured before writing this, with the
-- TRUE row count beside the anon read, because a zero-row anon read on an empty table is not
-- evidence of anything: service role 1,501 rows / anon key 0 rows, HTTP 200 — i.e. the anon role
-- holds the Data API grant and RLS is enabled with no policy, so it is filtered to nothing.
--
-- What is wrong is the same thing that was wrong twice before in this directory
-- (20260713153000_portal_rls_lockdown.sql, 20261011230000_rls_lockdown_chat_and_memory.sql): the
-- posture exists only in the live database. Here it is worse than a permissive policy in the repo,
-- because the table itself is absent — so a new project, a preview branch or a `supabase db reset`
-- comes up with NO app_settings at all, every getSetting returns null, and the first person to
-- notice fixes it the fastest way there is: creating the table by hand in the dashboard. A table
-- created by hand in `public` has ROW LEVEL SECURITY OFF, and Supabase's default grants give anon
-- SELECT. That is 1,501 secrets readable with the key that ships in every browser.
--
-- So this migration does nothing to production (create if not exists, and RLS is already enabled)
-- and everything to a rebuild: the credential store comes back locked, or it does not come back.
--
-- Shape taken from the live Data API schema, 2026-10-15: key text PRIMARY KEY, value text,
-- updated_at timestamptz not null default now(). lib/settings.ts upserts on `key` and
-- compare-and-sets on `updated_at`, both of which this preserves.

create table if not exists public.app_settings (
  key        text        primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- Service role only. Every reader and writer of this table is a server route going through
-- lib/supabaseAdminClient (lib/settings.ts has no browser caller — checked across app/ and
-- components/ on 2026-10-15). The grant is also what keeps the table reachable at all after
-- Supabase's 2026-10-30 Data API change on rebuilds; see scripts/verify-supabase-grants.ts.
-- Deliberately NO grant to anon or authenticated: nothing in the app needs one, and granting one
-- "just in case" is how the storage bucket hole was opened.
grant select, insert, update, delete on public.app_settings to service_role;

-- RLS on with NO policy: the browser key reads nothing, which is what production already enforces.
-- Do NOT add a policy here. A borrower- or employee-facing value that genuinely needs to reach a
-- browser belongs in a server route that decides what to expose, not in a blanket read of a table
-- whose other rows are live API credentials.
alter table public.app_settings enable row level security;

comment on table public.app_settings is
  'Runtime config AND machine credentials (API keys, OAuth refresh tokens, webhook secrets). RLS enabled, no policy, service_role only — see 20261016060000_app_settings_lockdown.sql. Reached only through lib/settings.ts on the server. scripts/verify-rls-lockdown.ts --live proves the anon key reads zero rows.';
