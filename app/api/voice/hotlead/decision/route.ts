// Twilio posts Ramon's keypress here. 1 → bridge him straight to the borrower (we
// dial the borrower on his live leg). 2 / no input → drop a call-back task so it's
// never lost. HMAC-nonce gated. Public route (Twilio-facing).
import { NextRequest, NextResponse } from "next/server";
import { hotLeadTokenValid } from "@/lib/hotLead";
import { getSetting } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM = process.env.TWILIO_FROM || "";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "", t = req.nextUrl.searchParams.get("t") || "";
  if (!hotLeadTokenValid(n, t)) return xml(`<Say voice="Polly.Joanna">Invalid request. Goodbye.</Say><Hangup/>`);
  let ctx: any = {};
  try { ctx = JSON.parse((await getSetting("hotlead_" + n)) || "{}"); } catch { /* */ }
  let digits = "";
  try { const f = await req.formData(); digits = String(f.get("Digits") || ""); } catch { /* */ }

  const leadId = ctx.lead_id, borrower = String(ctx.borrower || ""), name = esc(ctx.name || "them");

  // PRESS 1 → connect now: dial the borrower onto Ramon's live leg (answerOnBridge so
  // he only hears ringing, and the Fetti number is the caller ID the borrower sees).
  if (digits === "1" && /^\+\d{10,15}$/.test(borrower)) {
    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:penny", action: "hotlead.connected", detail: { borrower } }).catch(() => {});
    return xml(
      `<Say voice="Polly.Joanna">Connecting you to ${name} now.</Say>` +
      `<Dial callerId="${esc(FROM)}" answerOnBridge="true" timeout="30">${esc(borrower)}</Dial>` +
      `<Say voice="Polly.Joanna">That call has ended. Goodbye.</Say>`
    );
  }

  // PRESS 2 / anything else / timeout → log a call-back task so the hot lead is never dropped.
  if (leadId) {
    await supabaseAdmin.from("org_tasks").insert([{
      title: `🟠 CALL BACK (hot lead) — ${name}`.slice(0, 200),
      detail: `You chose "call later" on Penny's hot-lead page. Call ${borrower || "them"} back soon.`,
      source: "hotlead_later", status: "open", priority: 9,
      dedup_key: `hotback:${leadId}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
    }]).then(() => {}, () => {});
    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:penny", action: "hotlead.deferred", detail: { digits } }).catch(() => {});
  }
  return xml(`<Say voice="Polly.Joanna">Got it — I'll add ${name} to your call-back list. Goodbye.</Say><Hangup/>`);
}
