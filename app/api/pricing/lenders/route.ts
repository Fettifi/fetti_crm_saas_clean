import { NextRequest, NextResponse } from "next/server";
import { getLenders, upsertLender, removeLender } from "@/lib/pricing/lenders";

// Wholesale lender directory CRUD. Auth-gated via the /api/pricing matcher.
//   GET    /api/pricing/lenders            -> { lenders }
//   POST   /api/pricing/lenders { lender } -> upsert
//   DELETE /api/pricing/lenders?id=<id>    -> remove
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ lenders: await getLenders() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.lender?.name) return NextResponse.json({ error: "Lender name required." }, { status: 400 });
    const lender = await upsertLender(body.lender);
    return NextResponse.json({ ok: true, lender });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await removeLender(id);
  return NextResponse.json({ ok: true });
}
