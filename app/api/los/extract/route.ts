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

const SYSTEM = `You read U.S. mortgage documents (paystubs, W2s, bank statements, driver's licenses/IDs, 1003s, tax returns) and extract structured data for a Uniform Residential Loan Application (URLA/1003).
Return ONLY valid JSON matching this partial shape — INCLUDE ONLY fields you can actually read from the document; omit everything else. Never guess.
{
 "borrower": {"firstName","lastName","ssn","dob" (YYYY-MM-DD),"email","cellPhone","currentAddress":{"street","city","state" (2-letter),"zip"},
   "employment":{"employerName","position","employerAddress":{"street","city","state","zip"}},
   "income":{"base","overtime","bonus","commission","other"}  // MONTHLY dollars; if a paystub shows gross pay, convert to monthly; if a W2 shows annual wages, divide by 12 },
 "assets":[{"type" (CheckingAccount|SavingsAccount|MoneyMarketFund|RetirementFund|Stock|Other),"institution","balance"}],
 "docType": "paystub|w2|bankstatement|id|1003|taxreturn|other"
}`;

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

// One document → parsed URLA fields (or null if unreadable).
async function extractOne(key: string, buf: Buffer, mediaType: string): Promise<any | null> {
  const b64 = buf.toString("base64");
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
      messages: [{ role: "user", content: [block, { type: "text", text: "Extract the URLA fields you can read. JSON only." }] }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : txt); } catch { return null; }
}

function mergeIntoUrla(cur: any, extracted: any): any {
  if (extracted?.borrower) {
    cur.borrowers = cur.borrowers && cur.borrowers.length ? cur.borrowers : [{}];
    cur.borrowers[0] = deepMerge(cur.borrowers[0], extracted.borrower);
  }
  if (Array.isArray(extracted?.assets) && extracted.assets.length) {
    cur.assets = [...(cur.assets || []), ...extracted.assets];
  }
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

    // ---- Extract each + merge once ------------------------------------------
    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    let cur = (raw.urla && typeof raw.urla === "object") ? raw.urla : assembleUrla(lead, loanFile);
    const read: { name: string; docType: string }[] = [];
    const failed: string[] = [];
    // Read every document IN PARALLEL — a file with many docs read sequentially blows
    // past the function timeout before it can save (15 docs was ~8s parallel vs 5min+
    // sequential). Merge in source order afterward so the result is deterministic.
    const outcomes = await Promise.all(sources.map(async (s) => {
      try { return { s, ex: await extractOne(key, s.buf, s.mediaType) }; }
      catch (e) { console.warn("[los/extract]", s.label, e); return { s, ex: null as any }; }
    }));
    for (const { s, ex } of outcomes) {
      if (ex && (ex.borrower || ex.assets)) {
        cur = mergeIntoUrla(cur, ex);
        read.push({ name: s.label, docType: ex.docType || "document" });
      } else failed.push(s.label);
    }

    raw.urla = encryptUrlaSsns(cur); // SSN encrypted at rest (app-layer)
    await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);

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
