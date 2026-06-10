import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, computeLoanMetrics } from "@/lib/urla";
import { buildMismo34 } from "@/lib/mismo";
import { getLenders } from "@/lib/pricing/lenders";
import { logActivity } from "@/lib/activity";

// Submit a loan file to a chosen wholesale lender: build the MISMO 3.4 file and
// email it to the lender's submission address (with a borrower/loan summary).
// Auth-gated via the /api/los matcher.  POST /api/los/submit { file, lenderId }
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { file: fileId, lenderId } = await req.json();
    if (!fileId || !lenderId) return NextResponse.json({ error: "file and lenderId required." }, { status: 400 });

    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
    if (!loanFile?.lead_id) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    const lenders = await getLenders();
    const lender = lenders.find((l) => l.id === lenderId);
    if (!lender) return NextResponse.json({ error: "Lender not found in your directory." }, { status: 404 });
    if (!lender.submissionEmail) {
      return NextResponse.json({ error: `No submission email on file for ${lender.name}. Add one, or use their portal: ${lender.portalUrl || "(no portal set)"}`, portalUrl: lender.portalUrl }, { status: 422 });
    }

    const urla = assembleUrla(lead, loanFile);
    const metrics = computeLoanMetrics(urla);
    const xml = buildMismo34(urla);
    const b = urla.borrowers[0] || {};
    const fname = `${(loanFile.file_number || "loan")}_MISMO_3.4.xml`;

    const RESEND = process.env.RESEND_API_KEY;
    if (!RESEND) return NextResponse.json({ error: "Email not configured (RESEND_API_KEY)." }, { status: 503 });
    const from = process.env.LEAD_RESPONSE_FROM_EMAIL || "Fetti Financial Services <files@fettifi.com>";
    const html = `<p>New loan submission from <b>Fetti Financial Services LLC</b> (NMLS #2267023).</p>
<ul>
<li><b>Borrower:</b> ${b.fullName || `${b.firstName || ""} ${b.lastName || ""}`}</li>
<li><b>Loan:</b> ${urla.loan.productDescription || urla.loan.purpose || ""} ${urla.loan.loanType || ""} — $${(urla.loan.amount || 0).toLocaleString()}</li>
<li><b>Property:</b> ${[urla.property.address?.street, urla.property.address?.city, urla.property.address?.state].filter(Boolean).join(", ")}</li>
<li><b>Value:</b> $${(metrics.value || 0).toLocaleString()} · <b>LTV:</b> ${metrics.ltv ?? "—"}% · ${metrics.isInvestment ? `<b>DSCR:</b> ${metrics.dscr ?? "—"}` : `<b>DTI:</b> ${metrics.backDti ?? "—"}%`}</li>
<li><b>Credit:</b> ${(lead.credit_score || urla.borrowers[0] ? lead.credit_score : "") || "see file"}</li>
</ul>
<p>The MISMO 3.4 (DU) file is attached. Loan officer: Ramon Dent, NMLS #2235992 · ramon@fettifi.com.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
      body: JSON.stringify({
        from,
        to: [lender.submissionEmail],
        ...(lender.aeEmail && lender.aeEmail !== lender.submissionEmail ? { cc: [lender.aeEmail] } : {}),
        reply_to: "ramon@fettifi.com",
        subject: `New submission: ${b.lastName || lead.full_name || "Borrower"} — ${urla.loan.loanType || urla.loan.purpose || "Loan"} $${(urla.loan.amount || 0).toLocaleString()}`,
        html,
        attachments: [{ filename: fname, content: Buffer.from(xml).toString("base64") }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.message || `Resend ${res.status}`);

    await logActivity({
      entity_type: "loan_file", entity_id: fileId, loan_file_id: fileId, lead_id: lead.id,
      actor: "loan_officer", action: "file.submitted",
      detail: { lender: lender.name, to: lender.submissionEmail, file_number: loanFile.file_number },
    }).catch(() => {});

    return NextResponse.json({ ok: true, lender: lender.name, to: lender.submissionEmail });
  } catch (e: any) {
    console.error("[los/submit] error:", e);
    return NextResponse.json({ error: e?.message || "Submit failed." }, { status: 500 });
  }
}
