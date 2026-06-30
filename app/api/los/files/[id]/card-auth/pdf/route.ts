// Download the signed Credit Card Authorization as a PDF (the document of record).
// Generated ON DEMAND from the encrypted data and streamed — never persisted as a
// PAN-bearing file. Access-logged. Auth-gated via the /api/los matcher.
//   GET /api/los/files/[id]/card-auth/pdf?b=<borrowerIndex>
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { getCardAuths, decryptPan, decryptCvv, cvvLive, blanketAuthText } from "@/lib/cardAuth";
import { buildCardAuthPdf } from "@/lib/cardAuthPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const i = Number(req.nextUrl.searchParams.get("b"));
    if (!(i >= 0)) return NextResponse.json({ error: "borrower index required" }, { status: 400 });
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
    if (!loanFile?.lead_id) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
    const a = getCardAuths(lead)[String(i)];
    if (!a?.panEnc) return NextResponse.json({ error: "No signed authorization on file for this borrower yet." }, { status: 404 });

    const pan = decryptPan(a.panEnc);
    if (!pan) return NextResponse.json({ error: "Could not decrypt the card (missing key)." }, { status: 500 });

    const bytes = await buildCardAuthPdf({
      fileNumber: loanFile.file_number,
      borrowerName: a.borrowerName,
      authText: a.consentText || blanketAuthText(loanFile.file_number, a.amount),
      amount: a.amount,
      cardholder: a.cardholder || "",
      brand: a.brand || "Card",
      pan,
      exp: a.expMonth && a.expYear ? `${a.expMonth}/${a.expYear}` : "",
      cvv: cvvLive(a) ? decryptCvv(a.cvvEnc) : undefined,
      billingZip: a.billingZip || "",
      signature: a.signature || "",
      signedAt: a.signedAt || "",
      signerIp: a.signerIp,
    });

    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: loanFile.lead_id, actor: "lo", action: "card_auth.pdf_generated", detail: { borrowerIndex: i, last4: a.last4 } }).catch(() => {});

    const safe = (a.borrowerName || "borrower").replace(/[^a-z0-9]+/gi, "-");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Credit-Card-Authorization-${safe}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[card-auth/pdf]", e);
    return NextResponse.json({ error: e?.message || "PDF failed." }, { status: 500 });
  }
}
