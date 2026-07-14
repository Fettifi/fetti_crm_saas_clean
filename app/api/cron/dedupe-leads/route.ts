// Scheduled + on-demand duplicate-lead reconciliation. Collapses same-phone/email
// leads that slipped past the per-path intake dedup (races, multi-path submissions).
// Cron-authed by CRON_SECRET (Vercel cron sends `Authorization: Bearer <secret>`);
// also accepts `x-fetti-internal: <secret>` for manual triggers, and `?dry=1` to
// preview without writing.
import { NextRequest, NextResponse } from "next/server";
import { reconcileLeadDuplicates } from "@/lib/leadDedup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const internal = req.headers.get("x-fetti-internal") || "";
  if (!secret || (bearer !== secret && internal !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  try {
    const report = await reconcileLeadDuplicates(!dry);
    // Cap the details payload; the counts are the signal.
    return NextResponse.json({ ok: true, applied: !dry, ...report, details: report.details.slice(0, 60) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
