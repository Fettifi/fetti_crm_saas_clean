-- THE THROTTLE THAT EVERY PUBLIC ROUTE DEPENDS ON WAS IN NO MIGRATION AT ALL.
--
-- lib/rateLimit.ts calls supabaseAdmin.rpc("rate_limit_hit", { p_key, p_limit, p_window }). That
-- function, and the rate_limits table behind it, existed ONLY in the production database. Grep
-- for "rate_limit_hit" across the whole repo on 2026-10-15 returned exactly two hits: the call in
-- lib/rateLimit.ts and a comment in app/api/sms/inbound/route.ts. Nothing created either object.
--
-- WHAT THAT COSTS A FRESH ENVIRONMENT (new project, preview branch, `supabase db reset`). The RPC
-- is absent, so supabaseAdmin.rpc rejects, and lib/rateLimit.ts is fail-OPEN by design. MEASURED,
-- not reasoned: with the Supabase env stripped so the RPC is genuinely unreachable,
--
--     rateLimit(key, 1, 60)                       -> true     (allowed, every single time)
--     rateLimit(key, 1, 60, { failClosed: true }) -> false
--
-- so on a rebuild EVERY throttle in the app is simply off, silently, and the three things that are
-- not really throttles at all go with it:
--   • app/api/sms/inbound/route.ts uses rateLimit(`smsidem:<MessageSid>`, 1, 3 days) as the
--     IDEMPOTENCY gate in front of every side effect in that route. Fail-open means a Twilio
--     redelivery double-inserts the owner's dictated task, re-fires a keyword opt-in alert, and
--     creates a phantom duplicate lead.
--   • the OTP routes pass failClosed:true, so a borrower cannot get into her document portal at
--     all — the limiter denies before the code is ever sent.
--   • app/api/apply, /track, /proof/submit and the Shield velocity caps run with no ceiling.
--
-- HOW THIS DEFINITION WAS ESTABLISHED. The live function could not be read: there is no psql, no
-- Supabase CLI and no exec-SQL RPC on this machine, so pg_get_functiondef was out of reach. It was
-- therefore RECONSTRUCTED FROM OBSERVED BEHAVIOUR plus the call site — and the observations are
-- recorded here so the next person can tell measurement from assumption. Probed against production
-- on 2026-10-15 with a throwaway key:
--
--     signature accepted: (p_key, p_limit, p_window); (key, limit, window_seconds) -> PGRST202
--     returns: boolean
--     table shape (from the Data API schema): rate_limits(key text PRIMARY KEY,
--                 count integer not null default 0, reset_at timestamptz not null default now())
--     5 calls with p_limit=3 on a fresh key -> true, true, true, false, false
--     the row left behind -> count = 5, so the counter increments on DENIED calls too
--     reset_at on the first call -> now() + p_window exactly (60s), and a later call passing a
--                 SHORTER p_window did NOT move it: the window is fixed when it opens
--     a second key was unaffected by the first key's exhaustion
--
-- Those five observations pin the semantics below: increment-then-compare, `count <= p_limit`, a
-- fixed window that only re-opens once reset_at has passed. If the live function ever turns out to
-- differ, scripts/verify-rate-limiter.ts replays that exact sequence against production and goes
-- red — it is the only thing standing between "reconstructed" and "guessed".
--
-- `create table if not exists` and `create or replace function` make this a no-op against the
-- existing production database. Nothing here edits an applied migration.

create table if not exists public.rate_limits (
  key      text        primary key,
  count    integer     not null default 0,
  reset_at timestamptz not null default now()
);

-- Only the service role ever touches this table: lib/rateLimit.ts goes through supabaseAdmin, and
-- every caller of it is a server route. The grant is required for a rebuild to be reachable at all
-- after Supabase's 2026-10-30 Data API change (see scripts/verify-supabase-grants.ts).
grant select, insert, update, delete on public.rate_limits to service_role;

-- RLS on, no policy: with RLS enabled and nothing granted to anon, the browser key reads nothing.
-- Measured 2026-10-15 — service role sees 3,279 rows in this table, anon sees 0. The rows are
-- themselves worth protecting: production throttle keys are `apply:<borrower IP>` and
-- `otp-send:<borrower email address>`, i.e. a log of who contacted us and from where.
alter table public.rate_limits enable row level security;

-- One atomic increment per call. INSERT ... ON CONFLICT DO UPDATE is a single statement, which is
-- what makes this usable as the SMS idempotency gate: two concurrent deliveries of the same
-- MessageSid cannot both come back true. A SELECT-then-UPDATE here would reopen that race.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window integer)
returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as rl (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window))
  on conflict (key) do update
    -- The window is fixed when it OPENS. Once reset_at has passed the counter starts over at 1
    -- and a new window begins; while it is still open the counter rises and reset_at does not
    -- move, so a caller passing a shorter p_window cannot shorten a window already in progress.
    set count    = case when rl.reset_at <= now() then 1 else rl.count + 1 end,
        reset_at = case when rl.reset_at <= now() then now() + make_interval(secs => p_window)
                        else rl.reset_at end
  returning rl.count into v_count;

  -- `<=`, not `<`: p_limit is the number of calls ALLOWED, and the counter has already counted
  -- this one. With p_limit = 3 the third call is the last allowed — measured against production.
  return v_count <= p_limit;
end;
$$;

-- THE PUBLIC ANON KEY CAN CALL THIS FUNCTION ON PRODUCTION TODAY. Measured 2026-10-15: a POST to
-- /rest/v1/rpc/rate_limit_hit with the NEXT_PUBLIC anon key returned 200 true and left a row in
-- rate_limits. Nothing in the app needs that — every caller is a server route holding the service
-- role — and it lets anyone holding the browser key burn a counter of their choosing. The two that
-- matter: exhausting `otp-send:<a borrower's email>` (6 per 15 minutes, failClosed) locks that
-- borrower out of her own document portal with six HTTP requests, and exhausting `track:global` or
-- `shield:apply:global` stops lead ingestion for a day. These revokes close it.
--
-- NOTE FOR WHOEVER APPLIES THIS: a migration file is not the live database. Until this runs against
-- production, the grant is still open there.
revoke all on function public.rate_limit_hit(text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, integer, integer) from anon;
revoke all on function public.rate_limit_hit(text, integer, integer) from authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

comment on function public.rate_limit_hit(text, integer, integer) is
  'Atomic per-key rolling-window counter behind lib/rateLimit.ts. Returns true while the key is under p_limit for the current window. Service role only — see 20261016050000_rate_limiter.sql.';
