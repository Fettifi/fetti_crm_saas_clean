import { NextRequest, NextResponse } from "next/server";

// Upload a lender TERM SHEET (PDF/image) → Claude (vision) extracts the loan terms
// → returns sanitized fields to pre-fill a Fetti pre-approval. No DB write here:
// the LO reviews the extracted terms, then issues the letter via POST /api/preapprovals.
// Auth-gated via the /api/preapprovals matcher in proxy.ts. Mirrors /api/los/extract.
export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const LOAN_TYPES = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "First-Time Homebuyer", "DSCR", "Bank-Statement (Self-Employed)", "Fix & Flip", "Bridge", "HELOC", "Reverse (HECM)"];
const TERMS = ["30-year fixed", "15-year fixed", "20-year fixed", "5/1 ARM", "7/1 ARM", "12-month interest-only", "Other"];
const OCC = ["Primary residence", "Second home", "Investment"];

const SYSTEM = `You read U.S. mortgage/lender TERM SHEETS, rate locks, loan estimates, and wholesale approval term sheets, and extract the loan terms to pre-fill a pre-approval letter.
Return ONLY valid JSON in this shape — INCLUDE ONLY fields you can actually read from the document; omit everything else. NEVER guess or invent numbers/rates.
{
 "borrower_name": string,
 "co_borrower": string,
 "loan_type": one of ${JSON.stringify(LOAN_TYPES)} (map the product to the closest: "Conv"→"Conventional"; a no-income/rental/investment qualifier→"DSCR"; bank-statement self-employed→"Bank-Statement (Self-Employed)"; an interest-only short-term/rehab loan→"Fix & Flip" or "Bridge"),
 "loan_amount": number (base/total loan amount in dollars, digits only),
 "purchase_price": number (purchase price or appraised/property value, digits only),
 "down_payment": number (digits only),
 "interest_rate": string (e.g. "6.5%" or "6.500%"),
 "term": one of ${JSON.stringify(TERMS)} (map "360 mo"/"30 yr fixed"→"30-year fixed"; interest-only bridge/flip→"12-month interest-only"),
 "property_address": string,
 "occupancy": one of ${JSON.stringify(OCC)},
 "conditions": string (any conditions/stipulations/exceptions listed, concatenated into one line),
 "expires_on": "YYYY-MM-DD" (rate-lock expiration or term-sheet expiry, if shown)
}`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Term-sheet reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No term sheet provided." }, { status: 400 });
    const mediaType = (file as any).type || "application/octet-stream";
    if (!MEDIA.has(mediaType)) return NextResponse.json({ error: `Unsupported type ${mediaType}. Upload a PDF or image.` }, { status: 415 });
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
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract the loan terms from this term sheet. JSON only." }] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let ex: any = {};
    try { ex = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read that term sheet — try a clearer PDF or image." }, { status: 422 }); }

    // Sanitize → only well-formed, known values reach the form.
    const numf = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : undefined; };
    const str = (v: any) => (v == null ? undefined : String(v).trim() || undefined);
    const clean: Record<string, unknown> = {};
    if (str(ex.borrower_name)) clean.borrower_name = str(ex.borrower_name);
    if (str(ex.co_borrower)) clean.co_borrower = str(ex.co_borrower);
    if (LOAN_TYPES.includes(ex.loan_type)) clean.loan_type = ex.loan_type;
    if (numf(ex.loan_amount)) clean.loan_amount = numf(ex.loan_amount);
    if (numf(ex.purchase_price)) clean.purchase_price = numf(ex.purchase_price);
    if (numf(ex.down_payment)) clean.down_payment = numf(ex.down_payment);
    if (str(ex.interest_rate)) clean.interest_rate = str(ex.interest_rate);
    if (TERMS.includes(ex.term)) clean.term = ex.term;
    if (str(ex.property_address)) clean.property_address = str(ex.property_address);
    if (OCC.includes(ex.occupancy)) clean.occupancy = ex.occupancy;
    if (str(ex.conditions)) clean.conditions = str(ex.conditions);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(ex.expires_on || ""))) clean.expires_on = ex.expires_on;

    return NextResponse.json({ ok: true, extracted: clean, fields: Object.keys(clean) });
  } catch (e: any) {
    console.error("[preapprovals/extract] error:", e);
    return NextResponse.json({ error: e?.message || "Extraction failed." }, { status: 500 });
  }
}
