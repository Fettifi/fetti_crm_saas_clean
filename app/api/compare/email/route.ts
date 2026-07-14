// Email a loan comparison to the borrower with the branded PDF attached, and log it
// to the Conversations inbox + activity. Saves the comparison if it's new.
//   POST /api/compare/email  body: { id? , ...comparison fields, to?, note? }
// Auth-gated via /api/compare matcher.
import { NextRequest, NextResponse } from "next/server";
import { buildComparisonPdf } from "@/lib/comparePdf";
import { getComparison, saveComparison, genId, comparisonNumber, type Comparison, type CompareQuote } from "@/lib/compare";
import { logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { BRAND } from "@/lib/brand";
import { senderFrom } from "@/lib/notify/mailFrom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const now = new Date().toISOString();
    // Resolve to a persisted comparison (load by id, or create from the posted draft).
    let comparison: Comparison | null = b.id ? await getComparison(b.id) : null;
    if (!comparison) {
      const quotes: CompareQuote[] = (Array.isArray(b.quotes) ? b.quotes : []).map((q: any) => ({ ...q, id: q.id || genId() }));
      comparison = {
        id: b.id || genId(), number: b.number || comparisonNumber(),
        borrowerName: b.borrowerName, borrowerEmail: b.borrowerEmail, leadId: b.leadId ?? null, loanFileId: b.loanFileId ?? null,
        note: b.note, quotes, emailed_to: [], created_at: now, updated_at: now,
      };
    }
    if (!comparison.quotes.length) return NextResponse.json({ error: "No quotes to send." }, { status: 400 });

    const to = String(b.to || comparison.borrowerEmail || "").trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: "A valid borrower email is required." }, { status: 400 });

    const key = process.env.RESEND_API_KEY;
    const from = senderFrom();
    if (!key || !from) return NextResponse.json({ error: "Email isn't configured (RESEND_API_KEY / LEAD_RESPONSE_FROM_EMAIL)." }, { status: 503 });

    const bytes = await buildComparisonPdf(comparison);
    const pdfB64 = Buffer.from(bytes).toString("base64");
    const filename = `Fetti-Loan-Comparison-${comparison.number}.pdf`;
    const first = (comparison.borrowerName || "there").split(" ")[0];
    const note = String(b.note ?? comparison.note ?? "").trim();
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
      <p>Hi ${esc(first)},</p>
      <p>Here's a side-by-side comparison of the loan options we put together for you — the full details are in the attached PDF.</p>
      ${note ? `<p>${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
      <p>Take a look and reply with any questions. When you're ready, you can finish your secure application here (about 2 minutes): <a href="${APP_URL}/apply" style="color:#10b981;font-weight:600">${APP_URL}/apply</a></p>
      <p style="margin-top:20px;color:#64748b;font-size:12px">— ${esc(BRAND.company)} · NMLS #${BRAND.nmls}<br>These are estimated loan options for comparison only, based on information available now and subject to change. This is not a commitment to lend, a rate lock, or an approval; final terms depend on a full application, underwriting, and verification. Equal Housing Opportunity.</p>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Your loan options from Fetti Financial Services", html, attachments: [{ filename, content: pdfB64 }] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: j?.message || `Email failed (${res.status})` }, { status: 502 });

    // Persist + record.
    comparison.borrowerEmail = comparison.borrowerEmail || to;
    comparison.emailed_to = Array.from(new Set([...(comparison.emailed_to || []), to]));
    if (note) comparison.note = note;
    await saveComparison(comparison);

    const summary = `Sent loan comparison ${comparison.number} (${comparison.quotes.length} option${comparison.quotes.length === 1 ? "" : "s"})${note ? ` — ${note}` : ""}`;
    if (comparison.leadId) {
      await logComms({ leadId: comparison.leadId, loanFileId: comparison.loanFileId, channel: "email", direction: "outbound", type: "comparison", subject: "Your loan options from Fetti Financial Services", body: summary, to, providerId: (j as any)?.id, actor: "lo" }).catch(() => {});
    }
    await logActivity({ entity_type: "comparison", entity_id: comparison.id, lead_id: comparison.leadId || null, loan_file_id: comparison.loanFileId || null, actor: "lo", action: "comparison.emailed", detail: { to, number: comparison.number, quotes: comparison.quotes.length } }).catch(() => {});

    return NextResponse.json({ ok: true, sent: to, comparison });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send failed" }, { status: 500 });
  }
}
