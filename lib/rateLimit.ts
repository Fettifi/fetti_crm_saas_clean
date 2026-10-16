// Lightweight rate limiting backed by Postgres (no extra vendor needed). Each
// call atomically increments a per-key counter in a rolling window and returns
// whether the request is allowed. Fail-OPEN: if the limiter errors, we allow the
// request — a limiter hiccup must never block a real borrower's submission.
//
// THE RPC LIVES IN supabase/migrations/20261016050000_rate_limiter.sql. Until 2026-10-15 it lived
// NOWHERE in version control — only inside the production database — so a new project, a preview
// branch or `supabase db reset` came up with no throttle at all. Measured with the Supabase env
// stripped, which is exactly the state a fresh environment is in: rateLimit() returns true every
// time by default, and false under failClosed. Fail-open is right for a hiccup and catastrophic as
// a permanent condition, because nothing anywhere reports it — app/api/sms/inbound/route.ts uses
// this same counter as its IDEMPOTENCY gate, and the portal OTP routes use it failClosed, where an
// absent limiter locks a borrower out of her own documents. scripts/verify-rate-limiter.ts holds
// both halves: that a migration defines the function, and that this contract still behaves.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { createHmac } from "crypto";

// !! THE LIMITER IS REACHABLE BY ANYONE, SO THE KEY MUST NOT BE GUESSABLE.
//
// MEASURED ON PRODUCTION 2026-10-16, with the NEXT_PUBLIC anon key that ships in every browser
// bundle by design:
//     POST /rest/v1/rpc/rate_limit_hit {"p_key":"zz-probe","p_limit":3,"p_window":60}
//     -> 200 true, true, true, false, false
// It executes, and it WRITES STATE. PostgREST exposes the function to `anon`, so the throttle is a
// public API that anybody can spend on anybody's behalf.
//
// The keys were plaintext and derivable from public facts. Six calls against
// `otp-send:<a borrower's email address>` exhaust her 6-per-15-minute budget, and the portal OTP
// limiter is failClosed — so she is locked out of her own document portal, and repeating it keeps
// her out. `track:global` and `shield:apply:global` are fixed strings; exhausting those stops lead
// ingestion for a day. No credential is needed for any of it, only her email address.
//
// THE REAL FIX IS `revoke execute ... from anon`, which is in
// supabase/migrations/20261016050000_rate_limiter.sql — but a migration file does not apply itself
// and applying it needs a DB credential nobody should type into a tool. So this closes the attack
// from the side we control: the caller's key is never sent. What goes to the RPC is an HMAC of it,
// keyed by a server-only secret, computed in this module which never reaches the browser.
//
// An attacker can still burn RANDOM keys — which belong to nobody and cost nothing — but can no
// longer compute the key for a named borrower, or for a global bucket, without the secret. That
// turns a targeted lockout into noise. Defence in depth: apply the REVOKE as well when you can.
//
// Falls back to the plaintext key ONLY if no secret is configured, because a limiter that throws
// is a limiter that fails open on every call — the one outcome worse than a guessable key.
const RL_SECRET = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Opaque, stable, server-only. Same input always yields the same key, so windows still work. */
export function rateLimitKey(key: string): string {
  if (!RL_SECRET) return key;
  return "h:" + createHmac("sha256", RL_SECRET).update(String(key)).digest("base64url").slice(0, 32);
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim();
  return ip || req.headers.get("x-real-ip") || "unknown";
}

/** Returns true if allowed, false if the limit is exceeded for this window.
 *  Default is fail-OPEN (a limiter hiccup must never block a real borrower's
 *  submission). Pass { failClosed: true } for AUTH-security limiters (e.g. OTP
 *  brute-force throttles) where a limiter error must DENY, not silently disable
 *  the throttle. */
export async function rateLimit(
  key: string, limit: number, windowSeconds: number,
  opts?: { failClosed?: boolean },
): Promise<boolean> {
  const onError = opts?.failClosed ? false : true;
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      // rateLimitKey, never the caller's key — see the note at the top of this file.
      p_key: rateLimitKey(key), p_limit: limit, p_window: windowSeconds,
    });
    if (error) return onError;
    return data === true;
  } catch {
    return onError;
  }
}
