import { NextRequest, NextResponse } from "next/server";
import { voidEnvelope } from "@/lib/esign";

// Sender voids an envelope. Auth-gated via the /api/esign/requests matcher.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || "").slice(0, 300) || "Voided by sender";
  const out = await voidEnvelope(token, reason);
  if (!out.ok) {
    return out.reason === "not_found"
      ? NextResponse.json({ error: "not found" }, { status: 404 })
      : NextResponse.json({ error: "Already completed — can't void." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, voided: true });
}
