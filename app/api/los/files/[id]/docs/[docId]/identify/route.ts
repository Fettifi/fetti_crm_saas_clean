// IDENTIFY AN UPLOADED DOCUMENT AND LABEL IT FOR WHAT IT IS.
//
// Ramon, 2026-09-12: "create a tool in the document upload section that you read what the
// document actually is and label it for what it is so I don't have to. And it's accurate."
//
// POST /api/los/files/:id/docs/:docId/identify
//   { apply?: boolean }   apply defaults TRUE; pass false for a look-without-touching preview.
//
// The rules about what may be renamed live in lib/identifyAndLabel.ts, which the borrower's own
// upload path calls too — one copy, so the staff action and the borrower action can never drift.
import { NextRequest, NextResponse } from "next/server";
import { applyIdentification } from "@/lib/identifyAndLabel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  try {
    const body = await req.json().catch(() => ({} as any));
    const r = await applyIdentification(id, docId, { apply: body?.apply !== false, actor: "lo" });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: /not found/.test(r.error) ? 404 : 500 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
