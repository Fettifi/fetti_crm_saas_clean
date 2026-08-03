import { NextRequest, NextResponse } from "next/server";
import { PA_FIELDS, PA_BY_KEY } from "@/lib/preapprovalFields";

// Upload a lender TERM SHEET (PDF/image) → Claude (vision) extracts the loan terms
// → returns sanitized fields to pre-fill a Fetti pre-approval. No DB write here:
// the LO reviews the extracted terms, then issues the letter via POST /api/preapprovals.
// Auth-gated via the /api/preapprovals matcher in proxy.ts. Mirrors /api/los/extract.
export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const LOAN_TYPES = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "First-Time Homebuyer", "DSCR", "Bank-Statement (Self-Employed)", "Fix & Flip", "Bridge", "Private Money / Hard Money", "Second Mortgage / 2nd TD", "HELOC", "Reverse (HECM)"];
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

DICTATE, DO NOT RE-CATEGORISE. Ramon's words: "read everything that I upload and dictate that onto the sheet." Use a named field ONLY when the document's own wording unambiguously means that field. If a line item does not clearly match one, put it in "other_terms" USING THE DOCUMENT'S OWN LABEL, VERBATIM. Never rename a fee: an "Insurance Monitoring Fee" is not a processing fee, a "Lender Desk Review" is not an appraisal fee. A term shown under the sheet's own name is right; the same term shown under a name the sheet never used is wrong, and it goes to a borrower.

TRANSCRIBE VALUES AS WRITTEN. Keep ranges ("10.99-11.99%"), approximations ("Approximately $2,000,000"), qualifiers ("paid in advance", "excludes escrow & title") and conditions in full. Do not round, average, normalise or tidy. If the document contains an obvious typo in a name or address, reproduce it — do not silently correct it.

EVERY LINE ON THE DOCUMENT MUST APPEAR SOMEWHERE in your output — a named field or other_terms. Before finishing, re-read the document and confirm nothing was left out.

DO NOT REPEAT YOURSELF. If a value is already in a named field, do not also list it in other_terms. Use other_terms only for what has no named field, or for a QUALIFIER the named field cannot hold ("paid in advance", "excludes escrow & title", "of the appraised value") — and then state only the qualifier, not the whole line again.

A ZERO IS A REAL ANSWER. If the sheet says 0 points, $0 lender fees, no prepayment penalty or $0 down, return it — do not omit it as if it were absent.

Map the product to the closest ${JSON.stringify(LOAN_TYPES)} for "loan_type" ("Conv"→"Conventional"; a no-income/rental/investment qualifier→"DSCR"; bank-statement self-employed→"Bank-Statement (Self-Employed)"; an interest-only short-term/rehab loan→"Fix & Flip" or "Bridge"), and keep the sheet's OWN product wording verbatim in "program_name".
Set "term" ONLY when the document's term genuinely IS one of ${JSON.stringify(TERMS)} ("360 mo"/"30 yr fixed"→"30-year fixed"). If it is anything else — 3 years, 18 months, 40-year, a balloon — LEAVE "term" OUT ENTIRELY and put the document's own wording in "loan_term_length" (e.g. "3 Years"). Never pick the nearest option: a 3-year bridge shown as "12-month interest-only" is a false statement on a letter that goes to a borrower. Keep the payment structure in "amortization_type".
Map "occupancy" to one of ${JSON.stringify(OCC)} ("Non-Owner Occupied"/"NOO"/"Investor"/"Rental"→"Investment"; "Owner-Occupied"/"Primary"→"Primary residence"; "Second Home"/"Vacation"→"Second home").

Distinguish the two expiry dates — "lock_expires" is when the RATE lock dies, "termsheet_expires" is when the LENDER'S QUOTE dies. Do not merge them.

{
${SCHEMA_LINES},
 "other_terms": [{"label": string, "value": string}]  — EVERY remaining term on the sheet that has no field above. Do not drop anything; put it here.
}`;

/** Read ONE document. Throws on a truncated or unreadable reply — never returns a partial. */
async function readOne(key: string, buf: Buffer, mediaType: string): Promise<any> {
    const b64 = buf.toString("base64");

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
    if (j?.stop_reason === "max_tokens") throw new Error("denser than one pass can read — split it into separate uploads");
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : txt); } catch { throw new Error("couldn't read it — try a clearer scan"); }
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Term-sheet reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    // READ EVERYTHING HE UPLOADS.
    //
    // Ramon, 2026-08-03: "make sure that you read everything that I upload and dictate that onto
    // the sheet." This read `form.get("file")` — exactly ONE document — while a real quote arrives
    // as several: the term sheet, the fee worksheet, the rate lock confirmation, a guideline
    // exception page. Everything after the first was simply not read.
    const form = await req.formData();
    const files = form.getAll("file").filter((f) => typeof f !== "string") as unknown as Blob[];
    if (!files.length) return NextResponse.json({ error: "No term sheet provided." }, { status: 400 });

    const skipped: string[] = [];
    const usable: { name: string; buf: Buffer; mediaType: string }[] = [];
    for (const f of files) {
      const name = (f as any).name || "document";
      const mediaType = (f as any).type || "application/octet-stream";
      if (!MEDIA.has(mediaType)) { skipped.push(`${name} (unsupported type ${mediaType})`); continue; }
      usable.push({ name, buf: Buffer.from(await f.arrayBuffer()), mediaType });
    }
    if (!usable.length) return NextResponse.json({ error: "Nothing readable. Upload a PDF or an image.", skipped }, { status: 415 });

    // In parallel — several documents read one after another blow the function timeout.
    const outcomes = await Promise.all(usable.map(async (u) => {
      try { return { name: u.name, ex: await readOne(key, u.buf, u.mediaType) }; }
      catch (e: any) { return { name: u.name, ex: null, err: e?.message || "unreadable" }; }
    }));
    const failed = outcomes.filter((o) => !o.ex).map((o) => `${o.name} (${(o as any).err})`);
    const read = outcomes.filter((o) => o.ex).map((o) => o.name);
    if (!read.length) return NextResponse.json({ error: `Couldn't read ${failed.join("; ")}.`, failed, skipped }, { status: 422 });

    // MERGE, AND NEVER LET A LATER DOCUMENT BLANK AN EARLIER ONE.
    // Same rule as the 1003 SSN merge: completeness only goes up. A fee worksheet that does not
    // mention the rate must not erase the rate the term sheet stated. Where two documents state
    // DIFFERENT values for the same term we keep the first and REPORT the disagreement — silently
    // picking one is how a letter ends up quoting a rate the borrower was never offered.
    const ex: any = {};
    const conflicts: { field: string; kept: string; also: string; from: string }[] = [];
    const seenIn: Record<string, string> = {};
    for (const o of outcomes) {
      if (!o.ex) continue;
      for (const [k, v] of Object.entries(o.ex)) {
        if (v == null || String(v).trim() === "") continue;
        if (k === "other_terms") {
          ex.other_terms = [...(ex.other_terms || []), ...(Array.isArray(v) ? v : [])];
          continue;
        }
        if (!(k in ex)) { ex[k] = v; seenIn[k] = o.name; continue; }
        if (String(ex[k]).trim() !== String(v).trim()) {
          const label = PA_BY_KEY[k]?.label || k;
          conflicts.push({ field: label, kept: String(ex[k]), also: String(v), from: o.name });
        }
      }
    }

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
      // A catch-all row that repeats a named field is noise on the letter — the model echoed
      // "$550.00 Lender Desk Review" beside the Desk review fee row it had already filled.
      const shown = new Set(Object.entries(clean).map(([, v]) => String(v).replace(/[^a-z0-9.]/gi, "").toLowerCase()).filter((x) => x.length >= 2));
      const others = ex.other_terms
        .map((o: any) => ({ label: String(o?.label ?? "").trim().slice(0, 80), value: String(o?.value ?? "").trim().slice(0, CAP) }))
        .filter((o: any) => {
          if (!o.label || !o.value || PA_BY_KEY[o.label]) return false;
          const norm = o.value.replace(/[^a-z0-9.]/gi, "").toLowerCase();
          // Short values that exactly duplicate a captured one are echoes; long prose is a real
          // stipulation and must be kept even if it mentions a number we also captured.
          return !(norm.length < 60 && [...shown].some((v) => norm === v || norm.includes(v)));
        });
      if (others.length) clean.other_terms = others.slice(0, 40);
    }

    return NextResponse.json({ ok: true, extracted: clean, fields: Object.keys(clean), unmapped, read, failed, skipped, conflicts });
  } catch (e: any) {
    console.error("[preapprovals/extract] error:", e);
    return NextResponse.json({ error: e?.message || "Extraction failed." }, { status: 500 });
  }
}
