// The Writers' Room API — "Ray & Mark — We Do Money" episode engine.
//   GET  /api/show          -> { episodes, ledger, concepts }  (library + state)
//   GET  /api/show?id=ID     -> { episode }
//   POST /api/show           -> generate a new in-canon episode { brief?, concept? }
//   DELETE /api/show?id=ID    -> delete
// Auth-gated by the /api/show matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { listEpisodes, getEpisode, generateEpisode, deleteEpisode, getLedger, conceptList } from "@/lib/show/writersRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const episode = await getEpisode(id);
    if (!episode) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ episode });
  }
  const [episodes, ledger] = await Promise.all([listEpisodes(), getLedger()]);
  return NextResponse.json({ episodes, ledger, concepts: conceptList() });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const episode = await generateEpisode({ brief: b.brief, concept: b.concept });
    return NextResponse.json({ ok: true, episode });
  } catch (e: any) {
    const msg = e?.message || "generation failed";
    const status = /ANTHROPIC_API_KEY/.test(msg) ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteEpisode(id);
  return NextResponse.json({ ok: true });
}
