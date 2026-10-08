// TwiML Twilio fetches when an errand target picks up — an IVR, hold music, or a person.
//
// TWO DELIBERATE DIFFERENCES FROM app/api/voice/outbound/twiml/route.ts, and both are the feature:
//
// 1. IT NEVER HANGS UP ON A "MACHINE". That route returns <Say>voicemail</Say><Hangup/> when
//    AnsweredBy starts with "machine" (line 25). An IVR is a machine. On an IRS call that is a
//    guaranteed hang-up on the menu, every time, indistinguishable from "nobody answered".
//    Errand calls are placed with NO MachineDetection at all, so AnsweredBy never arrives here.
//
// 2. NO <Say> DISCLOSURE BEFORE THE STREAM. That route speaks the CA SB 1001 / § 632 disclosure at
//    second 0 (line 45-46). Correct for a borrower who just answered their own phone; useless on an
//    errand, where second 0 is a recorded menu saying "for English, press 1". Nobody hears it, and
//    on a 40-minute hold the one human who should hear it arrives 39 minutes after it played.
//    So the disclosure travels as a Parameter and Penny speaks it AS HER FIRST WORDS TO A HUMAN —
//    which is both where the law wants it and where it is actually true.
//
// The stream also learns, up front, that it may not transact. That is a data fact from the target's
// allowlist entry, not an instruction the model can be talked out of.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
// & MUST become &amp; inside an XML attribute or Twilio 12100s the entire call — learned the hard
// way on the hot-lead pager (app/api/voice/hotlead/answer/route.ts).
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^ER[a-f0-9]{30}$/i.test(n) || t !== decisionToken(n, secret)) return xml(`<Hangup/>`);

  const raw = await getSetting(`errand_${n}`);
  if (!raw) return xml(`<Hangup/>`);
  const ctx = JSON.parse(raw);

  const wss = await cfg("REALTIME_VOICE_WSS");
  if (!wss) {
    // No bridge configured: say nothing useful to a stranger's phone system — just end it.
    console.error("[voice/errand/twiml] REALTIME_VOICE_WSS unset; cannot run an errand without the bridge");
    return xml(`<Hangup/>`);
  }
  const url = wss.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const params = [
    `<Parameter name="mode" value="errand" />`,
    `<Parameter name="errand_id" value="${esc(n)}" />`,
    `<Parameter name="org" value="${esc(ctx.org)}" />`,
    `<Parameter name="purpose" value="${esc(String(ctx.purpose || "").slice(0, 240))}" />`,
    `<Parameter name="reason" value="${esc(String(ctx.reason || "").slice(0, 240))}" />`,
    // Spoken verbatim as the first words to a human. Not a suggestion.
    `<Parameter name="disclosure" value="${esc(String(ctx.disclosure || "").slice(0, 400))}" />`,
    // false for every bridge target, and permanently false for the IRS.
    `<Parameter name="may_transact" value="${ctx.agentMayTransact ? "true" : "false"}" />`,
    `<Parameter name="bridge_url" value="${esc(`/api/voice/errand/bridge?n=${n}&t=${t}`)}" />`,
  ].join("");

  // Straight into the stream. No Say, no Pause, no detection — Penny needs to hear the menu's first
  // syllable, because "press 1 for English" is often already playing when the call connects.
  return xml(`<Connect><Stream url="${url}">${params}</Stream></Connect>`);
}
