// MISMO 3.4 (DU wrapper / ULAD) exporter. Modeled to match a real Calyx Point
// DU export (DU_Wrapper_3.4.0_B324.xsd, MISMOReferenceModelIdentifier
// 3.4.032420160128): deal-level ASSETS and LIABILITIES with RELATIONSHIPS linking to borrowers,
// full PROPERTY_DETAIL / LOAN_DETAIL indicator sets, ROLE_DETAIL/PartyRoleType,
// party-level TAXPAYER_IDENTIFIERS, DU:/ULAD: HMDA extensions, and separate
// LoanOriginator + LoanOriginationCompany parties. So it imports into DU/lenders
// the same way Point's output does.
import type { Urla, UrlaAddress, UrlaBorrower } from "@/lib/urla";

function esc(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function el(tag: string, value: any, ind: string): string {
  if (value === null || value === undefined || value === "") return "";
  return `${ind}<${tag}>${esc(value)}</${tag}>\n`;
}
const bool = (v: any) => (v ? "true" : "false");
function money(v: any): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? undefined : n.toFixed(2);
}
const ssnDigits = (s?: string) => (s || "").replace(/[^0-9]/g, "").slice(0, 9);

/** Yes/No/unanswered -> a MISMO Indicator. "" is the wizard's NOT ASKED, and an Indicator has no
 *  unknown value, so an unanswered question is OMITTED rather than exported as a negative nobody
 *  gave — the same rule the Section 5 declarations block below applies to the fifteen. */
const ynIndicator = (v?: string) => (v === "Yes" ? "true" : v === "No" ? "false" : undefined);

// ── AN ENUMERATION IS NOT FREE TEXT ────────────────────────────────────────────────────────────
// CitizenshipResidencyType, AssetType, LiabilityType, HMDARaceType and the rest are CLOSED
// enumerations in ULAD/MISMO, and what reaches this exporter is whatever the borrower or the LO
// actually typed — the wizard's own slugs ("white", "female", "not_hispanic", "checking"), a
// human spelling ("US Citizen", "Credit Card"), or the canonical value itself when the file came
// back through a MISMO import. Those were being written into the XML verbatim, so a lender's
// parser met a value that is not in the schema: it drops the element, or rejects the file. Our own
// importer is the proof — it accepts only "Female"/"Male" for gender, so the "female" we exported
// did not survive a round trip through our own code, and nobody noticed because both ends were
// blind in the same place. [[a-mechanism-must-be-proven-to-fire]]
//
// enumOf() takes all three spellings and returns undefined for anything it cannot place: an
// omitted element, never a guessed one. Where the borrower's own words carry real information the
// schema has no member for, the caller pairs "Other" with a <...OtherDescription> so the words
// still reach the underwriter instead of being flattened into a wrong category.
function enumOf(map: Record<string, string>, v: any): string | undefined {
  const t = String(v ?? "").trim();
  if (!t) return undefined;
  const key = t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (map[key]) return map[key];
  const squashed = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.values(map).find((x) => x.toLowerCase() === squashed);
}

// HMDA / Reg B §1002.13. The wizard stores slugs; HMDA reports enumerations.
const HMDA_RACE: Record<string, string> = {
  american_indian: "AmericanIndianOrAlaskaNative", asian: "Asian", black: "BlackOrAfricanAmerican",
  pacific_islander: "NativeHawaiianOrOtherPacificIslander", white: "White",
};
const HMDA_ETHNICITY: Record<string, string> = { hispanic: "HispanicOrLatino", not_hispanic: "NotHispanicOrLatino" };
const HMDA_GENDER: Record<string, string> = { female: "Female", male: "Male" };

// URLA Section 2a. Mapped only where the borrower's word is unambiguous — a "brokerage" account
// is not evidence of what is held in it, so it travels as Other + description rather than being
// called Stock by this file.
const ASSET_TYPES: Record<string, string> = {
  checking: "CheckingAccount", checking_account: "CheckingAccount",
  savings: "SavingsAccount", savings_account: "SavingsAccount",
  money_market: "MoneyMarketFund", money_market_fund: "MoneyMarketFund", money_market_account: "MoneyMarketFund",
  cd: "CertificateOfDepositTimeDeposit", certificate_of_deposit: "CertificateOfDepositTimeDeposit",
  time_deposit: "CertificateOfDepositTimeDeposit",
  retirement: "RetirementFund", retirement_fund: "RetirementFund", retirement_account: "RetirementFund",
  "401k": "RetirementFund", "401_k": "RetirementFund", "403b": "RetirementFund", "403_b": "RetirementFund",
  ira: "RetirementFund", roth: "RetirementFund", roth_ira: "RetirementFund", sep_ira: "RetirementFund",
  tsp: "RetirementFund", pension: "RetirementFund",
  stock: "Stock", stocks: "Stock", bond: "Bond", bonds: "Bond",
  mutual_fund: "MutualFund", mutual_funds: "MutualFund",
  trust: "TrustAccount", trust_account: "TrustAccount", other: "Other",
};

// URLA Section 2c/2d. "card" is revolving, a car or student loan is installment; anything else the
// borrower wrote keeps its own words under Other.
const LIABILITY_TYPES: Record<string, string> = {
  card: "Revolving", cards: "Revolving", credit_card: "Revolving", credit_cards: "Revolving",
  revolving: "Revolving", revolving_credit: "Revolving",
  auto: "Installment", auto_loan: "Installment", car: "Installment", car_loan: "Installment",
  vehicle: "Installment", vehicle_loan: "Installment",
  student: "Installment", student_loan: "Installment", student_loans: "Installment",
  personal: "Installment", personal_loan: "Installment",
  installment: "Installment", installment_loan: "Installment",
  heloc: "HELOC", home_equity: "HELOC", home_equity_line: "HELOC", home_equity_line_of_credit: "HELOC",
  mortgage: "MortgageLoan", mortgage_loan: "MortgageLoan",
  lease: "LeasePayment", lease_payment: "LeasePayment",
  alimony: "Alimony", child_support: "ChildSupport",
  open_30_day: "Open30DayChargeAccount", charge_account: "Open30DayChargeAccount",
  open_30_day_charge_account: "Open30DayChargeAccount", other: "Other",
};

/** The nine community property states. Alaska's opt-in regime is deliberately absent: it takes a
 *  written election we never see, so a file there is not one of these by default. */
const COMMUNITY_PROPERTY_STATES = new Set(["AZ", "CA", "ID", "LA", "NV", "NM", "TX", "WA", "WI"]);

/** Free-text citizenship -> the three ULAD members. lib/urla.ts carries this answer as whatever
 *  the intake wrote ("US Citizen", "Permanent Resident"), and it was going out as free text where
 *  the schema allows exactly USCitizen / PermanentResidentAlien / NonPermanentResidentAlien, so
 *  the element was dropped by the receiving parser and the 1003 arrived with no citizenship at
 *  all. urlaCompleteness() already lists citizenship as required, so a borrower we cannot place
 *  shows up as a gap to fill instead of a value we invented.
 *
 *  "Non-Permanent Resident Alien" CONTAINS "permanent", so the negative test runs first — the same
 *  trap isInvestmentDeal() documents for "non-owner occupied", and the reason the existing mapper
 *  in lib/urla.ts could not simply be called: it tests "permanent" first and would report a
 *  non-permanent resident as a permanent one, which is a different lending eligibility. */
function citizenshipResidency(v?: string): string | undefined {
  const t = String(v || "").toLowerCase();
  if (!t.trim()) return undefined;
  const negated = /non-?\s?permanent|\bnon\b|\bnot\b/.test(t);
  if (/permanent/.test(t)) return negated ? "NonPermanentResidentAlien" : "PermanentResidentAlien";
  if (/citizen/.test(t) && !negated) return "USCitizen";
  return undefined;   // "Foreign National", "not a citizen" — true of the borrower, but not one of the three
}

/** Occupancy -> PropertyUsageType, the enumeration of three.
 *
 *  The caller used `p.occupancy || "PrimaryResidence"`, which turned every file whose occupancy
 *  never reached the assembler into an owner-occupied one. That is the most consequential field on
 *  the application: it prices the loan, sets the LTV ceiling and the reserve requirement, and
 *  mislabelling an investment property as a primary residence is the shape occupancy fraud takes.
 *  lib/urla.ts::normalizeOccupancy deliberately returns undefined rather than defaulting a blank —
 *  this is where that care was being thrown away one line before the file left the building.
 *  The LOS and the intake spell it a dozen ways, so the free text is classified here and anything
 *  unclassifiable is omitted. Negative test first: "non-owner occupied" contains "owner". */
function propertyUsage(v?: string): string | undefined {
  const t = String(v || "").toLowerCase();
  if (!t.trim()) return undefined;
  if (/non.?owner|noo\b|invest|rental|tenant/.test(t)) return "Investment";
  if (/second|2nd|vacation/.test(t)) return "SecondHome";
  if (/primary|owner|principal/.test(t)) return "PrimaryResidence";
  return undefined;
}

/** MortgageType -> the ULAD enumeration, with the product's own words when it is "Other".
 *
 *  EVERY VA FILE SHIPPED AS CONVENTIONAL. `l.loanType || "Conventional"` was the whole derivation,
 *  and lib/urla.ts has no VA or USDA branch either — it resolves anything that is not FHA and not
 *  an investor product to "Conventional" — so a veteran's $0-down file reached a wholesale lender
 *  as a conventional loan: no entitlement, no funding fee, mortgage insurance priced in, and an
 *  LO re-keying the whole 1003 by hand when the portal refused to match it to a VA product.
 *
 *  A named government programme PROMOTES over "Conventional" and never demotes an explicit one,
 *  because "Conventional" is the upstream DEFAULT and cannot outrank a product that says VA, FHA
 *  or USDA in so many words — the same promote-only rule lib/urla.ts applies to occupancy.
 *  "Other" (DSCR, hard money, bridge, non-QM, a 2nd) now carries a description: a lender who
 *  receives a bare MortgageType "Other" cannot tell a DSCR from a HELOC and conditions the file
 *  until someone tells them, which is exactly the missing information this export was blamed for. */
function mortgageType(l: Urla["loan"]): { type?: string; desc?: string } {
  const gov = (s: string) =>
    /\bva\b|\birrrl\b/i.test(s) ? "VA"
      : /\bfha\b|\b203\s*\(?k\)?\b/i.test(s) ? "FHA"
        : /\busda\b|rural\s*(development|housing)/i.test(s) ? "USDARuralDevelopment"
          : undefined;
  const declared = String(l.loanType || "").trim();
  const product = `${l.productDescription || ""} ${l.purpose || ""}`;
  const named = gov(declared) || gov(product);
  if (named) return { type: named };
  if (/conventional|conforming|fannie|freddie/i.test(declared)) return { type: "Conventional" };
  if (declared) return { type: "Other", desc: l.productDescription || declared };
  return {};   // nothing stated anywhere — omitted, not defaulted to Conventional
}

function addr(a: UrlaAddress | string | undefined, ind: string, extra = ""): string {
  if (!a) return "";
  const ad: UrlaAddress = typeof a === "string" ? { street: a } : a;
  if (!ad.street && !ad.city) return "";
  let s = `${ind}<ADDRESS>\n`;
  s += el("AddressLineText", ad.street, ind + "\t");
  s += extra;
  s += el("CityName", ad.city, ind + "\t");
  s += el("CountryCode", ad.country || "US", ind + "\t");
  s += el("PostalCode", ad.zip, ind + "\t");
  s += el("StateCode", ad.state, ind + "\t");
  s += `${ind}</ADDRESS>\n`;
  return s;
}

export function buildMismo34(u: Urla): string {
  const T = (n: number) => "\t".repeat(n);
  const rels: string[] = [];
  let relSeq = 0;
  const rel = (arcrole: string, from: string, to: string) => {
    relSeq++;
    rels.push(`${T(5)}<RELATIONSHIP SequenceNumber="${relSeq}" xlink:arcrole="urn:fdc:mismo.org:2009:residential/${arcrole}" xlink:from="${from}" xlink:to="${to}" />`);
  };
  const borrowerLabels = u.borrowers.map((_, i) => `BORROWER_1${i + 1}`);

  // ---------- ASSETS (deal level) ----------
  let assetsXml = "";
  let assetSeq = 100;
  for (const a of u.assets || []) {
    assetSeq += 1;
    const label = `ASSET_${assetSeq}`;
    assetsXml += `${T(6)}<ASSET SequenceNumber="${assetSeq}" xlink:label="${label}">\n`;
    assetsXml += `${T(7)}<ASSET_DETAIL>\n`;
    assetsXml += el("AssetCashOrMarketValueAmount", money(a.balance), T(8));
    // A BLANK ACCOUNT TYPE WAS BECOMING "CheckingAccount" — an account type nobody stated,
    // printed on a signed 1003 and delivered to a lender as a fact about where the borrower's
    // money sits. lib/urla.ts stopped inventing it at the assembler ("When they did not say, it
    // stays unsaid"); this line put it straight back one step before the file left. Unsaid is
    // now unsaid, and the words the borrower DID use are mapped or carried, never replaced.
    const assetType = enumOf(ASSET_TYPES, a.type);
    assetsXml += el("AssetType", a.type ? assetType || "Other" : undefined, T(8));
    assetsXml += el("AssetTypeOtherDescription", a.type && !assetType ? a.type : undefined, T(8));
    assetsXml += `${T(7)}</ASSET_DETAIL>\n`;
    if (a.institution) assetsXml += `${T(7)}<ASSET_HOLDER>\n${T(8)}<NAME>\n` + el("FullName", a.institution, T(9)) + `${T(8)}</NAME>\n${T(7)}</ASSET_HOLDER>\n`;
    assetsXml += `${T(6)}</ASSET>\n`;
    borrowerLabels.forEach((bl) => rel("ASSET_IsAssociatedWith_ROLE", label, bl));
  }
  for (const r of u.reo || []) {
    assetSeq += 1;
    const label = `ASSET_OWNED_${assetSeq}`;
    assetsXml += `${T(6)}<ASSET SequenceNumber="${assetSeq}" xlink:label="${label}">\n`;
    assetsXml += `${T(7)}<OWNED_PROPERTY>\n${T(8)}<OWNED_PROPERTY_DETAIL>\n`;
    // `|| "0.00"` REPORTED A RENTAL AS OWNED FREE AND CLEAR whenever the balance was simply never
    // collected, and a zero lien is not a small error on an REO schedule: it moves the net rental
    // calculation, the DTI and the CLTV a lender sizes the whole file against. Unknown is unknown.
    // (The sequence is also alphabetical now, like every other MISMO container here — LienUPB was
    // sitting first, and a lender's parser can reject an out-of-order element.)
    assetsXml += el("OwnedPropertyDispositionStatusType", r.status, T(9));
    assetsXml += el("OwnedPropertyLienUPBAmount", money(r.mortgageBalance), T(9));
    assetsXml += el("OwnedPropertyMaintenanceExpenseAmount", money(r.monthlyMortgage), T(9));
    assetsXml += el("OwnedPropertyRentalIncomeGrossAmount", money(r.monthlyRentalIncome), T(9));
    assetsXml += `${T(8)}</OWNED_PROPERTY_DETAIL>\n${T(8)}<PROPERTY>\n`;
    assetsXml += addr(r.address, T(9));
    assetsXml += `${T(8)}</PROPERTY>\n${T(7)}</OWNED_PROPERTY>\n${T(6)}</ASSET>\n`;
    borrowerLabels.forEach((bl) => rel("ASSET_IsAssociatedWith_ROLE", label, bl));
  }
  const assetsBlock = assetsXml ? `${T(5)}<ASSETS>\n${assetsXml}${T(5)}</ASSETS>\n` : "";

  // ---------- LIABILITIES (deal level) ----------
  // THE ENTIRE CONTAINER WAS MISSING. This exporter emitted ASSETS and REO and then stopped, so
  // every 1003 we handed a lender said the borrower owes NOTHING — a clean liability schedule on a
  // file whose credit report will show a car note, two cards and a student loan. That is not a
  // field-level gap: a DTI computed from it is wrong by every debt the borrower has, the lender's
  // import looks complete, and the contradiction only surfaces when the credit report lands and an
  // underwriter asks why the application was signed with an empty Section 2c. urla.liabilities has
  // been populated the whole time — the wizard asks for the rows (app/apply/form: "What monthly
  // debts do you carry?") and lib/mismoImport.ts has always READ this container back, which is how
  // a round trip through our own code looked lossless while the export was silent.
  //
  // Built exactly like the ASSETS block above: LIABILITY / LIABILITY_DETAIL + LIABILITY_HOLDER,
  // alphabetical children, linked to the borrower ROLEs through a RELATIONSHIP so DU attributes
  // the debt instead of discarding it. The schedule carries no per-borrower attribution in our
  // data model, so the link mirrors the ASSETS convention and names every borrower on the
  // application: on a joint 1003 the debt counts once against the household either way, and
  // claiming to know WHICH borrower owes it would be the invention this block exists to stop.
  //
  // LiabilityType is an enumeration, and the row type is whatever the borrower typed ("card",
  // "auto"), plus one synthetic row lib/urla.ts creates when all we hold is a stated TOTAL
  // ("Borrower-stated total monthly debt" — deliberately not a fabricated tradeline). Mapped
  // where unambiguous, otherwise Other + description so the underwriter reads the borrower's own
  // words and can see for themselves that a stated total is not a tradeline.
  let liabXml = "";
  let liabSeq = 300;
  for (const li of u.liabilities || []) {
    const payment = money(li.monthlyPayment), balance = money(li.balance);
    // A row with nothing in it is not a liability; it would export as an empty tradeline.
    if (!payment && !balance && !li.creditor && !li.type) continue;
    liabSeq += 1;
    const label = `LIABILITY_${liabSeq}`;
    const liabType = enumOf(LIABILITY_TYPES, li.type);
    liabXml += `${T(6)}<LIABILITY SequenceNumber="${liabSeq}" xlink:label="${label}">\n`;
    liabXml += `${T(7)}<LIABILITY_DETAIL>\n`;
    liabXml += el("LiabilityMonthlyPaymentAmount", payment, T(8));
    liabXml += el("LiabilityType", li.type ? liabType || "Other" : undefined, T(8));
    liabXml += el("LiabilityTypeOtherDescription", li.type && !liabType ? li.type : undefined, T(8));
    liabXml += el("LiabilityUnpaidBalanceAmount", balance, T(8));
    liabXml += `${T(7)}</LIABILITY_DETAIL>\n`;
    if (li.creditor) liabXml += `${T(7)}<LIABILITY_HOLDER>\n${T(8)}<NAME>\n` + el("FullName", li.creditor, T(9)) + `${T(8)}</NAME>\n${T(7)}</LIABILITY_HOLDER>\n`;
    liabXml += `${T(6)}</LIABILITY>\n`;
    borrowerLabels.forEach((bl) => rel("LIABILITY_IsAssociatedWith_ROLE", label, bl));
  }
  const liabilitiesBlock = liabXml ? `${T(5)}<LIABILITIES>\n${liabXml}${T(5)}</LIABILITIES>\n` : "";

  // ---------- COLLATERAL / SUBJECT PROPERTY ----------
  const p = u.property;
  // Derived once, here: the MortgageType decides the FHA-only property indicator below as well as
  // TERMS_OF_LOAN, and the two must not be allowed to disagree about what kind of loan this is.
  const mortgage = mortgageType(u.loan);
  const usage = propertyUsage(p.occupancy);
  // The SUBJECT_PROPERTY wrapper is built last, from its own contents: with the hardcoded
  // indicators gone a file carrying no property facts at all would ship an empty collateral shell.
  let coll = "";
  coll += addr(p.address, T(8));
  // Accumulated, not appended straight onto `coll`: now that every child can legitimately be
  // absent, an all-unknown property would otherwise emit an empty PROPERTY_DETAIL shell.
  let pd = "";
  // ── SEVEN ELEMENTS, SEVEN HARDCODED ANSWERS ──────────────────────────────────────────────────
  // Not one of these was read from the file. They were constants, which means they were answers,
  // which means the ones that happened to be wrong were wrong on every single export.
  //
  // CommunityPropertyStateIndicator "false" ON A CALIFORNIA FILE. California IS a community
  // property state, and the indicator is not decorative: it governs whether a non-borrowing
  // spouse's debts count against the DTI, whether that spouse must sign the security instrument,
  // and how title vests. We are a California brokerage — the hardcoded value was wrong on the
  // majority of what we send, and a wholesale lender reading "false" is reading something the
  // state's own law contradicts. Derived from the SUBJECT PROPERTY's state, omitted when we have
  // no state to read rather than guessed.
  const propState = String(p.address?.state || "").trim().toUpperCase();
  pd += el("CommunityPropertyStateIndicator",
    /^[A-Z]{2}$/.test(propState) ? bool(COMMUNITY_PROPERTY_STATES.has(propState)) : undefined, T(9));
  // FHA-only element. On a conventional or DSCR file it is an answer to a question nobody asked;
  // on an FHA file it is real, and the occupancy answers it. Emitted only where it means something.
  pd += el("FHASecondaryResidenceIndicator",
    mortgage.type === "FHA" && usage ? bool(usage === "SecondHome") : undefined, T(9));
  // PropertyEstateType "FeeSimple" is GONE rather than derived. Nothing in this CRM records the
  // estate — the prelim/title commitment establishes it — and California is exactly where the
  // constant breaks: a Palm Springs Indian-land lease or a ground-lease condo is a leasehold whose
  // own property type still reads "Single Family". A hardcoded FeeSimple reads to an underwriter
  // as a verified fact about the collateral when nobody verified anything, and title will
  // contradict it later. An absent optional element reads as "not supplied", which is the truth;
  // collecting the estate belongs in the wizard and the LOS, not in a default here.
  // PropertyExistingCleanEnergyLienIndicator "false" is gone for the same reason: an EXISTING PACE
  // lien lives on the county tax bill, which we do not parse. The only clean-energy answer we hold
  // is the borrower's forward-looking 5a(7) declaration, already exported as
  // PropertyProposedCleanEnergyLienIndicator — and PACE is a California invention, so "no PACE
  // lien" was the riskiest possible default on our own book.
  // Tri-state now: `p.mixedUse === "Yes"` collapsed NOT ASKED into "not mixed use", a declaration
  // about the collateral on every storefront-with-an-apartment-over-it in Los Angeles. The wizard
  // does not ask it yet, so this will mostly be absent — which is what we actually know.
  pd += el("PropertyMixedUsageIndicator", ynIndicator(p.mixedUse), T(9));
  pd += el("PropertyUsageType", usage, T(9));
  // A PUD is established by the plat and the HOA documents, and in Southern California a detached
  // single-family house inside a PUD is ordinary — so "false" was not a safe default, it was an
  // answer only the appraisal settles. Emitted when the property type says so, omitted otherwise.
  pd += el("PUDIndicator", /\bpud\b|planned unit/i.test(String(p.propertyType || "")) ? "true" : undefined, T(9));
  if (pd) coll += `${T(8)}<PROPERTY_DETAIL>\n${pd}${T(8)}</PROPERTY_DETAIL>\n`;
  if (p.presentValue) {
    // SAY HOW THIS VALUE WAS ARRIVED AT. The Underwriting Desk BACKFILLS the property value from a
    // public-web automated valuation (a Zestimate) when the LO leaves it blank, and that figure
    // was previously exported to a wholesale lender as a bare PropertyValuationAmount — visually
    // and structurally identical to an appraised value. A lender who prices off it, or an
    // investor who reads the file, has no way to know it is a model output.
    //
    // PropertyValuationMethodType is the MISMO 3.4 field for exactly this. UNKNOWN provenance
    // emits "Other" with an explicit description rather than being silently omitted, because an
    // absent method reads as "not applicable", not as "we do not know".
    const METHOD: Record<string, { type: string; desc?: string }> = {
      appraisal:     { type: "FullAppraisal" },
      "recent-sale": { type: "Other", desc: "Recent recorded sale price from public records — not an appraisal" },
      avm:           { type: "AutomatedValuationModel", desc: "Public-web automated valuation (AVM) — unverified, not an appraisal" },
      entered:       { type: "Other", desc: "Value stated by the loan officer — no appraisal on file" },
      unknown:       { type: "Other", desc: "Source of value not recorded — treat as unverified" },
    };
    const m = METHOD[String(p.valueSource || "unknown")] || METHOD.unknown;
    coll += `${T(8)}<PROPERTY_VALUATIONS>\n${T(9)}<PROPERTY_VALUATION>\n${T(10)}<PROPERTY_VALUATION_DETAIL>\n`;
    coll += el("PropertyValuationAmount", money(p.presentValue), T(11));
    coll += el("PropertyValuationMethodType", m.type, T(11));
    if (m.desc) coll += el("PropertyValuationMethodTypeOtherDescription", m.desc, T(11));
    coll += `${T(10)}</PROPERTY_VALUATION_DETAIL>\n${T(9)}</PROPERTY_VALUATION>\n${T(8)}</PROPERTY_VALUATIONS>\n`;
  }
  const collateralBlock = coll
    ? `${T(5)}<COLLATERALS>\n${T(6)}<COLLATERAL>\n${T(7)}<SUBJECT_PROPERTY>\n${coll}${T(7)}</SUBJECT_PROPERTY>\n${T(6)}</COLLATERAL>\n${T(5)}</COLLATERALS>\n`
    : "";

  // ---------- LOAN ----------
  const l = u.loan;
  // Read before TERMS_OF_LOAN, not after: the subject loan's own LienPriorityType depends on
  // whether there is a senior lien, and the two used to be able to contradict each other.
  const senior = Number(l.existingLienBalance) || 0;
  const loanId = (u.meta.fileNumber || `${u.borrowers[0]?.lastName || "Borrower"}-${(u.meta.assembledAt || "").slice(0, 10)}`).replace(/\s+/g, "-");
  let loan = `${T(5)}<LOANS>\n${T(6)}<LOAN LoanRoleType="SubjectLoan" xlink:label="LOAN_1">\n`;
  // `|| "Fixed"` and `|| 360` invented a thirty-year fixed for any file whose terms nobody
  // recorded — a complete, plausible, fabricated note. lib/urla.ts does supply both for an
  // assembled file, so in practice this changes nothing there; what it stops is a hand-built or
  // partially-imported file acquiring terms on the way out the door. The container itself only
  // appears when there is something true to put in it, and PeriodType "Month" is genuinely
  // invariant (termMonths is a count of months by definition) but means nothing without a count.
  if (l.amortizationType || l.termMonths) {
    loan += `${T(7)}<AMORTIZATION>\n${T(8)}<AMORTIZATION_RULE>\n`;
    loan += el("AmortizationType", l.amortizationType, T(9));
    loan += el("LoanAmortizationPeriodCount", l.termMonths, T(9));
    loan += el("LoanAmortizationPeriodType", l.termMonths ? "Month" : undefined, T(9));
    loan += `${T(8)}</AMORTIZATION_RULE>\n${T(7)}</AMORTIZATION>\n`;
  }
  // THE DU URLA WRAPPER IS GONE, and it held exactly one thing: EstimatedClosingCostsAmount
  // hardcoded "0.00". We do not compute closing costs anywhere near this file — the Quick Pricer's
  // fee sheet is explicitly an ESTIMATE and explicitly not a Loan Estimate — so that zero was a
  // manufactured figure sitting in the one place a lender's import looks for the borrower's
  // cash-to-close. $0 in closing costs is not a rounding error: it is the difference between a
  // file that balances and one that does not, and it reads as a quoted number rather than a blank.
  // With it dropped the wrapper is empty, so the wrapper goes too; an absent optional container
  // reads as "not supplied", which is the truth.
  // LOAN_DETAIL
  loan += `${T(7)}<LOAN_DETAIL>\n`;
  // A twelve-month interest-only bridge or hard-money note does not amortize: the principal is due
  // in full at maturity, which is the definition of a balloon — and this said "false" on every one
  // of them, on the products we write most. Derived: interest-only over a term too short to
  // amortize is true; a loan whose amortization period IS its term is false; an interest-only loan
  // with a long term is a recast whose IO period we do not carry, so it says nothing.
  const termM = Number(l.termMonths) || undefined;
  loan += el("BalloonIndicator",
    l.interestOnly ? (termM && termM <= 120 ? "true" : undefined) : termM ? "false" : undefined, T(8));
  loan += el("BorrowerCount", u.borrowers.length, T(8));
  // Ground-up construction is in the programme set this CRM actually quotes, so a hardcoded
  // "false" misstated those files to the lender. Read off the product; omitted when there is no
  // product string to read. A rehab / fix-and-flip is deliberately NOT a construction loan.
  const productText = `${l.productDescription || ""} ${l.purpose || ""}`.trim();
  loan += el("ConstructionLoanIndicator",
    productText ? bool(/construction|ground.?up/i.test(productText)) : undefined, T(8));
  // Tri-state: `bool(!!l.interestOnly)` turned "nobody recorded the payment structure" into a
  // positive assertion that the loan amortizes.
  loan += el("InterestOnlyIndicator", typeof l.interestOnly === "boolean" ? bool(l.interestOnly) : undefined, T(8));
  // GENUINELY INVARIANT, and the one constant in this block that earns its place: there is no
  // negative-amortization product in the wholesale channel a broker can place post-Dodd-Frank, so
  // "false" is a statement about the product set, not an answer to an unanswered question.
  loan += el("NegativeAmortizationIndicator", "false", T(8));
  // NOT invariant, and this is the one that bites on a California investor file. A prepayment
  // penalty is STANDARD on DSCR and bridge paper — the 5/4/3/2/1 and 3-year step-downs — and we do
  // not carry the note's prepay terms anywhere, so "false" told the lender there is no penalty on
  // exactly the files that usually have one, misstating a material term of the note. On an
  // owner-occupied consumer loan it IS effectively invariant (Reg Z 1026.43 bars a penalty on a
  // non-QM or higher-priced loan, and Cal. Civ. Code §2954.9 limits it), so a primary residence or
  // second home still exports false; an investment or business-purpose file now exports nothing
  // rather than a term nobody read off a note.
  loan += el("PrepaymentPenaltyIndicator",
    usage === "PrimaryResidence" || usage === "SecondHome" ? "false" : undefined, T(8));
  loan += `${T(7)}</LOAN_DETAIL>\n`;
  loan += `${T(7)}<LOAN_IDENTIFIERS>\n${T(8)}<LOAN_IDENTIFIER>\n` + el("LoanIdentifier", loanId, T(9)) + el("LoanIdentifierType", "LenderLoan", T(9)) + `${T(8)}</LOAN_IDENTIFIER>\n${T(7)}</LOAN_IDENTIFIERS>\n`;
  loan += `${T(7)}<ORIGINATION_SYSTEMS>\n${T(8)}<ORIGINATION_SYSTEM>\n` + el("LoanOriginationSystemName", "Fetti Financial CRM", T(9)) + `${T(8)}</ORIGINATION_SYSTEM>\n${T(7)}</ORIGINATION_SYSTEMS>\n`;
  if ((l.purpose || "").toLowerCase().includes("refinance")) {
    loan += `${T(7)}<REFINANCE>\n` + el("RefinanceCashOutDeterminationType", (l.purpose || "").toLowerCase().includes("cash") ? "CashOut" : "NoCashOut", T(8)) + `${T(7)}</REFINANCE>\n`;
  }
  loan += `${T(7)}<TERMS_OF_LOAN>\n`;
  loan += el("BaseLoanAmount", money(l.amount), T(8));
  // Junior liens must export as SecondLien — a 2nd/HELOC delivered to a lender labeled a
  // first lien is a material misstatement. (1003 Sel writes "2" as a string; coerce.)
  // An UNRECORDED position used to fall through to FirstLien even on a file that also exports a
  // senior lien as a RelatedLoan FirstLien below — two first liens on one property, which is not a
  // thing, and the contradiction was ours to resolve, not the underwriter's. A disclosed senior
  // balance is proof this loan is junior. With neither stated, a file disclosing no other
  // financing on the subject is a first lien; that stays the documented default.
  loan += el("LienPriorityType",
    Number(l.lienPosition) === 2 ? "SecondLien"
      : Number(l.lienPosition) === 1 ? "FirstLien"
        : senior > 0 ? "SecondLien" : "FirstLien", T(8));
  // ULAD LoanPurposeType enum = Purchase | Refinance | Other. Cash-out is a Refinance here;
  // the cash-out detail is carried separately in RefinanceCashOutDeterminationType above.
  const purposeType = /(refinance|refi|cash)/i.test(l.purpose || "") ? "Refinance" : /purchase/i.test(l.purpose || "") ? "Purchase" : (l.purpose ? "Other" : "");
  loan += el("LoanPurposeType", purposeType, T(8));
  // "Other" with no description is unactionable — the lender has to call and ask, which is the
  // missing information this export keeps getting blamed for. Say what the product is.
  loan += el("LoanPurposeTypeOtherDescription", purposeType === "Other" ? l.productDescription || l.purpose : undefined, T(8));
  loan += el("MortgageType", mortgage.type, T(8));
  loan += el("MortgageTypeOtherDescription", mortgage.type === "Other" ? mortgage.desc : undefined, T(8));
  loan += el("NoteAmount", money(l.amount), T(8));
  loan += el("NoteRatePercent", l.noteRatePercent, T(8));
  loan += `${T(7)}</TERMS_OF_LOAN>\n`;
  loan += `${T(6)}</LOAN>\n`;

  // ---------- SENIOR LIEN (other financing on the subject) ----------
  // A junior loan is sized off CLTV, not LTV, so the senior balance is the BINDING input — and it
  // was being dropped between the Underwriting Desk and the export, handing a wholesale lender a
  // file that could not reproduce the max loan the Desk had just computed. Delivered as a sibling
  // LOAN with LoanRoleType="RelatedLoan", the standard MISMO 3.4 representation for other
  // financing secured by the subject property.
  if (senior > 0) {
    loan += `${T(6)}<LOAN LoanRoleType="RelatedLoan" xlink:label="LOAN_SENIOR">\n`;
    // The senior lien's LOAN_DETAIL carried one element — LoanAffordableIndicator "false" — a
    // subsidised / below-market-programme flag nobody asked, on a loan we know only the balance
    // and payment of. It was holding an otherwise empty container open; both are gone.
    if (Number(l.existingLienMonthlyPayment) > 0) {
      loan += `${T(7)}<PAYMENT>\n${T(8)}<PAYMENT_RULE>\n`;
      loan += el("InitialPrincipalAndInterestPaymentAmount", money(l.existingLienMonthlyPayment), T(9));
      loan += `${T(8)}</PAYMENT_RULE>\n${T(7)}</PAYMENT>\n`;
    }
    loan += `${T(7)}<TERMS_OF_LOAN>\n`;
    loan += el("BaseLoanAmount", money(senior), T(8));
    // The senior lien is the FIRST, whatever position the subject loan occupies.
    loan += el("LienPriorityType", "FirstLien", T(8));
    loan += el("NoteAmount", money(senior), T(8));
    loan += `${T(7)}</TERMS_OF_LOAN>\n`;
    loan += `${T(6)}</LOAN>\n`;
  }
  loan += `${T(5)}</LOANS>\n`;

  // ---------- PARTIES ----------
  let parties = `${T(5)}<PARTIES>\n`;
  let empSeq = 110;
  let incSeq = 1100;

  u.borrowers.forEach((b: UrlaBorrower, i) => {
    const roleLabel = borrowerLabels[i];
    const roleSeq = `1${i + 1}`;
    parties += `${T(6)}<PARTY>\n${T(7)}<INDIVIDUAL>\n`;
    // contact points
    if (b.cellPhone || b.email) {
      parties += `${T(8)}<CONTACT_POINTS>\n`;
      if (b.cellPhone) parties += `${T(9)}<CONTACT_POINT>\n${T(10)}<CONTACT_POINT_TELEPHONE>\n` + el("ContactPointTelephoneValue", String(b.cellPhone).replace(/\D/g, ""), T(11)) + `${T(10)}</CONTACT_POINT_TELEPHONE>\n${T(10)}<CONTACT_POINT_DETAIL>\n` + el("ContactPointRoleType", "Mobile", T(11)) + `${T(10)}</CONTACT_POINT_DETAIL>\n${T(9)}</CONTACT_POINT>\n`;
      if (b.email) parties += `${T(9)}<CONTACT_POINT>\n${T(10)}<CONTACT_POINT_EMAIL>\n` + el("ContactPointEmailValue", b.email, T(11)) + `${T(10)}</CONTACT_POINT_EMAIL>\n${T(9)}</CONTACT_POINT>\n`;
      parties += `${T(8)}</CONTACT_POINTS>\n`;
    }
    parties += `${T(8)}<NAME>\n` + el("FirstName", b.firstName, T(9)) + el("LastName", b.lastName, T(9)) + `${T(8)}</NAME>\n`;
    parties += `${T(7)}</INDIVIDUAL>\n`;
    // mailing address = current address
    if (b.currentAddress) parties += `${T(7)}<ADDRESSES>\n` + addr(b.currentAddress, T(8), el("AddressType", "Mailing", T(8) + "\t")) + `${T(7)}</ADDRESSES>\n`;
    parties += `${T(7)}<ROLES>\n${T(8)}<ROLE SequenceNumber="${roleSeq}" xlink:label="${roleLabel}">\n${T(9)}<BORROWER>\n`;
    // BORROWER_DETAIL — accumulated for the same reason as PROPERTY_DETAIL above: with the
    // fabricated dependent count and military indicator gone, a thin borrower record can have
    // nothing true to put in here, and an empty shell is not worth emitting.
    let bd = "";
    bd += el("BorrowerBirthDate", b.dob, T(11));
    // "No dependents" and "nobody asked" are different facts, and `?? 0` manufactured a childless
    // household on every file where the question never got answered. FHA and VA read the household
    // count straight off this element — VA residual income is a table lookup keyed on family size,
    // so a fabricated zero makes a veteran's file pass a test it was never measured against. An
    // explicitly stated 0 still exports as 0; el() only drops undefined.
    bd += el("DependentCount", b.dependentsCount ?? undefined, T(11));
    bd += el("MaritalStatusType", b.maritalStatus, T(11));
    // ── SECTION 7: MILITARY SERVICE ────────────────────────────────────────────────────────────
    // This was the string "false" on EVERY file ever exported, which is how a $0-down VA borrower
    // reaches a wholesale lender as a civilian. The question gates VA eligibility, the wizard has
    // asked it since 2026-09-09, and lib/urla.ts carries the answer in urla.military — the export
    // was simply not reading it. A hardcoded negative is worse than silence here: "never served"
    // is the one answer that costs a veteran the loan they qualify for, and an underwriter has no
    // reason to question an explicit declaration.
    //
    // Yes to ANY of the three (served / currently serving / surviving spouse) is the Section 7
    // gate, because the URLA question is "did you (or your deceased spouse) ever serve". All three
    // explicitly No is a real false. Nothing asked is OMITTED.
    //
    // Borrower 1 only. The data model holds ONE household answer and the wizard asks the primary
    // applicant, so attributing it to the co-borrower sitting next to them would be invented — and
    // the Certificate of Eligibility is what names the actual veteran anyway. Per-borrower Section
    // 7 collection is a wizard gap, not something to paper over here.
    const mil = i === 0 ? u.military || {} : {};
    const milAnswers = [mil.everServed, mil.currentlyServing, mil.survivingSpouse];
    bd += el("SelfDeclaredMilitaryServiceIndicator",
      milAnswers.some((v) => v === "Yes") ? "true" : milAnswers.some((v) => v === "No") ? "false" : undefined, T(11));
    if (bd) parties += `${T(10)}<BORROWER_DETAIL>\n${bd}${T(10)}</BORROWER_DETAIL>\n`;
    // income
    const inc = b.income || {};
    const items: [string, number | undefined, boolean][] = [
      ["Base", inc.base ?? (inc.total && !inc.overtime && !inc.bonus && !inc.commission ? inc.total : undefined), true],
      ["Overtime", inc.overtime, true], ["Bonus", inc.bonus, true], ["Commissions", inc.commission, true], ["Other", inc.other, false],
    ];
    const hasEmployer = !!(b.employment?.employerName);
    let employerLabel = "";
    const rentForFirst = i === 0 ? u.property.expectedMonthlyRentalIncome : undefined;
    if (items.some(([, v]) => v) || rentForFirst) {
      parties += `${T(10)}<CURRENT_INCOME>\n${T(11)}<CURRENT_INCOME_ITEMS>\n`;
      for (const [type, val, isEmp] of items) {
        if (!val) continue;
        incSeq += 1;
        const il = `CURRENT_INCOME_ITEM_${incSeq}`;
        parties += `${T(12)}<CURRENT_INCOME_ITEM SequenceNumber="${incSeq}" xlink:label="${il}">\n${T(13)}<CURRENT_INCOME_ITEM_DETAIL>\n`;
        parties += el("CurrentIncomeMonthlyTotalAmount", money(val), T(14));
        parties += el("EmploymentIncomeIndicator", bool(isEmp && hasEmployer), T(14));
        parties += el("IncomeType", type, T(14));
        parties += `${T(13)}</CURRENT_INCOME_ITEM_DETAIL>\n${T(12)}</CURRENT_INCOME_ITEM>\n`;
        if (isEmp && hasEmployer && type === "Base") employerLabel = il; // link base income to employer
      }
      if (rentForFirst) {
        incSeq += 1;
        parties += `${T(12)}<CURRENT_INCOME_ITEM SequenceNumber="${incSeq}" xlink:label="CURRENT_INCOME_ITEM_${incSeq}">\n${T(13)}<CURRENT_INCOME_ITEM_DETAIL>\n`;
        parties += el("CurrentIncomeMonthlyTotalAmount", money(rentForFirst), T(14));
        parties += el("EmploymentIncomeIndicator", "false", T(14));
        parties += el("IncomeType", "NetRentalIncome", T(14));
        // A RENT ZESTIMATE IS NOT A LEASE. Exported unlabelled it reads as documented rental
        // income on a DSCR file, which is the number the whole loan qualifies on — see the
        // lease-governs rule the income engine already enforces. Say what it is.
        if (String(p.rentSource || "unknown") !== "entered") {
          parties += el("IncomeDocumentationDescription",
            p.rentSource === "lease" ? "Rent per executed lease"
              : p.rentSource === "avm" ? "Estimated market rent from a public-web automated model — NOT a lease; verify before qualifying"
              : "Rent source not recorded — unverified, verify before qualifying", T(14));
        }
        parties += `${T(13)}</CURRENT_INCOME_ITEM_DETAIL>\n${T(12)}</CURRENT_INCOME_ITEM>\n`;
      }
      parties += `${T(11)}</CURRENT_INCOME_ITEMS>\n${T(10)}</CURRENT_INCOME>\n`;
    }
    // ── URLA SECTION 5 DECLARATIONS ────────────────────────────────────────────────────────
    // The wizard asks the borrower all fifteen declarations and stores each one separately.
    // Until 2026-10-07 this block emitted EIGHT elements, two of them wired to the WRONG source
    // field — so eleven answers a borrower actually gave were dropped between our form and the
    // lender's portal. That is the "missing information" Ramon kept finding in the MISMO files:
    // it was lost HERE, in the export, not left uncollected by the application.
    //
    // lib/mismoImport.ts::parseDeclarations reads the same six elements, so round-tripping a
    // file through our own importer looked lossless and hid this completely.
    //
    // ORDER IS ALPHABETICAL ON PURPOSE — the MISMO 3.4 DECLARATION_DETAIL sequence is ordered,
    // and a lender's parser can reject an out-of-order element. Keep new tags in place.
    const d = u.declarations || {};
    // "" means NOT ASKED. An Indicator has no "unknown" value, so OMIT it rather than assert a
    // negative the borrower never gave — an unanswered declaration exported as "false" is a
    // false statement on a loan application, which is worse than an absent one. el() drops
    // undefined. Use `||` not `??`: these fields are "" when unanswered, not null.
    const ynBool = (v?: string) => (v === "Yes" ? "true" : v === "No" ? "false" : undefined);
    const ynType = (v?: string) => (v === "Yes" ? "Yes" : v === "No" ? "No" : "Unknown");
    const chapters = String(d.bankruptcyChapters || "").split(/[^0-9]+/).filter(Boolean);
    parties += `${T(10)}<DECLARATION>\n${T(11)}<DECLARATION_DETAIL>\n`;
    parties += el("BankruptcyChapterElevenIndicator", chapters.includes("11") ? "true" : undefined, T(12));
    parties += el("BankruptcyChapterSevenIndicator", chapters.includes("7") ? "true" : undefined, T(12));
    parties += el("BankruptcyChapterThirteenIndicator", chapters.includes("13") ? "true" : undefined, T(12));
    parties += el("BankruptcyChapterTwelveIndicator", chapters.includes("12") ? "true" : undefined, T(12));
    // 5b(8). declaredBankruptcy is the Section 5 question; bankruptcyPast7Years is the older
    // combined "bankruptcy OR foreclosure in 7 years" the wizard asked before 2026-09-09.
    parties += el("BankruptcyIndicator", ynBool(d.declaredBankruptcy || d.bankruptcyPast7Years), T(12));
    // Not a declaration — the one ENUMERATED element in this alphabetical run, and it was going out
    // as whatever the intake typed ("US Citizen", "Permanent Resident"). ULAD allows exactly three
    // members, so free text here does not degrade gracefully: the receiving parser drops the
    // element and the 1003 arrives with no citizenship at all, which on a non-permanent resident
    // file is the difference between an eligible loan and a withdrawn one. See
    // citizenshipResidency() — unplaceable answers stay absent and surface in urlaCompleteness().
    parties += el("CitizenshipResidencyType", citizenshipResidency(b.citizenship), T(12));
    // 5a(2) — owned a property in the last three years. NOT `ownsOtherProperty`, which is a
    // different question (owns one NOW) and is what this element was previously fed.
    parties += el("HomeownerPastThreeYearsType", ynType(d.priorOwnershipLast3Years), T(12));
    parties += el("IntentToOccupyType", ynType(d.intendToOccupyAsPrimary), T(12));               // 5a(1)
    parties += el("OutstandingJudgmentsIndicator", ynBool(d.outstandingJudgments), T(12));       // 5b(2)
    parties += el("PartyToLawsuitIndicator", ynBool(d.partyToLawsuit), T(12));                   // 5b(4)
    parties += el("PresentlyDelinquentIndicator", ynBool(d.delinquentOnFederalDebt), T(12));     // 5b(3)
    parties += el("PriorPropertyDeedInLieuConveyedIndicator", ynBool(d.conveyedTitleInLieu), T(12));          // 5b(5)
    parties += el("PriorPropertyForeclosureCompletedIndicator", ynBool(d.propertyForeclosed || d.foreclosurePast7Years), T(12)); // 5b(7)
    parties += el("PriorPropertyShortSaleCompletedIndicator", ynBool(d.preForeclosureOrShortSale), T(12));    // 5b(6)
    parties += el("PropertyProposedCleanEnergyLienIndicator", ynBool(d.propertySubjectToLien), T(12));        // 5a(7) PACE
    parties += el("SpecialBorrowerSellerRelationshipIndicator", ynBool(d.relationshipWithSeller), T(12));     // 5a(3)
    // 5a(4). undisclosedBorrowedFunds is the Section 5 question; borrowingDownPayment is the
    // older, narrower one. Prefer the real field, fall back so pre-2026-09-09 leads still say
    // something true rather than nothing.
    parties += el("UndisclosedBorrowedFundsIndicator", ynBool(d.undisclosedBorrowedFunds || d.borrowingDownPayment), T(12));
    parties += el("UndisclosedComakerOfNoteIndicator", ynBool(d.coSignerOnUndisclosedDebt), T(12));           // 5b(1)
    parties += el("UndisclosedCreditApplicationIndicator", ynBool(d.applyingNewCredit), T(12));               // 5a(6)
    parties += el("UndisclosedMortgageApplicationIndicator", ynBool(d.applyingOtherMortgage), T(12));         // 5a(5)
    parties += `${T(11)}</DECLARATION_DETAIL>\n${T(10)}</DECLARATION>\n`;
    // employer
    if (hasEmployer) {
      empSeq += 1;
      const empLbl = `EMPLOYER_${empSeq}`;
      parties += `${T(10)}<EMPLOYERS>\n${T(11)}<EMPLOYER SequenceNumber="${empSeq}" xlink:label="${empLbl}">\n`;
      parties += `${T(12)}<LEGAL_ENTITY>\n${T(13)}<LEGAL_ENTITY_DETAIL>\n` + el("FullName", b.employment?.employerName, T(14)) + `${T(13)}</LEGAL_ENTITY_DETAIL>\n${T(12)}</LEGAL_ENTITY>\n`;
      if (b.employment?.employerAddress) parties += addr(b.employment.employerAddress, T(12));
      parties += `${T(12)}<EMPLOYMENT>\n`;
      parties += el("EmploymentBorrowerSelfEmployedIndicator", bool(b.employment?.selfEmployed), T(13));
      parties += el("EmploymentPositionDescription", b.employment?.position, T(13));
      parties += el("EmploymentStatusType", "Current", T(13));
      parties += el("EmploymentTimeInLineOfWorkMonthsCount", b.employment?.yearsInLineOfWork ? Math.round(b.employment.yearsInLineOfWork * 12) : undefined, T(13));
      parties += `${T(12)}</EMPLOYMENT>\n${T(11)}</EMPLOYER>\n${T(10)}</EMPLOYERS>\n`;
      if (employerLabel) rel("CURRENT_INCOME_ITEM_IsAssociatedWith_EMPLOYER", employerLabel, empLbl);
    }
    // ── SECTION 8: GOVERNMENT MONITORING (HMDA / Reg B §1002.13) ───────────────────────────────
    // Three defects, each of which made this block tell the lender something untrue:
    //
    //  1. RACE WAS COLLECTED AND NEVER EXPORTED. There was no race container in this file at all,
    //     while HMDARaceRefusalIndicator was free to say "false" — "this applicant DID provide
    //     their race" — with no race anywhere in the document. The borrower answered a question
    //     the law requires us to ask, and the answer died in the exporter.
    //  2. THE REFUSAL INDICATORS WERE COMPUTED FROM BORROWER 1 AND EMITTED FOR EVERY BORROWER, so
    //     a co-borrower nobody ever asked inherited the primary's answers. Demographics are
    //     deal-level in the data model and the wizard asks only the primary applicant, so only
    //     borrower 1 can carry them; a co-borrower's HMDA data is a collection gap, and inferring
    //     it from the person next to them is exactly the invention this file refuses elsewhere.
    //  3. A FILE WHERE THE QUESTION WAS NEVER ASKED exported all three refusals as "true" —
    //     asserting the borrower REFUSED. Reg B distinguishes a refusal, which we must record,
    //     from an application that never made the request; only the first is a fact about the
    //     borrower, and only the first is ours to report. Never asked now means no block, and
    //     urlaCompleteness() already lists the demographics request as a gap to close.
    //
    // A refusal indicator is now tied to what this file actually DELIVERS: "false" is only ever
    // written next to a value the lender can read. A per-field "I'd rather not say" reaches us as
    // an absent value with providedVoluntarily still true, and comes out as a refusal on that
    // field alone, which is what the borrower did.
    const dm = i === 0 ? u.demographics || {} : {};
    const declined = dm.providedVoluntarily === false;
    const hmdaAsked = dm.providedVoluntarily !== undefined || !!(dm.ethnicity || dm.race || dm.sex);
    const race = enumOf(HMDA_RACE, dm.race);
    const ethnicity = enumOf(HMDA_ETHNICITY, dm.ethnicity);
    const gender = enumOf(HMDA_GENDER, dm.sex);
    if (hmdaAsked) {
      parties += `${T(10)}<GOVERNMENT_MONITORING>\n${T(11)}<GOVERNMENT_MONITORING_DETAIL>\n`;
      parties += el("HMDAEthnicityRefusalIndicator", bool(declined || !ethnicity), T(12));
      parties += el("HMDAGenderRefusalIndicator", bool(declined || !gender), T(12));
      parties += el("HMDARaceRefusalIndicator", bool(declined || !race), T(12));
      parties += `${T(12)}<EXTENSION>\n${T(13)}<OTHER>\n${T(14)}<ULAD:GOVERNMENT_MONITORING_DETAIL_EXTENSION>\n`;
      parties += el("ULAD:ApplicationTakenMethodType", "Internet", T(15));
      parties += el("ULAD:HMDAGenderType", gender, T(15));
      parties += `${T(14)}</ULAD:GOVERNMENT_MONITORING_DETAIL_EXTENSION>\n${T(13)}</OTHER>\n${T(12)}</EXTENSION>\n`;
      parties += `${T(11)}</GOVERNMENT_MONITORING_DETAIL>\n`;
      // HMDA_RACES is native MISMO 3.4 — ethnicity is the one that needs the ULAD extension, which
      // is why the two sit at different depths — and it is precisely where lib/mismoImport.ts has
      // always looked for the race it could never find, because we never wrote it.
      if (race) {
        parties += `${T(11)}<HMDA_RACES>\n${T(12)}<HMDA_RACE>\n${T(13)}<HMDA_RACE_DETAIL>\n`;
        parties += el("HMDARaceType", race, T(14));
        parties += `${T(13)}</HMDA_RACE_DETAIL>\n${T(12)}</HMDA_RACE>\n${T(11)}</HMDA_RACES>\n`;
      }
      if (ethnicity) {
        parties += `${T(11)}<EXTENSION>\n${T(12)}<OTHER>\n${T(13)}<ULAD:GOVERNMENT_MONITORING_EXTENSION>\n${T(14)}<ULAD:HMDA_ETHNICITIES>\n${T(15)}<ULAD:HMDA_ETHNICITY>\n`;
        parties += el("ULAD:HMDAEthnicityType", ethnicity, T(16));
        parties += `${T(15)}</ULAD:HMDA_ETHNICITY>\n${T(14)}</ULAD:HMDA_ETHNICITIES>\n${T(13)}</ULAD:GOVERNMENT_MONITORING_EXTENSION>\n${T(12)}</OTHER>\n${T(11)}</EXTENSION>\n`;
      }
      parties += `${T(10)}</GOVERNMENT_MONITORING>\n`;
    }
    // residence
    if (b.currentAddress) {
      parties += `${T(10)}<RESIDENCES>\n${T(11)}<RESIDENCE>\n`;
      parties += addr(b.currentAddress, T(12));
      parties += `${T(12)}<RESIDENCE_DETAIL>\n`;
      parties += el("BorrowerResidencyBasisType", b.housingStatus === "Own" ? "Own" : b.housingStatus === "Rent" ? "Rent" : "", T(13));
      parties += el("BorrowerResidencyDurationMonthsCount", b.yearsAtAddress ? Math.round(b.yearsAtAddress * 12) : undefined, T(13));
      parties += el("BorrowerResidencyType", "Current", T(13));
      parties += `${T(12)}</RESIDENCE_DETAIL>\n${T(11)}</RESIDENCE>\n${T(10)}</RESIDENCES>\n`;
    }
    parties += `${T(9)}</BORROWER>\n${T(9)}<ROLE_DETAIL>\n` + el("PartyRoleType", "Borrower", T(10)) + `${T(9)}</ROLE_DETAIL>\n${T(8)}</ROLE>\n${T(7)}</ROLES>\n`;
    // taxpayer id (SSN)
    if (b.ssn) {
      parties += `${T(7)}<TAXPAYER_IDENTIFIERS>\n${T(8)}<TAXPAYER_IDENTIFIER>\n`;
      parties += el("TaxpayerIdentifierType", "SocialSecurityNumber", T(9));
      parties += el("TaxpayerIdentifierValue", ssnDigits(b.ssn), T(9));
      parties += `${T(8)}</TAXPAYER_IDENTIFIER>\n${T(7)}</TAXPAYER_IDENTIFIERS>\n`;
    }
    parties += `${T(6)}</PARTY>\n`;
  });

  // joint credit relationship for co-borrowers
  for (let i = 1; i < borrowerLabels.length; i++) rel("ROLE_SharesJointCreditReportWith_ROLE", borrowerLabels[i], borrowerLabels[0]);

  // ---------- Loan Originator PARTY ----------
  const o = u.originator || {};
  parties += `${T(6)}<PARTY>\n${T(7)}<INDIVIDUAL>\n`;
  if (o.email) parties += `${T(8)}<CONTACT_POINTS>\n${T(9)}<CONTACT_POINT>\n${T(10)}<CONTACT_POINT_EMAIL>\n` + el("ContactPointEmailValue", o.email, T(11)) + `${T(10)}</CONTACT_POINT_EMAIL>\n${T(9)}</CONTACT_POINT>\n${T(8)}</CONTACT_POINTS>\n`;
  parties += `${T(8)}<NAME>\n` + el("FullName", o.name, T(9)) + `${T(8)}</NAME>\n${T(7)}</INDIVIDUAL>\n`;
  parties += `${T(7)}<ROLES>\n${T(8)}<ROLE SequenceNumber="1" xlink:label="LOAN_ORIGINATOR_11">\n${T(9)}<LICENSES>\n`;
  if (o.nmls) parties += `${T(10)}<LICENSE>\n${T(11)}<LICENSE_DETAIL>\n` + el("LicenseAuthorityLevelType", "Private", T(12)) + el("LicenseIdentifier", o.nmls, T(12)) + `${T(11)}</LICENSE_DETAIL>\n${T(10)}</LICENSE>\n`;
  if (o.stateLicense) parties += `${T(10)}<LICENSE>\n${T(11)}<LICENSE_DETAIL>\n` + el("LicenseAuthorityLevelType", "PublicState", T(12)) + el("LicenseIdentifier", o.stateLicense, T(12)) + `${T(11)}</LICENSE_DETAIL>\n${T(10)}</LICENSE>\n`;
  parties += `${T(9)}</LICENSES>\n${T(9)}<ROLE_DETAIL>\n` + el("PartyRoleType", "LoanOriginator", T(10)) + `${T(9)}</ROLE_DETAIL>\n${T(8)}</ROLE>\n${T(7)}</ROLES>\n${T(6)}</PARTY>\n`;

  // ---------- Loan Origination Company PARTY ----------
  parties += `${T(6)}<PARTY>\n${T(7)}<LEGAL_ENTITY>\n${T(8)}<LEGAL_ENTITY_DETAIL>\n` + el("FullName", o.company, T(9)) + `${T(8)}</LEGAL_ENTITY_DETAIL>\n${T(7)}</LEGAL_ENTITY>\n`;
  if (o.companyAddress) parties += `${T(7)}<ADDRESSES>\n` + addr(o.companyAddress, T(8)) + `${T(7)}</ADDRESSES>\n`;
  parties += `${T(7)}<ROLES>\n${T(8)}<ROLE SequenceNumber="2" xlink:label="LOAN_ORIGINATION_COMPANY_12">\n${T(9)}<LICENSES>\n`;
  if (o.companyNmls) parties += `${T(10)}<LICENSE>\n${T(11)}<LICENSE_DETAIL>\n` + el("LicenseAuthorityLevelType", "Private", T(12)) + el("LicenseIdentifier", o.companyNmls, T(12)) + `${T(11)}</LICENSE_DETAIL>\n${T(10)}</LICENSE>\n`;
  if (o.stateLicense) parties += `${T(10)}<LICENSE>\n${T(11)}<LICENSE_DETAIL>\n` + el("LicenseAuthorityLevelType", "PublicState", T(12)) + el("LicenseIdentifier", o.stateLicense, T(12)) + `${T(11)}</LICENSE_DETAIL>\n${T(10)}</LICENSE>\n`;
  parties += `${T(9)}</LICENSES>\n${T(9)}<ROLE_DETAIL>\n` + el("PartyRoleType", "LoanOriginationCompany", T(10)) + `${T(9)}</ROLE_DETAIL>\n${T(8)}</ROLE>\n${T(7)}</ROLES>\n${T(6)}</PARTY>\n`;

  parties += `${T(5)}</PARTIES>\n`;

  const relationships = rels.length ? `${T(5)}<RELATIONSHIPS>\n${rels.join("\n")}\n${T(5)}</RELATIONSHIPS>\n` : "";

  const header =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<MESSAGE xsi:schemaLocation="http://www.mismo.org/residential/2009/schemas DU_Wrapper_3.4.0_B324.xsd" MISMOReferenceModelIdentifier="3.4.032420160128" ` +
    `xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:DU="http://www.datamodelextension.org/Schema/DU" ` +
    `xmlns:ULAD="http://www.datamodelextension.org/Schema/ULAD" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `${T(1)}<ABOUT_VERSIONS>\n${T(2)}<ABOUT_VERSION>\n${T(3)}<AboutVersionIdentifier>DU Spec 1.8.5</AboutVersionIdentifier>\n${T(3)}<CreatedDatetime>${esc(u.meta.assembledAt)}</CreatedDatetime>\n${T(2)}</ABOUT_VERSION>\n${T(1)}</ABOUT_VERSIONS>\n` +
    `${T(1)}<DEAL_SETS>\n${T(2)}<DEAL_SET>\n${T(3)}<DEALS>\n${T(4)}<DEAL>\n`;
  const footer = `${T(4)}</DEAL>\n${T(3)}</DEALS>\n${T(2)}</DEAL_SET>\n${T(1)}</DEAL_SETS>\n</MESSAGE>\n`;

  // DEAL children are alphabetical: ASSETS, COLLATERALS, LIABILITIES, LOANS, PARTIES,
  // RELATIONSHIPS. LIABILITIES belongs between the collateral and the loan.
  return header + assetsBlock + collateralBlock + liabilitiesBlock + loan + parties + relationships + footer;
}
