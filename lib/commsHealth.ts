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

// HOW LONG HAVE WE GOT — the number a threshold cannot tell you.
//
// 2026-09-26. The balance read $14.07 against a $15 floor, so this file said "below the floor".
// True, and not a decision: it says nothing about WHEN the phone dies. Pulling 14 days of usage
// turned it into "$1.63/day, empty about Oct 5" — which could then be set against a rate lock
// expiring 10/02 and a closing on 09/28. A level tells you a state; only a rate gives a deadline.
//
// It also closes a real hole. A FIXED FLOOR IS BLIND TO THE BURN RATE: $20 against a $15 floor
// reports healthy, but at $5/day that is four days from a busy signal on the office line. The
// floor catches a slow drain and misses a fast one, which is the one that hurts.
//
// Best-effort only. If the usage API is unreachable this returns null and every balance check
// below still fires exactly as it did before — a diagnostic must never be able to break the
// alarm it is decorating.
async function twilioBurn(sid: string, tok: string, days = 14):
  Promise<{ perDay: number; worstDay: number; sampled: number } | null> {
  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/Daily.json?Category=totalprice&PageSize=${days}`,
      { headers: { Authorization: basic(sid, tok) } });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => ({}));
    const prices: number[] = (j?.usage_records || [])
      .map((u: any) => Number(u?.price))
      .filter((n: number) => isFinite(n) && n >= 0);
    if (!prices.length) return null;
    const total = prices.reduce((a, b) => a + b, 0);
    const perDay = total / prices.length;
    if (!(perDay > 0)) return null;          // a zero burn gives an infinite runway — say nothing
    return { perDay, worstDay: Math.max(...prices), sampled: prices.length };
  } catch { return null; }
}

export type Burn = { perDay: number; worstDay: number; sampled: number };

// THE DECISION, SEPARATED FROM THE NETWORK, SO A GUARD CAN REACH IT.
//
// While it lived inline inside the fetch above, nothing could test it without live Twilio
// credentials — so the branch that matters most (above the floor, nearly empty) could only
// ever have been proven by waiting for it to happen in production. Pure in, pure out.
export function balanceVerdict(
  bal: number, floor: number, minDays: number, burn: Burn | null,
): { ok: boolean; level: CommsCheck["level"]; detail: string } {
  if (!isFinite(bal)) return { ok: false, level: "warn", detail: "could not read balance" };

  const runway = bal > 0 && burn ? ` — ${runwayPhrase(bal, burn)}` : "";
  const daysLeft = bal > 0 && burn ? bal / burn.perDay : Infinity;

  // WHAT A ZERO BALANCE ACTUALLY BREAKS — corrected 2026-10-05, because this alert was telling Ramon
  // something false every night. It said "the office line goes busy". The published office line,
  // (424) 675-6295, is a **Spectrum** line and is not on Twilio at all — only three numbers are
  // (866 493-3884, 920 754-3647, 858 879-3162) and the account holds no 424. A Twilio balance cannot
  // make Spectrum go busy, and saying so sends the reader to the wrong bill: the office line dies if
  // SPECTRUM …7741 is cut ($938.67, at Sequium), which is a different problem with a different fix.
  // The real mechanism is one step removed and worth naming exactly: the 424 is *72-forwarded to the
  // 866, so at zero the forward lands on a SUSPENDED Twilio number — callers stop reaching Mark even
  // though Spectrum is fine — and the SMS pager (ping-ramon) stops, which on a signed-out-Outlook day
  // is the only outbound channel left. [[ai-receptionist]] · [[twilio-suspension-busy-signal]]
  if (bal <= 0) return { ok: false, level: "critical",
    detail: `$${bal.toFixed(2)} — Twilio will suspend: the SMS pager stops and calls forwarded from the office line hit a dead number. Top up now.` };

  if (bal < floor) return { ok: false, level: "warn",
    detail: `$${bal.toFixed(2)} is below the $${floor} floor${runway} — top up before it suspends: at zero the SMS pager stops and office-line calls forwarded to the 866 stop reaching Mark (Spectrum itself is unaffected).` };

  // ABOVE the floor and still nearly empty. A fixed floor cannot see this at all.
  if (daysLeft < minDays) return { ok: false, level: "warn",
    detail: `$${bal.toFixed(2)} clears the $${floor} floor but is only ~${Math.floor(daysLeft)} days of spend${runway} — a fixed floor cannot see a fast burn. Top up.` };

  return { ok: true, level: "info", detail: `$${bal.toFixed(2)}${runway}` };
}

// "$1.63/day, ~8 days, empty ~2026-10-05 (~3 days at the worst recent day, $4.56)"
function runwayPhrase(bal: number, burn: { perDay: number; worstDay: number; sampled: number }): string {
  const days = bal / burn.perDay;
  const empty = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const worst = burn.worstDay > burn.perDay
    ? `, ~${Math.floor(bal / burn.worstDay)} days at the worst of the last ${burn.sampled} days ($${burn.worstDay.toFixed(2)})`
    : "";
  return `$${burn.perDay.toFixed(2)}/day over ${burn.sampled} days, ~${Math.floor(days)} days left, empty ~${empty}${worst}`;
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
    // Days of runway we refuse to be above, however healthy the absolute number looks.
    const minDays = Number((await cfg("TWILIO_MIN_RUNWAY_DAYS")) || 10);
    const burn = isFinite(bal) && bal > 0 ? await twilioBurn(sid, tok) : null;
    const v = balanceVerdict(bal, floor, minDays, burn);
    add("twilio:balance", v.ok, v.level, v.detail);
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
