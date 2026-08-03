// GRANT SMS CONSENT FROM ONE CLICK.
//
// The disclosure the consumer reads is stored verbatim as the artifact, because in a TCPA
// dispute the burden of proving consent is ours and a description of the widget proves
// nothing. HMAC-scoped to opt-in so an apply link cannot grant consent.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { optInToken } from "@/lib/magicLink";
import { logActivity } from "@/lib/activity";
import { SMS_OPTIN_DISCLOSURE } from "@/lib/smsConsent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { id, t } = await req.json();
    if (!id || !t || t !== optInToken(String(id))) {
      return NextResponse.json({ error: "invalid link" }, { status: 401 });
    }
    const { data: lead } = await supabaseAdmin.from("leads").select("id, raw").eq("id", id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

    const raw = ((lead as any).raw && typeof (lead as any).raw === "object" ? { ...(lead as any).raw } : {}) as any;
    // A REVOCATION IS NEVER OVERTURNED BY A LINK. If they said STOP, only a fresh
    // consumer-initiated text re-opens the channel.
    if (raw.sms_optout_at) return NextResponse.json({ ok: false, reason: "opted_out" }, { status: 409 });

    const now = new Date().toISOString();
    raw.sms_consent = true;
    raw.sms_consent_at = raw.sms_consent_at || now;
    raw.sms_consent_text = SMS_OPTIN_DISCLOSURE;
    raw.sms_consent_source = "web_checkbox";
    raw.consent = { ...(raw.consent && typeof raw.consent === "object" ? raw.consent : {}), sms_optin: true, via: "optin_link", at: now };
    await supabaseAdmin.from("leads").update({ raw, nurture_paused: false }).eq("id", id);
    await logActivity({
      entity_type: "lead", entity_id: String(id), lead_id: String(id), actor: "consumer",
      action: "sms.optin_granted", detail: { via: "optin_link", text: SMS_OPTIN_DISCLOSURE },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
