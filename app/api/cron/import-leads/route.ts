// Safety-net lead importer — pulls Facebook/Instagram instant-form leads straight from
// the Page's lead forms via the Graph API and inserts any the realtime webhook missed.
// The leadgen webhook can silently drop leads (delivery lag, a lead created before the
// Page subscription, a transient fetch failure), so this runs on a frequent Vercel Cron
// as a guarantee that NO paid lead is ever lost. Dedupes by Meta leadgen_id, so repeated
// runs only insert genuinely new leads. Cron-authed by CRON_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { importHistoricalLeads } from "@/lib/metaHeal";
import { runCommsWatchdog } from "@/lib/commsWatchdog";
import { recordHeartbeat } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await importHistoricalLeads();
    // Never-miss sweep: re-answer any inbound SMS the real-time path dropped and
    // first-touch any lead that never got one — every 15 minutes, forever.
    let watchdog: any = null;
    try { watchdog = await runCommsWatchdog(); } catch (e) { console.error("[import-leads] watchdog:", e); }
    try { await recordHeartbeat("import-leads"); } catch { /* heartbeat optional */ }
    return NextResponse.json({ ok: true, watchdog, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
