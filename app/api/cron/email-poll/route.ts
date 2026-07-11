// PERMANENT inbound-email pipe (cron). Every few minutes, poll the nurture
// reply-to mailbox (frank@fettifi.com) via Microsoft Graph and feed any NEW
// borrower replies into the shared ingestion — so an email reply becomes a real
// two-way thread (hot alert + quarantine release + Mark auto-reply) instead of
// dying unread in a person's inbox.
//
// Why polling over Power Automate: no premium HTTP-connector license, no mail
// reroute (which would break M365), all logic in code we control + test. Watches
// frank@ where replies already land — no change to the nurture reply-to needed.
//
// Safe before setup: if Graph creds aren't configured yet, it no-ops. First run
// starts the watermark ~15m back (not the whole backlog) so we never blast Mark
// replies at old threads. Only senders that MATCH a lead trigger anything; all of
// Frank's normal vendor mail is ignored (alertUnmatched:false in the ingestor).
import { NextRequest, NextResponse } from "next/server";
import { graphConfigured, listInboxSince, graphCreds } from "@/lib/msGraph";
import { ingestInboundEmail } from "@/lib/inbound/ingestEmail";
import { getSetting, setSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATE_KEY = "EMAIL_POLL_STATE"; // { lastReceived: ISO, mailbox: string }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (!(await graphConfigured())) {
      return NextResponse.json({ ok: true, skipped: "graph_not_configured" });
    }
    const { mailbox } = await graphCreds();

    // Watermark. First run (or a mailbox change) starts 15m back — recent enough to
    // catch a just-arrived reply, short enough to skip the historical backlog.
    let state: { lastReceived?: string; mailbox?: string } = {};
    try { state = JSON.parse((await getSetting(STATE_KEY)) || "{}"); } catch { state = {}; }
    const freshStart = !state.lastReceived || state.mailbox !== mailbox;
    const since = freshStart
      ? new Date(Date.now() - 15 * 60_000).toISOString()
      : state.lastReceived!;

    const msgs = await listInboxSince(since, 50);

    let processed = 0, matched = 0, skippedOwn = 0;
    let maxReceived = since;
    for (const m of msgs) {
      // Monotonic watermark advance regardless of match outcome. Compare by parsed
      // time (Graph omits millis, our fresh-start ISO includes them — a raw string
      // compare would misorder the boundary).
      if (m.receivedDateTime && Date.parse(m.receivedDateTime) > Date.parse(maxReceived)) maxReceived = m.receivedDateTime;
      if (!m.from || !m.text) continue;
      // Never ingest our OWN mail (a self-copy / CC of Fetti outbound) — that's how a
      // reply loop or a bogus "reply from Fetti" could start. Borrowers are never @fettifi.
      if (m.from.endsWith("@fettifi.com")) { skippedOwn++; continue; }
      const r = await ingestInboundEmail(
        { from: m.from, subject: m.subject, text: m.text },
        { alertUnmatched: false, source: "graph_poll" }
      );
      processed++;
      if (r.matched) matched++;
    }

    // Persist the watermark (advance to newest seen, even on a fresh start with 0 msgs
    // so we don't keep re-scanning the same 15m window).
    await setSetting(STATE_KEY, JSON.stringify({ lastReceived: maxReceived, mailbox }));

    try { const { recordHeartbeat } = await import("@/lib/heartbeat"); await recordHeartbeat("email-poll"); } catch { /* */ }

    return NextResponse.json({ ok: true, mailbox, since, fetched: msgs.length, processed, matched, skippedOwn, watermark: maxReceived });
  } catch (e: any) {
    console.error("[cron/email-poll]", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
