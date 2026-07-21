// Title/Escrow order-opening sheet for a loan file. GET → prefilled branded PDF
// (download); POST { toCompany, toContact, toEmail, ... } → email it to the title
// company with the PDF attached, reply-to ramon@fettifi.com, logged to the file.
// Auth-gated by the /api/los matcher.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildTitleOrderPdf, type TitleOrderData } from "@/lib/titleOrderPdf";
import { assembleUrla } from "@/lib/urla";
import { logActivity } from "@/lib/activity";
import { logComms } from "@/lib/comms";
import { senderFrom } from "@/lib/notify/mailFrom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function transactionFrom(s: string): "Purchase" | "Refinance" | "Cash-out refinance" | null {
  if (/cash.?out/i.test(s)) return "Cash-out refinance";
  if (/refi/i.test(s)) return "Refinance";
  if (/purchase/i.test(s)) return "Purchase";
  return null;
}

// Build the order from the SAME structured 1003 (assembleUrla) the LOS/MISMO use — so the
// transaction type, lien position, value and loan amount match the underwrite exactly,
// instead of being guessed from the product string (which mislabeled every non-purchase).
async function dataFor(id: string, overrides: Partial<TitleOrderData>): Promise<{ d: TitleOrderData; lf: any } | null> {
  const { data: lf } = await supabaseAdmin.from("loan_files")
    .select("id, file_number, borrower_name, email, phone, product, property_address, property_value, loan_amount, state, lead_id")
    .eq("id", id).maybeSingle();
  if (!lf) return null;
  let lead: any = null;
  if ((lf as any).lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", (lf as any).lead_id).maybeSingle(); lead = r.data; }
  const urla = assembleUrla(lead || {
    property_value: (lf as any).property_value, loan_amount_requested: (lf as any).loan_amount,
    property_address: (lf as any).property_address, loan_purpose: (lf as any).product, state: (lf as any).state,
  }, lf);
  const loan = urla.loan || {}; const prop = urla.property || {};
  // purpose from the structured 1003 first, then the product label as a fallback.
  const transaction = transactionFrom(String(loan.purpose || "")) || transactionFrom(String((lf as any).product || "")) || "Purchase";
  const lienPosition = Number(loan.lienPosition) === 2 ? 2 : 1;
  const d: TitleOrderData = {
    transaction,
    lienPosition,
    loanProduct: (lf as any).product || loan.productDescription || undefined,
    interestOnly: !!loan.interestOnly,
    propertyAddress: (lf as any).property_address || [prop.address?.street, prop.address?.city, prop.address?.state, prop.address?.zip].filter(Boolean).join(", ") || "",
    borrowers: (lf as any).borrower_name || urla.borrowers?.[0]?.fullName || "",
    borrowerPhone: (lf as any).phone, borrowerEmail: (lf as any).email,
    purchasePrice: prop.presentValue ?? (lf as any).property_value, loanAmount: loan.amount ?? (lf as any).loan_amount,
    fileNumber: (lf as any).file_number,
    ...overrides,
  };
  return { d, lf };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  const r = await dataFor(id, {
    toCompany: q.get("company") || undefined, toContact: q.get("contact") || undefined,
    toEmail: q.get("email") || undefined, toPhone: q.get("phone") || undefined,
    estClosing: q.get("closing") || undefined, notes: q.get("notes") || undefined,
    lenderLoanNumber: q.get("lenderLoan") || undefined, mortgageeClause: q.get("clause") || undefined,
  });
  if (!r) return NextResponse.json({ error: "Loan file not found" }, { status: 404 });
  // ?report=1 → the resolved order fields as JSON (what the sheet/email will say) — for a
  // quick "is this right?" check before sending, and for debugging the 1003→order mapping.
  if (q.get("report") === "1") return NextResponse.json({ order: r.d });
  const pdf = await buildTitleOrderPdf(r.d);
  return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Fetti-Title-Order-${r.d.fileNumber || id.slice(0, 6)}.pdf"` } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const toEmail = String(b.toEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return NextResponse.json({ error: "A valid title-company email is required." }, { status: 400 });
  const key = process.env.RESEND_API_KEY, from = senderFrom();
  if (!key || !from) return NextResponse.json({ error: "Email isn't configured." }, { status: 503 });
  const r = await dataFor(id, b);
  if (!r) return NextResponse.json({ error: "Loan file not found" }, { status: 404 });
  const pdf = await buildTitleOrderPdf(r.d);
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
    <p>Hi ${r.d.toContact ? String(r.d.toContact).split(" ")[0] : "there"},</p>
    <p>Please open a ${String(r.d.transaction || "purchase").toLowerCase()} order for <b>${r.d.propertyAddress || "the attached property"}</b> — the full order-opening sheet is attached, including everything we need back (order #, wire instructions, prelim, fee quote, CPL).</p>
    <p>Reply directly to this email and it comes straight to me.</p>
    <p style="margin-top:16px">Ramon Dent<br>Fetti Financial Services LLC · NMLS #2267023<br>ramon@fettifi.com · +1 424.675.6295</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [toEmail], reply_to: ["ramon@fettifi.com"], subject: `Order opening request — ${r.d.propertyAddress || r.d.fileNumber || "new file"} (Fetti Financial)`, html, attachments: [{ filename: `Fetti-Title-Order-${r.d.fileNumber || id.slice(0, 6)}.pdf`, content: Buffer.from(pdf).toString("base64") }] }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) return NextResponse.json({ error: j?.message || `Email failed (${res.status})` }, { status: 502 });
  if ((r.lf as any).lead_id) await logComms({ leadId: (r.lf as any).lead_id, channel: "email", direction: "outbound", type: "title_order", body: `Title/escrow order opening sent to ${toEmail} (${r.d.toCompany || "title co."})`, to: toEmail, providerId: j?.id }).catch(() => {});
  await logActivity({ entity_type: "loan_file", entity_id: id, lead_id: (r.lf as any).lead_id || undefined, actor: "lo", action: "title.order_sent", detail: { to: toEmail, company: r.d.toCompany } });
  return NextResponse.json({ ok: true });
}
