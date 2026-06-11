import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, computeLoanMetrics, type Urla } from "@/lib/urla";
import { getLenders } from "@/lib/pricing/lenders";

// AI Deal Screen (Relip-style) — on any loan file: is this a real, fundable deal
// or a tire-kicker, and WHICH of your wholesalers fits best? Auth-gated via the
// /api/los matcher.  POST /api/los/screen?file=<id>
export const runtime = "nodejs";
export const maxDuration = 60;

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
 "bestLenders": [ {"lenderId": string, "lenderName": string, "fit": "Strong"|"Possible"|"Pass", "reason": string} ],  // rank the provided lenders for THIS deal
 "questions": string[],  // the 1-3 questions to ask the borrower to firm it up
 "nextAction": string  // the single next move
}
Rules: only recommend from the provided lender list (use their exact lenderId/lenderName). Match on loan type + the lender's notes/specialty. Be honest about tire-kickers (no value/no rent/no deal). Never promise approval or a rate.`;

async function callClaude(payload: string): Promise<string> {
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

export async function POST(req: NextRequest) {
  try {
    const fileId = req.nextUrl.searchParams.get("file");
    if (!fileId) return NextResponse.json({ error: "file id required" }, { status: 400 });
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
    if (!loanFile?.lead_id) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    const urla = assembleUrla(lead, loanFile);
    const metrics = computeLoanMetrics(urla);
    const lenders = (await getLenders()).filter((l) => l.active !== false)
      .map((l) => ({ lenderId: l.id, lenderName: l.name, loanTypes: l.loanTypes || [], specialty: l.notes || "" }));

    const payload = `YOUR APPROVED WHOLESALERS:\n${JSON.stringify(lenders)}\n\nDEAL METRICS: ${JSON.stringify(metrics)}\nPRODUCT: ${urla.loan.productDescription || urla.loan.purpose || "?"} (${urla.loan.loanType || "?"})\n1003 (SSN omitted): ${JSON.stringify(stripSsn(urla))}`;

    let text = await callClaude(payload);
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    let screen: any;
    try { screen = JSON.parse(m ? m[0] : text); } catch { screen = { verdict: "Needs more info", dealScore: 0, summary: text, bestLenders: [], questions: [], nextAction: "" }; }

    return NextResponse.json({ screen, metrics, lenderCount: lenders.length });
  } catch (e: any) {
    console.error("[los/screen] error:", e);
    return NextResponse.json({ error: e?.message || "Screen failed." }, { status: 500 });
  }
}
