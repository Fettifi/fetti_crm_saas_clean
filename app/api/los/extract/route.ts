import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";

// Document OCR auto-fill. Upload a paystub / W2 / bank statement / ID / 1003 and
// Claude (vision) extracts the URLA-relevant fields and merges them into the
// lead's structured 1003 (leads.raw.urla). No third-party OCR vendor needed.
// Auth-gated via the /api/los matcher.  POST /api/los/extract?file=<loanFileId>
export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

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

    const form = await req.formData();
    const file = form.get("doc");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No document provided." }, { status: 400 });
    const mediaType = (file as any).type || "application/octet-stream";
    if (!MEDIA.has(mediaType)) return NextResponse.json({ error: `Unsupported type ${mediaType}. Use PDF or an image.` }, { status: 415 });
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
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract the URLA fields you can read. JSON only." }] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    let txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let extracted: any = {};
    try { extracted = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't parse the document." }, { status: 422 }); }

    // Merge into structured urla
    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    const cur = (raw.urla && typeof raw.urla === "object") ? raw.urla : assembleUrla(lead, loanFile);
    if (extracted.borrower) {
      cur.borrowers = cur.borrowers && cur.borrowers.length ? cur.borrowers : [{}];
      cur.borrowers[0] = deepMerge(cur.borrowers[0], extracted.borrower);
    }
    if (Array.isArray(extracted.assets) && extracted.assets.length) {
      cur.assets = [...(cur.assets || []), ...extracted.assets];
    }
    raw.urla = cur;
    await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);

    return NextResponse.json({ ok: true, docType: extracted.docType || "document", extracted });
  } catch (e: any) {
    console.error("[los/extract] error:", e);
    return NextResponse.json({ error: e?.message || "Extraction failed." }, { status: 500 });
  }
}
