// HOT-LEAD VOICE PAGE — speed-to-lead without Ramon logging in.
// When a high-value (Tier-1 / high-intent) lead lands, Penny CALLS RAMON'S CELL:
// "Ramon, hot lead — <pitch>. Press 1 to connect with <name> now, or 2 to call
// later." Press 1 → we dial the borrower and bridge them to Ramon live. Press 2 →
// a call-back task. Ramon never opens the app; the system reaches out to HIM.
//
// Guardrails: only pages for a REAL, consented, callable US borrower (inbound leads
// who inquired — never cold/opted-out/invalid). Master switch HOTLEAD_VOICE_PAGE
// (app_settings) defaults OFF so his cell never rings until he turns it on. Throttled
// to one page per lead / 30 min. The TwiML endpoints are gated by a single-use HMAC
// nonce so nobody but our own page call can trigger a bridge.
import crypto from "crypto";
import { after } from "next/server";
import { signingSecret } from "@/lib/signingSecret";
import { getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export function hotLeadToken(nonce: string): string {
  return crypto.createHmac("sha256", signingSecret() + ":hotlead").update(nonce).digest("hex").slice(0, 24);
}
export function hotLeadTokenValid(nonce: string, t: string): boolean {
  if (!nonce || !t) return false;
  const a = Buffer.from(hotLeadToken(nonce)), b = Buffer.from(String(t));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ownerCellE164(): string | null {
  const raw = String(process.env.LEAD_NOTIFY_SMS_TO || "").trim();
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return "+" + d;
  return d.length === 10 ? "+1" + d : d ? "+" + d : null;
}
export function toE164(phone: string): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d.length >= 11 ? "+" + d : null;
}

export type PageResult = { paged: boolean; reason?: string };

/** Page Ramon's cell about a hot lead. `pitch` is the one-line Penny reads aloud.
 *  opts.force = LO-initiated (a click-to-call button): bypass the auto-page master
 *  switch and the throttle, since the human explicitly asked to dial this one now. */
export async function pageOwnerHotLead(lead: any, pitch: string, opts?: { force?: boolean }): Promise<PageResult> {
  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  const owner = ownerCellE164();
  if (!tsid || !ttok || !from || !owner) return { paged: false, reason: "voice_unconfigured" };
  if (!opts?.force && (await getSetting("HOTLEAD_VOICE_PAGE")) !== "on") return { paged: false, reason: "disabled" };

  const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
  if (!lead?.phone) return { paged: false, reason: "no_phone" };
  if (lead.nurture_paused || raw.sms_optout_at) return { paged: false, reason: "opted_out" };
  if (["invalid", "non_us"].includes(raw.phone_status) || /@fetti-internal\.test$/i.test(String(lead.email || ""))) return { paged: false, reason: "guarded_phone" };
  const borrower = toE164(lead.phone);
  if (!borrower) return { paged: false, reason: "bad_phone" };

  // One page per lead / 30 min (never double-ring his cell) — skipped when LO-forced.
  if (!opts?.force) {
    const tk = `hotpage_last_${lead.id}`;
    const last = await getSetting(tk);
    if (last && Date.now() - new Date(last).getTime() < 30 * 60_000) return { paged: false, reason: "throttled" };
    await setSetting(tk, new Date().toISOString());
  }

  const nonce = "HL" + crypto.randomBytes(12).toString("hex");
  const tok = hotLeadToken(nonce);
  const first = String(lead.first_name || lead.full_name || "there").split(/\s+/)[0];
  await setSetting("hotlead_" + nonce, JSON.stringify({ lead_id: lead.id, name: first, borrower, pitch: String(pitch || "a new high-value lead").slice(0, 220) }));

  after(async () => {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: owner, From: from, Url: `${APP}/api/voice/hotlead/answer?n=${nonce}&t=${tok}`, Timeout: "25" }).toString(),
      });
      await logActivity({ entity_type: "lead", entity_id: lead.id, lead_id: lead.id, actor: "agent:penny", action: "hotlead.paged_owner", detail: { placed: r.ok, to: owner } }).catch(() => {});
      if (!r.ok) console.error("[hotLead] twilio", r.status, (await r.text().catch(() => "")).slice(0, 160));
    } catch (e) { console.error("[hotLead] page failed", e); }
  });
  return { paged: true };
}
