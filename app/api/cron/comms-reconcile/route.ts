// DOES OUR RECORD MATCH THE CARRIER'S?
//
// Ramon, 2026-08-02. Reconciling 834 Twilio messages against 8,567 activity_log rows by SID
// found 56 with no `comms.message` row. 38 were failed/undelivered and are correctly unlogged.
// **18 were DELIVERED** — real texts that reached real handsets and exist nowhere in the CRM.
// They sat undetected for two months, because nothing anywhere compared the provider's ledger
// to ours. Every send path logs on success, so a gap means a send happened outside the paths
// we know about, or a log write failed silently.
//
// That is a record-keeping problem before it is anything else: in a TCPA dispute the message
// log IS the evidence, and "we have no record of that" is the worst possible answer. This cron
// is the control that was missing. It does not fix a gap — it makes one impossible to miss.
//
// Read-only. Pages Ramon on a mismatch; silent when the ledgers agree.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { recordHeartbeat, recordAttempt } from "@/lib/heartbeat";
import { sendSms } from "@/lib/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Twilio messages sent in the window, by SID, with their final status. */
/** sid -> recipient, filled by twilioSent so the owner's own pages can be excluded. */
const toOf = new Map<string, string>();

async function twilioSent(sinceIso: string): Promise<Map<string, string>> {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  const out = new Map<string, string>();
  if (!sid || !token) return out;
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  let url: string | null =
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?PageSize=200&DateSent%3E=${sinceIso.slice(0, 10)}`;
  for (let page = 0; page < 10 && url; page++) {
    const r: any = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20000) })
      .then((x) => x.json()).catch(() => null);
    if (!r) break;
    for (const m of r.messages || []) {
      if (String(m.direction || "").startsWith("inbound")) continue;
      out.set(String(m.sid), String(m.status || ""));
      toOf.set(String(m.sid), String(m.to || ""));
    }
    url = r.next_page_uri ? `https://api.twilio.com${r.next_page_uri}` : null;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordAttempt("comms-reconcile");

  // A 7-day window: long enough to catch a gap the day it appears, short enough to stay cheap.
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  try {
    const provider = await twilioSent(since);

    const { data: rows } = await supabaseAdmin
      .from("activity_log").select("detail")
      .eq("action", "comms.message").gte("created_at", since).limit(5000);
    const ours = new Set(
      (rows || [])
        .map((r: any) => String(r?.detail?.providerId || ""))
        .filter((x: string) => x.startsWith("SM") || x.startsWith("MM")),
    );

    // ONLY DELIVERED/SENT MESSAGES COUNT AS A GAP. A failed or undelivered message is correctly
    // absent from the borrower's timeline — logging it would put a message on their record that
    // never arrived, which is its own kind of wrong.
    const landed = [...provider.entries()].filter(([, st]) => st === "delivered" || st === "sent");
    // OUR OWN PAGES ARE NOT BORROWER MESSAGES. Alerts to the owner's number (this cron's own
    // output, the hot-lead pager, the handoff page, bounce notices) are deliberately not written
    // to a lead's conversation timeline — there is no lead. Counting them as missing records
    // manufactures a permanent, growing false alarm.
    const ownerDigits = String(process.env.LEAD_NOTIFY_SMS_TO || "").replace(/\D/g, "").slice(-10);
    const missing = landed.filter(([sid]) => !ours.has(sid) && (!ownerDigits || String(toOf.get(sid) || "").replace(/\D/g, "").slice(-10) !== ownerDigits));

    const detail = {
      window_days: 7,
      provider_outbound: provider.size,
      provider_landed: landed.length,
      crm_logged: ours.size,
      missing_from_crm: missing.length,
      sample: missing.slice(0, 10).map(([sid, st]) => ({ sid, status: st })),
    };

    if (missing.length) {
      await logActivity({ entity_type: "system", entity_id: "comms-reconcile", actor: "system", action: "comms.ledger_gap", detail });
      // An INTERNAL alert to the owner's own number is the documented use for
      // allowQuietHours — it is not a solicitation. It still goes through the one send
      // primitive, because "this one is different" is how the last four bypasses started.
      //
      // AND IT MUST NOT PAGE ON ITS OWN FOOTPRINT. Every alert this cron sends is an outbound
      // Twilio message with no `comms.message` row — so it becomes a "gap" on the next run, and
      // the count grows by one a day forever. A monitor whose own output is its alarm condition
      // reports a system that is fine as broken, and after a week nobody reads it.
      const to = process.env.LEAD_NOTIFY_SMS_TO;
      if (to && missing.length) {
        await sendSms(to, `⚠️ ${missing.length} text(s) landed in the last 7d with NO record in the CRM. Check /api/cron/comms-reconcile.`, { allowQuietHours: true }).catch(() => {});
      }
    }

    await recordHeartbeat("comms-reconcile");
    return NextResponse.json({ ok: missing.length === 0, ...detail });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
