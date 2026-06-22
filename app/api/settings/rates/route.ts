import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/settings";
import { loadRateModel } from "@/lib/rateModelServer";
import { RATE_MODEL_DEFAULTS, validateRateModel } from "@/lib/rateEstimator";

// Editable Quick Pricer rate model (base rates + LLPA-style adjustments).
// Auth-gated via the /api/settings matcher in proxy.ts (same as margin).
//   GET  -> the live model (admin-edited or defaults)
//   POST { model } -> validate + save (stamps asOf = today so the "as of" badge
//                     can't go stale silently)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const model = await loadRateModel();
  return NextResponse.json({ model });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const incoming = body?.model ?? body;
    const err = validateRateModel(incoming);
    if (err) return NextResponse.json({ error: err }, { status: 422 });

    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short" });
    const model = {
      ...RATE_MODEL_DEFAULTS,
      ...incoming,
      _meta: { ...RATE_MODEL_DEFAULTS._meta, ...(incoming._meta || {}), asOf: today },
    };
    await setSetting("PRICER_RATE_MODEL", JSON.stringify(model));
    return NextResponse.json({ ok: true, model });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed." }, { status: 500 });
  }
}
