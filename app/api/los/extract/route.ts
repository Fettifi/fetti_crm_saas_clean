import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { encryptUrlaSsns } from "@/lib/crypto";

// Document → 1003 auto-fill. Claude (vision) extracts the URLA-relevant fields and
// merges them into the lead's structured 1003 (leads.raw.urla). Three input modes:
//   • { all: true }   — read ALL documents already uploaded to this loan file
//   • { docId: "..." } — read one already-uploaded document by its id
//   • multipart "doc"  — read a freshly uploaded file (ad-hoc)
// The first two pull straight from the loan file's verified documents (loan-docs
// bucket) so the LO never re-uploads what's already on file.
// Auth-gated via the /api/los matcher.  POST /api/los/extract?file=<loanFileId>
export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const READABLE_STATUS = ["received", "accepted"]; // uploaded (received) or verified (accepted)

function inferType(name: string): string {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

const SYSTEM = `You read U.S. mortgage documents and extract EVERY field you can for a Uniform Residential Loan Application (URLA/1003). Different documents carry different data — pull ALL of it:
- Driver's license / state ID → borrower legal first & last name, DOB, current address, and citizenship if shown.
- Paystub → employer name/address/phone, job title, hire/start date, and income (base, overtime, bonus, commission) as MONTHLY dollars (weekly×52/12, biweekly×26/12, semimonthly×24/12, annual/12; if only YTD is shown, divide by the number of months elapsed).
- W-2 → employer name/address, employee name/SSN/address, annual wages → MONTHLY income.
- Tax return (1040 + schedules) → name, SSN, address, filing status (Married Filing Jointly/Separately→"Married", Single→"Unmarried"), number of dependents, self-employment (Schedule C → employment.selfEmployed=true + net monthly income), rental real estate (Schedule E → a reo[] entry per property with address, monthly rental income, and mortgage figures), interest & dividends (→ income.other). A spouse on a JOINT return → a SECOND borrower (coBorrower).
- Bank / brokerage statement → assets (account type, institution, last-4 account number, current balance) and the account holder's name/address.
- Prior 1003 / URLA / loan application → EVERYTHING: all borrowers, employment history, income, assets, liabilities (creditor, balance, monthly payment), real estate owned, subject property, loan details, declarations, demographics.

Return ONLY valid JSON in this shape — INCLUDE ONLY fields you can actually read; OMIT everything else; NEVER guess a value you cannot see:
{
 "borrower": { "firstName","lastName","ssn" (###-##-####),"dob" (YYYY-MM-DD),"citizenship" ("US Citizen"|"Permanent Resident"|"Non-Permanent Resident"),"maritalStatus" ("Married"|"Separated"|"Unmarried"),"dependentsCount","email","homePhone","cellPhone",
   "currentAddress":{"street","city","state" (2-letter),"zip"},"housingStatus" ("Own"|"Rent"),"monthlyHousingExpense","yearsAtAddress",
   "employment":{"employerName","employerPhone","employerAddress":{"street","city","state","zip"},"position","startDate" (YYYY-MM-DD),"yearsInLineOfWork","selfEmployed" (bool)},
   "income":{"base","overtime","bonus","commission","other"} },
 "coBorrower": { same shape as borrower — ONLY when a second person clearly appears (joint tax-return spouse, co-applicant on a 1003) },
 "assets":[{"type" (CheckingAccount|SavingsAccount|MoneyMarketFund|RetirementFund|Stock|Other),"institution","accountNumber" (last 4 only),"balance"}],
 "liabilities":[{"type","creditor","balance","monthlyPayment"}],
 "reo":[{"address","presentValue","status","monthlyRentalIncome","mortgageBalance","monthlyMortgage"}],
 "property":{"address":{"street","city","state","zip"},"propertyType","occupancy" ("PrimaryResidence"|"SecondHome"|"Investment"),"presentValue"},
 "loan":{"purpose" ("Purchase"|"Refinance"),"amount","loanType","amortizationType","termMonths"},
 "declarations":{"intendToOccupyAsPrimary","ownsOtherProperty","borrowingDownPayment"},
 "docType": "paystub|w2|bankstatement|id|1003|taxreturn|other"
}
All INCOME is MONTHLY dollars (convert annual → monthly). Balances/amounts stay as-is.`;

function deepMerge(target: any, src: any): any {
  if (Array.isArray(src)) return src.length ? src : target;
  if (src && typeof src === "object") {
    const out = { ...(target && typeof target === "object" ? target : {}) };
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined || v === "") continue;
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return src;
}

// ── BORROWER vs CO-BORROWER assignment by NAME (not by the model's per-doc guess). A
// co-borrower's solo document (their driver's license, W-2, paystub) reads to the model as
// the lone "borrower" on that page — filing it blindly into borrowers[0] OVERWRITES the
// primary's DOB/SSN/address. We instead match the extracted person's NAME to the existing
// borrower roster and merge into THAT slot; an unrecognized named person becomes a new
// co-borrower. Mirrors the income engine's deterministic borrower assignment.
const NM_STOP = new Set(["and", "the", "jr", "sr", "ii", "iii", "mrs", "mr", "ms", "for", "aka", "dba", "llc", "inc", "trust"]);
const nmTokens = (s: string): string[] =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !NM_STOP.has(t));
function personName(p: any): string {
  return `${p?.firstName || ""} ${p?.lastName || ""} ${p?.fullName || ""}`.trim();
}
function nameScore(a: string, b: string): number {
  const ta = new Set(nmTokens(a)); if (!ta.size) return 0;
  let s = 0; for (const t of nmTokens(b)) if (ta.has(t)) s++; return s;
}
// Which existing borrower slot does this person belong to? -1 = unrecognized (a new person).
function slotForPerson(person: any, borrowers: any[]): number {
  const nm = personName(person); if (!nm) return -1;
  let best = -1, bestScore = 0;
  for (let i = 0; i < borrowers.length; i++) {
    const sc = nameScore(nm, personName(borrowers[i]));
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return bestScore >= 1 ? best : -1;
}

// One document → parsed URLA fields (or null if unreadable). `rosterHint` names the known
// applicants so the model files a co-borrower's solo document as coBorrower, not borrower.
async function extractOne(key: string, buf: Buffer, mediaType: string, rosterHint: string): Promise<any | null> {
  const b64 = buf.toString("base64");
  const block = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
  const hint = rosterHint
    ? `KNOWN APPLICANTS on this loan — attribute the person on this document to the matching one BY NAME: ${rosterHint}. Put the PRIMARY borrower's fields under "borrower" and a DIFFERENT applicant's fields under "coBorrower". If the person on this document is the co-borrower, return their fields under "coBorrower" (leave "borrower" empty). `
    : "";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: [block, { type: "text", text: `${hint}Extract the URLA fields you can read. Always include the person's name on the object you return so it can be filed under the right borrower. JSON only.` }] }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : txt); } catch { return null; }
}

// Dedupe list items by a content key (so re-running auto-fill, or the same account
// appearing on two statements, doesn't pile up duplicates). Items with no readable
// key are kept as-is.
function dedupeBy(arr: any[], keyFn: (x: any) => string): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const x of arr) {
    const k = keyFn(x).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(x);
  }
  return out;
}

function mergeIntoUrla(cur: any, ex: any): any {
  cur.borrowers = (cur.borrowers && cur.borrowers.length) ? cur.borrowers : [{}];
  // File each extracted person under the roster slot whose NAME matches — the model may
  // label a co-borrower's solo doc as "borrower", so we never trust the label blindly.
  const people = [ex?.borrower, ex?.coBorrower].filter((p) => p && Object.keys(p).length);
  for (const person of people) {
    const nm = personName(person);
    let slot: number;
    if (nm) {
      slot = slotForPerson(person, cur.borrowers);
      if (slot < 0) {                                   // a named person not yet on the roster
        const emptyIdx = cur.borrowers.findIndex((bb: any) => !personName(bb));
        slot = emptyIdx >= 0 ? emptyIdx : cur.borrowers.length;   // reuse an empty slot, else append
      }
    } else {
      slot = 0;                                          // nameless doc (assets etc.) → primary
    }
    if (!cur.borrowers[slot]) cur.borrowers[slot] = {};
    cur.borrowers[slot] = deepMerge(cur.borrowers[slot], person);
  }
  if (Array.isArray(ex?.assets) && ex.assets.length)
    cur.assets = dedupeBy([...(cur.assets || []), ...ex.assets], (a) => `${a.institution || ""}|${a.type || ""}|${a.accountNumber || a.balance || ""}`);
  if (Array.isArray(ex?.liabilities) && ex.liabilities.length)
    cur.liabilities = dedupeBy([...(cur.liabilities || []), ...ex.liabilities], (l) => `${l.creditor || ""}|${l.balance || ""}`);
  if (Array.isArray(ex?.reo) && ex.reo.length)
    cur.reo = dedupeBy([...(cur.reo || []), ...ex.reo], (r) => JSON.stringify(r.address || r));
  if (ex?.property && Object.keys(ex.property).length) cur.property = deepMerge(cur.property || {}, ex.property);
  if (ex?.loan && Object.keys(ex.loan).length) cur.loan = deepMerge(cur.loan || {}, ex.loan);
  if (ex?.declarations && Object.keys(ex.declarations).length) cur.declarations = deepMerge(cur.declarations || {}, ex.declarations);
  return cur;
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Document OCR needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const fileId = req.nextUrl.searchParams.get("file");
    if (!fileId) return NextResponse.json({ error: "file id required" }, { status: 400 });
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
    if (!loanFile?.lead_id) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    // ---- Gather sources ------------------------------------------------------
    type Src = { label: string; buf: Buffer; mediaType: string };
    const sources: Src[] = [];
    const skipped: string[] = [];
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      // Pull from documents ALREADY uploaded to this loan file.
      const body = await req.json().catch(() => ({} as any));
      let q = supabaseAdmin.from("loan_documents")
        .select("id, name, file_name, storage_path, status")
        .eq("loan_file_id", fileId).in("status", READABLE_STATUS).not("storage_path", "is", null);
      if (!body.all && body.docId) q = q.eq("id", String(body.docId));
      const { data: docs } = await q.limit(15);
      if (!docs || !docs.length) {
        return NextResponse.json({ error: "No uploaded documents on this file to read yet." }, { status: 400 });
      }
      for (const d of docs) {
        const mediaType = inferType(d.file_name || d.name || "");
        if (!MEDIA.has(mediaType)) { skipped.push(`${d.name || d.file_name} (unsupported type)`); continue; }
        const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
        if (error || !blob) { skipped.push(`${d.name || d.file_name} (download failed)`); continue; }
        sources.push({ label: d.name || d.file_name || "document", buf: Buffer.from(await blob.arrayBuffer()), mediaType });
      }
    } else {
      // Ad-hoc: a freshly uploaded file.
      const form = await req.formData();
      const file = form.get("doc");
      if (!(file instanceof Blob)) return NextResponse.json({ error: "No document provided." }, { status: 400 });
      const mediaType = (file as any).type || "application/octet-stream";
      if (!MEDIA.has(mediaType)) return NextResponse.json({ error: `Unsupported type ${mediaType}. Use PDF or an image.` }, { status: 415 });
      sources.push({ label: (file as any).name || "upload", buf: Buffer.from(await file.arrayBuffer()), mediaType });
    }
    if (!sources.length) return NextResponse.json({ error: "Nothing readable to extract.", skipped }, { status: 400 });

    // ---- Extract each (parallel), then merge onto the FRESHEST urla ----------
    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    // Roster hint from what we already know (lead name seeds borrower[0]; any co-borrowers
    // from a prior 1003/MISMO) so each doc is attributed to the right person by name.
    const preUrla: any = (raw.urla && typeof raw.urla === "object") ? raw.urla : assembleUrla(lead, loanFile);
    const rosterHint = ((preUrla.borrowers || []) as any[])
      .map((bb, i) => { const nm = personName(bb); return nm ? `${i === 0 ? "Primary borrower" : "Co-borrower"} = ${nm}` : null; })
      .filter(Boolean).join("; ");
    const read: { name: string; docType: string }[] = [];
    const failed: string[] = [];
    // Read every document IN PARALLEL — a file with many docs read sequentially blows
    // past the function timeout before it can save (15 docs was ~8s parallel vs 5min+
    // sequential). Merge in source order afterward so the result is deterministic.
    const outcomes = await Promise.all(sources.map(async (s) => {
      try { return { s, ex: await extractOne(key, s.buf, s.mediaType, rosterHint) }; }
      catch (e) { console.warn("[los/extract]", s.label, e); return { s, ex: null as any }; }
    }));

    // Concurrency-safe write: the Anthropic OCR above can run for minutes, and a
    // borrower/LO URLA save or a cron (qualify/shield) can mutate leads.raw in that
    // window. Re-read the freshest raw HERE and (a) build the urla base from the FRESHEST
    // urla — NOT the pre-OCR snapshot — so a concurrent 1003 edit made during the OCR is
    // preserved and our deltas merge on top of it instead of reverting it, and (b) replace
    // ONLY the urla key so every other raw.* change (shield/qualification) survives.
    const { data: freshLead } = await supabaseAdmin.from("leads").select("raw").eq("id", lead.id).maybeSingle();
    const freshRaw = ((freshLead as any)?.raw && typeof (freshLead as any).raw === "object"
      ? (freshLead as any).raw
      : (raw && typeof raw === "object" ? raw : {})) as any;
    let cur = (freshRaw.urla && typeof freshRaw.urla === "object") ? freshRaw.urla : assembleUrla(lead, loanFile);
    const hasData = (ex: any) => ex && [ex.borrower, ex.coBorrower].some((p) => p && Object.keys(p).length)
      || (ex && [ex.assets, ex.liabilities, ex.reo].some((a) => Array.isArray(a) && a.length))
      || (ex && [ex.property, ex.loan, ex.declarations].some((o) => o && Object.keys(o).length));
    for (const { s, ex } of outcomes) {
      if (hasData(ex)) {
        cur = mergeIntoUrla(cur, ex);
        read.push({ name: s.label, docType: ex.docType || "document" });
      } else failed.push(s.label);
    }
    // encryptUrlaSsns is idempotent on already-encrypted SSNs, so merging our deltas onto a
    // fresh urla that may already carry encrypted SSNs re-encrypts safely (no double-encrypt).
    freshRaw.urla = encryptUrlaSsns(cur); // SSN encrypted at rest (app-layer)
    await supabaseAdmin.from("leads").update({ raw: freshRaw }).eq("id", lead.id);

    return NextResponse.json({
      ok: true,
      count: read.length,
      read,
      failed,
      skipped,
      docType: read[0]?.docType || "document",
    });
  } catch (e: any) {
    console.error("[los/extract] error:", e);
    return NextResponse.json({ error: e?.message || "Extraction failed." }, { status: 500 });
  }
}
