import { NextRequest, NextResponse } from "next/server";
import { estimatePITIA } from "@/lib/pricer";
import { buildPricerPdf } from "@/lib/pricerPdf";
import { estimateRate, creditValueToFico, LOAN_TYPES } from "@/lib/rateEstimator";
import { loadRateModel } from "@/lib/rateModelServer";
import { resolveLocation } from "@/lib/propertyData";
import { estimateClosingCosts, type LoanType } from "@/lib/closingCosts";
import { cfg } from "@/lib/settings";

// Pricer loan-type ids ("conv30", "fha30", "dscr30"…) → closing-cost engine types.
function ccLoanType(t: string): LoanType {
  if (t.startsWith("fha")) return "fha";
  if (t.startsWith("va")) return "va";
  if (t.startsWith("usda")) return "usda";
  if (t.startsWith("dscr")) return "dscr";
  if (t.startsWith("bank") || t.startsWith("nonqm")) return "bank_statement";
  if (t.startsWith("bridge") || t.startsWith("hard")) return "bridge";
  return "conventional";
}

// Borrower-facing payment estimate PDF from a Quick Pricer scenario.
// Auth-gated via the /api/pricer matcher (the LO generates it, then shares it).
// The rate is recomputed server-side from the borrower profile using the live
// (admin-edited) model so the PDF is authoritative — unless the advisor
// explicitly overrode it, in which case the supplied rate is used as-is.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOV = ["fha30", "va30", "usda30"];
// Pricer purpose ids ("rateTerm"/"cashOut") → engine purposes.
function mapPurpose(p: any): "purchase" | "refi" | "cashout" {
  const v = String(p || "");
  if (v === "cashOut" || v.toLowerCase() === "cashout") return "cashout";
  if (v === "rateTerm" || v === "refi") return "refi";
  return "purchase";
}


export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const price = Number(b.price) || 0;
    if (!price) return NextResponse.json({ error: "Enter a purchase price first." }, { status: 400 });

    // ZIP-accurate tax + insurance (county/ZCTA Census rates + state-avg premium
    // model). Use the ZIP's rates unless the advisor pinned a different state.
    // Exact annual overrides (real tax bill / insurance quote) win over the estimate.
    const loc = resolveLocation(b.zip);
    const stateIn = b.state || loc.state || null;
    const useLocRates = !!loc.state && (!b.state || b.state === loc.state);
    const taxBasis = price || Number(b.value) || 0;
    const insBasis = Number(b.value) || price || 0;
    const taxOverAnnual = Number(b.taxAnnualOverride) || 0;
    const insOverAnnual = Number(b.insAnnualOverride) || 0;

    const baseInput = {
      price, value: Number(b.value) || undefined, down: Number(b.down) || 0,
      loanAmount: b.loanAmount != null ? Number(b.loanAmount) : undefined,
      termMonths: Number(b.termMonths) || 360,
      state: stateIn, hoaMonthly: Number(b.hoaMonthly) || 0, includePMI: b.includePMI !== false,
      taxRatePct: taxOverAnnual > 0 && taxBasis > 0 ? (taxOverAnnual / taxBasis) * 100 : (useLocRates ? loc.taxRatePct : undefined),
      insRatePct: insOverAnnual > 0 && insBasis > 0 ? (insOverAnnual / insBasis) * 100 : (useLocRates ? loc.insRatePct : undefined),
    };

    // Resolve the rate. Honor an explicit advisor override; otherwise estimate.
    let ratePct = Number(b.ratePct) || 0;
    const loanType = String(b.loanType || "conv30");
    if (!b.rateIsOverride) {
      const pre = estimatePITIA({ ...baseInput, ratePct: 0 });
      const model = await loadRateModel();
      const isGov = GOV.includes(loanType);
      const occ = isGov ? "primary" : loanType === "dscr30" ? "investment" : String(b.occupancy || "primary");
      const est = estimateRate(
        { loanType, fico: creditValueToFico(b.creditVal).fico, ltv: pre.ltv, occupancy: occ, purpose: String(b.purpose || "purchase"), termMonths: baseInput.termMonths },
        model,
      );
      ratePct = est.rate;
    }

    const r = estimatePITIA({ ...baseInput, ratePct });
    const loanTypeLabel = LOAN_TYPES.find((t) => t.value === loanType)?.label;

    // Page 2: closing-cost estimate (same engine as the screen — recomputed
    // server-side so the PDF is authoritative). Skipped if it can't resolve.
    let closing: any = undefined;
    if (b.includeClosing !== false && r.loan > 0 && (stateIn || loc.state)) {
      try {
        let ccModel: any = {}; try { ccModel = JSON.parse((await cfg("CLOSING_COST_MODEL")) || "{}"); } catch { /* */ }
        const cc = estimateClosingCosts({
          zip: String(b.zip || ""), state: String(stateIn || loc.state),
          countyFips: useLocRates ? loc.countyFips : null, countyName: useLocRates ? loc.countyName : null,
          price, loanAmount: r.loan,
          loanType: ccLoanType(loanType), purpose: mapPurpose(b.purpose),
          ratePct, taxRatePct: r.taxRate, insAnnual: r.insMonthly * 12,
          pointsPct: Number(b.pointsPct) || 0, sellerCredit: Number(b.sellerCredit) || 0, lenderCredit: Number(b.lenderCredit) || 0,
          escrowWaived: b.escrowWaived === true, ownersTitle: b.ownersTitle === true,
          vaExempt: b.vaExempt === true, model: ccModel,
        });
        closing = { sections: cc.sections, totalClosingCosts: cc.totalClosingCosts, downPayment: cc.downPayment, credits: cc.credits, cashToClose: cc.cashToClose, financedFees: cc.financedFees, notes: cc.meta.notes, county: useLocRates ? loc.countyName : null };
      } catch (e) { console.warn("[api/pricer/pdf] closing-cost section skipped:", e); }
    }

    const pdf = await buildPricerPdf({
      closing,
      borrowerName: b.borrowerName || undefined, address: b.address || undefined, state: stateIn || undefined,
      county: taxOverAnnual > 0 ? undefined : (useLocRates ? (loc.countyName || undefined) : undefined),
      taxSource: taxOverAnnual > 0 ? undefined : (useLocRates ? loc.taxSource : undefined),
      taxIsActual: taxOverAnnual > 0, insIsActual: insOverAnnual > 0,
      price, value: Number(b.value) || undefined, down: Number(b.down) || 0, loanAmount: r.loan, ltv: r.ltv,
      loanType: loanTypeLabel, ratePct, rateIsOverride: !!b.rateIsOverride, termMonths: baseInput.termMonths,
      pi: r.pi, taxMonthly: r.taxMonthly, insMonthly: r.insMonthly, pmiMonthly: r.pmiMonthly, hoa: r.hoa, total: r.total,
      taxRate: r.taxRate, insRate: r.insRate,
      officerName: b.officerName || undefined, officerNmls: b.officerNmls || undefined,
    });

    const name = `Fetti-Payment-Estimate${b.borrowerName ? "-" + String(b.borrowerName).replace(/[^\w]+/g, "_") : ""}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` },
    });
  } catch (e: any) {
    console.error("[api/pricer/pdf]", e);
    return NextResponse.json({ error: e?.message || "PDF failed." }, { status: 500 });
  }
}
