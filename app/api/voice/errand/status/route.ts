// The errand call ended. Release the one-line-per-organisation lock and seal the audit record.
// A lock that is only released on the happy path is a lock that wedges the feature shut.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";
import { logActivity } from "@/lib/activity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^ER[a-f0-9]{30}$/i.test(n) || t !== decisionToken(n, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const raw = await getSetting(`errand_${n}`);
  const ctx = raw ? JSON.parse(raw) : {};
  const form = await req.formData().catch(() => null);
  const duration = Number(form?.get("CallDuration") || 0);
  if (ctx.target_id) await setSetting(`errand_live_${ctx.target_id}`, "");
  await logActivity({
    entity_type: "voice", entity_id: n, actor: "agent:penny", action: "errand.ended",
    detail: { org: ctx.org, seconds: duration, minutes: +(duration / 60).toFixed(1), status: String(form?.get("CallStatus") || ""), cost_estimate_usd: +(duration / 60 * 0.014).toFixed(3) },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
