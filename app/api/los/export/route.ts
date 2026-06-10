import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, urlaCompleteness, type Urla } from "@/lib/urla";
import { buildMismo34 } from "@/lib/mismo";

// MISMO 3.4 (ULAD / URLA) export. Auth-gated via the /api/los matcher in proxy.ts.
//   GET /api/los/export?file=<loanFileId>      -> downloads MISMO 3.4 XML
//   GET /api/los/export?lead=<leadId>          -> same, straight from a lead
//   GET /api/los/export?file=<id>&report=1     -> JSON: completeness + (masked) data
export const runtime = "nodejs";

function maskUrla(u: Urla): Urla {
  const copy: Urla = JSON.parse(JSON.stringify(u));
  for (const b of copy.borrowers) {
    if (b.ssn) { const d = b.ssn.replace(/[^0-9]/g, ""); b.ssn = d.length >= 4 ? `***-**-${d.slice(-4)}` : "***"; }
  }
  return copy;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const fileId = sp.get("file");
  const leadId = sp.get("lead");
  const wantReport = sp.get("report");

  let loanFile: any = null;
  let lead: any = null;

  try {
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
    } else {
      return NextResponse.json({ error: "Provide ?file= or ?lead=" }, { status: 400 });
    }

    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    const urla = assembleUrla(lead, loanFile);

    if (wantReport) {
      return NextResponse.json({ completeness: urlaCompleteness(urla), urla: maskUrla(urla) });
    }

    const xml = buildMismo34(urla);
    const base = (loanFile?.file_number || lead.full_name || "application").toString().replace(/[^a-z0-9]+/gi, "_");
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}_MISMO_3.4.xml"`,
      },
    });
  } catch (e: any) {
    console.error("[los/export] error:", e);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
