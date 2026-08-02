// Upload a CREDIT REPORT (PDF or images) → Claude extracts every tradeline's monthly
// obligation → returns normalized liabilities for the Income Calculator's DTI section.
// PRIVACY: the report is processed in-memory only — nothing is stored, and no SSN/DOB/
// addresses are returned. Auth-gated via the /api/income matcher in proxy.ts.
// Post-processing applies deterministic underwriting rules (not model guesses):
//   • revolving with a balance but no reported payment → 5% of balance (agency fallback)
//   • mortgage tradelines default-EXCLUDED (housing is counted separately in DTI)
//   • collections/charge-offs surfaced but excluded (no monthly obligation)
import { NextRequest, NextResponse } from "next/server";
import { extractLiabilitiesFromBlocks, type CreditLiability } from "@/lib/creditReport";

export const runtime = "nodejs";
export const maxDuration = 120;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Credit-report reading needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    // This is the un-fixed twin of the credit-liabilities MAX_DOCS = 4 bug: a bare .slice(0, 4)
    // that discarded files 5+ with a 200 OK and an authoritative includedMonthly, so an 8-page
    // report uploaded as 8 images silently qualified on half of it. Fixing ONE instance of a
    // shape is not fixing the shape.
    const CREDIT_FILE_GUARD = 25;
    const allFiles = ([...form.getAll("files"), ...form.getAll("file")].filter((f) => f instanceof Blob) as Blob[]);
    const fileOverflow = Math.max(0, allFiles.length - CREDIT_FILE_GUARD);
    const files = allFiles.slice(0, CREDIT_FILE_GUARD);
    const skippedFormats: string[] = [];
    if (!files.length) return NextResponse.json({ error: "Upload a credit report (PDF or images)." }, { status: 400 });
    if (files.some((f) => f.size > 25 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 25 MB." }, { status: 413 });

    const blocks: any[] = [];
    for (const f of files) {
      const mediaType = (f as any).type || "application/octet-stream";
      if (!MEDIA.has(mediaType)) { skippedFormats.push((f as any).name || mediaType); continue; }
      const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
      blocks.push(mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
    }
    if (!blocks.length) return NextResponse.json({ error: "Unsupported file type — use PDF or images." }, { status: 415 });

    let out: Awaited<ReturnType<typeof extractLiabilitiesFromBlocks>>;
    try { out = await extractLiabilitiesFromBlocks(blocks, key); }
    catch { return NextResponse.json({ error: "Couldn't read that report — try a clearer PDF." }, { status: 422 }); }
    if (!out.liabilities.length) return NextResponse.json({ error: "No tradelines found in that document." }, { status: 422 });

    return NextResponse.json({
      ok: true,
      borrower: out.borrower,
      liabilities: out.liabilities,
      includedMonthly: out.liabilities.filter((l) => l.include).reduce((s, l) => s + l.monthly, 0),
      // NEVER silent. includedMonthly rolls straight into DTI, so anything we did not read has
      // to be visible next to the number it distorts.
      ...(fileOverflow ? { fileOverflow, warning: `${fileOverflow} uploaded file(s) exceeded the ${CREDIT_FILE_GUARD}-file guard and were NOT read.` } : {}),
      ...(skippedFormats.length ? { skippedFormats, formatWarning: `Not read (unsupported format — use PDF or images): ${skippedFormats.slice(0, 6).join(", ")}.` } : {}),
      ...(out.tradelineOverflow ? { tradelineOverflow: out.tradelineOverflow, tradelineWarning: `${out.tradelineOverflow} tradeline(s) beyond the read guard were NOT counted — DTI is understated.` } : {}),
    });
  } catch (e: any) {
    console.error("[income/credit-report] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
