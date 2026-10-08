// Owner leg ended without a press — resolve "declined" immediately rather than let Penny stand
// there in silence for the full 42s poll while a live agent waits on the other end.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^CA[a-f0-9]{32}$/i.test(sid) || t !== decisionToken(sid, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const st = String(form?.get("CallStatus") || "");
  if (["no-answer", "busy", "failed", "canceled", "completed"].includes(st)) {
    if ((await getSetting(`errandbridge_${sid}`)) === "pending") await setSetting(`errandbridge_${sid}`, "declined");
  }
  return NextResponse.json({ ok: true });
}
