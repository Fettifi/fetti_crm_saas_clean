// DISABLED-VETERAN PROPERTY TAX EXEMPTION — the ongoing TAX benefit.
//
// NOT the VA funding fee. The funding fee waiver is a ONE-TIME closing charge removed by
// `vaExempt` in lib/closingCosts.ts; this file is the veteran's ANNUAL property tax relief and it
// changes the monthly payment for the life of the loan. They are different benefits with different
// eligibility, and a borrower can have one without the other. Keep them separate everywhere.
//
// IT FOLLOWS THE VETERAN, NOT THE LOAN. A 100%-disabled veteran buying with a CONVENTIONAL or FHA
// loan gets the same state property tax benefit. Gating this on loanType === "va" would silently
// overstate the payment for every disabled veteran who did not use their VA entitlement.
//
// SCOPE. Fetti originates owner-occupied consumer loans in CA, FL and MI only, and every one of
// these benefits is a homestead/principal-residence benefit, so those three states are exactly the
// universe where this can apply. Every other state returns modelled:false and changes nothing —
// silence is correct there, a guess is not.
//
// ── WHAT THE RESEARCH ACTUALLY SAID, because two of these are counter-intuitive ──────────────────
//  CA  PARTIAL. R&TC 205.5 exempts a FIXED DOLLAR AMOUNT OF ASSESSED VALUE, not the tax bill and
//      not a percentage. California does NOT waive a disabled veteran's property tax. It also
//      REPLACES the $7,000 homeowners' exemption, so the incremental benefit is net of that.
//  FL  196.081 zeroes ALL AD VALOREM levies — but NON-AD-VALOREM assessments (CDD debt service and
//      O&M, solid waste, stormwater, fire-rescue MSBU, street lighting) survive in full on the same
//      bill and can still lien the homestead. The trigger is a VA TOTAL-AND-PERMANENT certification,
//      NOT a 100% rating: those are different things and only the former qualifies.
//  MI  MCL 211.7b zeroes the ad valorem bill outright — no cap, no income test. Special assessments
//      survive. Confirmed still an EXEMPTION (not the repeatedly-proposed state credit) for 2026.
//
// ── THREE RULES THAT ARE LOAD-BEARING, NOT STYLE ────────────────────────────────────────────────
//  1. GATE ON "GRANTED", NEVER ON A RATING. The benefit exists only once the county/assessor has
//     approved it (FL: property appraiser; MI: Form 5107 granted; CA: BOE-261-G filed). A borrower
//     saying "I'm 100%" is not the test. Escrowing off an ungranted exemption produces a payment
//     shock and an escrow shortage on a real loan.
//  2. A ZERO TOTAL PROPERTY TAX IS REACHABLE IN EXACTLY ONE WAY, AND NEVER BY INFERENCE.
//     California can never reach zero: relief is capped at the parcel's own rate, so net tax is
//     always at least the $7,000 homeowners' exemption's worth of value. Florida and Michigan CAN
//     reach zero, but only when the LO has explicitly typed $0 of non-ad-valorem assessments — a
//     Michigan parcel in no special district genuinely owes nothing, and refusing to show that
//     would be its own lie. What must never happen is a zero arrived at by DEFAULT: a blank field,
//     an empty string coerced through Number(), or an assumption that a CDD does not exist.
//  3. NEVER SILENTLY REDUCE. If the exemption is claimed but the figure needed to compute it
//     honestly is missing, this returns `pending` and relief 0 — the payment does not move and the
//     UI must say why. An unasked-for reduction on a borrower-facing PDF is the failure mode.

/** The tax year this model's figures and statutory reads were verified for. */
export const DV_MODEL_TAX_YEAR = 2026;
/** Verification stamp — printed with the citation so a stale model is visible, not assumed. */
export const DV_VERIFIED_ON = "2026-09-30";

// CALIFORNIA, 2026 assessment year (1/1/2026 lien date).
// Source: BOE Letter To Assessors No. 2025/014 (May 21, 2025), "Disabled Veterans' Exemption
// Increases for 2026". Indexed annually by the CCPI factor — these change EVERY year.
export const CA_DVE_BASIC_2026 = 180_671;
export const CA_DVE_LOW_INCOME_2026 = 271_009;
export const CA_DVE_INCOME_LIMIT_2026 = 81_131;
/** The ordinary homeowners' exemption the DVE REPLACES (R&TC 205.5(f) — in lieu of any other). */
export const CA_HOMEOWNERS_EXEMPTION = 7_000;
/**
 * The AD VALOREM rate the California relief is computed at: the Prop 13 base only (Cal. Const.
 * art. XIII A, s. 1).
 *
 * DELIBERATELY CONSERVATIVE, AND THIS IS THE REASON. The pricer's tax rate is an EFFECTIVE rate —
 * Census ACS median taxes paid over median value — so it already contains fixed direct assessments
 * (Mello-Roos/CFD, parcel taxes) that the exemption does NOT touch. Computing the relief at that
 * blended rate would credit the veteran for reducing charges the exemption cannot reduce, and
 * overstate the saving. Voter-approved debt service IS ad valorem and would raise the real saving
 * somewhat, but it is parcel-specific and unknown here. Understating relief overstates the payment,
 * which is the safe direction for a qualification tool.
 */
export const CA_AD_VALOREM_BASE_RATE_PCT = 1.0;

export type DvTier = "basic" | "low_income";

export type DvExemptionInput = {
  /** 2-letter state of the subject property. */
  state?: string | null;
  /** The exemption is GRANTED / certified — not a self-reported disability rating. */
  granted?: boolean;
  /** CA only: which R&TC 205.5 tier the assessor granted. */
  tier?: DvTier | null;
  /** Assessed value. In the purchase year this is the purchase price (art. XIII A, s. 2). */
  assessedValue: number;
  /** Modelled annual property tax BEFORE any exemption, in dollars. */
  baseTaxAnnual: number;
  /**
   * The effective annual tax RATE (% of value) the base figure was built from.
   *
   * REQUIRED FOR CALIFORNIA TO BE CORRECT. The relief is a value-based computation
   * (exempted value x rate), so it has to use the SAME property's rate as the base it is
   * subtracted from. Computing relief at a flat 1% while the base was built at, say, 0.71% credited
   * the veteran more than the property's own tax — measured: a $700k CA quote whose base is
   * $4,970/yr got $1,736.71 of relief, i.e. relief at a rate the parcel does not pay.
   */
  taxRatePct?: number | null;
  /**
   * The base tax figure is the LO's ACTUAL annual tax bill, not a model estimate.
   *
   * A real tax bill for a property whose exemption has been granted ALREADY HAS THE EXEMPTION IN
   * IT. Subtracting the relief again quotes a payment below anything the borrower could ever owe —
   * measured at $1,736.71/yr (basic) or $2,640.09/yr (low-income) of phantom California relief on
   * top of a figure that already reflected it. When this is set the exemption reports itself as
   * already included and changes no number.
   */
  baseIsActual?: boolean;
  /**
   * Purchase or refinance. It decides WHOSE tax bill an entered figure is, and therefore whether
   * the exemption is already inside it:
   *   REFINANCE — the figure comes from the borrower's own statement or escrow analysis, so a
   *     granted exemption is already netted out of it. Applying the relief again double-counts.
   *   PURCHASE  — the figure is the SELLER's current bill (MLS, tax record). The exemption is
   *     personal to the veteran and does NOT transfer with the property, so that figure is a
   *     pre-exemption bill from the buyer's point of view and the relief genuinely does apply.
   * Suppressing both cases was the first fix and it was too broad — it silently withheld real
   * relief from every veteran buying a home with a known tax bill.
   */
  purpose?: string | null;
  /**
   * FL / MI: the NON-AD-VALOREM annual total from the actual tax bill or TRIM notice.
   * REQUIRED to produce a number in those states, and never estimated — there is no defensible
   * default for a CDD. null/undefined => `pending`.
   */
  nonAdValoremAnnual?: number | null;
  /**
   * Tax year being quoted. Defaults to the CURRENT calendar year, not the model year.
   *
   * It used to default to DV_MODEL_TAX_YEAR, which meant the "forced re-verification" gate below
   * could never fire in production — no caller passes taxYear, so every quote silently claimed to
   * be the verified year forever. A staleness guard that can only be triggered by a test argument
   * is not a guard. Defaulting to the real clock is what makes it fire on 1 January.
   */
  taxYear?: number;
};

export type DvExemptionResult = {
  /** The borrower claimed it AND this state is modelled AND the year is in range. */
  applies: boolean;
  /** This state/year is modelled at all. */
  modelled: boolean;
  /** Claimed, but a required input is missing — relief is 0 and the caller must say why. */
  pending: boolean;
  /** Annual property tax after the exemption. null when it cannot be computed honestly. */
  netTaxAnnual: number | null;
  /** Annual dollars removed from the tax bill. Never negative, never more than the base. */
  reliefAnnual: number;
  /** One-line summary for the screen and the PDF. */
  headline: string;
  /** Things that survive the exemption, or conditions on it. Always shown, never trimmed away. */
  caveats: string[];
  /** Statute/source with the date it was verified. */
  citation: string;
  /** Why it is not modelled, when it is not. */
  reason?: string;
};

const money = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");

const NOT_APPLICABLE = (reason: string): DvExemptionResult => ({
  applies: false,
  modelled: false,
  pending: false,
  netTaxAnnual: null,
  reliefAnnual: 0,
  headline: "",
  caveats: [],
  citation: "",
  reason,
});

/** States whose disabled-veteran exemption this model encodes. */
export const DV_MODELLED_STATES = ["CA", "FL", "MI"] as const;

export function dvExemption(i: DvExemptionInput): DvExemptionResult {
  const state = String(i.state || "").toUpperCase();
  const year = i.taxYear ?? new Date().getFullYear();
  const base = Number(i.baseTaxAnnual);
  const av = Number(i.assessedValue);

  if (!i.granted) return NOT_APPLICABLE("not claimed");
  if (!Number.isFinite(base) || base < 0) return NOT_APPLICABLE("no base tax figure to reduce");

  // FORCED RE-VERIFICATION, NOT A SILENT ROLL-FORWARD.
  //
  // Every figure here is dated. California's amounts are CCPI-indexed annually AND SB 296
  // (Ch. 727, Stats. 2026) replaces the whole scheme with R&TC 205.5.1 from the 1/1/2027 lien date,
  // whose text could not be read from a primary source. Michigan's exemption survives a recurring
  // convert-to-credit bill. Florida has a constitutional amendment on the 11/3/2026 ballot.
  //
  // So the model REFUSES past its verified year rather than quietly applying last year's law to
  // this year's borrower. Refusing degrades to today's behaviour — the full modelled tax — which is
  // conservative. Rolling forward would not be.
  if (year > DV_MODEL_TAX_YEAR) {
    return NOT_APPLICABLE(
      `not modelled for ${year} — figures are verified for ${DV_MODEL_TAX_YEAR} only ` +
        `(CA amounts are indexed annually and R&TC 205.5.1 replaces 205.5 from the 1/1/2027 lien date). ` +
        `Re-verify against the BOE Letter To Assessors, MCL 211.7b and Fla. Stat. 196.081 before quoting ${year}.`
    );
  }

  // AN ENTERED TAX BILL ON A REFINANCE IS THE BORROWER'S OWN, AND ALREADY NET OF THE EXEMPTION.
  // On a purchase it is the seller's, the exemption does not transfer, and the relief does apply.
  const isRefinance = /refi|cashout|cash_out|rateterm|rate_term/i.test(String(i.purpose || ""));
  if (i.baseIsActual && isRefinance) {
    return {
      applies: true,
      modelled: true,
      pending: false,
      netTaxAnnual: null,          // null = do not move the payment
      reliefAnnual: 0,
      headline: "Exemption already reflected — the annual taxes you entered are being used as-is",
      caveats: [
        "You entered an actual annual tax figure, so it is taken as the real bill for this property. A granted exemption is already inside that number; applying it again would quote a payment below anything the borrower could owe.",
        "Clear the actual-taxes field if you want the exemption modelled from the estimate instead.",
      ],
      citation: `Entered figure used as-is. Verified ${DV_VERIFIED_ON}.`,
    };
  }

  if (!DV_MODELLED_STATES.includes(state as any)) {
    return NOT_APPLICABLE(
      state
        ? `${state} is not modelled — disabled-veteran exemptions are state law and Fetti's owner-occupied lending is CA, FL and MI. Enter the actual annual taxes instead.`
        : "no state resolved"
    );
  }

  // ── CALIFORNIA — a fixed exemption of ASSESSED VALUE, never a waiver ──────────────────────────
  if (state === "CA") {
    const tier: DvTier = i.tier === "low_income" ? "low_income" : "basic";
    const exemptValue = tier === "low_income" ? CA_DVE_LOW_INCOME_2026 : CA_DVE_BASIC_2026;
    // The DVE is IN LIEU OF the $7,000 homeowners' exemption (R&TC 205.5(f)), so the incremental
    // benefit is the exemption net of the HOE the veteran gives up. Where assessed value is below
    // the exemption, only the value that actually exists can be exempted.
    const effectiveExempt = Math.max(0, Math.min(exemptValue, Number.isFinite(av) ? av : 0) - CA_HOMEOWNERS_EXEMPTION);
    // THE RELIEF RATE MUST BE THE LESSER OF THE PROP 13 BASE AND THIS PARCEL'S OWN MODELLED RATE.
    //
    // Two different errors are being avoided at once:
    //  - using the parcel's full effective rate would credit the veteran for reducing Mello-Roos,
    //    parcel taxes and other direct assessments, which the exemption does not touch;
    //  - using a flat 1% when the parcel's modelled rate is BELOW 1% credits relief at a rate the
    //    parcel does not pay at all. That was the live bug: a $700k CA quote with a $4,970/yr base
    //    (0.71%) was given $1,736.71 of relief, computed at 1%.
    // Taking the lesser is conservative in both directions. It also makes a $0 California tax
    // arithmetically impossible: relief <= (AV - 7,000) x rate, so net >= 7,000 x rate > 0, which
    // is what keeps this branch honest about California being a reduction and never a waiver.
    const parcelRate = i.taxRatePct != null && Number.isFinite(Number(i.taxRatePct)) && Number(i.taxRatePct) >= 0
      ? Number(i.taxRatePct)
      : CA_AD_VALOREM_BASE_RATE_PCT;
    const reliefRate = Math.min(CA_AD_VALOREM_BASE_RATE_PCT, parcelRate);
    const relief = Math.max(0, Math.min(base, effectiveExempt * (reliefRate / 100)));
    const net = Math.max(0, base - relief);
    return {
      applies: true,
      modelled: true,
      pending: false,
      netTaxAnnual: net,
      reliefAnnual: relief,
      headline:
        `California Disabled Veterans' Exemption (${tier === "low_income" ? "low-income" : "basic"} tier) — ` +
        `${money(exemptValue)} of assessed value exempt, about ${money(relief)}/yr less tax`,
      caveats: [
        "California REDUCES the taxable value — it does not waive the tax. Tax is still owed on the assessed value above the exemption.",
        `Computed at ${reliefRate.toFixed(3)}% — the lesser of the Prop 13 base rate and this property's modelled rate — and net of the $${CA_HOMEOWNERS_EXEMPTION.toLocaleString()} homeowners' exemption the DVE replaces. Voter-approved debt service would increase the saving; Mello-Roos, parcel taxes and other direct assessments are not reduced at all.`,
        tier === "low_income"
          ? `The low-income tier requires household income at or under ${money(CA_DVE_INCOME_LIMIT_2026)} and must be re-filed every year between January 1 and February 15, or it lapses.`
          : "The basic tier has no income test, but must be claimed on form BOE-261-G with the county assessor — it is not automatic.",
      ],
      citation: `Cal. Rev. & Tax. Code s. 205.5; BOE Letter To Assessors 2025/014 (2026 amounts). Verified ${DV_VERIFIED_ON}.`,
    };
  }

  // ── FLORIDA and MICHIGAN — ad valorem goes to zero, the rest of the bill does not ─────────────
  const isFL = state === "FL";
  const nav = i.nonAdValoremAnnual;
  // `Number("") === 0`, so a bare Number.isFinite test turned an EMPTY FIELD into a stated $0 and
  // printed "$0/yr property taxes" on a borrower PDF from an input nobody filled in. Empty string
  // is "not supplied"; only a real numeric 0 is a stated zero.
  const navStated =
    nav != null &&
    !(typeof nav === "string" && String(nav).trim() === "") &&
    Number.isFinite(Number(nav)) &&
    Number(nav) >= 0;

  const citation = isFL
    ? `Fla. Stat. s. 196.081 (total and permanent service-connected disability). Verified ${DV_VERIFIED_ON}.`
    : `MCL 211.7b (Dannie Lee Barnes disabled veteran property tax relief act). Verified ${DV_VERIFIED_ON}.`;

  const gateCaveat = isFL
    ? "Florida requires a VA letter certifying TOTAL AND PERMANENT service-connected disability, approved by the county property appraiser. A 100% rating is not by itself the statutory test."
    : "Michigan requires Form 5107 filed with the local assessor and GRANTED. The exemption is personal to the veteran — it does not transfer from the seller with the property, and the acquisition year is prorated.";

  const surviveCaveat = isFL
    ? "Ad valorem taxes only. Non-ad-valorem assessments — CDD debt service and O&M, solid waste, stormwater, fire-rescue MSBU, street lighting — are still owed in full and can still lien the homestead."
    : "Ad valorem taxes only. Special assessments levied outside the General Property Tax Act are still owed in full.";

  if (!navStated) {
    // CLAIMED BUT NOT COMPUTABLE. Do not move the payment, and say so loudly. Returning a zero here
    // would be the single most damaging thing this file could do: it reads as "no property taxes",
    // which is never true, and it under-escrows a real loan.
    return {
      applies: true,
      modelled: true,
      pending: true,
      netTaxAnnual: null,
      reliefAnnual: 0,
      headline: `${isFL ? "Florida" : "Michigan"} exemption claimed — enter the non-ad-valorem assessments to apply it`,
      caveats: [
        surviveCaveat,
        "Those charges have no defensible estimate — they are parcel-specific. Take the figure from the actual tax bill or TRIM notice. Until it is entered the quote keeps the full modelled tax, which is the safe direction.",
        gateCaveat,
      ],
      citation,
    };
  }

  const net = Math.max(0, Number(nav));
  const relief = Math.max(0, base - net);
  const caveats = [surviveCaveat, gateCaveat];
  // THE PAYMENT CAN GO UP, AND THAT IS NOT A BUG — SO SAY IT.
  // The modelled tax is a county-median estimate. A parcel in a heavy CDD or special district can
  // genuinely owe MORE in non-ad-valorem assessments than the estimate assumed for the whole bill,
  // so entering the real figure raises the quote even though an exemption was applied. Without this
  // line it reads as the tool malfunctioning, and the LO's instinct will be to untick a true fact.
  if (net > base) {
    caveats.unshift(
      `Note: the ${money(net)}/yr entered here exceeds the ${money(base)}/yr this tool had estimated for the whole bill, so the quoted payment goes UP. That is the real figure replacing an estimate — the exemption still removed the ad valorem tax.`
    );
  }
  return {
    applies: true,
    modelled: true,
    pending: false,
    netTaxAnnual: net,
    reliefAnnual: relief,
    headline:
      `${isFL ? "Florida" : "Michigan"} disabled-veteran exemption — ad valorem tax exempt, ` +
      `${money(net)}/yr of non-ad-valorem assessments remain`,
    caveats,
    citation,
  };
}
