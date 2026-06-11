// AI Deal Screen (Relip-style): is this a real, fundable deal or a tire-kicker,
// and which of the broker's wholesalers fits best? Shared by the loan-file API
// and the new-lead pipeline (auto-screens every investor lead).
import { assembleUrla, computeLoanMetrics, type Urla } from "@/lib/urla";
import { getLenders } from "@/lib/pricing/lenders";

function stripSsn(u: Urla): Urla {
  const c: Urla = JSON.parse(JSON.stringify(u));
  for (const b of c.borrowers) if (b.ssn) b.ssn = undefined;
  return c;
}

const SYSTEM = `You are a senior account executive at a mortgage brokerage that specializes in investor lending (DSCR, bridge, fix & flip, bank-statement / non-QM) and also does agency loans. You triage incoming deals fast and route them to the right wholesale lender.
Given a deal (1003 data + computed metrics) and the broker's ACTUAL approved wholesaler list, return ONLY valid JSON:
{
 "verdict": "Hot deal" | "Workable" | "Needs more info" | "Likely tire-kicker",
 "dealScore": number 0-100,
 "summary": string (2-3 sentences, sharp, the real read),
 "dealRead": string (DSCR feasibility / LTV / credit / what makes it fundable or not),
 "bestLenders": [ {"lenderId": string, "lenderName": string, "fit": "Strong"|"Possible"|"Pass", "reason": string} ],
 "questions": string[],
 "nextAction": string
}
Rules: only recommend from the provided lender list (use their exact lenderId/lenderName). Match on loan type + the lender's notes/specialty. Be honest about tire-kickers. Never promise approval or a rate.`;

async function callAI(payload: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 1600, system: SYSTEM, messages: [{ role: "user", content: payload }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  }
  const okey = process.env.OPENAI_API_KEY;
  if (okey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${okey}` },
      body: JSON.stringify({ model: process.env.OPENAI_AGENT_MODEL || "gpt-4o", max_tokens: 1600, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: payload }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `OpenAI ${res.status}`);
    return j.choices?.[0]?.message?.content || "";
  }
  throw new Error("No AI key configured.");
}

export async function runDealScreen(loanFile: any, lead: any): Promise<any> {
  const urla = assembleUrla(lead, loanFile);
  const metrics = computeLoanMetrics(urla);
  const lenders = (await getLenders()).filter((l) => l.active !== false)
    .map((l) => ({ lenderId: l.id, lenderName: l.name, loanTypes: l.loanTypes || [], specialty: l.notes || "" }));
  const payload = `YOUR APPROVED WHOLESALERS:\n${JSON.stringify(lenders)}\n\nDEAL METRICS: ${JSON.stringify(metrics)}\nPRODUCT: ${urla.loan.productDescription || urla.loan.purpose || "?"} (${urla.loan.loanType || "?"})\n1003 (SSN omitted): ${JSON.stringify(stripSsn(urla))}`;
  let text = await callAI(payload);
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  try { return { ...JSON.parse(m ? m[0] : text), screenedAt: new Date().toISOString() }; }
  catch { return { verdict: "Needs more info", dealScore: 0, summary: text, bestLenders: [], questions: [], screenedAt: new Date().toISOString() }; }
}

// Is this an investor / business-purpose deal worth auto-screening?
export function isInvestorDeal(lead: any): boolean {
  const p = `${lead?.loan_purpose || ""} ${lead?.occupancy || ""} ${lead?.property_type || ""}`.toLowerCase();
  return /dscr|invest|rental|bridge|flip|hard money|commercial|business|non-?qm/.test(p);
}
