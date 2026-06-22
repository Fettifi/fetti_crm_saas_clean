import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { getRequest, saveRequest } from "@/lib/esign";

// Sender voids an envelope. Auth-gated via the /api/esign/requests matcher.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const env = await getRequest(token);
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (env.status === "completed") return NextResponse.json({ error: "Already completed — can't void." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || "").slice(0, 300) || "Voided by sender";
  env.status = "voided";
  env.events = [...(env.events || []), { type: "voided", at: new Date().toISOString(), detail: reason }];
  await saveRequest(env);
  if (env.loan_file_id) {
    await logActivity({ entity_type: "loan_file", entity_id: env.loan_file_id, loan_file_id: env.loan_file_id, lead_id: env.lead_id || undefined, actor: "lo", action: "esign.voided", detail: { title: env.title, reason } });
  }
  return NextResponse.json({ ok: true, voided: true });
}
