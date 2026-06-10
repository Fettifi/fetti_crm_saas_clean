import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, computeLoanMetrics, type Urla } from "@/lib/urla";

// AI Underwriter — the enterprise differentiator legacy LOSs don't have. Claude
// reads the full 1003 + computed metrics and returns a structured underwriting
// read: summary, strengths, risks, suggested conditions, income analysis, and an
// eligibility call for the product. Auth-gated via the /api/los matcher.
//   POST /api/los/underwrite?file=<id> | ?lead=<id>
export const runtime = "nodejs";
export const maxDuration = 60;

function stripSsn(u: Urla): Urla {
  const c: Urla = JSON.parse(JSON.stringify(u));
  for (const b of c.borrowers) if (b.ssn) b.ssn = undefined;
  return c;
}

const SYSTEM = `You are a senior U.S. residential mortgage underwriter with 20 years of experience across agency (Fannie/Freddie), FHA/VA, jumbo, and non-QM/DSCR. You review a 1003 (URLA) and computed metrics and give a sharp, honest underwriting read.
Rules:
- Be specific and use the numbers. Reference real guidelines conceptually (DTI/LTV thresholds, reserves, DSCR ≥1.0, seasoning) but NEVER promise approval or quote a specific rate.
- For DSCR/investment loans, qualify on the property cash flow (DSCR), not personal DTI.
- Conditions should be concrete and actionable (the docs/explanations you'd actually ask for).
- Output ONLY valid JSON, no prose around it, matching exactly:
{"summary": string, "eligibilityRead": "Looks strong" | "Likely with conditions" | "Needs work" | "Insufficient data", "strengths": string[], "risks": string[], "conditions": string[], "incomeAnalysis": string, "keyRatios": string}`;

async function callClaude(payload: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: payload }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  }
  const okey = process.env.OPENAI_API_KEY;
  if (okey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${okey}` },
      body: JSON.stringify({ model: process.env.OPENAI_AGENT_MODEL || "gpt-4o", max_tokens: 2000, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: payload }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `OpenAI ${res.status}`);
    return j.choices?.[0]?.message?.content || "";
  }
  throw new Error("No AI key configured.");
}

export async function POST(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const fileId = sp.get("file"), leadId = sp.get("lead");
    let loanFile: any = null, lead: any = null;
    if (fileId) {
      const { data } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
      loanFile = data;
      if (loanFile?.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle(); lead = r.data; }
    } else if (leadId) {
      const r = await supabaseAdmin.from("leads").select("*").eq("id", leadId).maybeSingle(); lead = r.data;
    }
    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    const urla = assembleUrla(lead, loanFile);
    const metrics = computeLoanMetrics(urla);
    const payload = `PRODUCT: ${urla.loan.productDescription || urla.loan.purpose || "?"} (${urla.loan.loanType || "?"})\nMETRICS: ${JSON.stringify(metrics)}\n1003 (SSN omitted): ${JSON.stringify(stripSsn(urla))}`;

    let text = await callClaude(payload);
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    let analysis: any;
    try { analysis = JSON.parse(m ? m[0] : text); } catch { analysis = { summary: text, eligibilityRead: "Insufficient data", strengths: [], risks: [], conditions: [], incomeAnalysis: "", keyRatios: "" }; }

    return NextResponse.json({ analysis, metrics });
  } catch (e: any) {
    console.error("[los/underwrite] error:", e);
    return NextResponse.json({ error: e?.message || "Underwrite failed." }, { status: 500 });
  }
}
