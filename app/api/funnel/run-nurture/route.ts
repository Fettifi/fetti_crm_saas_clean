import { NextResponse } from "next/server";
import { runNurture } from "@/lib/nurture";

// Authed manual trigger for the follow-up engine, so an LO can run the drip on
// demand from the Funnel page and SEE the result (considered / sent). Gated by
// the /api/funnel/:path* matcher (session required) — same as the funnel view.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const r = await runNurture();
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    console.error("[funnel/run-nurture] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Run failed." }, { status: 500 });
  }
}
