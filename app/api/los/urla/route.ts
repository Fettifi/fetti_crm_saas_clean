import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, urlaCompleteness } from "@/lib/urla";
import { encryptUrlaSsns } from "@/lib/crypto";

// Structured 1003 (URLA) load + save. Auth-gated via the /api/los matcher.
//   GET  /api/los/urla?file=<id> | ?lead=<id>   -> { urla } (full, for the LO to edit)
//   POST /api/los/urla?file=<id> | ?lead=<id>   body { urla } -> saves to leads.raw.urla
export const runtime = "nodejs";

async function resolve(req: NextRequest) {
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
  return { lead, loanFile };
}

export async function GET(req: NextRequest) {
  const { lead, loanFile } = await resolve(req);
  if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  const urla = assembleUrla(lead, loanFile);
  return NextResponse.json({ urla, completeness: urlaCompleteness(urla) });
}

export async function POST(req: NextRequest) {
  try {
    const { lead, loanFile } = await resolve(req);
    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    const body = await req.json();
    const incoming = body?.urla;
    if (!incoming || typeof incoming !== "object") {
      return NextResponse.json({ error: "Missing urla object." }, { status: 400 });
    }
    // Concurrency-safe write: lead.raw was selected in resolve() above. Re-read the
    // freshest raw and replace ONLY the urla key so a concurrent raw.* writer (extract
    // auto-fill, qualify/shield crons) isn't reverted by round-tripping a stale blob.
    const { data: freshLead } = await supabaseAdmin.from("leads").select("raw").eq("id", lead.id).maybeSingle();
    const raw = ((freshLead as any)?.raw && typeof (freshLead as any).raw === "object"
      ? (freshLead as any).raw
      : (lead.raw && typeof lead.raw === "object" ? lead.raw : {})) as any;
    raw.urla = encryptUrlaSsns(incoming); // SSN encrypted at rest (app-layer)
    const { error } = await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
    if (error) throw new Error(error.message);

    // Mirror a few first-class columns so list views stay accurate.
    const b = incoming.borrowers?.[0] || {};
    const patch: any = {};
    if (incoming.loan?.amount) patch.loan_amount_requested = incoming.loan.amount;
    if (b.income?.total) patch.income = b.income.total;
    if (Object.keys(patch).length) await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);

    const merged = assembleUrla({ ...lead, raw }, loanFile);
    return NextResponse.json({ ok: true, completeness: urlaCompleteness(merged) });
  } catch (e: any) {
    console.error("[los/urla] save error:", e);
    return NextResponse.json({ error: e?.message || "Save failed." }, { status: 500 });
  }
}
