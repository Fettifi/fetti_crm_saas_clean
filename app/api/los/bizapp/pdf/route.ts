// GET /api/los/bizapp/pdf?file=<id> | ?lead=<id> -> the Business Credit Application PDF.
//
// The commercial counterpart to /api/los/urla/pdf: a 1003 is for mortgage credit, this is for
// business-purpose funding (working capital, LOC, SBA, equipment). Same resolve-and-assemble
// shape so the two routes stay recognisably siblings.
//
// Auth-gated by the /api/los matcher — the assembled object carries the guarantor's decrypted
// SSN, so this must never be public. (It prints MASKED, but the object in memory is not.)
// Inline disposition so it opens in a viewer the LO can print or save from.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleBizApp } from "@/lib/bizApp";
import { buildBizAppPdf } from "@/lib/bizAppPdf";

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
    if (!lead && !loanFile) return NextResponse.json({ error: "Pass ?file=<loan file id> or ?lead=<lead id>." }, { status: 400 });

    const app = assembleBizApp(lead, loanFile);
    const bytes = await buildBizAppPdf(app);
    const who = (app.legalName || app.owners[0]?.name || "application").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const name = `business-credit-application-${who}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not build the application." }, { status: 500 });
  }
}
