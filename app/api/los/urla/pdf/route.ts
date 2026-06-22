// GET /api/los/urla/pdf?file=<id> | ?lead=<id> -> the borrower's Form 1003 as a PDF.
// Same resolve + assemble as /api/los/urla; renders via buildUrlaPdf. Auth-gated by
// the /api/los matcher (the assembled object contains the decrypted SSN, so this must
// never be public). Inline so it opens in a viewer window the LO can save from.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { buildUrlaPdf } from "@/lib/urlaPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const fileId = sp.get("file");
    const leadId = sp.get("lead");
    let loanFile: any = null;
    let lead: any = null;
    if (fileId) {
      const { data } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
      loanFile = data;
      if (loanFile?.lead_id) {
        const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
        lead = r.data;
      }
    } else if (leadId) {
      const r = await supabaseAdmin.from("leads").select("*").eq("id", leadId).maybeSingle();
      lead = r.data;
    }
    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    const urla = assembleUrla(lead, loanFile);
    const bytes = await buildUrlaPdf(urla, loanFile);
    const last = urla.borrowers?.[0]?.lastName || "application";
    const fn = `1003-${(loanFile?.file_number || last).toString().replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fn}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[los/urla/pdf] error:", e);
    return NextResponse.json({ error: e?.message || "PDF generation failed" }, { status: 500 });
  }
}
