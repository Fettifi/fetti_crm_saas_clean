import { NextRequest, NextResponse } from "next/server";
import { runStalledFileDigest } from "@/lib/stalledFiles";
import { recordHeartbeat, recordAttempt } from "@/lib/heartbeat";

// Daily internal digest of OPEN loan files that have gone quiet (7d / 14d / 30d).
// The nurture cron watches leads and the doctor watches crons; nothing watched
// whether files actually MOVED — so 21 active files sat up to 44 days cold behind
// an all-green dashboard. See lib/stalledFiles.ts for the full rationale.
//
// Internal only: emails the team channel, never the borrower, never SMS.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  // A ?dry=1 preview is not an invocation: stamping an attempt without the matching
  // heartbeat makes the doctor read the job as "fired but never completed" and page
  // that the system is down. (Same trap already documented in reengage-stale.)
  if (!dry) await recordAttempt("stale-files");
  try {
    const out = await runStalledFileDigest(dry);
    if (!dry) await recordHeartbeat("stale-files");
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST kept for manual/programmatic runs.
export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
