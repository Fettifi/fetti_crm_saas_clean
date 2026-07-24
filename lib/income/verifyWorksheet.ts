// INDEPENDENT INCOME VERIFICATION — the adversarial check before the number is trusted.
//   After per-document reads (DocRead[]) are resolved and the deterministic engine computes the
//   worksheet, a SEPARATE underwriter-reviewer inspects the whole result against the DocReads and
//   reports problems: a misidentified document, income on the wrong borrower, a prior employer
//   summed as current, a double-count, documented income missed, a guideline misapplied, a
//   worksheet line whose number doesn't match its own basis, or a total unreasonable vs bank
//   deposits. It NEVER silently changes the number — findings become flags the LO acts on.
import type { DocRead } from "@/lib/income/readDocument";
import type { QualifyResult } from "@/lib/income/docFacts";

export type VerifyFinding = { severity: "high" | "medium" | "low"; issue: string; borrower?: 1 | 2 };

export const VERIFY_SYSTEM = `You are an independent senior U.S. mortgage underwriter doing QC on a computed income worksheet. You are given (a) the per-document facts a first examiner read from each uploaded document, and (b) the qualifying-income worksheet a deterministic engine produced from them. Your job is to CATCH ERRORS before this income is used to approve a loan. Check against Fannie B3-3.1 / Freddie 5303 / FHA 4000.1.

Run EVERY check and report only REAL problems (do not invent issues):
1. IDENTITY: is each counted income attributed to the right PERSON? Two documents with the SAME SSN are one person; the same person under two name spellings must not become two borrowers, and two different people must not be merged.
2. CURRENT vs PRIOR: is any income counted from a FORMER employer (a document with only a prior-year W-2 and no current pay stub, or a "final check")? Prior-employer income is work history, NOT qualifying income — flag if it was summed.
3. DOUBLE-COUNT: is the same job/stream counted twice (e.g. a stream's 2-yr average PLUS its current stub, or the same IHSS recipient/case under two labels)?
4. MISSED income: is there documented, countable income in the DocReads that the worksheet omitted with no explanation?
5. GUIDELINE: is the right calculation applied per income type — base-from-current-stub for salaried (not W-2 Box 1), 2-yr average for variable/gig/self-employment, monthly benefit with gross-up (×1.25 conv / ×1.15 FHA) only for documented NON-taxable income, continuance ≥3yr for benefits?
6. MATH COHERENCE: does each worksheet line's monthly number equal the arithmetic described in its own basis?
7. REASONABLENESS: is the total plausible for the documented jobs, and roughly consistent with bank-statement deposits if present (net-of-tax ≈ 70-80% of gross)? A wildly higher total than deposits suggests over-counting.

Return via the tool: findings (each with severity high|medium|low, a concrete one-line issue, and the borrower 1 or 2 it concerns), and an overall confidence high|medium|low. Empty findings = the worksheet is sound. Be specific and cite the document/line.`;

// Run the independent reviewer over the DocReads + worksheet. Facts-level (no images) — it checks
// internal consistency + guideline application, which catches the structural errors (misattribution,
// prior-as-current, double-count, missed income, math mismatch). Never throws; returns [] on failure.
export async function verifyWorksheet(
  key: string,
  reads: DocRead[],
  result: QualifyResult,
  ctx: { loanType: "conventional" | "fha"; applicants: string },
): Promise<{ findings: VerifyFinding[]; confidence: "high" | "medium" | "low" }> {
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  // Compact the DocReads to what the reviewer needs (drop nulls) so the payload stays small.
  const compactReads = reads.map((r) => {
    const o: any = {};
    for (const [k, v] of Object.entries(r)) if (v != null && v !== "" && v !== false) o[k] = v;
    return o;
  });
  const worksheet = {
    perBorrowerMonthly: result.perBorrowerMonthly,
    qualifyingMonthlyIncome: result.qualifyingMonthlyIncome,
    breakdown: result.breakdown.map((l) => ({ borrower: l.borrower, label: l.label, monthly: l.monthly, basis: l.basis })),
    flags: result.flags.map((f) => f.text),
  };
  const userText = `Applicant(s): ${ctx.applicants}. Loan type: ${ctx.loanType}.\n\nPER-DOCUMENT FACTS (one per uploaded document):\n${JSON.stringify(compactReads, null, 1)}\n\nCOMPUTED WORKSHEET:\n${JSON.stringify(worksheet, null, 1)}\n\nQC this worksheet against the documents and report real problems.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: VERIFY_SYSTEM,
        messages: [{ role: "user", content: userText }],
        tools: [{
          name: "report_qc",
          description: "Report income-worksheet QC findings.",
          input_schema: {
            type: "object",
            properties: {
              findings: { type: "array", items: { type: "object", properties: {
                severity: { type: "string", enum: ["high", "medium", "low"] },
                issue: { type: "string" }, borrower: { type: "number" },
              }, required: ["severity", "issue"] } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["findings", "confidence"],
          },
        }],
        tool_choice: { type: "tool", name: "report_qc" },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const jr: any = await res.json().catch(() => ({}));
    if (!res.ok) return { findings: [], confidence: "low" };
    const tu = (jr?.content || []).find((b: any) => b.type === "tool_use" && b.input);
    const out = tu?.input || {};
    const findings: VerifyFinding[] = (Array.isArray(out.findings) ? out.findings : [])
      .map((f: any) => ({ severity: ["high", "medium", "low"].includes(f?.severity) ? f.severity : "low", issue: String(f?.issue || "").slice(0, 240), borrower: Number(f?.borrower) === 2 ? 2 : Number(f?.borrower) === 1 ? 1 : undefined }))
      .filter((f: VerifyFinding) => f.issue);
    return { findings, confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium" };
  } catch {
    return { findings: [], confidence: "low" };
  }
}
