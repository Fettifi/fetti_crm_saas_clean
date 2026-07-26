import { NextRequest, NextResponse } from "next/server";
import { buildAndSendLeadDigest } from "@/lib/notify/leadDigest";
import { recordHeartbeat, recordAttempt } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Daily morning digest of new leads + tier mix + who needs working.
// Triggered by Vercel Cron (vercel.json). Vercel sends Authorization: Bearer
// <CRON_SECRET> automatically. Also callable manually with the same header.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await recordAttempt("lead-digest");
  const result = await buildAndSendLeadDigest();
  await recordHeartbeat("lead-digest");
  return NextResponse.json({ ok: true, ...result });
}
