// Shop a scenario to selected wholesalers: build the PDF once, email it to each
// selected wholesaler, and record a "sent" quote per recipient so the desk can
// track responses. Flips a fresh draft into "shopping". Persistence goes through
// scenarioStore only — never touch supabase directly for scenarios/wholesalers.
import { NextRequest, NextResponse } from "next/server";
import { genId, getScenario, listWholesalers, saveScenario, upsertQuote } from "@/lib/scenarioStore";
import { buildScenarioPdf } from "@/lib/scenarioPdf";
import { sendScenarioToWholesalers } from "@/lib/notify/sendScenario";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scenario = await getScenario(id);
    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.wholesaler_ids)
      ? body.wholesaler_ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (!ids.length) return NextResponse.json({ error: "wholesaler_ids is required" }, { status: 400 });

    const all = await listWholesalers();
    const idSet = new Set(ids);
    const selected = all.filter((w) => idSet.has(w.id));
    if (!selected.length) return NextResponse.json({ error: "No matching wholesalers" }, { status: 400 });

    // Build the PDF once and email all recipients in a single pass.
    const pdf = await buildScenarioPdf(scenario);
    const sent = await sendScenarioToWholesalers(scenario, pdf, selected);

    // Record a "sent" quote per selected wholesaler.
    const now = new Date().toISOString();
    for (const w of selected) {
      await upsertQuote(scenario.id, {
        id: genId(),
        wholesaler_id: w.id,
        wholesaler_company: w.company,
        status: "sent",
        sent_at: now,
      });
    }

    // Re-read so the returned scenario carries the new quotes; flip draft -> shopping.
    let saved = (await getScenario(scenario.id)) || scenario;
    if (saved.status === "draft") {
      saved = await saveScenario({ ...saved, status: "shopping" });
    }

    try {
      await logActivity({
        entity_type: "scenario", entity_id: saved.id,
        lead_id: saved.lead_id, loan_file_id: saved.loan_file_id,
        actor: "lo", action: "scenario.sent",
        detail: { scenario_number: saved.scenario_number, wholesalers: selected.map((w) => w.company), sent },
      });
    } catch (e) { console.warn("[scenario.send] activity log failed:", e); }

    return NextResponse.json({ sent, scenario: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
