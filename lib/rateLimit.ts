// Lightweight rate limiting backed by Postgres (no extra vendor needed). Each
// call atomically increments a per-key counter in a rolling window and returns
// whether the request is allowed. Fail-OPEN: if the limiter errors, we allow the
// request — a limiter hiccup must never block a real borrower's submission.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim();
  return ip || req.headers.get("x-real-ip") || "unknown";
}

/** Returns true if allowed, false if the limit is exceeded for this window. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      p_key: key, p_limit: limit, p_window: windowSeconds,
    });
    if (error) return true; // fail open
    return data === true;
  } catch {
    return true; // fail open
  }
}
