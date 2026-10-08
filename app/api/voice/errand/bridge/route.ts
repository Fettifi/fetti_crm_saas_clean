// A HUMAN ANSWERED. PUT RAMON ON.
//
// Penny calls this the moment she is satisfied she is talking to a person rather than a menu or
// hold music. It rings Ramon's cell, whispers what is on the line, and on press-1 drops both legs
// into a private conference — the same mechanism as app/api/voice/transfer/decision/route.ts, which
// has been working on inbound calls for months. Nothing here is invented; it is the proven bridge
// pointed the other way.
//
// WHY A WHISPER AND NOT A STRAIGHT DIAL: he may be driving, in a closing, or on another call. A
// bare connect would drop him into a live IRS agent mid-sentence with no idea who it is. The
// whisper costs four seconds and tells him what he is walking into.
//
// WHAT HAPPENS IF HE DOES NOT PICK UP is the part that decides whether this feature is trusted.
// The human on the other end has just said "hello" twice. Penny does NOT hang up silently and she
// does NOT improvise: she says, verbatim, that she could not reach him and asks whether she may call
// back — and that is the end of her authority. Anything else would be transacting.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";
import { ownerCallFrom } from "@/lib/ownerCallFrom";
import { ownerCell } from "@/lib/ownerCell";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^ER[a-f0-9]{30}$/i.test(n) || t !== decisionToken(n, secret)) {
    return NextResponse.json({ bridged: false, error: "unauthorized" }, { status: 401 });
  }
  const raw = await getSetting(`errand_${n}`);
  if (!raw) return NextResponse.json({ bridged: false, error: "unknown errand" }, { status: 404 });
  const ctx = JSON.parse(raw);

  const body = await req.json().catch(() => ({} as any));
  // The live call sid of the ERRAND leg — the bridge hands it over so we can redirect it.
  const errandSid = String(body.call_sid || ctx.call_sid || "");
  if (!/^CA[a-f0-9]{32}$/i.test(errandSid)) {
    return NextResponse.json({ bridged: false, error: "need the errand call sid" }, { status: 400 });
  }

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN;
  // lib/ownerCell.ts, NOT a key of this route's own invention. The first version read
  // cfg("OWNER_MOBILE") — set in neither Vercel nor app_settings — so this route would have
  // 500'd at the one moment that matters: a live human on the line after a long hold. Read that
  // file before changing this line; it has the measurements.
  const owner = await ownerCell();
  if (!tsid || !ttok || !owner) return NextResponse.json({ bridged: false, error: "not configured" }, { status: 500 });

  const auth = "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64");
  const conf = `errand_${errandSid}`;
  await setSetting(`errandbridge_${errandSid}`, "pending");

  // Ring him from the 10DLC line — the toll-free goes unanswered to his cell every time
  // (carrier spam filtering / Silence Unknown Callers). See lib/ownerCallFrom.ts.
  const from = await ownerCallFrom();
  const who = esc(String(ctx.org || "the other party"));
  const why = esc(String(ctx.reason || "").slice(0, 160));
  const dt = decisionToken(errandSid, secret);

  const whisper =
    `<Response><Gather numDigits="1" timeout="12" action="${esc(`${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/api/voice/errand/bridge/decision?sid=${errandSid}&amp;t=${dt}&amp;n=${n}`)}" method="POST">` +
    `<Say voice="Polly.Joanna-Neural">Ramon — Penny here. I have a live person at ${who} on the line` +
    (why ? `, about ${why}` : "") +
    `. Press 1 and I will connect you.</Say></Gather>` +
    `<Say voice="Polly.Joanna-Neural">No answer — I will let them go.</Say><Hangup/></Response>`;

  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        To: owner, From: from, Twiml: whisper, Timeout: "20",
        StatusCallback: `${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/api/voice/errand/bridge/status?sid=${errandSid}&t=${dt}`,
        StatusCallbackEvent: "completed",
      }).toString(),
    });
  } catch (e) {
    console.error("[voice/errand/bridge] owner ring threw:", (e as any)?.message || e);
    return NextResponse.json({ bridged: false, error: "could not ring owner" }, { status: 502 });
  }
  if (!r.ok) {
    console.error("[voice/errand/bridge] owner ring failed:", r.status, (await r.text()).slice(0, 200));
    return NextResponse.json({ bridged: false, error: "could not ring owner" }, { status: 502 });
  }

  await logActivity({
    entity_type: "voice", entity_id: n, actor: "agent:penny", action: "errand.human_reached",
    detail: { org: ctx.org, errand_sid: errandSid, conference: conf },
  }).catch(() => {});

  // Poll the decision for up to ~42s (Vercel's 60s ceiling, same budget as the inbound transfer).
  const deadline = Date.now() + 42_000;
  while (Date.now() < deadline) {
    await new Promise((r2) => setTimeout(r2, 1500));
    const s = await getSetting(`errandbridge_${errandSid}`);
    if (s === "accepted") return NextResponse.json({ bridged: true, say: "Thank you for holding — connecting you with Ramon Dent now." });
    if (s === "declined") {
      return NextResponse.json({
        bridged: false,
        // Verbatim. This is the whole of her authority when he does not pick up.
        say: "I'm very sorry — I wasn't able to reach Mr. Dent just now. May we call you back, or is there a direct number or reference I can note for him?",
      });
    }
  }
  return NextResponse.json({
    bridged: false,
    say: "I'm very sorry — I wasn't able to reach Mr. Dent just now. May we call you back, or is there a direct number or reference I can note for him?",
  });
}
