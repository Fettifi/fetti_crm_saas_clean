// The stalled-file worklist, as a SURFACE rather than an email.
//
// Why this exists: lib/stalledFiles.ts already computes exactly the right thing —
// which open files have gone quiet, and (the part that matters) which borrowers
// handed over documents or replied and then got silence back from us. But until now
// it had exactly ONE consumer: the daily digest cron. That means the intelligence
// only existed for the few seconds an email was being rendered, and only on the days
// the digest had something NEW to raise.
//
// Two things follow from that, and both were visible in the data on 2026-08-04:
//   - REALERT_DAYS suppresses a file for a week once raised, so on most mornings the
//     digest correctly sends nothing. "Nothing new" then reads as "nothing wrong",
//     while 20 of 24 open files sat stale and the oldest aged from 44 days (7/29) to
//     50 days — the backlog grew the entire time the watchdog was working perfectly.
//   - An email cannot be checked at 2pm. The worklist has to live where the work
//     happens, which is the pipeline board.
//
// So this is not a second implementation of staleness — it is the SAME
// findStalledFiles() the digest uses, exposed so the board can render it. One source
// of truth, two renderings; the alternative (recomputing "quiet" in the client from
// updated_at) would drift from the email within a week and quietly lose the entire
// borrower-silence dimension, which is the only part that ranks by who is closest to
// funding.
//
// Read-only, internal, and auth-gated by proxy.ts (`/api/los` prefix). It contacts
// nobody: no SMS, no email, no borrower touch, no consent surface. It also must never
// write to loan_files — see the HARD RULE at the top of lib/stalledFiles.ts; a write
// would bump updated_at and destroy the very signal being measured.
import { NextResponse } from "next/server";
import { findStalledFiles, nextAction } from "@/lib/stalledFiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const stale = await findStalledFiles();
    // nextAction() is computed server-side so the board and the digest can never
    // disagree about what the next move on a file is.
    const files = stale.map((f) => ({
      id: f.id,
      fileNumber: f.file_number,
      leadId: f.lead_id,
      borrower: f.borrower_name,
      email: f.email,
      phone: f.phone,
      stage: f.stage,
      product: f.product,
      state: f.state,
      loanAmount: f.loan_amount,
      days: f.days,
      bucket: f.bucket,
      flag: f.flag,
      severity: f.severity,
      lastTouch: f.lastTouch,
      outreachDays: f.outreachDays,
      replyDays: f.replyDays,
      deliveredDays: f.deliveredDays,
      docsDelivered: f.docsDelivered,
      action: nextAction(f),
    }));

    return NextResponse.json({
      ok: true,
      files,
      counts: {
        total: files.length,
        // "We are the blocker" is the headline number: these borrowers already said
        // yes with their actions. Nothing in the pipeline is closer to a funding.
        blocked: files.filter((f) => f.flag === "awaiting_us" || f.flag === "no_outreach").length,
        awaitingUs: files.filter((f) => f.flag === "awaiting_us").length,
        neverContacted: files.filter((f) => f.flag === "no_outreach").length,
        frozen: files.filter((f) => f.bucket === "frozen").length,
        cold: files.filter((f) => f.bucket === "cold").length,
        warm: files.filter((f) => f.bucket === "warm").length,
        oldestDays: files.reduce((m, f) => Math.max(m, f.days), 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
