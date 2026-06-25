// File-less Income Summary PDF for the standalone Income Calculator (/income).
// Same builder as the loan-file worksheet; takes the computed worksheet in the body.
// Auth-gated via the /api/income matcher.
import { NextRequest, NextResponse } from "next/server";
import { buildIncomeWorksheetPdf, type WorksheetData } from "@/lib/incomePdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.result?.lines) return NextResponse.json({ error: "Add income first." }, { status: 400 });
    const data: WorksheetData = {
      borrowerName: body.borrowerName || "Borrower",
      date: body.date || new Date().toISOString().slice(0, 10),
      loanType: body.loanType,
      audience: body.audience === "lender" ? "lender" : "borrower",
      result: body.result,
      qualification: body.qualification,
      comparison: body.comparison,
      borrowersNote: body.borrowersNote,
    };
    const bytes = await buildIncomeWorksheetPdf(data);
    const safe = (data.borrowerName || "income").replace(/[^a-z0-9]+/gi, "-");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Income-Summary-${safe}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[income/pdf]", e);
    return NextResponse.json({ error: e?.message || "PDF failed." }, { status: 500 });
  }
}
