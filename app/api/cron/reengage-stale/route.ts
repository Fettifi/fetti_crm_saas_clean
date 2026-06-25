import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { advanceLeadStage } from "@/lib/leadStage";
import { BRAND } from "@/lib/brand";
import { LICENSING_NOTE } from "@/lib/legal";

// ONE-TIME, MANUAL, EMAIL-ONLY re-engagement of historically-recovered Facebook
// leads (raw.historical_import) that were correctly held from auto-contact (stale
// Meta opt-in is NOT TCPA SMS consent). Ramon explicitly approved a single email
// outreach (2026-06-23) because intake had been broken and these paid leads sat cold.
//   - EMAIL ONLY (never SMS — TCPA).
//   - Idempotent: stamps raw.historical_outreach_at so a re-run NEVER double-sends.
//   - Excludes test/dummy leads.
//   - Marks each contacted lead -> "Contacted" so the LO works replies.
// NOT in vercel.json crons — it only runs when triggered with the CRON_SECRET bearer.
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
  const from = process.env.LEAD_RESPONSE_FROM_EMAIL;
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
  const { data: leads } = await supabaseAdmin
    .from("leads").select("id, full_name, email, stage, raw, source").limit(5000);
  const targets = (leads || []).filter((l: any) => {
    const raw = l.raw || {};
    if (!raw.historical_import) return false;        // only the recovered/stale Meta leads
    if (raw.historical_outreach_at) return false;    // already emailed once — never repeat
    if (!l.email) return false;                      // email-only outreach
    const name = (l.full_name || "").toLowerCase();
    const src = (l.source || "").toLowerCase();
    if (name.includes("test") || name.includes("dummy") || src.startsWith("zz") || src === "test") return false;
    return true;
  });

  if (dry) {
    return { dry: true, found: targets.length, sample: targets.slice(0, 25).map((l: any) => ({ name: l.full_name, email: l.email })) };
  }

  let contacted = 0, failed = 0;
  for (const l of targets as any[]) {
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
  return { dry: false, found: targets.length, contacted, failed };
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  try { return NextResponse.json({ ok: true, ...(await run(dry)) }); }
  catch (e: any) { return NextResponse.json({ error: e?.message || "failed" }, { status: 500 }); }
}
