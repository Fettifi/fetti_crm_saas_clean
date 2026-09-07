// HOW MUCH OF A BENEFIT IS TAX-FREE, AND WHEN ARE TWO BENEFIT DOCUMENTS ONE BENEFIT.
//
// Pure, zero imports, so both builders can read it: lib/income/docFacts.ts (the LOS engine)
// and lib/income.ts (the /income calculator). Gross-up lived at three call sites with three
// copies of the same boolean, which is how one of them stayed wrong.
//
// ── DEFECT 1: A PORTION WAS IMPLEMENTED AS A BOOLEAN ────────────────────────────────────
//
// lib/income/PROGRAMS.md:57 says "apply GROSSUP modifier to the nontaxable PORTION", and :97
// says "Store raw amount, nontaxable PORTION, factor, family". The specification was right.
// The code read:
//
//     const m = f.nonTaxable ? num(f.monthlyBenefit)! * grossUp : num(f.monthlyBenefit)!;
//
// — a fraction collapsed to yes/no, so anything the reader flagged non-taxable was grossed up
// in full. Charletha Osborne's Social Security: $3,418 x 1.15 = $3,931 counted on an FHA file.
//
// Under IRC 86(a)(2) AT MOST 85% of a Social Security benefit is includible in gross income,
// so the tax-free share is never 0 — but it is also never 100% for a borrower with other
// income. The IRS states the same in plain terms (irs.gov, Social Security income FAQ).
// Verified 2026-09-06, not recalled.
//
// The engine ALREADY knew this in one place: readDocument.ts:322 marks a benefit arriving as a
// bank deposit non-taxable only for VA disability and SSI, deliberately excluding Social
// Security, and scripts/verify-benefit-deposits.ts pins it. The award-letter path took the AI's
// boolean instead. This extends the rule the codebase already had to wherever the amount came
// from.
//
// WHAT IS ACTUALLY TAX-FREE (verified against IRS Pub 525, 2026-09-06):
//   VA disability compensation — "Don't include in your income any veterans' benefits paid
//     under any law ... administered by the VA". Wholly excluded. Jazmine Wilson's $4,898.05
//     x 1.25 = $6,123 is CORRECT and must not move.
//   SSI — needs-based, never taxable, and never reported on 1040 line 6a at all.
//   Child support — never includible.
// Those keep the full gross-up. Social Security title-II (retirement / SSDI / survivors) does
// not, and gets the statutory floor below.
//
// WHY A FLOOR AND NOT ZERO. Dropping the gross-up entirely would count Osborne at $3,418 — but
// at least 15% of a title-II benefit is tax-free by statute no matter how high the borrower's
// other income, so the floor is the conservative figure that is also the CORRECT one. A
// borrower whose provisional income is under the base amount owes tax on none of it and is
// entitled to the full gross-up; that borrower is not lost, they are FLAGGED, with a one-click
// add-back, because only their tax return can prove it and the engine must not guess upward.
//
// WHY NOT READ 1040 LINES 6a/6b HERE. That is the real answer and it is deliberately NOT in
// this change. Lines 4a/4b and 5a/5b are captured; 6a/6b are not, and adding them changes the
// EXTRACTION PROMPT — which forces a fresh AI re-read of every document on every file, and a
// re-read moves numbers for reasons that have nothing to do with this fix (Asia Dearman went
// $5,102 -> $8,645 on identical documents). That is exactly what the comment at
// verify-income/route.ts refuses. This change is deterministic: same stored facts, arithmetic
// only. The 6a/6b capture is a separate, separately-verified change.

/** IRC 86(a)(2): at most 85% of a title-II benefit is includible, so >= 15% is always tax-free. */
export const SS_MIN_NON_TAXABLE_SHARE = 0.15;

/** Wholly tax-free by statute — these keep the FULL gross-up. */
const ALWAYS_TAX_FREE = [
  /va[\s_-]*disab/i,          // VA disability compensation
  /veterans?[\s_-]*affairs/i,
  /\bssi\b/i,                  // Supplemental Security Income (needs-based, never on line 6a).
  /supplemental[\s_-]*(security|income)/i,
  // Word-boundary, not ^ssi$, because the reader writes SSI in prose: "Social Security
  // Supplemental Income (SSI)" hits the title-II pattern below and WOULD have been trimmed to
  // 15%. This list is checked FIRST precisely so a statutorily tax-free benefit can never be
  // trimmed by a looser pattern further down. Found by mutating the list away and discovering
  // the guard stayed green — the list had been documentation; these two lines make it logic.
  /child[\s_-]*support/i,
];

/**
 * Social Security title-II: retirement, SSDI, survivors. Matched POSITIVELY and narrowly —
 * never inferred from docType. A VA award mis-typed as `ssa_award` with a null benefitType
 * must not be trimmed, so an unrecognised benefit keeps today's behaviour unchanged.
 */
const TITLE_II_SS = [/social[\s_-]*security/i, /^ssa$/i, /^ssdi$/i, /^oasdi$/i, /^rsdi$/i];

const hit = (pats: RegExp[], s: string) => pats.some((p) => p.test(s));

export type BenefitTaxInput = {
  benefitType?: string | null;
  /** The reader's flag. Still the answer for every class not named above. */
  nonTaxable?: boolean | null;
};

/**
 * The share of this benefit that is tax-free, 0..1.
 *   1     — statutorily tax-free (VA disability, SSI, child support), or the reader says so
 *           for a class this module does not special-case.
 *   0.15  — Social Security title-II: the statutory floor, pending the borrower's 1040.
 *   0     — taxable.
 */
export function nonTaxableShare(f: BenefitTaxInput): number {
  const bt = String(f?.benefitType || "").trim();
  if (bt && hit(ALWAYS_TAX_FREE, bt)) return 1;
  // Positive identification only. An unrecognised benefit is left exactly as it is today.
  if (bt && hit(TITLE_II_SS, bt) && f?.nonTaxable) return SS_MIN_NON_TAXABLE_SHARE;
  return f?.nonTaxable ? 1 : 0;
}

/** True when this benefit's gross-up was trimmed from a full one — i.e. the LO should be told. */
export function isTrimmedGrossUp(f: BenefitTaxInput): boolean {
  const s = nonTaxableShare(f);
  return !!f?.nonTaxable && s > 0 && s < 1;
}

/**
 * Gross up only the tax-free share. share=1 reproduces the old `monthly * grossUp` exactly, so
 * VA disability and SSI are byte-identical to before this change.
 */
export function grossedUpMonthly(monthly: number, share: number, grossUp: number): number {
  const m = Number(monthly), g = Number(grossUp), s = Number(share);
  // NaN must never reach the total: add() guards only `m <= 0`, and NaN <= 0 is false, so a
  // NaN would ship as `"qualifyingMonthlyIncome": null` on the stored payload.
  if (!isFinite(m) || !isFinite(g) || !isFinite(s)) return isFinite(m) ? m : 0;
  const sh = Math.min(1, Math.max(0, s));
  return m * (1 + sh * (g - 1));
}

// ── DEFECT 2: ONE PENSION, TWO DOCUMENTS, COUNTED TWICE ─────────────────────────────────
//
// Osborne's Aerospace pension arrived on two documents that print the payer differently — an
// internal payer-code list and the plan's full legal name plus its trustee:
//
//   "112 - AEROSPACE CORPORATION / 622 - AEROSPACE EMPLOYEES"      -> 112aerospace|case#8165
//   "The Aerospace Corporation - Aerospace Employees' Retirement
//    Plan (The Northern Trust Company Benefit Payment Services)"   -> PENSION|Aerospace...|AMAS17710
//
// Two streamIds, so both were added: $5,218.91 twice. Her own 1040 line 5a disclosed $60,145
// of pension for the year against the $125,254 the engine counted.
//
// NAME MATCHING CANNOT FIX THIS AND MUST NOT BE USED. Run against these two real strings,
// payerStem gives `112aerospace622aerospaceemployees` and
// `aerospaceaerospaceemployeesretirementplannortherntrustpayment`; payerStem equality,
// sameEmployerStem and isAbbrevOf all return false. A wage document prints one thing — an
// employer. A benefit prints sponsor, plan, paying agent and internal codes interchangeably.
//
// SO THE TEST IS THE AMOUNT, TO THE CENT, AND NOTHING ELSE. A fuzzy rule was written and
// tested first, and it deleted real money: same payer within 5% merged a retiree's own CalPERS
// service retirement ($2,100.00) with her deceased husband's survivor continuance ($2,050.00),
// qualifying income 4150 -> 2100, silently, with no flag. Two Teamsters locals ($1,800 +
// $1,850) halved the same way. Cent-exact cannot do that: $2,100.00 != $2,050.00.
//
// AND IT IS NEVER SILENT. The duplicate is excluded WITH a flag carrying the full add-back, so
// if they really are two benefits the loan officer restores it in one click — the same shape
// as the payroll-deposit duplicate check that already sits in this path.

/** Coarse benefit class for "are these the same kind of benefit". Free text is normalised. */
export function benefitClassOf(benefitType?: string | null, docType?: string | null): string {
  const bt = String(benefitType || "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (bt) {
    if (hit(TITLE_II_SS, bt) || /social_security/.test(bt)) return "social_security";
    if (/pension|annuit|retirement/.test(bt)) return "pension";
    if (hit(ALWAYS_TAX_FREE, bt)) return /child/.test(bt) ? "child_support" : /ssi|supplemental/.test(bt) ? "ssi" : "va_disability";
    return bt;
  }
  return String(docType || "other");
}

/** Cent-exact, so two amounts that merely look alike can never merge. */
export const benefitCents = (v: unknown): number | null => {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Two benefit facts are the SAME stream only when they are the same class and the same amount
 * to the cent. Deliberately narrow: this is used to remove money, so it must be a rule that
 * cannot fire on two genuinely different benefits.
 */
export function isSameBenefitStream(
  a: { benefitType?: string | null; docType?: string | null; monthlyBenefit?: unknown },
  z: { benefitType?: string | null; docType?: string | null; monthlyBenefit?: unknown },
): boolean {
  if (benefitClassOf(a.benefitType, a.docType) !== benefitClassOf(z.benefitType, z.docType)) return false;
  const ca = benefitCents(a.monthlyBenefit), cz = benefitCents(z.monthlyBenefit);
  return ca != null && cz != null && ca > 0 && ca === cz;
}

// ── ONE PERSON, ONE SOCIAL SECURITY PAYMENT, THREE LINES ────────────────────────────────
//
// Corine Lucas (FF-202607-7963) carried the same Social Security benefit as THREE streams:
//
//   $2,884.90  SSA|CORINE LUCAS                 <- her award letter
//   $2,682     benefit|social_security|1510     <- the deposits
//   $2,621     benefit|ssa|1510                 <- THE SAME DEPOSITS, same account
//
// $8,296/mo of Social Security for one person. Two separate causes:
//
//   A. The bank-deposit reader keys a stream `benefit|<benefitType>|<last4>`
//      (readDocument.ts:336), so the same deposits on the same account split in two purely
//      because the reader wrote "social_security" on some and "ssa" on others. Same account,
//      same class, same money — a spelling, not a second benefit.
//
//   B. An award letter and its own deposits are one benefit documented twice. The file
//      already says this out loud for wages — "A PAYROLL DEPOSIT IS NOT A BENEFIT, IT IS THE
//      WAGES ARRIVING" — and the same is true here. The award letter GOVERNS: it states the
//      GROSS benefit, while the deposit is that benefit net of the Medicare Part B premium and
//      any withholding, and agencies qualify on the gross. Lucas corroborates it exactly:
//      $2,884.90 - $2,682 = $202.90, about a Part B premium.
//
// Scoped to benefits where one person receives exactly ONE payment. Social Security pays a
// single combined amount — own vs spousal vs survivor is one payment, never two — and so do
// SSI and VA compensation. PENSIONS ARE NOT IN THIS SET, deliberately: a borrower can genuinely
// draw two, which is the CalPERS own-plus-survivor shape a fuzzy rule already destroyed once.

const SINGLE_PAYMENT_CLASSES = new Set(["social_security", "ssi", "va_disability"]);

/** Facts built from a bank statement's benefit deposits, keyed `benefit|<type>|<last4>`. */
export const isDepositDerived = (streamId?: string | null): boolean =>
  /^benefit\|/i.test(String(streamId || ""));

/** The account/case identity a deposit stream carries — its last segment. */
export const benefitAccountId = (streamId?: string | null): string => {
  const parts = String(streamId || "").split("|");
  return parts.length >= 3 ? parts[parts.length - 1].trim().toLowerCase() : "";
};

/**
 * Higher wins when one stream must represent the benefit. An award letter states the GROSS
 * entitlement; a deposit is that money arriving after deductions.
 */
export const benefitAuthority = (f: { streamId?: string | null }): number =>
  isDepositDerived(f.streamId) ? 0 : 1;

/**
 * The same benefit documented twice, beyond the cent-exact test. Both rules are narrow and
 * identity-based; neither compares payer names or amount bands.
 */
export function isSameBenefitByIdentity(
  a: { benefitType?: string | null; docType?: string | null; streamId?: string | null },
  z: { benefitType?: string | null; docType?: string | null; streamId?: string | null },
): boolean {
  const ca = benefitClassOf(a.benefitType, a.docType);
  if (ca !== benefitClassOf(z.benefitType, z.docType)) return false;

  // A. Same account, same class — the same deposits split by how the reader spelled the type.
  const ia = benefitAccountId(a.streamId), iz = benefitAccountId(z.streamId);
  if (isDepositDerived(a.streamId) && isDepositDerived(z.streamId) && ia && ia === iz) return true;

  // B. An award letter and deposits of a single-payment benefit are one benefit.
  if (!SINGLE_PAYMENT_CLASSES.has(ca)) return false;
  return isDepositDerived(a.streamId) !== isDepositDerived(z.streamId);
}
