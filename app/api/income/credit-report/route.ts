// Upload a CREDIT REPORT (PDF or images) → Claude extracts every tradeline's monthly
// obligation → returns normalized liabilities for the Income Calculator's DTI section.
// PRIVACY: the report is processed in-memory only — nothing is stored, and no SSN/DOB/
// addresses are returned. Auth-gated via the /api/income matcher in proxy.ts.
// Post-processing applies deterministic underwriting rules (not model guesses):
//   • revolving with a balance but no reported payment → 5% of balance (agency fallback)
//   • mortgage tradelines default-EXCLUDED (housing is counted separately in DTI)
//   • collections/charge-offs surfaced but excluded (no monthly obligation)
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

export type CreditLiability = {
  id: string;
  creditor: string;
  type: "revolving" | "installment" | "mortgage" | "auto" | "student" | "lease" | "collection" | "other";
  monthly: number;          // monthly obligation used for DTI
  balance: number | null;
  status: string;           // open | closed | collection | chargeoff | disputed | unknown
  include: boolean;         // default DTI inclusion (LO can toggle in the UI)
  note?: string;            // why it's excluded / how the payment was derived
};

const SYSTEM = `You read U.S. consumer CREDIT REPORTS (tri-merge, Equifax/Experian/TransUnion, or mortgage credit reports). Extract the LIABILITIES (tradelines) into JSON.
Return ONLY valid JSON: {"borrower": string|null, "tradelines": [ ... ]}
Each tradeline: {
 "creditor": string (e.g. "CHASE CARD", "TOYOTA MOTOR CREDIT"),
 "type": one of "revolving","installment","mortgage","auto","student","lease","collection","other",
 "monthly_payment": number|null (the REPORTED monthly payment in dollars, digits only; null if not shown),
 "balance": number|null (current balance in dollars; null if not shown),
 "status": one of "open","closed","collection","chargeoff","disputed","unknown"
}
RULES: List each unique account ONCE (tri-merge reports repeat the same account per bureau — deduplicate by creditor+balance). Include open accounts, collections, and charge-offs. Mark paid/closed/transferred accounts status "closed". NEVER invent numbers — null when a figure isn't on the report. Do NOT return SSNs, dates of birth, addresses, or account numbers.`;

const uid = () => Math.random().toString(36).slice(2, 10);

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Credit-report reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    const files = ([...form.getAll("files"), ...form.getAll("file")].filter((f) => f instanceof Blob) as Blob[]).slice(0, 4);
    if (!files.length) return NextResponse.json({ error: "Upload a credit report (PDF or images)." }, { status: 400 });
    if (files.some((f) => f.size > 25 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 25 MB." }, { status: 413 });

    const blocks: any[] = [];
    for (const f of files) {
      const mediaType = (f as any).type || "application/octet-stream";
      if (!MEDIA.has(mediaType)) continue;
      const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
      blocks.push(mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
    }
    if (!blocks.length) return NextResponse.json({ error: "Unsupported file type — use PDF or images." }, { status: 415 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: [...blocks, { type: "text", text: "Extract the liabilities/tradelines. JSON only." }] }],
      }),
      signal: AbortSignal.timeout(110000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let ex: any = {};
    try { ex = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read that report — try a clearer PDF." }, { status: 422 }); }

    const numf = (v: any): number | null => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n) : null; };
    const liabilities: CreditLiability[] = [];
    for (const t of (Array.isArray(ex.tradelines) ? ex.tradelines : []).slice(0, 60)) {
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
      if (!monthly && include) { include = false; note = note || "no payment or balance reported"; }
      liabilities.push({ id: uid(), creditor, type, monthly, balance, status, include, note });
    }
    if (!liabilities.length) return NextResponse.json({ error: "No tradelines found in that document." }, { status: 422 });

    return NextResponse.json({
      ok: true,
      borrower: typeof ex.borrower === "string" ? ex.borrower.slice(0, 60) : null,
      liabilities,
      includedMonthly: liabilities.filter((l) => l.include).reduce((s, l) => s + l.monthly, 0),
    });
  } catch (e: any) {
    console.error("[income/credit-report] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
