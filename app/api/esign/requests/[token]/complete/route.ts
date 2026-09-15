import { NextRequest, NextResponse } from "next/server";
import { completeWithSignaturesCollected } from "@/lib/esign";

// Sender completes an envelope with the signatures already collected and issues the Certificate
// of Completion. Auth-gated via the /api/esign/requests matcher.
//   POST { reason? } — the note printed on the certificate as the sender's (omitted if blank)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const out = await completeWithSignaturesCollected(token, String(body?.reason || ""));
    if (!out.ok) {
      const refusal: Record<typeof out.reason, [number, string]> = {
        not_found: [404, "not found"],
        voided: [409, "This envelope was voided — it can't be completed."],
        declined: [409, "A signer declined this envelope — it can't be completed."],
        nothing_signed: [422, "Nobody has signed this envelope yet, so there is nothing to certify. Void it instead."],
        changed: [409, "A signer acted on this envelope while it was being completed. Nothing was changed — refresh to see where it stands, then try again."],
      };
      const [status, error] = refusal[out.reason];
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({
      ok: true, completed: true, alreadyCompleted: out.alreadyCompleted,
      signed: out.env.closed_by_sender?.signed ?? null,
      not_signed: out.env.closed_by_sender?.not_signed ?? null,
      warning: out.warning ?? null,
    });
  } catch (e: any) {
    console.error("[esign/complete] error:", e);
    return NextResponse.json({ error: e?.message || "Couldn't complete the envelope." }, { status: 500 });
  }
}
