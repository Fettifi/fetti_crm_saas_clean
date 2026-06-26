// Email the borrower's income summary (PDF attached) straight from the loan file.
// Always sends the BORROWER-facing copy (no internal flags), regardless of audience.
// POST body: { result, comparison, qualification, borrowersNote, loanType, borrowerName?, fileNumber?, to? }.
// Auth-gated via the /api/los matcher.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildIncomeWorksheetPdf, type WorksheetData } from "@/lib/incomePdf";
import { logActivity } from "@/lib/activity";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const maxDuration = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (!body?.result?.lines) return NextResponse.json({ error: "Run income verification first." }, { status: 400 });

    const { data: f } = await supabaseAdmin
      .from("loan_files").select("borrower_name, file_number, email, lead_id").eq("id", id).maybeSingle();
    if (!f) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });

    // Recipient: an explicit override, else the file's borrower email, else the lead's.
    let to = (typeof body.to === "string" ? body.to.trim().toLowerCase() : "") || String(f.email || "").toLowerCase();
    if (!to && f.lead_id) {
      const { data: lead } = await supabaseAdmin.from("leads").select("email").eq("id", f.lead_id).maybeSingle();
      to = String(lead?.email || "").toLowerCase();
    }
    if (!EMAIL_RE.test(to)) {
      return NextResponse.json({ error: "No valid borrower email on file — add one to the lead, or type a recipient." }, { status: 400 });
    }

    const data: WorksheetData = {
      borrowerName: body.borrowerName || f.borrower_name || "Borrower",
      fileNumber: body.fileNumber || f.file_number || undefined,
      date: new Date().toISOString().slice(0, 10),
      loanType: body.loanType,
      audience: "borrower", // never leak internal flags to the borrower
      result: body.result,
      qualification: body.qualification,
      comparison: body.comparison,
      borrowersNote: body.borrowersNote,
    };
    const bytes = await buildIncomeWorksheetPdf(data);

    const key = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_RESPONSE_FROM_EMAIL; // e.g. "Fetti Financial <hello@fettifi.com>"
    if (!key || !from) {
      return NextResponse.json({ error: "Email isn't configured on the server (RESEND_API_KEY / LEAD_RESPONSE_FROM_EMAIL)." }, { status: 503 });
    }

    const firstName = (data.borrowerName || "").split(" ")[0] || "there";
    const monthly = Math.round(body.result?.monthlyTotal || 0);
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">` +
      `Hi ${firstName},<br><br>` +
      `Attached is your income summary from ${BRAND.company}${monthly ? ` — your qualifying income works out to about <strong>$${monthly.toLocaleString()}/mo</strong>` : ""}. ` +
      `It shows the loan amount and monthly payment you can qualify for. Just reply to this email with any questions and we'll help you take the next step.<br><br>` +
      `— ${BRAND.company} · NMLS #${BRAND.nmls}` +
      `</div>`;
    const safe = (data.borrowerName || "borrower").replace(/[^a-z0-9]+/gi, "-");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: "Your Fetti income summary",
        html,
        attachments: [{ filename: `Income-Summary-${safe}.pdf`, content: Buffer.from(bytes).toString("base64") }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: "Email send failed." + (t ? ` (${t.slice(0, 140)})` : "") }, { status: 502 });
    }

    await logActivity({
      entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: f.lead_id,
      actor: "lo", action: "income.summary.emailed", detail: { to, monthlyIncome: monthly },
    }).catch(() => {});

    return NextResponse.json({ ok: true, to });
  } catch (e: any) {
    console.error("[los/income-worksheet/email]", e);
    return NextResponse.json({ error: e?.message || "Email failed." }, { status: 500 });
  }
}
