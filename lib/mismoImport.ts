// MISMO 3.4 (DU/ULAD) 1003 importer — the inverse of lib/mismo.ts.
// Parses a Calyx Point (or any MISMO 3.4) loan export into our structured URLA
// object so an LO can upload a file and have the whole 1003 land in the editor,
// fully editable, with nothing lost. Pure parsing only — no DB, no secrets.
import { XMLParser } from "fast-xml-parser";
import type {
  Urla, UrlaBorrower, UrlaAddress, UrlaAsset, UrlaLiability,
  UrlaDeclarations, UrlaDemographics, UrlaOriginator,
} from "./urla";
import { normalizeState } from "./urla";

export interface MismoImportResult {
  urla: Partial<Urla> & { borrowers: UrlaBorrower[] };
  summary: {
    borrowers: number;
    borrowerNames: string[];
    lenderLoanId?: string;
    originationSystem?: string;
    propertyAddress?: string;
    loanPurpose?: string;
    assets: number;
    liabilities: number;
  };
  warnings: string[];
}

// ---- small, defensive helpers (the tree is irregular: single node vs array) ----
const arr = <T,>(x: T | T[] | undefined | null): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];

const s = (v: any): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "object") return "#text" in v ? s((v as any)["#text"]) : undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
};

const n = (v: any): number | undefined => {
  const t = s(v);
  if (t == null) return undefined;
  const num = Number(t.replace(/[^0-9.\-]/g, ""));
  return isNaN(num) ? undefined : num;
};

const bool = (v: any): boolean | undefined => {
  const t = s(v);
  if (t == null) return undefined;
  return /^(true|yes|y|1)$/i.test(t);
};
const ynFromBool = (v: any): "Yes" | "No" | undefined => {
  const b = bool(v);
  return b === undefined ? undefined : b ? "Yes" : "No";
};
const ynFromText = (v: any): "Yes" | "No" | undefined => {
  const t = s(v);
  if (!t) return undefined;
  if (/^yes$/i.test(t)) return "Yes";
  if (/^no$/i.test(t)) return "No";
  return undefined;
};

function addr(a: any): UrlaAddress | undefined {
  if (!a) return undefined;
  const unit = s(a.AddressUnitIdentifier);
  const street = [s(a.AddressLineText), unit ? `#${unit}` : undefined].filter(Boolean).join(" ");
  const out: UrlaAddress = {
    street: street || undefined,
    city: s(a.CityName),
    state: normalizeState(s(a.StateCode)),
    zip: s(a.PostalCode),
    country: s(a.CountryCode) || "US",
  };
  return out.street || out.city || out.state || out.zip ? out : undefined;
}
function addrLine(a?: UrlaAddress): string | undefined {
  if (!a) return undefined;
  return [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ") || undefined;
}

// MISMO enum -> the exact values the 1003 editor's dropdowns expect.
const OCCUPANCY: Record<string, string> = {
  PrimaryResidence: "PrimaryResidence", SecondHome: "SecondHome",
  Investment: "Investment", Investor: "Investment",
};
const AMORT: Record<string, string> = { Fixed: "Fixed", AdjustableRate: "ARM", ARM: "ARM" };
const INCOME_KEY: Record<string, keyof NonNullable<UrlaBorrower["income"]>> = {
  Base: "base", Overtime: "overtime", Bonus: "bonus", Commission: "commission",
};

function parseBorrower(party: any, role: any): UrlaBorrower {
  const ind = party.INDIVIDUAL || {};
  const name = ind.NAME || {};
  const b: UrlaBorrower = {};
  b.firstName = s(name.FirstName);
  b.lastName = s(name.LastName);
  b.fullName = s(name.FullName) || [b.firstName, b.lastName].filter(Boolean).join(" ") || undefined;

  for (const cp of arr(ind.CONTACT_POINTS?.CONTACT_POINT)) {
    const email = s(cp.CONTACT_POINT_EMAIL?.ContactPointEmailValue);
    if (email) b.email = email;
    const tel = s(cp.CONTACT_POINT_TELEPHONE?.ContactPointTelephoneValue);
    if (tel) {
      const roleT = s(cp.CONTACT_POINT_DETAIL?.ContactPointRoleType);
      if (roleT === "Home" && !b.homePhone) b.homePhone = tel;
      else if (!b.cellPhone) b.cellPhone = tel;
    }
  }

  for (const ti of arr(party.TAXPAYER_IDENTIFIERS?.TAXPAYER_IDENTIFIER)) {
    if (s(ti.TaxpayerIdentifierType) === "SocialSecurityNumber") {
      const raw = (s(ti.TaxpayerIdentifierValue) || "").replace(/\D/g, "");
      b.ssn = raw.length === 9 ? `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5)}` : raw || undefined;
    }
  }

  const bor = role?.BORROWER || {};
  const det = bor.BORROWER_DETAIL || {};
  b.dob = s(det.BorrowerBirthDate);
  b.maritalStatus = s(det.MaritalStatusType);
  b.dependentsCount = n(det.DependentCount);
  b.citizenship = s(bor.DECLARATION?.DECLARATION_DETAIL?.CitizenshipResidencyType);

  const incItems = arr(bor.CURRENT_INCOME?.CURRENT_INCOME_ITEMS?.CURRENT_INCOME_ITEM);
  if (incItems.length) {
    const income: Record<string, number> = {};
    for (const it of incItems) {
      const d = it.CURRENT_INCOME_ITEM_DETAIL || {};
      const amt = n(d.CurrentIncomeMonthlyTotalAmount);
      if (amt == null) continue;
      const key = INCOME_KEY[s(d.IncomeType) || ""] || "other";
      income[key] = (income[key] || 0) + amt;
    }
    income.total = Object.values(income).reduce((x, y) => x + (y || 0), 0);
    if (Object.keys(income).length) b.income = income;
  }

  const employers = arr(bor.EMPLOYERS?.EMPLOYER);
  const primary =
    employers.find((e) => s(e.EMPLOYMENT?.EmploymentClassificationType) === "Primary") || employers[0];
  if (primary) {
    const emp = primary.EMPLOYMENT || {};
    const months = n(emp.EmploymentTimeInLineOfWorkMonthsCount);
    const e: NonNullable<UrlaBorrower["employment"]> = {
      employerName: s(primary.LEGAL_ENTITY?.LEGAL_ENTITY_DETAIL?.FullName),
      employerAddress: addr(primary.ADDRESS),
      position: s(emp.EmploymentPositionDescription),
      selfEmployed: bool(emp.EmploymentBorrowerSelfEmployedIndicator),
      yearsInLineOfWork: months != null ? Math.round((months / 12) * 10) / 10 : undefined,
    };
    if (e.employerName || e.position || e.yearsInLineOfWork != null) b.employment = e;
  }

  const residences = arr(bor.RESIDENCES?.RESIDENCE);
  const current =
    residences.find((r) => s(r.RESIDENCE_DETAIL?.BorrowerResidencyType) === "Current") || residences[0];
  if (current) {
    b.currentAddress = addr(current.ADDRESS);
    const basis = s(current.RESIDENCE_DETAIL?.BorrowerResidencyBasisType);
    b.housingStatus = basis === "Own" ? "Own" : basis === "Rent" ? "Rent" : basis ? "NoPrimaryHousingExpense" : undefined;
    const months = n(current.RESIDENCE_DETAIL?.BorrowerResidencyDurationMonthsCount);
    if (months != null) b.yearsAtAddress = Math.round((months / 12) * 10) / 10;
    const rent = n(current.LANDLORD?.LANDLORD_DETAIL?.MonthlyRentAmount);
    if (rent != null) b.monthlyHousingExpense = rent;
  }
  if (!b.currentAddress) {
    const mailing =
      arr(party.ADDRESSES?.ADDRESS).find((a) => s(a.AddressType) === "Mailing") ||
      arr(party.ADDRESSES?.ADDRESS)[0];
    if (mailing) b.currentAddress = addr(mailing);
  }

  // strip undefined keys so the merge never overwrites real data with blanks
  return JSON.parse(JSON.stringify(b));
}

function parseDeclarations(role: any): Partial<UrlaDeclarations> {
  const d = role?.BORROWER?.DECLARATION?.DECLARATION_DETAIL || {};
  const out: Partial<UrlaDeclarations> = {};
  const set = (k: keyof UrlaDeclarations, v: any) => { const yn = ynFromBool(v); if (yn) out[k] = yn; };
  set("bankruptcyPast7Years", d.BankruptcyIndicator);
  set("foreclosurePast7Years", d.PriorPropertyForeclosureCompletedIndicator);
  set("outstandingJudgments", d.OutstandingJudgmentsIndicator);
  set("partyToLawsuit", d.PartyToLawsuitIndicator);
  set("borrowingDownPayment", d.UndisclosedBorrowedFundsIndicator);
  const occ = ynFromText(d.IntentToOccupyType);
  if (occ) out.intendToOccupyAsPrimary = occ;
  return out;
}

function parseDemographics(role: any): Partial<UrlaDemographics> {
  const gm = role?.BORROWER?.GOVERNMENT_MONITORING;
  if (!gm) return {};
  const out: Partial<UrlaDemographics> = {};
  const sex = s(gm.GOVERNMENT_MONITORING_DETAIL?.EXTENSION?.OTHER?.GOVERNMENT_MONITORING_DETAIL_EXTENSION?.HMDAGenderType);
  if (sex === "Female" || sex === "Male") out.sex = sex;
  const race = s(arr(gm.HMDA_RACES?.HMDA_RACE)[0]?.HMDA_RACE_DETAIL?.HMDARaceType);
  if (race) out.race = race;
  const eth = s(arr(gm.EXTENSION?.OTHER?.GOVERNMENT_MONITORING_EXTENSION?.HMDA_ETHNICITIES?.HMDA_ETHNICITY)[0]?.HMDAEthnicityType);
  if (eth) out.ethnicity = eth;
  if (out.sex || out.race || out.ethnicity) out.providedVoluntarily = true;
  return out;
}

function parseOriginator(party: any, roles: any[]): Partial<UrlaOriginator> {
  const out: Partial<UrlaOriginator> = {};
  const roleTypes = roles.map((r) => s(r.ROLE_DETAIL?.PartyRoleType));
  const isCompany = roleTypes.includes("LoanOriginationCompany");
  const name = s(party.INDIVIDUAL?.NAME?.FullName) || s(party.LEGAL_ENTITY?.LEGAL_ENTITY_DETAIL?.FullName);
  const role = roles.find((r) => /LoanOriginat/.test(s(r.ROLE_DETAIL?.PartyRoleType) || ""));
  let nmls: string | undefined, stateLic: string | undefined;
  for (const lic of arr(role?.LICENSES?.LICENSE)) {
    const d = lic.LICENSE_DETAIL || {};
    if (s(d.LicenseAuthorityLevelType) === "Private") nmls = s(d.LicenseIdentifier);
    else if (s(d.LicenseAuthorityLevelType) === "PublicState") stateLic = s(d.LicenseIdentifier);
  }
  if (isCompany) {
    if (name) out.company = name;
    if (nmls) out.companyNmls = nmls;
    out.companyAddress = addr(arr(party.ADDRESSES?.ADDRESS)[0]) || undefined;
  } else {
    if (name) out.name = name;
    if (nmls) out.nmls = nmls;
    if (stateLic) out.stateLicense = stateLic;
    for (const cp of arr(party.INDIVIDUAL?.CONTACT_POINTS?.CONTACT_POINT)) {
      const email = s(cp.CONTACT_POINT_EMAIL?.ContactPointEmailValue);
      if (email) out.email = email;
    }
  }
  return JSON.parse(JSON.stringify(out));
}

export function parseMismo34(xml: string): MismoImportResult {
  const warnings: string[] = [];
  // parseTagValue:false keeps ZIPs/SSNs/phones as strings (no leading-zero loss);
  // removeNSPrefix flattens ULAD:/DU:/xlink: so the tree reads cleanly.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  let root: any;
  try { root = parser.parse(xml); }
  catch (e: any) { throw new Error("Could not parse the XML: " + (e?.message || "invalid XML")); }

  const msg = root?.MESSAGE;
  if (!msg) throw new Error("This isn't a MISMO file — no <MESSAGE> root element found.");

  const dealSet = arr(msg.DEAL_SETS?.DEAL_SET)[0];
  const deal = arr(arr(dealSet?.DEALS)[0]?.DEAL)[0];
  if (!deal) throw new Error("MISMO file contains no DEAL / loan data.");

  const borrowers: UrlaBorrower[] = [];
  let declarations: Partial<UrlaDeclarations> = {};
  let demographics: Partial<UrlaDemographics> = {};
  let originator: Partial<UrlaOriginator> = {};

  for (const p of arr(deal.PARTIES?.PARTY)) {
    const roles = arr(p.ROLES?.ROLE);
    const borRole = roles.find((r) => s(r.ROLE_DETAIL?.PartyRoleType) === "Borrower");
    if (borRole) {
      borrowers.push(parseBorrower(p, borRole));
      if (borrowers.length === 1) {
        declarations = parseDeclarations(borRole);
        demographics = parseDemographics(borRole);
      }
      continue;
    }
    if (roles.some((r) => /LoanOriginat/.test(s(r.ROLE_DETAIL?.PartyRoleType) || ""))) {
      originator = { ...originator, ...parseOriginator(p, roles) };
    }
  }
  if (!borrowers.length) warnings.push("No borrower party found in the file.");

  // Subject property
  const subj = arr(deal.COLLATERALS?.COLLATERAL)[0]?.SUBJECT_PROPERTY || {};
  const property: Urla["property"] = {};
  property.address = addr(subj.ADDRESS);
  const usage = s(subj.PROPERTY_DETAIL?.PropertyUsageType);
  if (usage) property.occupancy = OCCUPANCY[usage];
  const valuation = n(arr(subj.PROPERTY_VALUATIONS?.PROPERTY_VALUATION)[0]?.PROPERTY_VALUATION_DETAIL?.PropertyValuationAmount);
  const salesAmt = n(arr(subj.SALES_CONTRACTS?.SALES_CONTRACT)[0]?.SALES_CONTRACT_DETAIL?.SalesContractAmount);
  if (valuation && valuation > 0) property.presentValue = valuation;
  else if (salesAmt && salesAmt > 0) property.presentValue = salesAmt;

  // Subject loan
  const loanNode =
    arr(deal.LOANS?.LOAN).find((l) => s(l["@_LoanRoleType"]) === "SubjectLoan") ||
    arr(deal.LOANS?.LOAN)[0] || {};
  const loan: Urla["loan"] = {};
  const amortRule = loanNode.AMORTIZATION?.AMORTIZATION_RULE || {};
  const amortType = s(amortRule.AmortizationType);
  if (amortType) loan.amortizationType = AMORT[amortType] || amortType;
  const term = n(amortRule.LoanAmortizationPeriodCount);
  if (term) loan.termMonths = term;
  const terms = loanNode.TERMS_OF_LOAN || {};
  const purpose = s(terms.LoanPurposeType);
  if (purpose) loan.purpose = purpose;
  const mtg = s(terms.MortgageType);
  if (mtg) loan.loanType = ["Conventional", "FHA", "VA", "USDA", "Other"].includes(mtg) ? mtg : "Other";
  const amt = n(terms.NoteAmount) ?? n(terms.BaseLoanAmount) ?? n(loanNode.LOAN_DETAIL?.BaseLoanAmount);
  if (amt) loan.amount = amt;
  if (!loan.amount) warnings.push("No base loan amount in the file — enter it in the 1003 (this Point export often omits it).");
  const lenderLoanId = s(
    arr(loanNode.LOAN_IDENTIFIERS?.LOAN_IDENTIFIER).find((i) => s(i.LoanIdentifierType) === "LenderLoan")?.LoanIdentifier
  );
  const originationSystem = s(loanNode.ORIGINATION_SYSTEMS?.ORIGINATION_SYSTEM?.LoanOriginationSystemName);

  // Assets
  const assets: UrlaAsset[] = [];
  for (const a of arr(deal.ASSETS?.ASSET)) {
    const d = a.ASSET_DETAIL || {};
    const asset: UrlaAsset = {
      type: s(d.AssetType),
      institution: s(a.ASSET_HOLDER?.NAME?.FullName),
      accountNumber: s(a.ASSET_HOLDER?.ASSET_ACCOUNT_IDENTIFIER),
      balance: n(d.AssetCashOrMarketValueAmount),
    };
    if (asset.type || asset.institution || asset.balance != null) assets.push(JSON.parse(JSON.stringify(asset)));
  }

  // Liabilities
  const liabilities: UrlaLiability[] = [];
  for (const l of arr(deal.LIABILITIES?.LIABILITY)) {
    const d = l.LIABILITY_DETAIL || {};
    const liab: UrlaLiability = {
      type: s(d.LiabilityType),
      creditor: s(l.LIABILITY_HOLDER?.NAME?.FullName),
      balance: n(d.LiabilityUnpaidBalanceAmount),
      monthlyPayment: n(d.LiabilityMonthlyPaymentAmount),
    };
    if (liab.type || liab.creditor || liab.balance != null) liabilities.push(JSON.parse(JSON.stringify(liab)));
  }

  const urla: MismoImportResult["urla"] = { borrowers, property, loan, assets, liabilities };
  if (Object.keys(declarations).length) urla.declarations = declarations as UrlaDeclarations;
  if (Object.keys(demographics).length) urla.demographics = demographics as UrlaDemographics;
  if (Object.keys(originator).length) urla.originator = originator as UrlaOriginator;

  return {
    urla,
    summary: {
      borrowers: borrowers.length,
      borrowerNames: borrowers.map((b) => b.fullName || [b.firstName, b.lastName].filter(Boolean).join(" ")).filter(Boolean) as string[],
      lenderLoanId,
      originationSystem,
      propertyAddress: addrLine(property.address),
      loanPurpose: loan.purpose,
      assets: assets.length,
      liabilities: liabilities.length,
    },
    warnings,
  };
}
