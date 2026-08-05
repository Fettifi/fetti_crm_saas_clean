// THE PHONE IS THE BUSINESS. WATCH IT LIKE IT.
//
// 2026-08-05. The Twilio account went SUSPENDED on 2026-08-03 at 19:19. For two days every
// caller to the office line — (866) 493-3884, the number on the website, the letterhead, the
// privacy policy and the NMLS record — got a fast busy signal. Ramon found out by calling his
// own office. Nothing in this system said a word.
//
// It was invisible because the CRM Doctor, which runs hourly and reports "healthy", had ZERO
// checks touching Twilio, voice, or alerting. Zero. It checked ten database tables and a
// content queue while the phone was dead. That is the failure this project keeps hitting: a
// monitor that is green because it never looked.
//
// It was also silent because the one alert channel for a phone message is an SMS sent THROUGH
// TWILIO — so the outage disabled its own alarm. Anything that watches Twilio must not report
// through Twilio. These checks alert by EMAIL.
//
// WHAT WOULD HAVE PREVENTED IT: the balance. Twilio suspends at zero, and the account had been
// draining for weeks. A low-balance warning at $15 turns a two-day outage into a two-minute
// top-up. That is the cheapest check here and the most valuable.
import { cfg } from "@/lib/settings";

export type CommsCheck = { name: string; ok: boolean; level: "critical" | "warn" | "info"; detail: string };

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");
const VOICE_WEBHOOK = `${APP_URL}/api/voice/incoming`;
const SMS_WEBHOOK = `${APP_URL}/api/sms/inbound`;

function basic(sid: string, tok: string) {
  return "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64");
}

export async function commsChecks(): Promise<CommsCheck[]> {
  const out: CommsCheck[] = [];
  const add = (name: string, ok: boolean, level: CommsCheck["level"], detail: string) => out.push({ name, ok, level, detail });

  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";

  if (!(sid && tok && from)) {
    add("twilio:configured", false, "critical",
      `missing ${["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"].filter((k) => !process.env[k]).join(", ")}`);
    return out;
  }

  // ── the account itself ────────────────────────────────────────────────────────────────────
  // A suspended account answers REST with 401/20003 — the SAME error as a wrong auth token, so
  // do not report this as "bad credentials". On 2026-08-05 that ambiguity nearly sent us
  // rotating a token that was never wrong. Say what is observable: Twilio refused us.
  let accountActive = false;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: basic(sid, tok) } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      add("twilio:auth", false, "critical",
        `Twilio refused the account (HTTP ${r.status}${j?.code ? `, code ${j.code}` : ""}: ${j?.message || "no detail"}). ` +
        `This is EITHER a suspended/unfunded account OR rotated credentials — check the console banner and the balance FIRST, ` +
        `they look identical from here. While this is failing, inbound calls get a busy signal and every outbound SMS is dead.`);
      return out;
    }
    accountActive = String(j?.status || "").toLowerCase() === "active";
    add("twilio:auth", true, "critical", `authenticated as "${j?.friendly_name || "?"}"`);
    add("twilio:account_active", accountActive, "critical",
      accountActive ? "status=active" : `status=${j?.status} — callers cannot reach the office line`);
  } catch (e: any) {
    add("twilio:auth", false, "critical", `could not reach Twilio: ${e?.message || "error"}`);
    return out;
  }

  // ── the balance: the check that turns a 2-day outage into a 2-minute top-up ────────────────
  try {
    const floor = Number((await cfg("TWILIO_LOW_BALANCE_USD")) || 15);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, { headers: { Authorization: basic(sid, tok) } });
    const j: any = await r.json().catch(() => ({}));
    const bal = Number(j?.balance);
    if (!isFinite(bal)) add("twilio:balance", false, "warn", "could not read balance");
    else if (bal <= 0) add("twilio:balance", false, "critical", `$${bal.toFixed(2)} — the account will be suspended and the phone will go BUSY. Top up now.`);
    else if (bal < floor) add("twilio:balance", false, "warn", `$${bal.toFixed(2)} is below the $${floor} floor — top up before it suspends and the office line goes busy.`);
    else add("twilio:balance", true, "info", `$${bal.toFixed(2)}`);
  } catch (e: any) { add("twilio:balance", false, "warn", e?.message || "error"); }

  // ── every number points at us ─────────────────────────────────────────────────────────────
  // Not just TWILIO_FROM. On 2026-08-05 the (920) number was still answering with Twilio's own
  // DEMO greeting — "thanks for trying our documentation" — to anyone who dialled it, and the
  // (866), the number actually published to clients, had NO SMS webhook at all, so every text
  // a borrower sent to the office number was silently discarded.
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, { headers: { Authorization: basic(sid, tok) } });
    const j: any = await r.json().catch(() => ({}));
    const nums: any[] = j?.incoming_phone_numbers || [];
    if (!nums.length) add("twilio:numbers", false, "critical", "the account owns no phone numbers");

    const sender = nums.find((n) => n.phone_number === from);
    add("twilio:sender_owned", !!sender, "critical",
      sender ? `${from} is on the account` : `TWILIO_FROM ${from} is NOT a number on this account — every send will fail`);

    for (const n of nums) {
      const label = n.phone_number;
      const voiceOk = n.voice_url === VOICE_WEBHOOK;
      const isThirdParty = n.voice_url && !String(n.voice_url).startsWith(APP_URL);
      // A number wired to somebody else's service is not necessarily wrong — it may be a
      // deliberate hand-off — but it must never be silent about it.
      add(`twilio:voice:${label}`, voiceOk || !!n.voice_url, voiceOk ? "info" : "warn",
        voiceOk ? "→ our receptionist"
          : !n.voice_url ? "NO voice URL — inbound calls fail"
          : isThirdParty ? `points at a THIRD PARTY: ${n.voice_url}` : `points at ${n.voice_url}`);
      // Only the sending number must receive replies; the rest are informational.
      const smsOk = n.sms_url === SMS_WEBHOOK;
      add(`twilio:sms:${label}`, smsOk || label !== from, smsOk ? "info" : label === from ? "critical" : "warn",
        smsOk ? "→ our inbound handler" : !n.sms_url ? "NO SMS URL — inbound texts are dropped silently" : `points at ${n.sms_url}`);
    }
  } catch (e: any) { add("twilio:numbers", false, "warn", e?.message || "error"); }

  // ── the alert channel that must survive a Twilio outage ───────────────────────────────────
  const rk = process.env.RESEND_API_KEY, rto = process.env.LEAD_NOTIFY_EMAIL_TO, rfrom = process.env.LEAD_NOTIFY_EMAIL_FROM;
  add("alerts:email_configured", !!(rk && rto && rfrom), "critical",
    rk && rto && rfrom ? `→ ${rto}` : `alertTeam will SKIP email — missing ${[!rk && "RESEND_API_KEY", !rto && "LEAD_NOTIFY_EMAIL_TO", !rfrom && "LEAD_NOTIFY_EMAIL_FROM"].filter(Boolean).join(", ")}`);

  return out;
}
