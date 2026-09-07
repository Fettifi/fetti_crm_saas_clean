// IS THIS LOAN FILE STILL LIVE? ONE ANSWER, FOR EVERY SCREEN AND EVERY SENDER.
//
// A loan file carries TWO independent state columns and they are not interchangeable:
//
//   status — the Reg B / HMDA DISPOSITION: active | withdrawn | denied | closed.
//            Set only through the disposition flow, which demands a reason. It answers
//            "how did this application end?", and for a file still being worked the
//            honest answer is "it hasn't" — so it sits at `active` for the file's whole
//            life, right through funding.
//
//   stage  — WHERE IT IS IN THE PIPELINE: Application → Processing → Underwriting →
//            Approved → Clear to Close → Funded → Closed. This is what actually moves.
//
// Neither column alone tells you whether there is still work to do. `status` alone says
// 32 of 34 files are live; `stage` alone says two withdrawn files are still sitting in
// Application waiting to be worked. Liveness is the AND of both.
//
// 2026-09-06, what this cost. Charletha Osborne (FF-202608-1913) reached `stage="Closed"`
// while `status` stayed `active` — correctly, nobody withdrew or denied her. Every screen
// keyed on `status` therefore counted her as live: she showed in the LOS active count, in
// /api/stats, in the Enterprise Brain's nightly learning run, and in the scan-to-file
// picker. Worse, the bulk document reminder asks `mayChaseDocs(status)`, and her file still
// had one outstanding required document and both an email and a phone on it — so "Remind
// All" would have emailed AND texted a borrower whose file was closed, asking for proof of
// non-ownership on an address. That is the same chaser that put 16 unconsented texts on
// handsets on 2026-08-01.
//
// The predicates below are the only ones allowed to answer this. They take BOTH columns as
// required arguments, so a caller cannot ask half the question: the type checker rejects
// `mayChaseDocs(f.status)` and forces the query to select `stage` too.
//
// PURE, ZERO IMPORTS, ON PURPOSE. `lib/los.ts` imports supabaseAdmin, so a client component
// importing from it drags the service-role client into the browser bundle — which is why
// app/los/page.tsx was re-declaring the stage list by hand instead. This module is safe to
// import from anywhere. `lib/los.ts` and `lib/stalledFiles.ts` both re-export from here so
// there is exactly one list.

/** Pipeline stages meaning the work is over. The file is history, not a queue item. */
export const TERMINAL_STAGES = ["Funded", "Closed"] as const;

/**
 * Every word, in either column, that means "no longer being worked". Matched as a
 * substring and case-insensitively, because these values are typed by hand in places
 * ("Closed - Withdrawn", "cancelled") and a liveness check must never fail open.
 */
export const TERMINAL_FILE_VALUES = [
  "funded", "closed", "dead", "declined", "denied", "withdrawn", "cancelled", "canceled",
] as const;

/** Does this single status-or-stage value mean the file is finished? */
export const isTerminalFileValue = (v: unknown): boolean =>
  TERMINAL_FILE_VALUES.some((t) => String(v || "").toLowerCase().includes(t));

/**
 * The one liveness predicate. A file is open when NEITHER column says it is finished.
 * Both arguments are required: liveness cannot be decided from one column.
 */
export const isOpenFile = (status: string | null | undefined, stage: string | null | undefined): boolean =>
  !isTerminalFileValue(status) && !isTerminalFileValue(stage);

/**
 * May we chase this borrower for documents on this file? Only while it is open.
 * Kept as its own name because it is the sender-facing question, and every sender must be
 * greppable back to this line.
 */
export const mayChaseDocs = (status: string | null | undefined, stage: string | null | undefined): boolean =>
  isOpenFile(status, stage);

/**
 * The Reg B disposition ONLY — "was this application withdrawn or denied?".
 * NOT liveness: a funded file is still `active`. If you are deciding whether there is work
 * to do, or whether to contact someone, you want isOpenFile / mayChaseDocs instead.
 */
export const isActiveDisposition = (status?: string | null): boolean =>
  String(status || "active").toLowerCase() === "active";
