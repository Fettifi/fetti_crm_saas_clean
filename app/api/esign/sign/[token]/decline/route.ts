import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { getByRecipientToken, saveRequest } from "@/lib/esign";

// Public: a recipient declines to sign. Stops the envelope.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getByRecipientToken(token);
  if (!res) return NextResponse.json({ error: "invalid link" }, { status: 404 });
  const { env, recipient } = res;
  if (recipient.status === "signed") return NextResponse.json({ error: "already signed" }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || "").slice(0, 300) || "No reason provided";
  recipient.status = "declined"; recipient.declineReason = reason;
  env.status = "declined";
  env.events = [...(env.events || []), { type: "declined", at: new Date().toISOString(), detail: `${recipient.name} declined: ${reason}` }];
  await saveRequest(env);
  if (env.loan_file_id) {
    await logActivity({ entity_type: "loan_file", entity_id: env.loan_file_id, loan_file_id: env.loan_file_id, lead_id: env.lead_id || undefined, actor: "borrower", action: "esign.declined", detail: { title: env.title, by: recipient.name, reason } });
  }
  return NextResponse.json({ ok: true, declined: true });
}
