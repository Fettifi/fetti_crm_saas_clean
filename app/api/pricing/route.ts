import { NextRequest, NextResponse } from "next/server";
import { getProducts, lenderSummary, clearLender, compare, type Scenario } from "@/lib/pricing/compare";

// Pricing comparison API. Auth-gated via the /api/pricing matcher.
//   GET  /api/pricing                       -> { lenders, total }
//   POST /api/pricing { action:"compare", scenario }  -> ranked results
//   POST /api/pricing { action:"clear", lenderId }     -> remove a lender's sheet
export const runtime = "nodejs";

export async function GET() {
  const products = await getProducts();
  return NextResponse.json({ lenders: lenderSummary(products), total: products.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.action === "clear" && body.lenderId) {
      await clearLender(body.lenderId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "compare") {
      const products = await getProducts();
      const { results, filtered } = compare(products, (body.scenario || {}) as Scenario);
      return NextResponse.json({ results, filtered, lenders: lenderSummary(products).length });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}
