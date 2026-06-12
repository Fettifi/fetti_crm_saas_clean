import { NextRequest, NextResponse } from "next/server";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";

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
    console.log("[sms/status]", params["MessageSid"], "->", params["MessageStatus"], "to", params["To"]);
  } catch (e) {
    console.warn("[sms/status] parse error", e);
  }
  return new NextResponse(null, { status: 204 });
}
