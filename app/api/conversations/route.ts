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
import { COMMS_PERSONA } from "@/lib/markPersona";
import { loSendAllowed, invitedReply, smsAllowed } from "@/lib/smsConsent";

export const dynamic = "force-dynamic";

// ── THE ONE SENDER IN THIS REPO WITH NO CONSENT GATE AT ALL. ──────────────────────────────────
//
// Every other outbound path routes through lib/smsConsent: the automated engine (lib/nurture.ts,
// lib/leadPipeline.ts), the document chaser (lib/notify/docRequest.ts), the responder
// (lib/notify/leadResponder.ts). This route read consent with a hand-rolled
// `raw.sms_consent === true || raw.consent?.sms_optin === true` on one branch and NOTHING on the
// other, and claimed `allowQuietHours: true` on both. A hand-rolled expression cannot see
// sms_optout_at, sms_consent === false, sms_undeliverable or historical_import — so the composer
// that produced 1 of the 16 unconsented deliveries reconciled out of the Twilio ledger was still
// reading consent with the same kind of expression that let it happen.
//
// A HUMAN PRESSED SEND, so these are transactional (loSendAllowed → a bare marketing pause does
// not stop an LO writing to one named borrower). A revocation still stops everything, and SMS
// still needs recorded consent of its own: the TCPA burden of proof is ours and "Ramon meant to"
// is not evidence.
//
// QUIET HOURS ARE NOT WAIVED BY A BUTTON. sendSms's own contract reserves allowQuietHours for
// "a direct reply the recipient just asked for". So the exemption is now earned per send: an
// inbound message in the last 24h means someone is waiting and the reply is invited; otherwise
// the TCPA window binds (47 C.F.R. §64.1200(c)(1); lib/quietHours.ts holds 8am-8pm because
// Florida's FTSA is tighter than the federal 9pm).
const INVITED_WINDOW_HOURS = 24;
/** The most recent inbound message on this thread, or null. Feeds the invited-reply test. */
function lastInboundAt(messages: { direction?: string | null; at?: string | null }[]): string | null {
  let latest: string | null = null;
  for (const m of messages || []) {
    if (m?.direction !== "inbound" || !m?.at) continue;
    if (!latest || String(m.at) > latest) latest = String(m.at);
  }
  return latest;
}

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
    const smsVerdict = smsAllowed(raw);
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
        // The predicate, not a two-field read. This badge said "SMS consent on file" for a lead
        // carrying `sms_consent: true` alongside `sms_optout_at` — somebody who texted STOP —
        // because it never looked at the revocation. The LO reads this before deciding to text.
        smsConsent: smsVerdict.ok,
        smsConsentReason: smsVerdict.ok ? null : smsVerdict.reason || null,
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
        .select("id, full_name, first_name, phone, email, loan_purpose, state, stage, raw, nurture_paused").eq("id", leadId).maybeSingle();
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
          ? `Hey ${first}, it's ${COMMS_PERSONA} at Fetti — your application is saved and pre-filled, about 3 minutes to finish whenever you're ready: ${link}`
          : `Hey ${first}, it's ${COMMS_PERSONA} at Fetti — here's Ramon's calendar, grab any time that works and it's locked in: ${link}`;
        // THE CONSENT PREDICATE, not a hand-rolled read of two fields. The old expression said
        // yes for a lead carrying `sms_consent: true` alongside `sms_optout_at` — a borrower who
        // had texted STOP — because it never looked at the revocation at all.
        const smsVerdict = loSendAllowed(l as any, "sms");
        // An application-link or calendar push is a SOLICITATION however it is triggered, so it
        // gets no quiet-hours exemption. A hold is not a dead end: the email leg below has no
        // quiet-hours rule, so we fall through to it rather than telling the LO it failed.
        let smsHeld: string | null = null;
        if ((l as any).phone && smsVerdict.ok) {
          const r = await sendSms((l as any).phone, text2 + " (Reply STOP to opt out.)", { state: (l as any).state });
          if (r.ok) {
            await logComms({ leadId, channel: "sms", direction: "outbound", type: "manual", body: text2, to: (l as any).phone, providerId: r.sid, actor: "lo", status: "sent" });
            return NextResponse.json({ ok: true, via: "sms" });
          }
          if (!r.deferred) return NextResponse.json({ error: `SMS failed: ${r.detail}` }, { status: 502 });
          smsHeld = r.detail;
        }
        if ((l as any).email) {
          const emailVerdict = loSendAllowed(l as any, "email");
          if (!emailVerdict.ok) {
            return NextResponse.json({ error: `Not sent — ${emailVerdict.reason}.` }, { status: 409 });
          }
          const r = await sendEmail((l as any).email, action === "send_app_link" ? "your application — 3 minutes to finish" : "grab a time with Ramon", { html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${escapeHtml(text2).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#0c7a52">$1</a>')}</div>` });
          if (!(r as any).ok) return NextResponse.json({ error: `Email failed: ${(r as any).detail || "unknown"}` }, { status: 502 });
          await logComms({ leadId, channel: "email", direction: "outbound", type: "manual", body: text2, to: (l as any).email, providerId: (r as any).id, actor: "lo", status: "sent" });
          return NextResponse.json({ ok: true, via: "email", ...(smsHeld ? { smsHeld } : {}) });
        }
        // SAY WHICH REASON APPLIES. "no reachable channel (SMS needs consent)" was the same
        // sentence whether the lead had no phone, no consent, or had texted STOP — so the LO
        // could not tell "ask them to opt in" from "they opted out, stop".
        if (smsHeld) return NextResponse.json({ error: `Held — ${smsHeld}. No email on file, so it cannot be sent another way right now.` }, { status: 409 });
        if ((l as any).phone && !smsVerdict.ok) return NextResponse.json({ error: `Cannot text this lead — ${smsVerdict.reason}. No email on file either.` }, { status: 409 });
        return NextResponse.json({ error: "Lead has no reachable channel (no phone with SMS consent, and no email)." }, { status: 400 });
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

    // `state` was read off this row and passed to sendSms, but was never SELECTED — so the
    // quiet-hours check fell back to an area-code guess on every manual send. It did not show
    // because allowQuietHours:true meant the check never ran. raw + nurture_paused are what the
    // consent predicate reads.
    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, full_name, first_name, last_name, email, phone, state, raw, nurture_paused").eq("id", leadId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

    const verdict = loSendAllowed(lead as any, channel);
    if (!verdict.ok) {
      // 409, not 502: nothing failed. We refused, and the LO needs to read the reason — "they
      // opted out" and "they never opted in" are different problems with different next steps.
      return NextResponse.json({ error: `Not sent — ${verdict.reason}.`, reason: verdict.reason, refused: true }, { status: 409 });
    }

    if (channel === "sms") {
      if (!lead.phone) return NextResponse.json({ error: "This lead has no phone number on file." }, { status: 400 });
      // INVITED REPLY, EARNED PER SEND. A borrower who wrote in the last 24h is waiting on an
      // answer, and sendSms's contract allows exactly that case past the window. Outreach waits.
      const invited = invitedReply(lastInboundAt(await getLeadTimeline(leadId) as any), new Date(), INVITED_WINDOW_HOURS);
      const r = await sendSms(lead.phone, text, { state: (lead as any).state, allowQuietHours: invited });
      if (!r.ok) {
        // A HOLD IS NOT A FAILURE. Reporting a quiet-hours hold as "SMS failed" is how an LO
        // concludes the provider is broken and re-clicks send; it also hides the one fact that
        // tells them what to do, which is that it is the middle of the night where the borrower is.
        if (r.deferred) {
          return NextResponse.json({ error: `Held — ${r.detail}. Send it inside their window, or reply from the thread once they write back.`, held: true, reason: r.detail }, { status: 409 });
        }
        return NextResponse.json({ error: `SMS failed: ${r.detail}` }, { status: 502 });
      }
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
