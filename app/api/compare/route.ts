// Loan comparisons CRUD (persisted in app_settings — no DDL).
//   GET  /api/compare           -> list (newest first)
//   GET  /api/compare?id=ID     -> one comparison
//   POST /api/compare           -> create/update (returns saved)
//   DELETE /api/compare?id=ID   -> delete
// Auth-gated by the /api/compare matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { listComparisons, getComparison, saveComparison, deleteComparison, genId, comparisonNumber, type Comparison, type CompareQuote } from "@/lib/compare";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const c = await getComparison(id);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ comparison: c });
  }
  return NextResponse.json({ comparisons: await listComparisons() });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const now = new Date().toISOString();
    const existing = b.id ? await getComparison(b.id) : null;
    const quotes: CompareQuote[] = Array.isArray(b.quotes)
      ? b.quotes.map((q: any) => ({ ...q, id: q.id || genId() }))
      : (existing?.quotes || []);
    const c: Comparison = {
      id: existing?.id || b.id || genId(),
      number: existing?.number || comparisonNumber(),
      borrowerName: b.borrowerName ?? existing?.borrowerName,
      borrowerEmail: b.borrowerEmail ?? existing?.borrowerEmail,
      leadId: b.leadId ?? existing?.leadId ?? null,
      loanFileId: b.loanFileId ?? existing?.loanFileId ?? null,
      note: b.note ?? existing?.note,
      quotes,
      emailed_to: existing?.emailed_to || [],
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    const saved = await saveComparison(c);
    return NextResponse.json({ ok: true, comparison: saved });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteComparison(id);
  return NextResponse.json({ ok: true });
}
