// Closing-cost estimate for the Quick Pricer. POST the deal → LE-shaped breakdown.
// ZIP resolves to state/county/tax/insurance server-side (lib/propertyData), lender
// fees merge from the CLOSING_COST_MODEL app_setting over DEFAULT_MODEL, and the
// engine (lib/closingCosts) does the deterministic math. Auth-gated by the
// /api/pricer matcher in proxy.ts (internal sales tool).
import { NextRequest, NextResponse } from "next/server";
import { estimateClosingCosts, type ClosingCostInput, type LoanType, type Purpose } from "@/lib/closingCosts";
import { resolveLocation } from "@/lib/propertyData";
import { zipToState, PROPERTY_TAX_RATE, INSURANCE_RATE } from "@/lib/pricer";
import { cfg } from "@/lib/settings";

export const runtime = "nodejs";

const LOAN_TYPES = new Set(["conventional", "fha", "va", "usda", "dscr", "bank_statement", "bridge"]);
const PURPOSES = new Set(["purchase", "refi", "cashout"]);
// Pricer purpose ids ("rateTerm"/"cashOut") → engine purposes.
function mapPurpose(p: any): "purchase" | "refi" | "cashout" {
  const v = String(p || "");
  if (v === "cashOut" || v.toLowerCase() === "cashout") return "cashout";
  if (v === "rateTerm" || v === "refi") return "refi";
  return "purchase";
}


export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const price = Number(b.price) || 0;
    const loanAmount = Number(b.loanAmount) || 0;
    if (price <= 0 || loanAmount <= 0) return NextResponse.json({ error: "price and loanAmount are required" }, { status: 400 });

    const zip = String(b.zip || "").replace(/\D/g, "").slice(0, 5);
    const loc = zip.length === 5 ? resolveLocation(zip) : null;
    const state = String(b.state || loc?.state || zipToState(zip) || "").toUpperCase().slice(0, 2);
    if (!state) return NextResponse.json({ error: "Couldn't resolve the state — enter a valid ZIP" }, { status: 400 });

    // Only trust ZIP-derived county/tax when the ZIP's state matches the chosen
    // state (a manual state override must not import LA city taxes into a TX quote).
    const useLoc = !!loc?.state && state === loc.state;
    const taxRatePct = Number(b.taxRatePct) || (useLoc ? loc!.taxRatePct : 0) || PROPERTY_TAX_RATE[state] || 1.1;
    const insAnnual = Number(b.insAnnual)
      || (useLoc && (loc as any)?.insRatePct ? price * ((loc as any).insRatePct / 100) : 0)
      || Math.max(900, price * ((INSURANCE_RATE[state] ?? 0.5) / 100));

    // Owner-editable lender-fee model (no redeploy): CLOSING_COST_MODEL app_setting.
    let model: any = {};
    try { model = JSON.parse((await cfg("CLOSING_COST_MODEL")) || "{}"); } catch { model = {}; }

    // Accept both engine types and the pricer screen's ids ("conv30", "fha30"…).
    const rawLt = String(b.loanType || "conventional");
    const lt: LoanType = LOAN_TYPES.has(rawLt) ? (rawLt as LoanType)
      : rawLt.startsWith("fha") ? "fha" : rawLt.startsWith("va") ? "va" : rawLt.startsWith("usda") ? "usda"
      : rawLt.startsWith("dscr") ? "dscr" : (rawLt.startsWith("bank") || rawLt.startsWith("nonqm")) ? "bank_statement"
      : (rawLt.startsWith("bridge") || rawLt.startsWith("hard")) ? "bridge" : "conventional";
    const input: ClosingCostInput = {
      zip, state,
      countyFips: useLoc ? loc?.countyFips ?? null : null,
      countyName: useLoc ? loc?.countyName ?? null : null,
      price, loanAmount,
      loanType: lt,
      purpose: mapPurpose(b.purpose),
      ratePct: Number(b.ratePct) || 7,
      taxRatePct, insAnnual,
      pointsPct: Number(b.pointsPct) || 0,
      originationPct: b.originationPct != null && b.originationPct !== "" ? Number(b.originationPct) : undefined,
      sellerCredit: Number(b.sellerCredit) || 0,
      lenderCredit: Number(b.lenderCredit) || 0,
      escrowWaived: b.escrowWaived === true,
      ownersTitle: b.ownersTitle === true,
      vaFirstUse: b.vaFirstUse !== false,
      vaExempt: b.vaExempt === true,
      financeGovFee: b.financeGovFee !== false,
      closingDay: Number(b.closingDay) || undefined,
      model,
    };
    const result = estimateClosingCosts(input);
    return NextResponse.json({ ok: true, ...result, inputs: { state, taxRatePct, insAnnual, county: useLoc ? loc?.countyName ?? null : null } });
  } catch (e: any) {
    console.error("[pricer/closing-costs]", e?.message || e);
    return NextResponse.json({ error: "estimate failed" }, { status: 500 });
  }
}
