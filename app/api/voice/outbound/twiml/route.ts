// TwiML for Penny's outbound calls. Twilio fetches this when the callee answers.
// AnsweredBy=machine_* → a short, warm voicemail (never a stranded AI dialogue);
// human → hand the call to the realtime bridge with the outbound mode + context.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^OB[a-f0-9]{30}$/i.test(n) || t !== decisionToken(n, secret)) return xml(`<Hangup/>`);
  const raw = await getSetting(`outbound_${n}`);
  if (!raw) return xml(`<Hangup/>`);
  const ctx = JSON.parse(raw);
  const form = await req.formData().catch(() => null);
  const answeredBy = String(form?.get("AnsweredBy") || "");

  if (answeredBy.startsWith("machine")) {
    const vm = ctx.mode === "confirm"
      ? `Hi${ctx.first ? " " + esc(ctx.first) : ""}, this is Penny, the A.I. assistant at Fetti Financial Services, calling to confirm your upcoming appointment with Ramon. If anything changed, just call us back or reply to our text — otherwise we'll see you then. Talk soon!`
      : `Hi${ctx.first ? " " + esc(ctx.first) : ""}, this is Penny, the A.I. assistant at Fetti Financial Services, returning your call. Sorry we missed each other — call us back anytime and I'll pick right up, or Ramon will follow up personally. Talk soon!`;
    return xml(`<Pause length="1"/><Say voice="Polly.Joanna-Neural">${vm}</Say><Hangup/>`);
  }

  const wss = await cfg("REALTIME_VOICE_WSS");
  if (!wss) return xml(`<Say voice="Polly.Joanna-Neural">Sorry — please call Fetti Financial Services back. Goodbye.</Say><Hangup/>`);
  const url = wss.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const params = [
    `<Parameter name="caller" value="${esc(ctx.to)}" />`,
    `<Parameter name="mode" value="${esc(ctx.mode)}" />`,
    `<Parameter name="first" value="${esc(ctx.first || "")}" />`,
    `<Parameter name="context" value="${esc(String(ctx.context || "").slice(0, 250))}" />`,
  ].join("");
  return xml(`<Connect><Stream url="${url}">${params}</Stream></Connect>`);
}
