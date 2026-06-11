import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { runDealScreen } from "@/lib/dealScreen";

// AI Deal Screen. Auth-gated via the /api/los matcher.
//   GET  /api/los/screen?file=<id>  -> cached screen (auto-run on new investor leads)
//   POST /api/los/screen?file=<id>  -> run fresh + cache
export const runtime = "nodejs";
export const maxDuration = 60;

async function resolve(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("file");
  if (!fileId) return { loanFile: null, lead: null };
  const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
  let lead: any = null;
  if (loanFile?.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle(); lead = r.data; }
  return { loanFile, lead };
}

export async function GET(req: NextRequest) {
  const { lead } = await resolve(req);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ screen: lead.raw?.deal_screen || null });
}

export async function POST(req: NextRequest) {
  try {
    const { loanFile, lead } = await resolve(req);
    if (!loanFile || !lead) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    const screen = await runDealScreen(loanFile, lead);
    // cache on the lead
    try {
      const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
      raw.deal_screen = screen;
      await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
    } catch { /* non-fatal */ }
    return NextResponse.json({ screen });
  } catch (e: any) {
    console.error("[los/screen] error:", e);
    return NextResponse.json({ error: e?.message || "Screen failed." }, { status: 500 });
  }
}
