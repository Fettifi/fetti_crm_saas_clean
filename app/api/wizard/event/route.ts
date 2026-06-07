// Wizard telemetry + live config.
//   POST  -> record one funnel event (start | answer | contact | complete).
//            Fire-and-forget from the browser; powers the Application Coach.
//   GET   -> return the latest LEARNED config the wizard applies (goal order +
//            an optional reassurance tip). This is the feedback half of the loop.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

const EVENTS = new Set(["start", "answer", "contact", "complete"]);

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const session_id = String(b.session_id || "").slice(0, 64);
    const event = String(b.event || "");
    if (!session_id || !EVENTS.has(event)) {
      return NextResponse.json({ ok: false }, { status: 200 }); // never block the UI
    }
    const row = {
      session_id,
      event,
      phase: b.phase ? String(b.phase).slice(0, 16) : null,
      step_id: b.step_id ? String(b.step_id).slice(0, 48) : null,
      step_index: Number.isFinite(b.step_index) ? Math.min(99, Math.max(0, Math.trunc(b.step_index))) : null,
      goal: b.goal ? String(b.goal).slice(0, 24) : null,
      occupancy: b.occupancy ? String(b.occupancy).slice(0, 32) : null,
      product: b.product ? String(b.product).slice(0, 64) : null,
      meta: b.meta && typeof b.meta === "object" ? b.meta : null,
    };
    await supabaseAdmin.from("wizard_events").insert([row]);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("wizard_insights")
      .select("config, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const config = (data?.config as Record<string, unknown>) || {};
    return NextResponse.json(
      { config },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch {
    return NextResponse.json({ config: {} });
  }
}
