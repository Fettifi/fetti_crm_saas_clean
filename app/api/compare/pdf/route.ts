// Render a loan comparison to a branded PDF for download/preview.
//   POST /api/compare/pdf   body: a Comparison (or { id }) -> application/pdf
// Works on an unsaved (in-progress) comparison too. Auth-gated via /api/compare matcher.
import { NextRequest, NextResponse } from "next/server";
import { buildComparisonPdf } from "@/lib/comparePdf";
import { getComparison, comparisonNumber, mergeComparison, type Comparison } from "@/lib/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    // The screen's live state wins over the saved record — see mergeComparison. Loading by id
    // and IGNORING the posted body printed the stale saved version of an edited comparison.
    const stored: Comparison | null = b.id ? await getComparison(b.id) : null;
    const comparison: Comparison = mergeComparison(stored, { ...b, number: b.number || comparisonNumber() });
    if (!comparison.quotes.length) return NextResponse.json({ error: "No quotes to compare yet." }, { status: 400 });
    const bytes = await buildComparisonPdf(comparison);
    const fname = `Fetti-Loan-Comparison-${comparison.number}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fname}"` },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "PDF failed" }, { status: 500 });
  }
}
