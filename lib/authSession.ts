// Shared server-side auth guards for API routes that sit OUTSIDE the proxy session
// gate (e.g. cron routes whose GET is Vercel-cron/CRON_SECRET but whose POST is a
// logged-in Command Center trigger). Uses getUser() so the JWT is cryptographically
// validated against the Supabase auth server — never getSession() (spoofable cookie).
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function isStaffSession(req: NextRequest): Promise<boolean> {
  try {
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => req.cookies.get(name)?.value, set() {}, remove() {} } },
    );
    const { data, error } = await supa.auth.getUser();
    return !error && !!data.user;
  } catch { return false; }
}

// True when the request carries the CRON_SECRET bearer (the scheduled Vercel-cron path).
export function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Allow either a logged-in staff session OR the cron secret. Use for endpoints that
// must be reachable both from the CRM UI and from the scheduler, but never anonymously.
export async function isStaffOrCron(req: NextRequest): Promise<boolean> {
  return hasCronSecret(req) || (await isStaffSession(req));
}
