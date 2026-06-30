// Upload one or more lender price-quote PDFs (e.g. AD Mortgage Quick Pricer) →
// Claude (vision) extracts each into a normalized CompareQuote → returns the quotes
// for the LO to review/edit and build a side-by-side comparison. No DB write here.
// Auth-gated via the /api/compare matcher in proxy.ts. Mirrors /api/preapprovals/extract.
import { NextRequest, NextResponse } from "next/server";
import { genId, type CompareQuote } from "@/lib/compare";

export const runtime = "nodejs";
export const maxDuration = 120;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

const SYSTEM = `You read U.S. mortgage PRICE QUOTES, rate quotes, and loan term sheets from wholesale lenders (e.g. AD Mortgage, UWM Quick Pricer). Extract ONE loan offer from the document into JSON.
Return ONLY valid JSON in this shape — INCLUDE ONLY fields you can actually read from the document; omit everything else. NEVER guess or invent numbers/rates.
{
 "lender": string (lender/wholesaler name, e.g. "AD Mortgage"),
 "program": string (product/program name, e.g. "30-Yr Fixed DSCR", "FHA 30 Year Fixed"),
 "loanType": string (one of Conventional, FHA, VA, USDA, Jumbo, DSCR, Bank-Statement, Fix & Flip, Bridge, HELOC, Reverse, Other),
 "loanAmount": number (base/total loan amount, digits only),
 "rate": string (note/interest rate, e.g. "6.875%"),
 "apr": string (APR, e.g. "7.012%"),
 "term": string (e.g. "30-year fixed", "15-year fixed", "5/1 ARM", "12-month interest-only"),
 "monthlyPI": string (monthly principal & interest, e.g. "$2,431"),
 "pitia": string (total monthly payment / PITIA incl. taxes+insurance, if shown, e.g. "$3,142"),
 "points": string (discount/origination points or their cost, e.g. "1.000" or "$2,000" — use a credit as negative, e.g. "-0.500"),
 "lenderFees": string (total lender/origination fees in dollars, e.g. "$1,995"),
 "ltv": string (loan-to-value percent, e.g. "75%"),
 "cashToClose": string (estimated cash to close in dollars, if shown),
 "lockDays": string (rate lock period, e.g. "45 days"),
 "prepay": string (prepayment penalty structure, e.g. "5/4/3/2/1" or "None"),
 "occupancy": string (one of Primary residence, Second home, Investment),
 "purpose": string (one of Purchase, Rate/Term Refinance, Cash-Out Refinance),
 "dscr": string (DSCR ratio for investment loans, e.g. "1.25")
}`;

async function extractOne(file: Blob, key: string): Promise<CompareQuote | null> {
  try {
    const mediaType = (file as any).type || "application/octet-stream";
    if (!MEDIA.has(mediaType)) return null;
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const block = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract this loan price quote. JSON only." }] }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let ex: any = {};
    try { ex = JSON.parse(m ? m[0] : txt); } catch { return null; }

    const numf = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n) : undefined; };
    const str = (v: any) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, 80) : undefined; };
    const q: CompareQuote = { id: genId(), sourceFile: (file as any).name || undefined };
    q.lender = str(ex.lender);
    q.program = str(ex.program);
    q.loanType = str(ex.loanType);
    q.loanAmount = numf(ex.loanAmount);
    for (const k of ["rate", "apr", "term", "monthlyPI", "pitia", "points", "lenderFees", "ltv", "cashToClose", "lockDays", "prepay", "occupancy", "purpose", "dscr"] as const) {
      const v = str((ex as any)[k]); if (v) (q as any)[k] = v;
    }
    // Drop a quote that yielded nothing usable.
    const hasData = q.lender || q.program || q.rate || q.loanAmount || q.monthlyPI;
    return hasData ? q : null;
  } catch (e) {
    console.warn("[compare/extract] one file failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Quote reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    const files = ([...form.getAll("files"), ...form.getAll("file")].filter((f) => f instanceof Blob) as Blob[]).slice(0, 6);
    if (!files.length) return NextResponse.json({ error: "Upload at least one quote PDF." }, { status: 400 });
    // Guard memory: each file is base64'd in-memory (~1.33×). Reject oversized uploads.
    if (files.some((f) => f.size > 20 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 20 MB." }, { status: 413 });

    const results = await Promise.all(files.map((f) => extractOne(f, key)));
    const quotes = results.filter((q): q is CompareQuote => !!q);
    if (!quotes.length) return NextResponse.json({ error: "Couldn't read any of those files — try clearer PDFs or images." }, { status: 422 });

    return NextResponse.json({ ok: true, quotes, read: quotes.length, uploaded: files.length });
  } catch (e: any) {
    console.error("[compare/extract] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
