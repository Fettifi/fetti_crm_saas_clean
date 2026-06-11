// System-wide self-heal — runs hourly (Vercel Cron). Reconciles state and
// auto-completes any missed work (loan files, agent runs, content, tokens).
import { NextRequest, NextResponse } from "next/server";
import { reconcile } from "@/lib/selfheal";
import { recordHeartbeat, pingWatchdog } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const repairs = await reconcile();
    await recordHeartbeat("heal");
    await pingWatchdog();
    return NextResponse.json({ ok: true, repairs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
