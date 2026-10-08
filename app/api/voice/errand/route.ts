// PENNY RUNS AN ERRAND: she dials a named organisation, works the phone tree, waits out the hold,
// and the moment a human answers she says who she is and puts Ramon on.
//
// 2026-10-08, Ramon: "I hate having to sit and wait on hold... even if it is just to wait on hold
// till the prompts until you get a live operator and you get me on the phone, for example, if I
// wanted to call the IRS, you can handle the whole time until a live agent got on the phone."
//
// THIS IS A SECOND DOOR INTO THE DIALER AND IT IS GATED DIFFERENTLY FROM THE FIRST.
// /api/voice/outbound protects BORROWERS: ai_call_consent, borrower-local calling hours, one attempt
// per day, and a hard refusal of anything outside confirm|callback|new_lead. None of those can apply
// here — a servicer never gave us consent — so this route cannot reuse them, and that is exactly how
// a well-meant feature becomes an unrestricted auto-dialer. The substitute gate is lib/voice/
// callTargets.ts: a named allowlist, PLUS a live check that the number belongs to nobody in the CRM,
// PLUS deny-by-default when that check cannot be read. Proven by scripts/verify-errand-safety.ts,
// which was broken on purpose five ways before this route was written.
//
// !! NO ANSWERING-MACHINE DETECTION ON AN ERRAND CALL, AND THAT IS THE WHOLE POINT.
// app/api/voice/outbound/twiml/route.ts:25 hangs up when AnsweredBy starts with "machine". An IVR
// IS a machine. Wired that way, the very first IRS call would have been answered by the menu,
// classified machine_start, and hung up on — every time, silently, looking like the IRS never
// picked up. Worse, MachineDetection:"Enable" is the BLOCKING variant: it withholds TwiML for up to
// MachineDetectionTimeout seconds, so the stream would also miss the opening of the menu it needs to
// hear. So: no MachineDetection parameter at all. The stream connects immediately and Penny decides
// what she is listening to — menu, hold music, or a person. [[things-that-look-like-they-work]]
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";
import { logActivity } from "@/lib/activity";
import { canDial, normalize, type CallTarget } from "@/lib/voice/callTargets";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

/**
 * Every phone number Fetti holds for a HUMAN. Returns null when the read fails, which the gate
 * treats as a refusal — "we found no borrowers" and "we could not look" must never be the same answer.
 */
export async function crmHumanNumbers(): Promise<Set<string> | null> {
  try {
    const out = new Set<string>();
    const { data: leads, error: le } = await supabaseAdmin.from("leads").select("phone, raw").limit(5000);
    if (le) throw new Error(le.message);
    for (const l of leads || []) {
      const p = normalize((l as any).phone); if (p) out.add(p);
      const raw = (l as any).raw;
      if (raw && typeof raw === "object") {
        for (const k of ["co_phone", "callback_number", "phone2", "mobile"]) {
          const v = normalize((raw as any)[k]); if (v) out.add(v);
        }
      }
    }
    const { data: files, error: fe } = await supabaseAdmin.from("loan_files").select("phone").limit(5000);
    if (fe) throw new Error(fe.message);
    for (const f of files || []) { const p = normalize((f as any).phone); if (p) out.add(p); }
    return out;
  } catch (e) {
    console.error("[voice/errand] CRM number read failed:", (e as any)?.message || e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("x-fetti-internal") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({} as any));
  const targetKey = String(b.target || "").trim();
  const reason = String(b.reason || "").trim().slice(0, 300);
  if (!targetKey) return NextResponse.json({ called: false, error: "no target" }, { status: 400 });
  if (!reason) return NextResponse.json({ called: false, error: "every errand call states its reason — it goes in the audit record and into what Penny says she is calling about" }, { status: 400 });

  // ── THE GATE ──────────────────────────────────────────────────────────────────────────────────
  const crm = await crmHumanNumbers();
  const decision = canDial(targetKey, crm, { crmReadOk: crm !== null });
  if (!decision.allowed) {
    console.error("[voice/errand] REFUSED:", decision.reasons.join(" | "));
    return NextResponse.json({ called: false, error: "refused", reasons: decision.reasons }, { status: 403 });
  }
  const target = decision.target as CallTarget;

  // One line per organisation, ever. Two concurrent calls to the same multi-line business are not
  // just rude, they are 47 U.S.C. 227(b)(1)(D). A lock with a TTL, released on failure below.
  const lockKey = `errand_live_${target.id}`;
  const existing = await (await import("@/lib/settings")).getSetting(lockKey);
  if (existing) {
    const age = (Date.now() - Date.parse(existing)) / 60000;
    if (age < target.maxMinutes + 5) {
      return NextResponse.json({ called: false, error: `a call to ${target.org} is already live (${age.toFixed(0)}m). One line per organisation.` }, { status: 409 });
    }
  }
  await setSetting(lockKey, new Date().toISOString());
  const release = async () => { try { await setSetting(lockKey, ""); } catch {} };

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!tsid || !ttok || !from) { await release(); return NextResponse.json({ called: false, error: "not configured" }, { status: 500 }); }

  const secret = await cfg("VOICE_INGEST_TOKEN");
  const nonce = "ER" + crypto.randomBytes(15).toString("hex");
  const t = decisionToken(nonce, secret || "fetti");
  await setSetting(`errand_${nonce}`, JSON.stringify({
    target_id: target.id, org: target.org, to: target.number, mode: target.mode,
    agentMayTransact: target.agentMayTransact, record: target.record,
    disclosure: target.disclosure, purpose: target.purpose, reason,
    opened: new Date().toISOString(), maxMinutes: target.maxMinutes,
  }));

  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        To: target.number, From: from,
        Url: `${APP_URL}/api/voice/errand/twiml?n=${nonce}&t=${t}`,
        StatusCallback: `${APP_URL}/api/voice/errand/status?n=${nonce}&t=${t}`,
        StatusCallbackEvent: "completed",
        // NO MachineDetection — see the header. An IVR is a machine and must not end the call.
        // Generous answer window: a queue can ring a long time before anything picks up.
        Timeout: "45",
        // Wall-clock cap, enforced by Twilio itself rather than by anything of ours that could hang.
        TimeLimit: String(target.maxMinutes * 60),
      }).toString(),
    });
  } catch (e) {
    console.error("[voice/errand] twilio unreachable:", (e as any)?.message || e);
    await release();
    return NextResponse.json({ called: false, error: "twilio unreachable" }, { status: 502 });
  }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    console.error("[voice/errand] twilio rejected:", r.status, body);
    await release();
    return NextResponse.json({ called: false, error: "twilio rejected the call", detail: body }, { status: 502 });
  }
  const call = await r.json().catch(() => ({} as any));

  await logActivity({
    entity_type: "voice", entity_id: nonce, actor: "agent:penny", action: "errand.placed",
    detail: { target: target.id, org: target.org, to: target.number, mode: target.mode, reason, call_sid: call?.sid, cap_minutes: target.maxMinutes },
  }).catch(() => {});

  return NextResponse.json({
    called: true, nonce, call_sid: call?.sid || null, org: target.org, mode: target.mode,
    note: target.mode === "bridge"
      ? `Penny will work the menu and hold. When a human answers she states who she is and rings Ramon to bridge. She will not transact.`
      : `Scripted errand within the stated purpose. She will not transact beyond it.`,
  });
}
