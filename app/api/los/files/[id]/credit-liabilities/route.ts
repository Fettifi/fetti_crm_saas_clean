// Pull DTI liabilities straight from the credit report ALREADY UPLOADED to this loan
// file's documents — no re-upload. Finds credit-report docs in the loan-docs bucket,
// Claude extracts the tradelines, deterministic underwriting normalization applies
// (see lib/creditReport). Auth-gated via the /api/los matcher in proxy.ts.
//   POST /api/los/files/[id]/credit-liabilities -> { liabilities, includedMonthly, docsRead }
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { extractLiabilitiesFromBlocks, type CreditLiability } from "@/lib/creditReport";
import { pdfText, looksLikeCreditReport, isScan } from "@/lib/docContent";

export const runtime = "nodejs";
export const maxDuration = 120;
const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
// NOT a cap on what gets read — a runaway guard only, and anything beyond it is FLAGGED on the
// response rather than dropped. It was MAX_DOCS = 4 with a bare .slice(), which silently threw
// away a borrower's 5th credit document: no error, no flag, just liabilities missing from the
// file. That is the same failure that cost Ramon a client file on 2026-08-01 — a cap whose name
// reads like a policy and whose behaviour is a silent deletion. A borrower with a thick file or
// a joint tri-merge routinely has more than four.
const CREDIT_DOC_GUARD = 25;
const CREDIT_RE = /credit\s*report|tri.?merge|equifax|experian|trans.?union|bureau|credco|xactus|factual\s*data|meridianlink|credit\b/i;

function mediaTypeFor(name: string): string {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Credit-report reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const { id } = await ctx.params;
    const { data: docs } = await supabaseAdmin.from("loan_documents")
      .select("id, name, category, file_name, storage_path, status")
      .eq("loan_file_id", id).not("storage_path", "is", null);
    // A FILENAME IS NOT EVIDENCE.
    //
    // Ramon, 2026-08-03, on the Magali Lopez Villafuerte / Milton file: "their two credit reports
    // ... it says they don't have any credit reports on file. That's not accurate." It was not.
    // Both were on the file, accepted, in the bucket — named `dhqPDF.aspx-36.pdf` and
    // `dhqPDF.aspx-37.pdf`, which is what his credit vendor's portal calls the download. The
    // regex below looks for words like "credit" and "equifax"; none of them appear in
    // "dhqPDF.aspx-37.pdf". So two 16-page tri-merges with all three bureaus, both FICO sets and
    // every tradeline were invisible, and he was told to upload what he had already uploaded.
    //
    // Adding "dhq" here would fix this vendor and fail on the next. So the filename stays as a
    // FREE FAST PATH, and when it finds nothing we READ the documents and decide on their
    // CONTENTS. That costs nothing: these PDFs carry a text layer, so it is local extraction and
    // a regex — no model call.
    const named = (docs || [])
      .filter((d: any) => d.storage_path && CREDIT_RE.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`));

    let creditDocs = named;
    let foundBy: "name" | "content" = "name";
    const examined: { doc: string; score: number; scan: boolean }[] = [];
    if (!creditDocs.length) {
      foundBy = "content";
      const pdfs = (docs || []).filter((d: any) => d.storage_path && /\.pdf$/i.test(d.file_name || d.storage_path || ""));
      const scored = await Promise.all(pdfs.slice(0, 40).map(async (d: any) => {
        try {
          const { data: blob } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
          if (!blob) return null;
          const text = await pdfText(Buffer.from(await blob.arrayBuffer()));
          const v = looksLikeCreditReport(text);
          examined.push({ doc: d.name || d.file_name || "document", score: v.score, scan: isScan(text) });
          return v.ok ? d : null;
        } catch { return null; }
      }));
      creditDocs = scored.filter(Boolean) as any[];
    }

    const creditOverflow = creditDocs.slice(CREDIT_DOC_GUARD).map((d: any) => d.name || d.file_name || "document");
    creditDocs.length = Math.min(creditDocs.length, CREDIT_DOC_GUARD);
    if (!creditDocs.length) {
      // SAY WHAT WAS ACTUALLY CHECKED. "No credit report found" with an instruction to go upload
      // one is what made a real report look absent. A scanned report has no text to read and is
      // the one case that genuinely needs a hint.
      const scans = examined.filter((e) => e.scan).map((e) => e.doc);
      return NextResponse.json({
        error: scans.length
          ? `Checked all ${examined.length} PDF(s) on this file and none read as a credit report. ${scans.length} had no text layer (${scans.slice(0, 3).join(", ")}) — if the report is one of those, it is a scan; re-download it from the bureau as a text PDF, or use the upload on /income.`
          : `Checked all ${examined.length} PDF(s) on this file and none contains credit-report content (bureau names, tradelines, scores). If the report is an image or a screenshot, use the upload on /income.`,
        examined,
      }, { status: 404 });
    }

    const blocks: any[] = [];
    const read: string[] = [];
    for (const d of creditDocs) {
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
      if (error || !blob) continue;
      let mt = (blob as any).type || mediaTypeFor(d.file_name || d.storage_path || "");
      if (!MEDIA.has(mt)) mt = mediaTypeFor(d.file_name || "");
      if (!MEDIA.has(mt)) continue;
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      blocks.push({ type: "text", text: `--- Document: ${d.name || d.file_name} ---` });
      blocks.push(mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mt, data: b64 } });
      read.push(d.name || d.file_name || "document");
    }
    if (!blocks.length) return NextResponse.json({ error: "The credit-report file couldn't be read from storage." }, { status: 422 });

    const creditRes = await extractLiabilitiesFromBlocks(blocks, key);
    const { liabilities } = creditRes;
    if (!liabilities.length) return NextResponse.json({ error: "No tradelines found on that report." }, { status: 422 });

    await logActivity({
      entity_type: "loan_file", entity_id: id, actor: "agent:underwrite",
      action: "credit.liabilities.read", detail: { docs: read, tradelines: liabilities.length },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      liabilities,
      includedMonthly: liabilities.filter((l: CreditLiability) => l.include).reduce((s: number, l: CreditLiability) => s + l.monthly, 0),
      docsRead: read,
      // Tell the LO HOW the report was found — a file matched only on content is one whose name
      // gives no clue what it is, and he may want to rename it.
      foundBy,
      // Never silent. If the runaway guard ever trims a document, the caller is told which one
      // and how many, so "liabilities are missing" can never be a mystery.
      overflowDocs: creditOverflow,
      ...(creditRes.tradelineOverflow ? { tradelineOverflow: creditRes.tradelineOverflow, tradelineWarning: `${creditRes.tradelineOverflow} tradeline(s) beyond the read guard were NOT counted — DTI is understated.` } : {}),
      warning: creditOverflow.length
        ? `${creditOverflow.length} credit document(s) exceeded the ${CREDIT_DOC_GUARD}-document read guard and were NOT included: ${creditOverflow.slice(0, 6).join(", ")}.`
        : undefined,
    });
  } catch (e: any) {
    console.error("[credit-liabilities] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
