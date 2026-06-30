// Conversations inbox API.
//   GET  /api/conversations            -> list of leads with comms, newest first
//   GET  /api/conversations?leadId=ID  -> { lead, messages } full thread
//   POST /api/conversations            -> { leadId, channel, body, subject? } send + log
// Auth-gated by the /api/conversations matcher in proxy.ts (staff only).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { sendSms, sendEmail, logComms, getLeadTimeline, listConversations } from "@/lib/comms";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function leadName(l: any): string {
  return l?.full_name || [l?.first_name, l?.last_name].filter(Boolean).join(" ") || l?.email || l?.phone || "Lead";
}

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  try {
    if (!leadId) {
      const conversations = await listConversations();
      return NextResponse.json({ conversations });
    }
    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, full_name, first_name, last_name, email, phone, stage").eq("id", leadId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
    const messages = await getLeadTimeline(leadId);
    return NextResponse.json({
      lead: { id: lead.id, name: leadName(lead), email: lead.email || null, phone: lead.phone || null, stage: lead.stage || null },
      messages,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const leadId = String(body.leadId || "");
    const channel = body.channel === "email" ? "email" : "sms";
    const text = String(body.body || "").trim();
    if (!leadId || !text) return NextResponse.json({ error: "leadId and body are required" }, { status: 400 });

    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, full_name, first_name, last_name, email, phone").eq("id", leadId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

    if (channel === "sms") {
      if (!lead.phone) return NextResponse.json({ error: "This lead has no phone number on file." }, { status: 400 });
      const r = await sendSms(lead.phone, text);
      if (!r.ok) return NextResponse.json({ error: `SMS failed: ${r.detail}` }, { status: 502 });
      await logComms({ leadId, channel: "sms", direction: "outbound", type: "manual", body: text, to: lead.phone, providerId: r.sid, actor: "lo", status: "sent" });
      return NextResponse.json({ ok: true, channel, providerId: r.sid });
    }

    // email
    if (!lead.email) return NextResponse.json({ error: "This lead has no email on file." }, { status: 400 });
    const subject = String(body.subject || "").trim() || `A message from Fetti Financial Services`;
    const first = leadName(lead).split(" ")[0];
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
      <p>Hi ${escapeHtml(first)},</p>
      <div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>
      <p style="margin-top:20px;color:#64748b;font-size:12px">— Fetti Financial Services</p>
    </div>`;
    const r = await sendEmail(lead.email, subject, { html });
    if (!r.ok) return NextResponse.json({ error: `Email failed: ${r.detail}` }, { status: 502 });
    await logComms({ leadId, channel: "email", direction: "outbound", type: "manual", body: text, subject, to: lead.email, providerId: r.id, actor: "lo", status: "sent" });
    return NextResponse.json({ ok: true, channel, providerId: r.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
