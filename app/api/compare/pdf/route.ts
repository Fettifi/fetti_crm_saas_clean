// Render a loan comparison to a branded PDF for download/preview.
//   POST /api/compare/pdf   body: a Comparison (or { id }) -> application/pdf
// Works on an unsaved (in-progress) comparison too. Auth-gated via /api/compare matcher.
import { NextRequest, NextResponse } from "next/server";
import { buildComparisonPdf } from "@/lib/comparePdf";
import { getComparison, comparisonNumber, type Comparison } from "@/lib/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const c: Comparison | null = b.id ? await getComparison(b.id) : null;
    const comparison: Comparison = c || {
      id: b.id || "draft",
      number: b.number || comparisonNumber(),
      borrowerName: b.borrowerName,
      borrowerEmail: b.borrowerEmail,
      note: b.note,
      quotes: Array.isArray(b.quotes) ? b.quotes : [],
      created_at: b.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
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
