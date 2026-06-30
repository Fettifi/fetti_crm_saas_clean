import { NextRequest, NextResponse } from "next/server";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// Twilio Status Callback — receives delivery status for outbound SMS
// (queued, sent, delivered, undelivered, failed). We just acknowledge + log;
// extend later to persist per-message status if needed.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (token) {
      const sig = req.headers.get("x-twilio-signature") || "";
      if (!twilioSignatureValid(token, sig, webhookCandidateUrls(req, "/api/sms/status"), params)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
    const sid = params["MessageSid"];
    const status = params["MessageStatus"];
    console.log("[sms/status]", sid, "->", status, "to", params["To"]);
    // Persist the delivery state onto the conversation thread. Find the original
    // outbound message we logged with this SID to scope the status to its lead,
    // then append a comms.status row the timeline maps back onto that bubble.
    if (sid && status) {
      try {
        const { data: orig } = await supabaseAdmin
          .from("activity_log").select("lead_id").eq("action", "comms.message")
          .filter("detail->>providerId", "eq", sid).limit(1).maybeSingle();
        await logActivity({
          entity_type: "sms", entity_id: sid, lead_id: (orig as any)?.lead_id || null,
          actor: "system", action: "comms.status",
          detail: { sid, status, to: params["To"] || null },
        });
      } catch (e) { console.warn("[sms/status] persist failed", e); }
    }
  } catch (e) {
    console.warn("[sms/status] parse error", e);
  }
  return new NextResponse(null, { status: 204 });
}
