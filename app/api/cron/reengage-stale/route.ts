import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { advanceLeadStage } from "@/lib/leadStage";
import { BRAND } from "@/lib/brand";
import { LICENSING_NOTE } from "@/lib/legal";
import { senderFrom } from "@/lib/notify/mailFrom";
import { cfg } from "@/lib/settings";
import { recordHeartbeat, recordAttempt } from "@/lib/heartbeat";

// ONE-TIME, MANUAL, EMAIL-ONLY re-engagement of historically-recovered Facebook
// leads (raw.historical_import) that were correctly held from auto-contact (stale
// Meta opt-in is NOT TCPA SMS consent). Ramon explicitly approved a single email
// outreach (2026-06-23) because intake had been broken and these paid leads sat cold.
//   - EMAIL ONLY (never SMS — TCPA).
//   - Idempotent: stamps raw.historical_outreach_at so a re-run NEVER double-sends.
//   - Excludes test/dummy leads.
//   - Marks each contacted lead -> "Contacted" so the LO works replies.
//
// SCHEDULED weekly 2026-07-26 at Ramon's request (it was manual-only before). Safe to
// repeat ONLY because of two properties, both of which must be preserved:
//   1) IDEMPOTENT — raw.historical_outreach_at means a lead is emailed at most once, ever.
//      A weekly run therefore only ever picks up leads recovered SINCE the last run.
//   2) CAPPED per run (REENGAGE_CAP, default 25) — a large historical import can no longer
//      turn one tick into a mass send. This is the guard the nurture backlog lacked when a
//      single run pushed 159 touches out at once (2026-07-26).
// Email-only forever: stale Meta opt-in is NOT TCPA consent for SMS.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");
const APPLY_URL = `${BASE}/apply`;

function buildEmail(first: string): { subject: string; html: string } {
  const subject = `${first}, still here to help with your financing — Fetti`;
  const body =
    `Hi ${first},<br><br>` +
    `This is ${BRAND.company}. You reached out about financing a while back, and I want to make sure you didn't fall through the cracks.<br><br>` +
    `If a purchase, refinance, or an investment property is still on your radar, I can get you real options fast — no pressure, no obligation. Start or pick up your application here:` +
    `<div style="margin:18px 0"><a href="${APPLY_URL}" style="background:#10b981;color:#021;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9999px;display:inline-block">See my loan options &rarr;</a></div>` +
    `Or just reply to this email and a licensed specialist will take it from there.<br><br>&mdash; The Fetti team`;
  const footer =
    `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.5">` +
    `You're receiving this because you requested information from ${BRAND.company} through a Facebook lead form. ` +
    `Prefer not to hear from us? Just reply with "unsubscribe" and we'll remove you right away.<br><br>${LICENSING_NOTE}</div>`;
  return {
    subject,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${body}${footer}</div>`,
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom();
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

async function run(dry: boolean) {
  // Raw-string parse, NOT Number(await cfg(...)): cfg() returns null when unset and
  // Number(null) === 0, which would silently disable the cap (see nurture, 2026-07-26).
  const capRaw = await cfg("REENGAGE_CAP");
  const capNum = capRaw == null || String(capRaw).trim() === "" ? NaN : Number(capRaw);
  const CAP = Number.isFinite(capNum) && capNum > 0 ? capNum : 25;
  const { data: leads } = await supabaseAdmin
    .from("leads").select("id, full_name, email, stage, raw, source, nurture_paused").limit(5000);
  const targets = (leads || []).filter((l: any) => {
    const raw = l.raw || {};
    if (l.nurture_paused) return false;               // unsubscribed/opted-out: never email again
    if (!raw.historical_import) return false;        // only the recovered/stale Meta leads
    if (raw.historical_outreach_at) return false;    // already emailed once — never repeat
    if (!l.email) return false;                      // email-only outreach
    const name = (l.full_name || "").toLowerCase();
    const src = (l.source || "").toLowerCase();
    if (name.includes("test") || name.includes("dummy") || src.startsWith("zz") || src === "test") return false;
    return true;
  });

  if (dry) {
    return { dry: true, found: targets.length, cap: CAP, wouldSend: Math.min(targets.length, CAP), sample: targets.slice(0, 25).map((l: any) => ({ name: l.full_name, email: l.email })) };
  }

  // Never silent about a cap: `held` is returned so a backlog can't look like completion.
  const batch = (targets as any[]).slice(0, CAP);
  const held = targets.length - batch.length;
  let contacted = 0, failed = 0;
  for (const l of batch) {
    const first = (l.full_name || "there").split(" ")[0];
    const { subject, html } = buildEmail(first);
    const ok = await sendEmail(l.email, subject, html);
    if (!ok) { failed++; continue; }
    const raw = l.raw && typeof l.raw === "object" ? l.raw : {};
    raw.historical_outreach_at = new Date().toISOString();
    raw.historical_outreach_channel = "email";
    await supabaseAdmin.from("leads").update({ raw }).eq("id", l.id);
    try { await advanceLeadStage(l.id, "Contacted", { actor: "system", reason: "one-time historical re-engagement (email, owner-approved)" }); } catch { /* forward-only */ }
    await logActivity({
      entity_type: "lead", entity_id: l.id, lead_id: l.id, actor: "agent:mark",
      action: "lead.historical_outreach", detail: { channel: "email" },
    }).catch(() => {});
    contacted++;
  }
  if (held > 0) console.warn(`[reengage-stale] cap ${CAP} reached — HELD ${held} for the next run`);
  return { dry: false, found: targets.length, cap: CAP, contacted, failed, held };
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  // Only stamp an ATTEMPT for a real invocation. A ?dry=1 preview does no work and records
  // no heartbeat, so stamping the attempt made the doctor read "fired but never completed"
  // — i.e. STALLED — and report the whole system down until the next live run. A preview is
  // not an invocation. (Found by the doctor itself, 2026-07-26, crying wolf over my own audit.)
  if (!dry) await recordAttempt("reengage-stale");
  try {
    const out = await run(dry);
    if (!dry) await recordHeartbeat("reengage-stale");
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "failed" }, { status: 500 }); }
}

// Vercel Cron issues GET — POST-only would have 405'd on every scheduled tick.
export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
