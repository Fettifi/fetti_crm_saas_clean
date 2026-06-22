import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

// Adjustable loan margin (% Fetti makes per dollar lent), used for dashboard
// earnings projections. Auth-gated via the /api/settings matcher.
//   GET  -> { pct }
//   POST { pct } -> save (0–100)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pct = Number(await getSetting("LOAN_MARGIN_PCT")) || 2.75;
  return NextResponse.json({ pct });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pct = Number(body?.pct);
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: "Enter a margin between 0 and 100." }, { status: 422 });
    }
    await setSetting("LOAN_MARGIN_PCT", String(pct));
    return NextResponse.json({ ok: true, pct });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed." }, { status: 500 });
  }
}
