import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";

export const dynamic = "force-dynamic";

// Twilio inbound SMS webhook ("A message comes in"). When a lead replies:
//  - pause their automated nurture (they're engaged — a human takes over)
//  - ping the team in Discord with the reply so they respond fast
// Returns empty TwiML so Twilio doesn't auto-reply.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });

    // Reject forged webhooks: verify Twilio's signature. Fail-open only if no
    // auth token is configured (can't verify) so this never silently blocks.
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (token) {
      const sig = req.headers.get("x-twilio-signature") || "";
      const ok = twilioSignatureValid(token, sig, webhookCandidateUrls(req, "/api/sms/inbound"), params);
      if (!ok) {
        console.warn("[sms/inbound] rejected: invalid Twilio signature");
        return new NextResponse("Forbidden", { status: 403 });
      }
    }

    const from = String(params["From"] || "");
    const body = String(params["Body"] || "").trim();
    const digits = from.replace(/\D/g, "").slice(-10);

    // Keyword opt-in (e.g. "Text DEAL to ..." from The Lot). Because the viewer
    // texts US first, this is express written consent (TCPA-compliant). We log
    // the consented lead and reply with the capture link; the hourly self-heal
    // cron backfills their loan file + agents, and nurture works them.
    const OPTIN_KEYWORDS = (process.env.SMS_OPTIN_KEYWORDS || "DEAL,FETTI,MONEY,QUALIFY,HOME,LOT").split(",").map((k) => k.trim().toUpperCase());
    const word = body.toUpperCase().replace(/[^A-Z]/g, "");
    if (digits && OPTIN_KEYWORDS.includes(word)) {
      const consent = { sms_optin: true, keyword: word, campaign: "youtube_thelot", at: new Date().toISOString(), text: body.slice(0, 200) };
      try {
        const { data: existing } = await supabaseAdmin.from("leads").select("id, raw").eq("phone", digits).limit(1).maybeSingle();
        if (existing) {
          const raw = (existing as any).raw && typeof (existing as any).raw === "object" ? (existing as any).raw : {};
          raw.consent = consent;
          await supabaseAdmin.from("leads").update({ raw, nurture_paused: false }).eq("id", (existing as any).id);
        } else {
          await supabaseAdmin.from("leads").insert([{ phone: digits, source: "youtube_thelot", lead_source: "sms_optin", stage: "New Lead", raw: { consent } }]);
        }
      } catch (e) { console.warn("[sms/inbound] optin save failed", e); }

      const optinHook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (optinHook) { try { await fetch(optinHook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `🎬 **The Lot opt-in** — ${from} texted "${body}". Sent them fettifi.com/tv.` }) }); } catch { /* */ } }

      const reply = "It's Fetti 🦉 Thanks for texting in from The Lot! See what you qualify for in 2 min — home loans, refis & investment: https://fettifi.com/tv — Msg&data rates may apply. Reply STOP to opt out.";
      const xml = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return new NextResponse(`<Response><Message>${xml}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    if (digits) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, full_name, phone")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Only a genuine opt-out pauses nurture (TCPA). A normal reply is a HOT
      // engagement signal — keep nurturing (throttled) and alert the team to jump
      // in; don't silently kill follow-up forever just because they asked a question.
      const isStop = /\b(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|REVOKE)\b/.test(body.toUpperCase());
      if (lead && isStop) {
        await supabaseAdmin.from("leads").update({ nurture_paused: true }).eq("id", (lead as any).id);
      } else if (lead) {
        // Non-STOP reply from a known lead = hottest signal in the funnel.
        // Persist it as a top-priority CRM task so the conversion moment lands
        // in the task list, not just an ephemeral Discord ping.
        await logHotLeadReply({ leadId: (lead as any).id, name: (lead as any).full_name, phone: from, body });
      }

      const hook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (hook) {
        const who = (lead as any)?.full_name || from;
        const note = isStop
          ? (lead ? "🛑 STOP — opted out, nurture paused (compliance)." : "🛑 STOP received (no matching lead).")
          : (lead ? "🔥 Hot reply — respond now! (auto-nurture still active)" : "(no matching lead found)");
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `💬 **Lead replied** — ${who} (${from})\n"${body}"\n${note}`,
          }),
        });
      }
    }
  } catch (e) {
    console.warn("[sms/inbound] error", e);
  }
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
