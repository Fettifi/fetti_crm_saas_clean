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
    const files = ([...form.getAll("files"), ...form.getAll("file")].filter((f) => f instanceof Blob) as Blob[]).slice(0, 4);
    if (!files.length) return NextResponse.json({ error: "Upload a credit report (PDF or images)." }, { status: 400 });
    if (files.some((f) => f.size > 25 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 25 MB." }, { status: 413 });

    const blocks: any[] = [];
    for (const f of files) {
      const mediaType = (f as any).type || "application/octet-stream";
      if (!MEDIA.has(mediaType)) continue;
      const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
      blocks.push(mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
    }
    if (!blocks.length) return NextResponse.json({ error: "Unsupported file type — use PDF or images." }, { status: 415 });

    let out: { borrower: string | null; liabilities: CreditLiability[] };
    try { out = await extractLiabilitiesFromBlocks(blocks, key); }
    catch { return NextResponse.json({ error: "Couldn't read that report — try a clearer PDF." }, { status: 422 }); }
    if (!out.liabilities.length) return NextResponse.json({ error: "No tradelines found in that document." }, { status: 422 });

    return NextResponse.json({
      ok: true,
      borrower: out.borrower,
      liabilities: out.liabilities,
      includedMonthly: out.liabilities.filter((l) => l.include).reduce((s, l) => s + l.monthly, 0),
    });
  } catch (e: any) {
    console.error("[income/credit-report] error:", e?.message || e);
    return NextResponse.json({ error: "Extraction failed — please try again." }, { status: 500 });
  }
}
