// Twilio fetches this when Ramon PICKS UP the hot-lead page. Penny reads the pitch
// and gathers 1 (connect now) or 2 (call later). HMAC-nonce gated so only our own
// page call can reach it. Public route (Twilio-facing) — not in the proxy gate.
import { NextRequest, NextResponse } from "next/server";
import { hotLeadTokenValid } from "@/lib/hotLead";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

async function handle(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "", t = req.nextUrl.searchParams.get("t") || "";
  if (!hotLeadTokenValid(n, t)) return xml(`<Say voice="Polly.Joanna">Sorry, something went wrong. Goodbye.</Say><Hangup/>`);
  let ctx: any = {};
  try { ctx = JSON.parse((await getSetting("hotlead_" + n)) || "{}"); } catch { /* */ }
  const name = esc(ctx.name || "a borrower");
  const pitch = esc(ctx.pitch || "a new high-value lead");
  // esc() is NOT optional here: the raw "&t=" in this URL is what broke every
  // hot-lead page (Twilio 12100 "Document parse failure" → error message + hangup,
  // 7/17 + 7/21) — in XML an attribute's & MUST be &amp;.
  const action = esc(`/api/voice/hotlead/decision?n=${encodeURIComponent(n)}&t=${encodeURIComponent(t)}`);
  return xml(
    `<Gather numDigits="1" action="${action}" method="POST" timeout="8">` +
    `<Say voice="Polly.Joanna">Ramon, hot lead. ${pitch}. Press 1 to connect with ${name} right now, or press 2 to call them later.</Say>` +
    `</Gather>` +
    `<Say voice="Polly.Joanna">No answer received — we'll follow up. Goodbye.</Say><Hangup/>`
  );
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
