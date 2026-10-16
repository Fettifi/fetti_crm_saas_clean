// Download a pre-approval letter as a single-page PDF (public, token-gated).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildPreApprovalPdf } from "@/lib/preapprovalPdf";
import { getSetting } from "@/lib/settings";
import { isLetterGone } from "@/lib/preapprovalExpiry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data: l } = await supabaseAdmin.from("preapprovals").select("*").eq("share_token", token).maybeSingle();
  // THIS ROUTE KILLED THE LINK 30h59m59s EARLY — 111,599 seconds, measured, not estimated. It
  // claimed to match the JSON route and did not: `new Date("2026-10-20")` is UTC midnight, which
  // is 2026-10-19 17:00 Pacific, so the download
  // 410'd at 5pm on the day BEFORE the date the letter prints as "valid through" — while the JSON
  // route and the web page, both already using end of day Pacific, served the same letter as live.
  // One share token, three answers. The predicate now lives in ONE place for every reader surface;
  // see lib/preapprovalExpiry.ts for why the boundary is end of day Pacific and never longer.
  if (isLetterGone(l)) {
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
