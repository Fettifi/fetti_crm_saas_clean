// A CONTESTED INCOME NUMBER MUST NOT LEAVE THE BUILDING.
//
// 2026-08-04 the verify-income route started setting `qcContested` when its own QC reviewer
// raises a HIGH-severity finding — the engine disagreeing with itself about a borrower's income.
// The commit that added it said the flag was there "so the LO's screen and every downstream
// consumer can refuse to treat it as settled."
//
// 2026-08-13: nothing refused. `qcContested` had exactly ONE reader in the whole codebase — a
// red banner in components/los/IncomeQualifier.tsx whose text reads "Resolve or override before
// pricing, issuing a pre-approval, or sending to an underwriter." That is an instruction to a
// human, not a control. Meanwhile on FF-202607-9927 (Asia Dearman) the QC said, in its own
// words, that the $8,645/mo figure "does not reconcile to documents" and that unseasoned OT on a
// 06/09/2025 hire date "should not be averaged into qualifying income" — and the LO review for
// that file records settledMonthlyIncome: 8645. The disputed number was settled through as-is,
// and a pre-approval issued off that file would have carried a loan amount derived from it.
//
// This is the same shape as the $4,091 defect on the Magali/Milton file that the QC also named
// and that shipped anyway. Writing the finding down a second time would not change the outcome.
// So the flag becomes a gate: issuing a borrower-facing letter on a contested file FAILS unless
// a loan officer explicitly acknowledges the dispute, and that acknowledgement is on the record.
import { getSetting } from "@/lib/settings";

export type ContestedState = {
  contested: boolean;
  /** The QC reviewer's own words. Shown back to the LO so the refusal is actionable. */
  findings: string[];
  /** The figure the file currently carries, for the message. */
  monthlyIncome: number | null;
  /** An LO already accepted the dispute on this file, with a reason, and we let it through. */
  acknowledged: boolean;
  acknowledgedReason?: string;
};

/**
 * Read whether a loan file's verified income is contested by the engine's own QC.
 *
 * FAILS OPEN ON ABSENCE, ON PURPOSE. No verify record means nobody has claimed anything about
 * this borrower's income, so there is nothing to dispute — gating those would block every file
 * that has not been through the income screen yet. Only an explicit `qcContested: true` blocks.
 * Read errors also fail open rather than wedging letter issuance behind a settings outage; the
 * gate exists to stop a KNOWN dispute, not to be a second availability dependency.
 */
export async function incomeContestedState(loanFileId: string): Promise<ContestedState> {
  const none: ContestedState = { contested: false, findings: [], monthlyIncome: null, acknowledged: false };
  if (!loanFileId) return none;

  let payload: any = null;
  try {
    const raw = await getSetting(`los_income_verify:${loanFileId}`);
    payload = raw ? JSON.parse(raw)?.payload : null;
  } catch { return none; }
  if (!payload || payload.qcContested !== true) return none;

  let ack: any = null;
  try {
    const raw = await getSetting(`los_income_review:${loanFileId}`);
    ack = raw ? JSON.parse(raw)?.contestedAck : null;
  } catch { ack = null; }

  // An acknowledgement only counts against the findings it was given. If the documents are
  // re-read and the QC raises something NEW, the old "I've seen it" must not cover it — that is
  // how a stale sign-off silently blesses a different dispute.
  const findings: string[] = Array.isArray(payload.qcHigh) ? payload.qcHigh.map(String) : [];
  const acknowledged =
    !!ack?.reason &&
    Array.isArray(ack.findings) &&
    findings.length > 0 &&
    findings.every((f) => ack.findings.map(String).includes(f));

  return {
    contested: true,
    findings,
    monthlyIncome: Number.isFinite(Number(payload.qualifyingMonthlyIncome)) ? Number(payload.qualifyingMonthlyIncome) : null,
    acknowledged,
    acknowledgedReason: acknowledged ? String(ack.reason) : undefined,
  };
}

/** The refusal a borrower-facing issuer shows. Names the figure and the QC's actual objections. */
export function contestedRefusal(s: ContestedState): string {
  const money = s.monthlyIncome != null ? `$${Math.round(s.monthlyIncome).toLocaleString()}/mo` : "the verified figure";
  return (
    `This file's qualifying income (${money}) is CONTESTED — the income QC reviewer disagrees with the worksheet ` +
    `on the borrower's own documents, so a letter issued now would carry a loan amount derived from a disputed number.\n\n` +
    s.findings.map((f, i) => `  ${i + 1}. ${f}`).join("\n") +
    `\n\nResolve it on the income screen (re-read the documents, untick the disputed line, or type an override), ` +
    `or re-send with an explicit acknowledgement if you have reviewed it and stand behind the figure.`
  );
}
