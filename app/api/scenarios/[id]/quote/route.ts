// Record (or update) a wholesaler's quote on a scenario, and optionally crown the
// winner. Quotes are merged by wholesaler so re-quoting the same lender updates in
// place. Marking a winner clears is_winner on the scenario's other quotes and moves
// the scenario to "won". Persistence goes through scenarioStore only.
import { NextRequest, NextResponse } from "next/server";
import { num, type Quote, type QuoteStatus } from "@/lib/scenario";
import { getScenario, upsertQuote, saveScenario, genId } from "@/lib/scenarioStore";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QUOTE_STATUSES: QuoteStatus[] = ["sent", "quoted", "approved", "declined"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await req.json();

    const wholesaler_id = b?.wholesaler_id ? String(b.wholesaler_id) : "";
    if (!wholesaler_id) {
      return NextResponse.json({ error: "wholesaler_id is required." }, { status: 400 });
    }

    const existing = await getScenario(id);
    if (!existing) return NextResponse.json({ error: "Scenario not found." }, { status: 404 });

    const prior = (existing.quotes || []).find((q) => q.wholesaler_id === wholesaler_id);
    const status: QuoteStatus = QUOTE_STATUSES.includes(b?.status) ? b.status : prior?.status || "quoted";
    const is_winner = b?.is_winner === true;

    // Only overwrite a field when the caller actually supplied it — otherwise keep the
    // prior value. Crowning a winner POSTs just { wholesaler_id, is_winner } and must
    // NOT wipe previously-saved pricing.
    const has = (k: string) => b?.[k] !== undefined && b?.[k] !== null && b?.[k] !== "";
    const keepNum = (k: string) => (has(k) ? num(b[k]) : ((prior as any)?.[k] ?? null));
    const keepStr = (k: string) => (has(k) ? String(b[k]) : ((prior as any)?.[k] ?? null));
    const pricingTouched = ["rate", "points", "lender_fees", "max_ltv", "term", "prepay", "conditions", "notes", "status"].some(has);

    const quote: Quote = {
      id: prior?.id || genId(),
      wholesaler_id,
      wholesaler_company: b?.wholesaler_company ? String(b.wholesaler_company) : prior?.wholesaler_company || "",
      status,
      sent_at: prior?.sent_at ?? null,
      responded_at: pricingTouched ? new Date().toISOString() : (prior?.responded_at ?? null),
      rate: keepNum("rate"),
      points: keepNum("points"),
      lender_fees: keepNum("lender_fees"),
      max_ltv: keepNum("max_ltv"),
      term: keepStr("term"),
      prepay: keepStr("prepay"),
      conditions: keepStr("conditions"),
      notes: keepStr("notes"),
      is_winner,
    };

    let scenario = await upsertQuote(id, quote);
    if (!scenario) return NextResponse.json({ error: "Scenario not found." }, { status: 404 });

    // Crown the winner: clear is_winner on every other quote, mark the scenario "won".
    if (is_winner) {
      scenario = await saveScenario({
        ...scenario,
        status: "won",
        quotes: (scenario.quotes || []).map((q) => ({ ...q, is_winner: q.wholesaler_id === wholesaler_id })),
      });
    }

    try {
      await logActivity({
        entity_type: "scenario", entity_id: scenario.id, lead_id: scenario.lead_id, loan_file_id: scenario.loan_file_id,
        actor: "lo", action: is_winner ? "scenario.quote.won" : "scenario.quote.recorded",
        detail: { scenario_number: scenario.scenario_number, wholesaler_id, company: quote.wholesaler_company, status, rate: quote.rate },
      });
    } catch {}

    return NextResponse.json({ scenario });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
