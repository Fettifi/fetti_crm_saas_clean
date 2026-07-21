// Conversations inbox API.
//   GET  /api/conversations            -> list of leads with comms, newest first
//   GET  /api/conversations?leadId=ID  -> { lead, messages } full thread
//   POST /api/conversations            -> { leadId, channel, body, subject? } send + log
// Auth-gated by the /api/conversations matcher in proxy.ts (staff only).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { sendSms, sendEmail, logComms, getLeadTimeline, listPipeline, getLeadMessagesForAI } from "@/lib/comms";
import { markConciergeReply, expertiseFor } from "@/lib/markConcierge";
import { magicApplyLink } from "@/lib/magicLink";
import { leadQuality } from "@/lib/leadQuality";
import { leadReality } from "@/lib/leadReality";
import { cfg } from "@/lib/settings";

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
      // Unified workspace list: EVERY recent lead (incl. never-contacted), each with
      // last comms, needs-reply, funnel stage, quality badge, and reality check.
      const conversations = await listPipeline();
      return NextResponse.json({ conversations });
    }
    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, created_at, full_name, first_name, last_name, email, phone, stage, tier, score, loan_purpose, state, source, lead_source, raw, nurture_paused").eq("id", leadId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
    const messages = await getLeadTimeline(leadId);
    // Conversion context: everything the LO needs at a glance next to the thread.
    const raw: any = (lead as any).raw || {};
    const { data: lf } = await supabaseAdmin.from("loan_files").select("id, share_token").eq("lead_id", leadId).limit(1).maybeSingle();
    let missingDocs: string[] = [];
    if ((lf as any)?.id) {
      const { data: docs } = await supabaseAdmin.from("loan_documents").select("name, status, required").eq("loan_file_id", (lf as any).id);
      missingDocs = (docs || []).filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted").map((d: any) => String(d.name));
    }
    return NextResponse.json({
      lead: {
        id: lead.id, name: leadName(lead), email: lead.email || null, phone: lead.phone || null, stage: lead.stage || null,
        tier: (lead as any).tier || null, score: (lead as any).score ?? null, purpose: (lead as any).loan_purpose || null, state: (lead as any).state || null,
        source: (lead as any).source || (lead as any).lead_source || null, createdAt: (lead as any).created_at || null,
        quality: leadQuality({ tier: (lead as any).tier, score: (lead as any).score, decision: raw.qualify?.decision || raw.decision || null }),
        reality: leadReality({ raw, name: leadName(lead), email: lead.email, phone: lead.phone }),
        facts: Array.isArray(raw.concierge_facts) ? raw.concierge_facts : [],
        smsConsent: raw.sms_consent === true || raw.consent?.sms_optin === true,
        aiCallConsent: raw.ai_call_consent === true,
        paused: !!(lead as any).nurture_paused,
        appLink: magicApplyLink(lead as any),
        fileLink: (lf as any)?.share_token ? `${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/file/${(lf as any).share_token}` : null,
        missingDocs,
        // Completed-1003 state + existing file, so the workspace can offer
        // "Convert to Application" (start doc requests) instead of a dead end.
        appCompleted: raw.app_completed === true,
        appCompletedAt: raw.app_completed_at || null,
        loanFileId: (lf as any)?.id || null,
      },
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
    const action = String(body.action || "send");

    if (action !== "send") {
      const { data: l } = await supabaseAdmin.from("leads")
        .select("id, full_name, first_name, phone, email, loan_purpose, state, stage, raw").eq("id", leadId).maybeSingle();
      if (!l) return NextResponse.json({ error: "lead not found" }, { status: 404 });
      const raw: any = (l as any).raw || {};

      if (action === "draft") {
        // Mark writes the reply; the human approves. Same brain as the live concierge.
        const history = await getLeadMessagesForAI(leadId);
        if (!history.length || history[history.length - 1].role !== "user") {
          // No inbound to answer — draft a proactive check-in instead.
          history.push({ role: "user", content: "(no new inbound — write a short, natural, non-pushy check-in that moves their deal forward one step)" });
        }
        const { data: lf2 } = await supabaseAdmin.from("loan_files").select("id, share_token").eq("lead_id", leadId).limit(1).maybeSingle();
        let missing: string[] = [];
        if ((lf2 as any)?.id) {
          const { data: docs } = await supabaseAdmin.from("loan_documents").select("name, status, required").eq("loan_file_id", (lf2 as any).id);
          missing = (docs || []).filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted").map((d: any) => String(d.name));
        }
        const r = await markConciergeReply({
          lead: l, history,
          fileLink: (lf2 as any)?.share_token ? `${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/file/${(lf2 as any).share_token}` : null,
          appLink: magicApplyLink(l as any), calendlyUrl: (await cfg("CALENDLY_URL")) || null,
          missingDocs: missing, knownFacts: Array.isArray(raw.concierge_facts) ? raw.concierge_facts : [],
          expertise: expertiseFor(l, history[history.length - 1]?.content || ""),
        });
        if (!r.ok || !r.reply) return NextResponse.json({ error: r.detail || "draft failed" }, { status: 502 });
        return NextResponse.json({ ok: true, draft: r.reply.replace(/\s*\(Reply STOP to opt out\.\)\s*$/i, "") });
      }

      if (action === "send_app_link" || action === "send_calendar") {
        const first = String((l as any).first_name || (l as any).full_name || "").split(/\s+/)[0] || "there";
        const link = action === "send_app_link" ? magicApplyLink(l as any) : ((await cfg("CALENDLY_URL")) || "");
        if (!link) return NextResponse.json({ error: "No calendar link configured." }, { status: 400 });
        const text2 = action === "send_app_link"
          ? `Hey ${first}, it's Mark at Fetti — your application is saved and pre-filled, about 3 minutes to finish whenever you're ready: ${link}`
          : `Hey ${first}, it's Mark at Fetti — here's Ramon's calendar, grab any time that works and it's locked in: ${link}`;
        const smsOk = raw.sms_consent === true || raw.consent?.sms_optin === true;
        if ((l as any).phone && smsOk) {
          const r = await sendSms((l as any).phone, text2 + " (Reply STOP to opt out.)");
          if (!r.ok) return NextResponse.json({ error: `SMS failed: ${r.detail}` }, { status: 502 });
          await logComms({ leadId, channel: "sms", direction: "outbound", type: "manual", body: text2, to: (l as any).phone, providerId: r.sid, actor: "lo", status: "sent" });
          return NextResponse.json({ ok: true, via: "sms" });
        }
        if ((l as any).email) {
          const r = await sendEmail((l as any).email, action === "send_app_link" ? "your application — 3 minutes to finish" : "grab a time with Ramon", { html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${escapeHtml(text2).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#0c7a52">$1</a>')}</div>` });
          if (!(r as any).ok) return NextResponse.json({ error: "Email failed" }, { status: 502 });
          await logComms({ leadId, channel: "email", direction: "outbound", type: "manual", body: text2, to: (l as any).email, providerId: (r as any).id, actor: "lo", status: "sent" });
          return NextResponse.json({ ok: true, via: "email" });
        }
        return NextResponse.json({ error: "Lead has no reachable channel (SMS needs consent)." }, { status: 400 });
      }

      if (action === "bridge") {
        if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not configured" }, { status: 503 });
        const r = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/api/voice/bridge`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
          body: JSON.stringify({ lead_id: leadId, reason: "LO requested a live call from the Conversations inbox" }),
        }).then((x) => x.json()).catch(() => null);
        return NextResponse.json({ ok: true, bridged: !!r?.bridged });
      }
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

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
