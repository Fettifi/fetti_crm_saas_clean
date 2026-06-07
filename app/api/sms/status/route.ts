import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Twilio Status Callback — receives delivery status for outbound SMS
// (queued, sent, delivered, undelivered, failed). We just acknowledge + log;
// extend later to persist per-message status if needed.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    console.log("[sms/status]", form.get("MessageSid"), "->", form.get("MessageStatus"), "to", form.get("To"));
  } catch (e) {
    console.warn("[sms/status] parse error", e);
  }
  return new NextResponse(null, { status: 204 });
}
