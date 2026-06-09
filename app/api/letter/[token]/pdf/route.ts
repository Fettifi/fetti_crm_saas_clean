// Download a pre-approval letter as a single-page PDF (public, token-gated).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildPreApprovalPdf } from "@/lib/preapprovalPdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: l } = await supabaseAdmin.from("preapprovals").select("*").eq("share_token", token).maybeSingle();
  if (!l) return NextResponse.json({ error: "not found" }, { status: 404 });

  const pdf = await buildPreApprovalPdf(l);
  const safe = (l.borrower_name || "borrower").replace(/[^a-zA-Z0-9]+/g, "-");
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Pre-Approval-${l.letter_number}-${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
