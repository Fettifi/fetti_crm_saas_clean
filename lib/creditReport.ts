// Shared credit-report → liabilities extraction, used by BOTH the standalone Income
// Calculator upload (/api/income/credit-report) and the LOS loan-file panel
// (/api/los/files/[id]/credit-liabilities). Claude reads the tradelines; then
// DETERMINISTIC underwriting post-processing (not model guesses):
//   • revolving with a balance but no reported payment → 5% of balance (agency fallback)
//   • mortgage tradelines default-EXCLUDED (housing is counted separately in DTI)
//   • collections/charge-offs surfaced but excluded (no monthly obligation)
//   • closed accounts dropped
// PRIVACY: nothing is persisted; no SSN/DOB/addresses/account numbers are returned.
import "server-only";

export type CreditLiability = {
  id: string;
  creditor: string;
  type: "revolving" | "installment" | "mortgage" | "auto" | "student" | "lease" | "collection" | "other";
  monthly: number;          // monthly obligation used for DTI
  balance: number | null;
  status: string;           // open | collection | chargeoff | disputed | unknown
  include: boolean;         // default DTI inclusion (LO can toggle in the UI)
  note?: string;            // why it's excluded / how the payment was derived
};

export const CREDIT_SYSTEM = `You read U.S. consumer CREDIT REPORTS (tri-merge, Equifax/Experian/TransUnion, or mortgage credit reports). Extract the LIABILITIES (tradelines) into JSON.
Return ONLY valid JSON: {"borrower": string|null, "tradelines": [ ... ]}
Each tradeline: {
 "creditor": string (e.g. "CHASE CARD", "TOYOTA MOTOR CREDIT"),
 "type": one of "revolving","installment","mortgage","auto","student","lease","collection","other",
 "monthly_payment": number|null (the REPORTED monthly payment in dollars, digits only; null if not shown),
 "balance": number|null (current balance in dollars; null if not shown),
 "status": one of "open","closed","collection","chargeoff","disputed","unknown"
}
RULES: List each unique account ONCE (tri-merge reports repeat the same account per bureau — deduplicate by creditor+balance). Merged reports (e.g. Factual Data) also contain RECAP sections ("Adverse Summary", "Account Summary") that REPEAT accounts already listed in the tradeline sections — never count those again. Include open accounts, collections, and charge-offs. Mark paid/closed/transferred accounts status "closed". NEVER invent numbers — null when a figure isn't on the report. Do NOT return SSNs, dates of birth, addresses, or account numbers.`;

const uid = () => Math.random().toString(36).slice(2, 10);
const numf = (v: unknown): number | null => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n) : null; };

/** Deterministic underwriting normalization of the model's raw tradelines. */
export function normalizeTradelines(ex: any): CreditLiability[] {
  const liabilities: CreditLiability[] = [];
  for (const t of (Array.isArray(ex?.tradelines) ? ex.tradelines : []).slice(0, 60)) {
    const creditor = String(t.creditor || "").trim().slice(0, 60);
    if (!creditor) continue;
    const type = (["revolving", "installment", "mortgage", "auto", "student", "lease", "collection", "other"].includes(t.type) ? t.type : "other") as CreditLiability["type"];
    const status = (["open", "closed", "collection", "chargeoff", "disputed", "unknown"].includes(t.status) ? t.status : "unknown") as string;
    if (status === "closed") continue; // no obligation — drop entirely
    const balance = numf(t.balance);
    let monthly = numf(t.monthly_payment) ?? 0;
    let note: string | undefined;
    let include = true;
    if (!monthly && type === "revolving" && balance) {
      monthly = Math.round(balance * 0.05); // agency fallback: 5% of balance when no payment reported
      note = "no payment reported — using 5% of balance";
    }
    if (type === "mortgage") { include = false; note = "housing debt — counted in the housing payment, toggle on only for OTHER properties"; }
    if (status === "collection" || status === "chargeoff" || type === "collection") { include = false; monthly = monthly || 0; note = "derogatory — usually no monthly obligation; verify payoff requirements"; }
    // DEFERRED/no-payment student loans: agencies still count them — FHA 0.5% of balance,
    // conventional 1% (or a documented payment), VA may exclude if deferred >12mo past
    // closing. Pre-compute the FHA 0.5% so toggling the row on applies a defensible
    // number instantly; left OFF by default because the right % is program-specific.
    if (!monthly && type === "student" && balance) {
      monthly = Math.round(balance * 0.005);
      include = false;
      note = `deferred student loan — $0 reported; FHA counts 0.5% of balance (shown: $${monthly}/mo), conventional 1% or documented payment, VA may exclude if deferred >12mo past closing`;
    }
    if (!monthly && include) { include = false; note = note || (balance ? "no payment reported — verify the obligation" : "no payment or balance reported"); }
    liabilities.push({ id: uid(), creditor, type, monthly, balance, status, include, note });
  }
  return liabilities;
}

/** Run the extraction over prepared Anthropic content blocks (documents/images). */
export async function extractLiabilitiesFromBlocks(blocks: any[], key: string): Promise<{ borrower: string | null; liabilities: CreditLiability[] }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
      max_tokens: 4000,
      system: CREDIT_SYSTEM,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: "Extract the liabilities/tradelines. JSON only." }] }],
    }),
    signal: AbortSignal.timeout(110000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  const ex = JSON.parse(m ? m[0] : txt);
  return {
    borrower: typeof ex?.borrower === "string" ? ex.borrower.slice(0, 60) : null,
    liabilities: normalizeTradelines(ex),
  };
}
