// Closing-cost estimate for the Quick Pricer. POST the deal → LE-shaped breakdown.
// ZIP resolves to state/county/tax/insurance server-side (lib/propertyData), lender
// fees merge from the CLOSING_COST_MODEL app_setting over DEFAULT_MODEL, and the
// engine (lib/closingCosts) does the deterministic math. Auth-gated by the
// /api/pricer matcher in proxy.ts (internal sales tool).
import { NextRequest, NextResponse } from "next/server";
import { estimateClosingCosts, sanitizeOverrides, type ClosingCostInput, type LoanType, type Purpose } from "@/lib/closingCosts";
import { resolveLocation } from "@/lib/propertyData";
import { zipToState, PROPERTY_TAX_RATE, INSURANCE_RATE } from "@/lib/pricer";
import { dvExemption } from "@/lib/vaPropertyTax";
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
    // A STATED ZERO IS A FIGURE — the same rule lib/pricer.ts:189 already enforces, and this route
    // did not. `Number(b.taxRatePct) || …` is a TRUTHINESS chain, so a posted 0 was falsy and got
    // replaced by the ZIP or state rate. Measured before the fix: posting 0 for a Michigan quote
    // came back 1.38%, which put a full 3-month tax impound ($2,415 of cash to close) back onto a
    // property whose taxes are exempt — while the PITIA above it correctly showed no tax. The
    // screen contradicted itself and the borrower's cash to close was wrong.
    // This is the Number(cfg()) || default bug: a legitimate 0 and "not supplied" are different
    // facts, and only an explicit null/finite test can tell them apart.
    const statedNum = (v: unknown) => v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
    const taxRatePct = statedNum(b.taxRatePct)
      ? Number(b.taxRatePct)
      : ((useLoc ? loc!.taxRatePct : 0) || PROPERTY_TAX_RATE[state] || 1.1);
    // Same stated-zero rule as the tax rate above. Leaving this on the truthiness chain while
    // fixing only the line above would have been a half-fix: a self-insured or seller-paid-premium
    // scenario posting $0 was silently given a fabricated premium (floor $900), so the quote
    // charged insurance the borrower had told us they do not pay.
    const insAnnual = statedNum(b.insAnnual)
      ? Number(b.insAnnual)
      : ((useLoc && (loc as any)?.insRatePct ? price * ((loc as any).insRatePct / 100) : 0)
        || Math.max(900, price * ((INSURANCE_RATE[state] ?? 0.5) / 100)));

    // DISABLED-VETERAN EXEMPTION -> THE TAX IMPOUND, not just the payment.
    // Section G escrows 3 months of tax off this rate (lib/closingCosts.ts:419). If the exemption
    // moved the monthly payment but not this, the quote would collect an impound for a tax the
    // borrower does not owe, and cash to close would disagree with the payment above it.
    const dv = dvExemption({
      state,
      granted: b.dvExemptGranted === true,
      tier: b.dvExemptTier ?? null,
      assessedValue: price,
      baseTaxAnnual: price * (taxRatePct / 100),
      taxRatePct,
      baseIsActual: b.taxIsActual === true,
      purpose: String(b.purpose || 'purchase'),
      nonAdValoremAnnual: statedNum(b.dvNonAdValoremAnnual) ? Number(b.dvNonAdValoremAnnual) : null,
    });
    const taxRatePctAfterDv = dv.netTaxAnnual != null && price > 0
      ? (dv.netTaxAnnual / price) * 100
      : taxRatePct;

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
      taxRatePct: taxRatePctAfterDv, insAnnual,
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
      // The LO's own figures for lines they actually have a quote for.
      overrides: sanitizeOverrides(b.overrides),
      model,
    };
    const result = estimateClosingCosts(input);
    // `inputs.taxRatePct` echoes the rate BEFORE the exemption ON PURPOSE. The screen adopts this
    // as its own tax rate (page.tsx srvTaxRate) and then runs estimatePITIA, which applies the
    // exemption itself — echoing the reduced rate here would apply it TWICE and quote a payment
    // below anything the borrower could ever owe. The post-exemption rate is exposed separately.
    return NextResponse.json({
      ok: true, ...result,
      inputs: { state, taxRatePct, taxRatePctAfterDv, insAnnual, county: useLoc ? loc?.countyName ?? null : null },
      dvExemption: dv,
    });
  } catch (e: any) {
    console.error("[pricer/closing-costs]", e?.message || e);
    return NextResponse.json({ error: "estimate failed" }, { status: 500 });
  }
}
