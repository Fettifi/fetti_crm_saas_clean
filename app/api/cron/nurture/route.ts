import { NextRequest, NextResponse } from "next/server";
import { runNurture } from "@/lib/nurture";
import { recordHeartbeat, recordAttempt } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the daily list can exceed what 60s covers — 300s is the plan max

// Triggered daily by Vercel Cron (vercel.json). Vercel sends
// Authorization: Bearer <CRON_SECRET> automatically when CRON_SECRET is set.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Attempt is stamped BEFORE the work, the heartbeat only AFTER it actually ran. When
  // runNurture bails on the lock guard, the fresh attempt + stale heartbeat makes the
  // doctor report STALLED — the false "healthy" that hid a 13-day follow-up outage.
  await recordAttempt("nurture");
  const result = await runNurture();
  if (result.ran) await recordHeartbeat("nurture");
  return NextResponse.json({ ok: true, ...result });
}
