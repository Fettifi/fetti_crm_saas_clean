import { NextRequest, NextResponse } from "next/server";
import { getAdapter } from "@/lib/pricing/adapters";
import { clearLender, addProducts } from "@/lib/pricing/compare";

// Pull live products from a channel and replace that channel's rows in the
// pricing_products store (clearLender + addProducts, so a re-sync never
// duplicates and AI-parsed sheets from other lenders are untouched).
// Auth-gated via the /api/pricing matcher in proxy.ts (Next 16 middleware).
//
// PARKED: no channel is configured today (Fetti stayed on rate-sheet ingest),
// so fetchProducts() returns "not_configured" and nothing is written. Before a
// channel is ever turned on, gate this write on a verified dry-run test
// (testConnection() ok + non-null sample) so placeholder field maps can't
// persist mis-mapped rows.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const channel = b.channel || "optimalblue";
    const adapter = getAdapter(channel);
    if (!adapter) return NextResponse.json({ error: `unknown channel "${channel}"` }, { status: 400 });

    const res = await adapter.fetchProducts();
    if (res.status !== "ok") {
      const code = res.status === "not_configured" ? 400 : 502;
      return NextResponse.json({ added: 0, status: res.status, detail: res.detail }, { status: code });
    }

    const lenderId = res.lenderId || channel;
    await clearLender(lenderId);
    await addProducts(res.products);
    return NextResponse.json({ added: res.products.length, status: "ok", detail: res.detail, lenderId });
  } catch (e: any) {
    console.error("[api/pricing/sync] error");
    return NextResponse.json({ error: e?.message || "sync failed" }, { status: 500 });
  }
}
