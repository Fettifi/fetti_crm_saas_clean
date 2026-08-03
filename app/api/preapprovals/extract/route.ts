import { NextRequest, NextResponse } from "next/server";
import { PA_FIELDS, PA_BY_KEY } from "@/lib/preapprovalFields";

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

// The schema is GENERATED from lib/preapprovalFields.ts, not hand-written here. It used to be a
// closed 22-field shape, and a closed shape discards at the MODEL — anything without a named slot
// is gone before any downstream code could recover it. Six program specialists enumerated what
// real wholesale term sheets carry; that list is the registry, and this prompt is built from it,
// so a field added to the registry is extracted, stored, and printed with no second edit here.
const KIND_HINT: Record<string, string> = {
  money: "number, digits only",
  percent: 'percent as written, e.g. "75%" or "1.750%"',
  ratio: 'ratio as written, e.g. "1.25"',
  date: '"YYYY-MM-DD"',
  duration: 'as written, e.g. "45 days" or "120 months"',
  count: "number",
  boolean: "true or false",
  text: "text",
};
const SCHEMA_LINES = PA_FIELDS
  .filter((f) => f.key !== "other_terms")
  .map((f) => ` "${f.key}": ${KIND_HINT[f.valueKind] || "text"}${f.example ? ` — e.g. ${JSON.stringify(f.example).slice(0, 70)}` : ""}`)
  .join(",\n");

const SYSTEM = `You read U.S. mortgage/lender TERM SHEETS, rate locks, loan estimates, conditional approvals and wholesale approval term sheets, and extract EVERY term you can read so a pre-approval letter can reproduce the sheet in full.

Return ONLY valid JSON. INCLUDE ONLY fields you can actually read from the document; omit everything else. NEVER guess, infer or invent a number, rate or date — a missing field is correct, a wrong one is not.

A ZERO IS A REAL ANSWER. If the sheet says 0 points, $0 lender fees, no prepayment penalty or $0 down, return it — do not omit it as if it were absent.

Map the product to the closest ${JSON.stringify(LOAN_TYPES)} for "loan_type" ("Conv"→"Conventional"; a no-income/rental/investment qualifier→"DSCR"; bank-statement self-employed→"Bank-Statement (Self-Employed)"; an interest-only short-term/rehab loan→"Fix & Flip" or "Bridge"), and keep the sheet's OWN product wording verbatim in "program_name".
Map "term" to the closest ${JSON.stringify(TERMS)} ("360 mo"/"30 yr fixed"→"30-year fixed"; interest-only bridge/flip→"12-month interest-only"), and keep the sheet's own wording in "amortization_type".
Map "occupancy" to one of ${JSON.stringify(OCC)} ("Non-Owner Occupied"/"NOO"/"Investor"/"Rental"→"Investment"; "Owner-Occupied"/"Primary"→"Primary residence"; "Second Home"/"Vacation"→"Second home").

Distinguish the two expiry dates — "lock_expires" is when the RATE lock dies, "termsheet_expires" is when the LENDER'S QUOTE dies. Do not merge them.

{
${SCHEMA_LINES},
 "other_terms": [{"label": string, "value": string}]  — EVERY remaining term on the sheet that has no field above. Do not drop anything; put it here.
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
        // A dense wholesale term sheet carries 40+ terms. At 1,500 tokens the JSON was cut
        // mid-object, the brace match below failed, and the LO got "Couldn't read that term
        // sheet" for a document that read perfectly — or worse, a partial object.
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract the loan terms from this term sheet. JSON only." }] }],
      }),
      // This call had NO timeout at all. A hung upstream held the request until the platform
      // killed the function, and the LO watched a spinner with no error.
      signal: AbortSignal.timeout(180000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    // A truncated reply is a FAILURE, not a partial read. Say so rather than issuing a letter
    // off half a term sheet.
    if (j?.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "That term sheet is denser than one pass can read. Split it and upload the pages separately." }, { status: 422 });
    }
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let ex: any = {};
    try { ex = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read that term sheet — try a clearer PDF or image." }, { status: 422 }); }

    // Sanitize → only well-formed, known values reach the form.
    // A ZERO IS AN ANSWER. `n > 0` deleted every legitimate zero on a term sheet — $0 down on
    // 100% financing, 0 points, $0 lender fees. Those are terms the borrower is entitled to see,
    // and they are usually the BEST lines on the sheet. Only a value that is absent or unreadable
    // is undefined. (Negative is kept too: a lender CREDIT is a negative cost.)
    const numf = (v: any) => {
      const raw = String(v ?? "").trim();
      if (raw === "") return undefined;
      const n = Number(raw.replace(/[^0-9.\-]/g, ""));
      return isFinite(n) ? n : undefined;
    };
    const str = (v: any) => (v == null ? undefined : String(v).trim() || undefined);
    const clean: Record<string, unknown> = {};
    if (str(ex.borrower_name)) clean.borrower_name = str(ex.borrower_name);
    if (str(ex.co_borrower)) clean.co_borrower = str(ex.co_borrower);
    // A VALUE OUTSIDE THE ENUM MUST NOT VANISH INTO A DEFAULT.
    // These three whitelists silently discarded anything unlisted — and because the form seeds
    // loan_type "Conventional", term "30-year fixed" and occupancy "Primary residence", the drop
    // did not produce a blank, it produced a FALSE STATEMENT: a sheet reading "Non-Owner Occupied"
    // yielded a letter telling a listing agent the borrower will occupy an investment property.
    // The identical hazard on the LOS-pull path was fixed months ago with "unknown — the LO picks,
    // we do not assert"; this path never got it. Now: map what we can, and REPORT what we cannot.
    const unmapped: { field: string; value: string }[] = [];
    if (LOAN_TYPES.includes(ex.loan_type)) clean.loan_type = ex.loan_type;
    else if (str(ex.loan_type)) unmapped.push({ field: "Loan program", value: str(ex.loan_type)! });
    // `if (numf(...))` is itself a truthiness test — it would drop the 0 that numf now correctly
    // returns. Compare against undefined.
    const put = (k: string, v: number | undefined) => { if (v !== undefined) clean[k] = v; };
    put("loan_amount", numf(ex.loan_amount));
    put("purchase_price", numf(ex.purchase_price));
    put("down_payment", numf(ex.down_payment));
    if (str(ex.interest_rate)) clean.interest_rate = str(ex.interest_rate);
    if (TERMS.includes(ex.term)) clean.term = ex.term;
    else if (str(ex.term)) unmapped.push({ field: "Loan term", value: str(ex.term)! });
    if (str(ex.property_address)) clean.property_address = str(ex.property_address);
    if (OCC.includes(ex.occupancy)) clean.occupancy = ex.occupancy;
    else if (str(ex.occupancy)) {
      // Same mapping the LOS-pull path uses, rather than discarding a value we can read.
      const o = String(ex.occupancy).toLowerCase();
      if (/investor|investment|rental|non.?owner|noo/.test(o)) clean.occupancy = "Investment";
      else if (/second|vacation/.test(o)) clean.occupancy = "Second home";
      else if (/owner|primary/.test(o)) clean.occupancy = "Primary residence";
      else unmapped.push({ field: "Occupancy", value: str(ex.occupancy)! });
    }
    if (str(ex.conditions)) clean.conditions = str(ex.conditions);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(ex.expires_on || ""))) clean.expires_on = ex.expires_on;
    // EVERY registry field that is not a real column. The old list was 10 hand-written keys; the
    // cap was 80 characters applied here AND again on the way to storage, with no ellipsis — so a
    // real prepay clause printed cut mid-word, with the borrower-favourable half deleted, and read
    // as a complete term.
    const CAP = 600;
    for (const f of PA_FIELDS) {
      if (f.column || f.key === "other_terms") continue;
      const raw = (ex as any)[f.key];
      if (raw == null || String(raw).trim() === "") continue;   // "" is absent; 0 and false are NOT
      const v = String(raw).trim();
      clean[f.key] = v.length > CAP ? v.slice(0, CAP - 1) + "\u2026" : v;
    }
    // The catch-all: anything the sheet carried with no named slot. This is what makes "capture
    // everything" true rather than "capture the 130 things we thought of".
    if (Array.isArray(ex.other_terms)) {
      const others = ex.other_terms
        .map((o: any) => ({ label: String(o?.label ?? "").trim().slice(0, 80), value: String(o?.value ?? "").trim().slice(0, CAP) }))
        .filter((o: any) => o.label && o.value && !PA_BY_KEY[o.label]);
      if (others.length) clean.other_terms = others.slice(0, 40);
    }

    return NextResponse.json({ ok: true, extracted: clean, fields: Object.keys(clean), unmapped });
  } catch (e: any) {
    console.error("[preapprovals/extract] error:", e);
    return NextResponse.json({ error: e?.message || "Extraction failed." }, { status: 500 });
  }
}
