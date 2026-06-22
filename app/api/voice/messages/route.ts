import { NextRequest, NextResponse } from "next/server";
import { getMessages, setMessageStatus } from "@/lib/phoneMessages";

// Phone message queue for the CRM. Auth-gated via the /api/voice/messages matcher
// in proxy.ts (the Twilio webhooks /api/voice/incoming + /turn stay public).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ messages: await getMessages() });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (b?.id && (b.status === "new" || b.status === "handled")) await setMessageStatus(b.id, b.status);
  return NextResponse.json({ ok: true });
}
