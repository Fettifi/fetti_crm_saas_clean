// "Talk right now" from the borrower connect page → Fetti places an OUTBOUND call
// and Penny (AI loan officer) answers all their questions, then books a LIVE call
// with Ramon. Borrower-facing, gated by the HMAC connect token. Returns instantly;
// the call is placed in the background. Degrades to a team task if voice isn't
// configured or the number is unusable.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { connectTokenValid } from "@/lib/connect";
import { getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
function loToken(nonce: string): string {
  return crypto.createHmac("sha256", (process.env.CRON_SECRET || "fetti") + ":lovoice").update(nonce).digest("hex").slice(0, 24);
}

async function teamFallback(lead: any, why: string) {
  await supabaseAdmin.from("org_tasks").insert([{
    title: `🔴 CALL NOW REQUEST — ${lead.full_name || lead.first_name || "borrower"}`.slice(0, 200),
    detail: `${lead.full_name || "A borrower"} tapped "Talk right now" on the connect page (${why}). Call them ASAP: ${lead.phone || "(no phone)"}.`,
    source: "connect_call_now", status: "open", priority: 10,
    dedup_key: `callnow:${lead.id}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
  }]).select("id").then(() => {}, () => {});
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const leadId = String(b.lead || "");
    const t = String(b.t || "");
    if (!leadId || !connectTokenValid(leadId, t)) return NextResponse.json({ ok: false, error: "invalid link" }, { status: 403 });

    const { data: lead } = await supabaseAdmin.from("leads")
      .select("id, first_name, full_name, phone, email, raw, nurture_paused").eq("id", leadId).maybeSingle();
    if (!lead?.phone) return NextResponse.json({ ok: true, calling: false, fallback: "no_phone" });
    if (lead.nurture_paused || (lead as any).raw?.sms_optout_at) return NextResponse.json({ ok: true, calling: false, fallback: "opted_out" });
    if (["invalid", "non_us"].includes((lead as any).raw?.phone_status) || /@fetti-internal\.test$/i.test((lead as any).email || "")) {
      await teamFallback(lead, "guarded phone");
      return NextResponse.json({ ok: true, calling: false, fallback: "team_will_call" });
    }

    const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
    if (!tsid || !ttok || !from) { await teamFallback(lead, "voice not configured"); return NextResponse.json({ ok: true, calling: false, fallback: "team_will_call" }); }

    // Throttle: one AI call per lead per 2h (double-taps must not double-dial).
    const throttleKey = `locall_last_${leadId}`;
    const last = await getSetting(throttleKey);
    if (last && Date.now() - new Date(last).getTime() < 2 * 3600_000) return NextResponse.json({ ok: true, calling: true, note: "already ringing" });
    await setSetting(throttleKey, new Date().toISOString());

    const digits = String((lead as any).phone).replace(/\D/g, "");
    const toE164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    const nonce = "LO" + crypto.randomBytes(12).toString("hex");
    const tok = loToken(nonce);
    await setSetting("lo_" + nonce, JSON.stringify({ lead_id: leadId, first: String((lead as any).first_name || (lead as any).full_name || "there").split(/\s+/)[0], phone: toE164 }));

    // Place the outbound call after responding — borrower gets instant "connecting you".
    after(async () => {
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
          method: "POST",
          headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            To: toE164, From: from,
            Url: `${APP}/api/voice/lo/answer?n=${nonce}&t=${tok}`,
            MachineDetection: "Enable", MachineDetectionTimeout: "8", Timeout: "25",
          }).toString(),
        });
        await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:penny", action: "connect.call_now", detail: { placed: r.ok, to: toE164 } }).catch(() => {});
        if (!r.ok) console.error("[connect/call-now] twilio", r.status, (await r.text()).slice(0, 160));
      } catch (e) { console.error("[connect/call-now] call failed", e); }
    });

    return NextResponse.json({ ok: true, calling: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
