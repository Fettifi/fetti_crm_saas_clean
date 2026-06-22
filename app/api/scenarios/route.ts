// Scenario Desk — list, upsert, and delete loan scenarios. The scenario is the deal
// a loan officer assembles and shops to wholesale lenders for pricing + approval.
// Persistence is delegated entirely to lib/scenarioStore (never touch supabase here).
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import {
  SCENARIO_FIELD_KEYS,
  isNumericField,
  num,
  computeLtv,
  computeDscr,
} from "@/lib/scenario";
import type { Scenario } from "@/lib/scenario";
import {
  listScenarios,
  getScenario,
  saveScenario,
  deleteScenario,
  genId,
  scenarioNumber,
} from "@/lib/scenarioStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scenarios = await listScenarios();
    return NextResponse.json({ scenarios });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const now = new Date().toISOString();

    // Start from the existing record (update) or a fresh draft (create).
    const existing = b.id ? await getScenario(String(b.id)) : null;
    const isCreate = !existing;

    const base: Scenario = existing
      ? { ...existing }
      : {
          id: genId(),
          scenario_number: scenarioNumber(),
          status: "draft",
          quotes: [],
          created_at: now,
          updated_at: now,
        };

    // Whitelist + coerce the writable scenario fields.
    for (const key of SCENARIO_FIELD_KEYS) {
      if (!(key in b)) continue;
      const v = b[key as string];
      (base as any)[key] = isNumericField(String(key)) ? num(v) : v === "" ? null : v;
    }

    // Link + status are writable but live outside the field catalog.
    if ("lead_id" in b) base.lead_id = b.lead_id || null;
    if ("loan_file_id" in b) base.loan_file_id = b.loan_file_id || null;
    if (b.status) base.status = b.status;

    // Recompute derived ratios when not explicitly provided.
    if (base.ltv == null) base.ltv = computeLtv(base);
    if (base.dscr == null) base.dscr = computeDscr(base);

    const scenario = await saveScenario(base);

    try {
      await logActivity({
        entity_type: "scenario",
        entity_id: scenario.id,
        lead_id: scenario.lead_id,
        loan_file_id: scenario.loan_file_id,
        actor: "lo",
        action: isCreate ? "scenario.created" : "scenario.updated",
        detail: {
          scenario_number: scenario.scenario_number,
          borrower: scenario.borrower_name,
          loan_type: scenario.loan_type,
          loan_amount: scenario.loan_amount,
        },
      });
    } catch {}

    return NextResponse.json({ scenario }, { status: isCreate ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteScenario(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
