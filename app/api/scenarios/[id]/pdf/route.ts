import { NextRequest, NextResponse } from "next/server";
import { getScenario } from "@/lib/scenarioStore";
import { buildScenarioPdf } from "@/lib/scenarioPdf";

// Scenario Desk PDF — the lender-facing one-pager for a deal. Built fresh on each
// request from the stored scenario so it always reflects the latest edits + quotes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scenario = await getScenario(id);
    if (!scenario) return NextResponse.json({ error: "Scenario not found." }, { status: 404 });

    const bytes = await buildScenarioPdf(scenario);
    const name = `Scenario-${scenario.scenario_number}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch (e: any) {
    console.error("[api/scenarios/[id]/pdf]", e);
    return NextResponse.json({ error: e?.message || "PDF failed." }, { status: 500 });
  }
}
