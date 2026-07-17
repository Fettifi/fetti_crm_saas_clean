// DEAL QUALIFIER — reverse-engineers what a deal NEEDS to work, from as little as
// an address + purchase price (+ optional rehab budget). Mirrors the engine's
// conventions exactly (DSCR = gross rent / PITIA; vacancy/mgmt/maintenance on
// effective income; tax/insurance fallbacks as % of price) so the qualifier's
// "required rent" produces the same DSCR the grid will show once rent is entered.
// Pure + isomorphic: no imports beyond the engine's exported helpers/types.
import {
  monthlyPayment, loanFromPayment,
  type Assumptions, type PropertyRow,
} from "@/lib/underwrite/engine";

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type QualifierVerdict = "works" | "works_if" | "thin" | "no";

export type DealQualifier = {
  // Rental (DSCR hold)
  rental: {
    loanAtMaxLtv: number;          // loan sized purely by the LTV cap
    pitiaAtMaxLtv: number;         // monthly PITIA carrying that loan
    requiredRent: number;          // gross rent/mo needed to hit target DSCR at the LTV-cap loan
    breakevenRent: number;         // gross rent/mo where cashflow = $0 (after vacancy/mgmt/maint)
    actualRent: number | null;     // what was entered, if anything
    actualDscr: number | null;     // DSCR at the LTV-cap loan with entered rent
    rentGap: number | null;        // entered rent − required rent (negative = short)
    maxWorkablePrice: number | null; // max price where entered rent still hits target DSCR at max LTV
    verdict: QualifierVerdict;
    line: string;                  // plain-English requirement / verdict
  };
  // Fix & flip
  flip: {
    allIn: number;                 // price + rehab + closing
    carry6mo: number;              // ~6 months interest-only on the LTV-cap loan + taxes/ins
    arvNeeded70Rule: number;       // classic 70% rule: (price+rehab)/0.70
    arvNeededProfit: number;       // ARV that clears the profit floor after 7% sell costs
    profitFloor: number;           // the floor used (max of $25k / 15% of all-in)
    givenArv: number | null;
    profitAtGivenArv: number | null;
    roiAtGivenArvPct: number | null;
    verdict: QualifierVerdict | null; // null when no ARV given
    line: string;
  };
  // BRRRR (buy-rehab-rent-refi)
  brrrr: {
    refiLoan: number | null;       // max-LTV loan against ARV (falls back to arvNeededProfit if no ARV)
    cashInDeal: number;            // cash to acquire + rehab after initial loan
    cashLeftAfterRefi: number | null;
    line: string;
  };
  headline: string;                // the one-sentence answer: what this deal needs
};

export function qualifyDeal(p: PropertyRow, a: Assumptions): DealQualifier {
  const price = Number(p.price) || 0;
  const rent = Number(p.rent_monthly) || 0;
  const rehab = Number(p.rehab_budget) || 0;
  const arv = Number(p.arv) || 0;
  const taxesA = p.taxes_annual ?? (price * a.tax_fallback_pct) / 100;
  const insA = p.insurance_annual ?? (price * a.ins_fallback_pct) / 100;
  const taxes_m = taxesA / 12, ins_m = insA / 12, hoa_m = Number(p.hoa_monthly) || 0;

  // ---- RENTAL ------------------------------------------------------------------
  const loanLtv = price * (a.max_ltv_pct / 100);
  const pi = monthlyPayment(loanLtv, a.rate_pct, a.amort_years);
  const pitia = pi + taxes_m + ins_m + hoa_m;
  const requiredRent = r0(a.target_dscr * pitia); // DSCR = gross rent / PITIA
  // Break-even: effective(1-vac) − mgmt − maint − PITIA = 0, mgmt+maint are % of effective
  const effFactor = (1 - a.vacancy_pct / 100) * (1 - (a.mgmt_pct + a.maintenance_pct) / 100);
  const breakevenRent = effFactor > 0 ? r0(pitia / effFactor) : 0;
  const actualDscr = rent > 0 && pitia > 0 ? r2(rent / pitia) : null;
  const rentGap = rent > 0 ? r0(rent - requiredRent) : null;

  // Max price at the entered rent: solve price where required rent == entered rent.
  // Taxes/ins may scale with price (fallbacks), so iterate.
  let maxWorkablePrice: number | null = null;
  if (rent > 0) {
    const piBudget = (rentTry: number, taxesM: number, insM: number) => rentTry / a.target_dscr - taxesM - insM - hoa_m;
    let guess = price > 0 ? price : 100000;
    for (let i = 0; i < 25; i++) {
      const tM = (p.taxes_annual ?? (guess * a.tax_fallback_pct) / 100) / 12;
      const iM = (p.insurance_annual ?? (guess * a.ins_fallback_pct) / 100) / 12;
      const budget = piBudget(rent, tM, iM);
      if (budget <= 0) { guess = 0; break; }
      const loan = loanFromPayment(budget, a.rate_pct, a.amort_years);
      const next = loan / (a.max_ltv_pct / 100);
      if (Math.abs(next - guess) < 50) { guess = next; break; }
      guess = next;
    }
    maxWorkablePrice = r0(Math.max(0, guess));
  }

  let rVerdict: QualifierVerdict; let rLine: string;
  if (rent > 0 && actualDscr != null) {
    if (actualDscr >= a.target_dscr) {
      rVerdict = "works";
      rLine = `WORKS as a rental — $${rent.toLocaleString()}/mo rent carries a ${fmtM(loanLtv)} loan at ${actualDscr}x DSCR (target ${a.target_dscr}x). Room to pay up to ${fmtM(maxWorkablePrice || price)}.`;
    } else if (rentGap != null && Math.abs(rentGap) <= requiredRent * 0.1) {
      rVerdict = "works_if";
      rLine = `CLOSE — $${rent.toLocaleString()}/mo is $${Math.abs(rentGap).toLocaleString()} short of the $${requiredRent.toLocaleString()}/mo needed for ${a.target_dscr}x DSCR. Works if rent reaches $${requiredRent.toLocaleString()} OR price drops to ${fmtM(maxWorkablePrice || 0)}.`;
    } else {
      rVerdict = "no";
      rLine = `DOESN'T WORK as a rental at this price — needs $${requiredRent.toLocaleString()}/mo (entered: $${rent.toLocaleString()}). Either rent rises to $${requiredRent.toLocaleString()}/mo or price drops to ${fmtM(maxWorkablePrice || 0)}.`;
    }
  } else {
    rVerdict = "works_if";
    rLine = `Needs $${requiredRent.toLocaleString()}/mo gross rent to qualify (${a.target_dscr}x DSCR on a ${fmtM(loanLtv)} loan at ${a.rate_pct}%). Break-even is $${breakevenRent.toLocaleString()}/mo — verify market rent against these numbers.`;
  }

  // ---- FLIP --------------------------------------------------------------------
  const closing = (price * a.closing_cost_pct) / 100;
  const allIn = r0(price + rehab + closing);
  const carry6mo = r0(loanLtv * (a.rate_pct / 100) * 0.5 + (taxesA + insA) * 0.5);
  const profitFloor = r0(Math.max(25000, allIn * 0.15));
  const SELL = 0.07; // agent + seller closing on exit
  const arvNeededProfit = r0((allIn + carry6mo + profitFloor) / (1 - SELL));
  const arvNeeded70Rule = r0((price + rehab) / 0.7);
  let fVerdict: QualifierVerdict | null = null;
  let profitAtGivenArv: number | null = null, roiAtGivenArvPct: number | null = null;
  let fLine: string;
  if (arv > 0) {
    profitAtGivenArv = r0(arv * (1 - SELL) - allIn - carry6mo);
    const cashBasis = allIn + carry6mo - loanLtv;
    roiAtGivenArvPct = cashBasis > 0 ? r2((profitAtGivenArv / cashBasis) * 100) : null;
    fVerdict = profitAtGivenArv >= profitFloor ? "works" : profitAtGivenArv > 0 ? "thin" : "no";
    fLine = fVerdict === "works"
      ? `WORKS as a flip — ${fmtM(arv)} ARV clears ${fmtM(profitAtGivenArv)} profit after sell costs and ~6mo carry${roiAtGivenArvPct != null ? ` (${roiAtGivenArvPct}% cash-on-cash)` : ""}.`
      : fVerdict === "thin"
        ? `THIN flip — ${fmtM(arv)} ARV nets only ${fmtM(profitAtGivenArv)} (floor: ${fmtM(profitFloor)}). Needs ARV ≥ ${fmtM(arvNeededProfit)} or a cheaper basis.`
        : `LOSES as a flip — ${fmtM(arv)} ARV is under the ${fmtM(allIn + carry6mo)} all-in + carry. Needs ARV ≥ ${fmtM(arvNeededProfit)}.`;
  } else {
    fLine = `As a flip: all-in ${fmtM(allIn)}${rehab ? ` (incl. ${fmtM(rehab)} rehab)` : ""} + ~${fmtM(carry6mo)} carry. Needs ARV ≥ ${fmtM(arvNeededProfit)} to clear ${fmtM(profitFloor)} profit (70%-rule target: ${fmtM(arvNeeded70Rule)}).`;
  }

  // ---- BRRRR -------------------------------------------------------------------
  const cashInDeal = r0(allIn + carry6mo - loanLtv);
  const refiBase = arv > 0 ? arv : arvNeededProfit;
  const refiLoan = r0(refiBase * (a.max_ltv_pct / 100));
  const cashLeftAfterRefi = r0(cashInDeal - Math.max(0, refiLoan - loanLtv));
  const bLine = arv > 0
    ? `BRRRR: refi at ${a.max_ltv_pct}% of ${fmtM(arv)} ARV = ${fmtM(refiLoan)} — ${cashLeftAfterRefi <= 0 ? "returns ALL your cash (perfect BRRRR)" : `leaves ${fmtM(cashLeftAfterRefi)} in the deal`} of the ${fmtM(cashInDeal)} invested.`
    : `BRRRR: you'd have ~${fmtM(cashInDeal)} cash in. A refi at ${a.max_ltv_pct}% LTV needs ~${fmtM(r0(cashInDeal / (a.max_ltv_pct / 100) + loanLtv))} ARV to pull it all back out.`;

  // ---- Headline ----------------------------------------------------------------
  const headline = rent > 0 && rVerdict === "works"
    ? `✅ This deal WORKS as a rental at the entered rent${arv > 0 && fVerdict === "works" ? " — and as a flip" : ""}.`
    : `To work, this deal needs: rent ≥ $${requiredRent.toLocaleString()}/mo (rental) or ARV ≥ ${fmtM(arvNeededProfit)} (flip).`;

  return {
    rental: {
      loanAtMaxLtv: r0(loanLtv), pitiaAtMaxLtv: r0(pitia), requiredRent, breakevenRent,
      actualRent: rent || null, actualDscr, rentGap, maxWorkablePrice, verdict: rVerdict, line: rLine,
    },
    flip: {
      allIn, carry6mo, arvNeeded70Rule, arvNeededProfit, profitFloor,
      givenArv: arv || null, profitAtGivenArv, roiAtGivenArvPct, verdict: fVerdict, line: fLine,
    },
    brrrr: { refiLoan: arv > 0 ? refiLoan : null, cashInDeal, cashLeftAfterRefi: arv > 0 ? cashLeftAfterRefi : null, line: bLine },
    headline,
  };
}

function fmtM(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}
