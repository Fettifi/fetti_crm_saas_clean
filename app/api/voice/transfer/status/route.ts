// Status callback for the whisper/announce call (both Penny transfers and SMS
// bridges). If the owner HANGS UP, doesn't answer, or is busy — i.e. the call
// ends while the decision is still pending — that IS a decline, immediately:
// without this, a hang-up left the system in limbo until the 42s timeout and
// Penny had no answer to give (live-test bug 2026-07-08).
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || t !== decisionToken(sid, secret)) return NextResponse.json({ ok: true });
  const form = await req.formData().catch(() => null);
  const status = String(form?.get("CallStatus") || "");
  if (["completed", "no-answer", "busy", "failed", "canceled"].includes(status)) {
    const key = `transfer_${sid}`;
    if ((await getSetting(key)) === "pending") await setSetting(key, "declined");
  }
  return NextResponse.json({ ok: true });
}
