// Download a pre-approval letter as a single-page PDF (public, token-gated).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildPreApprovalPdf } from "@/lib/preapprovalPdf";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data: l } = await supabaseAdmin.from("preapprovals").select("*").eq("share_token", token).maybeSingle();
  // Match the JSON route: don't serve a void or expired letter as a PDF.
  if (!l || l.status === "void" || (l.expires_on && new Date(l.expires_on) < new Date())) {
    return NextResponse.json({ error: "not found" }, { status: l ? 410 : 404 });
  }

  let extra: any = undefined;
  try { const raw = await getSetting(`PA_TERMS:${l.id}`); if (raw) extra = JSON.parse(raw); } catch { /* terms optional */ }
  const pdf = await buildPreApprovalPdf(l, extra);
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
