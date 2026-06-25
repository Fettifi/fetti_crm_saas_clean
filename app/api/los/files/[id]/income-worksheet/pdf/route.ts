// Build the Income Calculation & Verification Worksheet PDF from the computed
// worksheet the LO is viewing (income breakdown + AI verification + qualification).
// POST body: { result, report, docsRead, qualification }. Auth-gated via /api/los.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildIncomeWorksheetPdf, type WorksheetData } from "@/lib/incomePdf";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (!body?.result?.lines) return NextResponse.json({ error: "Run income verification first." }, { status: 400 });

    const { data: f } = await supabaseAdmin.from("loan_files").select("borrower_name, file_number").eq("id", id).maybeSingle();

    const data: WorksheetData = {
      borrowerName: body.borrowerName || f?.borrower_name || "Borrower",
      fileNumber: body.fileNumber || f?.file_number || undefined,
      date: body.date || new Date().toISOString().slice(0, 10),
      loanType: body.loanType,
      audience: body.audience === "borrower" ? "borrower" : "lender",
      result: body.result,
      report: body.report,
      docsRead: body.docsRead,
      qualification: body.qualification,
      comparison: body.comparison,
      borrowersNote: body.borrowersNote,
    };

    const bytes = await buildIncomeWorksheetPdf(data);
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "lo", action: "income.worksheet.generated", detail: { monthlyIncome: Math.round(body.result?.monthlyTotal || 0) } }).catch(() => {});

    const safe = (data.borrowerName || "borrower").replace(/[^a-z0-9]+/gi, "-");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Income-Worksheet-${safe}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[los/income-worksheet/pdf]", e);
    return NextResponse.json({ error: e?.message || "Worksheet PDF failed." }, { status: 500 });
  }
}
