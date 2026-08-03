// GRANT SMS CONSENT FROM ONE CLICK.
//
// The disclosure the consumer reads is stored verbatim as the artifact, because in a TCPA
// dispute the burden of proving consent is ours and a description of the widget proves
// nothing. HMAC-scoped to opt-in so an apply link cannot grant consent.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { optInToken } from "@/lib/magicLink";
import { logActivity } from "@/lib/activity";
import { SMS_OPTIN_DISCLOSURE, smsAllowed } from "@/lib/smsConsent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { id, t } = await req.json();
    if (!id || !t || t !== optInToken(String(id))) {
      return NextResponse.json({ error: "invalid link" }, { status: 401 });
    }
    const { data: lead } = await supabaseAdmin.from("leads").select("id, raw, nurture_paused").eq("id", id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

    const raw = ((lead as any).raw && typeof (lead as any).raw === "object" ? { ...(lead as any).raw } : {}) as any;
    // A REVOCATION IS NEVER OVERTURNED BY A LINK — on EITHER channel.
    //
    // This checked only `sms_optout_at`. But app/api/unsubscribe/route.ts:68 records a
    // CAN-SPAM unsubscribe by writing `nurture_paused: true` and NOTHING ELSE — that boolean
    // IS the entire opt-out record — and line 35 below then wrote `nurture_paused: false`
    // unconditionally. The same drip email carries both the unsubscribe link and this opt-in
    // link, and the token has no expiry, so a borrower who unsubscribed and later tapped
    // "text me instead" in that same email was returned to the full email drip. Two live
    // leads are in exactly that state.
    if (raw.sms_optout_at) return NextResponse.json({ ok: false, reason: "opted_out" }, { status: 409 });
    if (raw.email_optout_at || (lead as any).nurture_paused) {
      return NextResponse.json({ ok: false, reason: "unsubscribed" }, { status: 409 });
    }

    // ALREADY CONSENTED = NOTHING TO DO. Re-writing the artifact on a second click can only
    // ever downgrade it (see below); there is no upside.
    if (smsAllowed(raw).ok) return NextResponse.json({ ok: true, already: true });

    const now = new Date().toISOString();
    raw.sms_consent = true;
    raw.sms_consent_at = raw.sms_consent_at || now;
    // NEVER OVERWRITE A BROADER ARTIFACT WITH A NARROWER ONE. The /apply wizard's disclosure
    // grants SMS *and* automated calls made with an AI voice assistant; 23 live leads carry
    // that wording and all 23 have ai_call_consent === true. Replacing it with this SMS-only
    // text while ai_call_consent stays true leaves the outbound-voice path dialling on a
    // consent record that no longer mentions calls — an FCC artificial-voice artifact
    // destroyed by the one route whose entire purpose is to preserve the artifact.
    raw.sms_consent_text = raw.sms_consent_text || SMS_OPTIN_DISCLOSURE;
    raw.sms_consent_source = raw.sms_consent_source || "optin_link";
    raw.consent = { ...(raw.consent && typeof raw.consent === "object" ? raw.consent : {}), sms_optin: true, via: "optin_link", at: now };
    // GRANT SMS, NOTHING ELSE. `nurture_paused: false` here silently un-did a CAN-SPAM
    // unsubscribe; the two facts are unrelated and this route has no business touching it.
    await supabaseAdmin.from("leads").update({ raw }).eq("id", id);
    await logActivity({
      entity_type: "lead", entity_id: String(id), lead_id: String(id), actor: "consumer",
      action: "sms.optin_granted", detail: { via: "optin_link", text: SMS_OPTIN_DISCLOSURE },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
