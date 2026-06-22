// Build (but do not save) a scenario draft prefilled from a Lead or a Loan File.
// The Scenario Desk editor calls this to seed a new scenario; the staff still
// reviews + saves it via POST /api/scenarios.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { scenarioFromLead, scenarioFromLoanFile, type Scenario } from "@/lib/scenario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const leadId = sp.get("lead_id");
    const loanFileId = sp.get("loan_file_id");

    if (!leadId && !loanFileId) {
      return NextResponse.json({ error: "lead_id or loan_file_id is required" }, { status: 400 });
    }

    let draft: Partial<Scenario>;

    if (loanFileId) {
      const { data, error } = await supabaseAdmin
        .from("loan_files")
        .select("*")
        .eq("id", loanFileId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Loan file not found" }, { status: 404 });
      draft = scenarioFromLoanFile(data);
    } else {
      const { data, error } = await supabaseAdmin
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      draft = scenarioFromLead(data);
    }

    return NextResponse.json({ draft });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to build prefill draft" }, { status: 500 });
  }
}
