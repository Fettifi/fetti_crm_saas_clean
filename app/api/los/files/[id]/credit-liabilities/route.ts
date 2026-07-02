// Pull DTI liabilities straight from the credit report ALREADY UPLOADED to this loan
// file's documents — no re-upload. Finds credit-report docs in the loan-docs bucket,
// Claude extracts the tradelines, deterministic underwriting normalization applies
// (see lib/creditReport). Auth-gated via the /api/los matcher in proxy.ts.
//   POST /api/los/files/[id]/credit-liabilities -> { liabilities, includedMonthly, docsRead }
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { extractLiabilitiesFromBlocks, type CreditLiability } from "@/lib/creditReport";

export const runtime = "nodejs";
export const maxDuration = 120;
const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const MAX_DOCS = 4;
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
    const creditDocs = (docs || [])
      .filter((d: any) => d.storage_path && CREDIT_RE.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`))
      .slice(0, MAX_DOCS);
    if (!creditDocs.length) {
      return NextResponse.json({ error: "No credit report found in this file's documents — upload one to the file (name it 'Credit report'), or use the upload on /income." }, { status: 404 });
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

    const { liabilities } = await extractLiabilitiesFromBlocks(blocks, key);
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
    });
  } catch (e: any) {
    console.error("[credit-liabilities] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
