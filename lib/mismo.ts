// MISMO 3.4 (DU wrapper / ULAD) exporter. Modeled to match a real Calyx Point
// DU export (DU_Wrapper_3.4.0_B324.xsd, MISMOReferenceModelIdentifier
// 3.4.032420160128): deal-level ASSETS with RELATIONSHIPS linking to borrowers,
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
    assetsXml += el("AssetType", a.type || "CheckingAccount", T(8));
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
    assetsXml += el("OwnedPropertyLienUPBAmount", money(r.mortgageBalance) || "0.00", T(9));
    assetsXml += el("OwnedPropertyDispositionStatusType", r.status, T(9));
    assetsXml += el("OwnedPropertyMaintenanceExpenseAmount", money(r.monthlyMortgage), T(9));
    assetsXml += el("OwnedPropertyRentalIncomeGrossAmount", money(r.monthlyRentalIncome), T(9));
    assetsXml += `${T(8)}</OWNED_PROPERTY_DETAIL>\n${T(8)}<PROPERTY>\n`;
    assetsXml += addr(r.address, T(9));
    assetsXml += `${T(8)}</PROPERTY>\n${T(7)}</OWNED_PROPERTY>\n${T(6)}</ASSET>\n`;
    borrowerLabels.forEach((bl) => rel("ASSET_IsAssociatedWith_ROLE", label, bl));
  }
  const assetsBlock = assetsXml ? `${T(5)}<ASSETS>\n${assetsXml}${T(5)}</ASSETS>\n` : "";

  // ---------- COLLATERAL / SUBJECT PROPERTY ----------
  const p = u.property;
  let coll = `${T(5)}<COLLATERALS>\n${T(6)}<COLLATERAL>\n${T(7)}<SUBJECT_PROPERTY>\n`;
  coll += addr(p.address, T(8));
  coll += `${T(8)}<PROPERTY_DETAIL>\n`;
  coll += el("CommunityPropertyStateIndicator", "false", T(9));
  coll += el("FHASecondaryResidenceIndicator", "false", T(9));
  coll += el("PropertyEstateType", "FeeSimple", T(9));
  coll += el("PropertyExistingCleanEnergyLienIndicator", "false", T(9));
  coll += el("PropertyMixedUsageIndicator", bool(p.mixedUse === "Yes"), T(9));
  coll += el("PropertyUsageType", p.occupancy || "PrimaryResidence", T(9));
  coll += el("PUDIndicator", "false", T(9));
  coll += `${T(8)}</PROPERTY_DETAIL>\n`;
  if (p.presentValue) {
    coll += `${T(8)}<PROPERTY_VALUATIONS>\n${T(9)}<PROPERTY_VALUATION>\n${T(10)}<PROPERTY_VALUATION_DETAIL>\n`;
    coll += el("PropertyValuationAmount", money(p.presentValue), T(11));
    coll += `${T(10)}</PROPERTY_VALUATION_DETAIL>\n${T(9)}</PROPERTY_VALUATION>\n${T(8)}</PROPERTY_VALUATIONS>\n`;
  }
  coll += `${T(7)}</SUBJECT_PROPERTY>\n${T(6)}</COLLATERAL>\n${T(5)}</COLLATERALS>\n`;

  // ---------- LOAN ----------
  const l = u.loan;
  const loanId = (u.meta.fileNumber || `${u.borrowers[0]?.lastName || "Borrower"}-${(u.meta.assembledAt || "").slice(0, 10)}`).replace(/\s+/g, "-");
  let loan = `${T(5)}<LOANS>\n${T(6)}<LOAN LoanRoleType="SubjectLoan" xlink:label="LOAN_1">\n`;
  loan += `${T(7)}<AMORTIZATION>\n${T(8)}<AMORTIZATION_RULE>\n`;
  loan += el("AmortizationType", l.amortizationType || "Fixed", T(9));
  loan += el("LoanAmortizationPeriodCount", l.termMonths || 360, T(9));
  loan += el("LoanAmortizationPeriodType", "Month", T(9));
  loan += `${T(8)}</AMORTIZATION_RULE>\n${T(7)}</AMORTIZATION>\n`;
  // DU URLA wrapper
  loan += `${T(7)}<DOCUMENT_SPECIFIC_DATA_SETS>\n${T(8)}<DOCUMENT_SPECIFIC_DATA_SET>\n${T(9)}<URLA>\n${T(10)}<URLA_DETAIL>\n`;
  loan += el("EstimatedClosingCostsAmount", "0.00", T(11));
  loan += `${T(10)}</URLA_DETAIL>\n${T(9)}</URLA>\n${T(8)}</DOCUMENT_SPECIFIC_DATA_SET>\n${T(7)}</DOCUMENT_SPECIFIC_DATA_SETS>\n`;
  // LOAN_DETAIL
  loan += `${T(7)}<LOAN_DETAIL>\n`;
  loan += el("BalloonIndicator", "false", T(8));
  loan += el("BorrowerCount", u.borrowers.length, T(8));
  loan += el("ConstructionLoanIndicator", "false", T(8));
  loan += el("InterestOnlyIndicator", "false", T(8));
  loan += el("NegativeAmortizationIndicator", "false", T(8));
  loan += el("PrepaymentPenaltyIndicator", "false", T(8));
  loan += `${T(7)}</LOAN_DETAIL>\n`;
  loan += `${T(7)}<LOAN_IDENTIFIERS>\n${T(8)}<LOAN_IDENTIFIER>\n` + el("LoanIdentifier", loanId, T(9)) + el("LoanIdentifierType", "LenderLoan", T(9)) + `${T(8)}</LOAN_IDENTIFIER>\n${T(7)}</LOAN_IDENTIFIERS>\n`;
  loan += `${T(7)}<ORIGINATION_SYSTEMS>\n${T(8)}<ORIGINATION_SYSTEM>\n` + el("LoanOriginationSystemName", "Fetti Financial CRM", T(9)) + `${T(8)}</ORIGINATION_SYSTEM>\n${T(7)}</ORIGINATION_SYSTEMS>\n`;
  if ((l.purpose || "").toLowerCase().includes("refinance")) {
    loan += `${T(7)}<REFINANCE>\n` + el("RefinanceCashOutDeterminationType", (l.purpose || "").toLowerCase().includes("cash") ? "CashOut" : "NoCashOut", T(8)) + `${T(7)}</REFINANCE>\n`;
  }
  loan += `${T(7)}<TERMS_OF_LOAN>\n`;
  loan += el("BaseLoanAmount", money(l.amount), T(8));
  loan += el("LienPriorityType", "FirstLien", T(8));
  loan += el("LoanPurposeType", l.purpose, T(8));
  loan += el("MortgageType", l.loanType || "Conventional", T(8));
  loan += el("NoteAmount", money(l.amount), T(8));
  loan += el("NoteRatePercent", l.noteRatePercent, T(8));
  loan += `${T(7)}</TERMS_OF_LOAN>\n`;
  loan += `${T(6)}</LOAN>\n${T(5)}</LOANS>\n`;

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
    // BORROWER_DETAIL
    parties += `${T(10)}<BORROWER_DETAIL>\n`;
    parties += el("BorrowerBirthDate", b.dob, T(11));
    parties += el("DependentCount", b.dependentsCount ?? 0, T(11));
    parties += el("MaritalStatusType", b.maritalStatus, T(11));
    parties += el("SelfDeclaredMilitaryServiceIndicator", "false", T(11));
    parties += `${T(10)}</BORROWER_DETAIL>\n`;
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
        parties += `${T(13)}</CURRENT_INCOME_ITEM_DETAIL>\n${T(12)}</CURRENT_INCOME_ITEM>\n`;
      }
      parties += `${T(11)}</CURRENT_INCOME_ITEMS>\n${T(10)}</CURRENT_INCOME>\n`;
    }
    // declarations
    const d = u.declarations || {};
    const ynBool = (v?: string) => (v === "Yes" ? "true" : "false");
    parties += `${T(10)}<DECLARATION>\n${T(11)}<DECLARATION_DETAIL>\n`;
    parties += el("BankruptcyIndicator", ynBool(d.bankruptcyPast7Years), T(12));
    parties += el("CitizenshipResidencyType", b.citizenship, T(12));
    parties += el("HomeownerPastThreeYearsType", d.ownsOtherProperty === "Yes" ? "Yes" : d.ownsOtherProperty === "No" ? "No" : "Unknown", T(12));
    parties += el("IntentToOccupyType", d.intendToOccupyAsPrimary === "Yes" ? "Yes" : d.intendToOccupyAsPrimary === "No" ? "No" : "Unknown", T(12));
    parties += el("OutstandingJudgmentsIndicator", ynBool(d.outstandingJudgments), T(12));
    parties += el("PartyToLawsuitIndicator", ynBool(d.partyToLawsuit), T(12));
    parties += el("PriorPropertyForeclosureCompletedIndicator", ynBool(d.foreclosurePast7Years), T(12));
    parties += el("UndisclosedBorrowedFundsIndicator", ynBool(d.borrowingDownPayment), T(12));
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
    // government monitoring (HMDA) with ULAD extension
    const dm = u.demographics || {};
    const declined = dm.providedVoluntarily === false;
    parties += `${T(10)}<GOVERNMENT_MONITORING>\n${T(11)}<GOVERNMENT_MONITORING_DETAIL>\n`;
    parties += el("HMDAEthnicityRefusalIndicator", bool(declined || !dm.ethnicity), T(12));
    parties += el("HMDAGenderRefusalIndicator", bool(declined || !dm.sex), T(12));
    parties += el("HMDARaceRefusalIndicator", bool(declined || !dm.race), T(12));
    if (i === 0 && (dm.sex || dm.ethnicity)) {
      parties += `${T(12)}<EXTENSION>\n${T(13)}<OTHER>\n${T(14)}<ULAD:GOVERNMENT_MONITORING_DETAIL_EXTENSION>\n`;
      parties += el("ULAD:ApplicationTakenMethodType", "Internet", T(15));
      parties += el("ULAD:HMDAGenderType", dm.sex, T(15));
      parties += `${T(14)}</ULAD:GOVERNMENT_MONITORING_DETAIL_EXTENSION>\n${T(13)}</OTHER>\n${T(12)}</EXTENSION>\n`;
    }
    parties += `${T(11)}</GOVERNMENT_MONITORING_DETAIL>\n`;
    if (i === 0 && dm.ethnicity) {
      parties += `${T(11)}<EXTENSION>\n${T(12)}<OTHER>\n${T(13)}<ULAD:GOVERNMENT_MONITORING_EXTENSION>\n${T(14)}<ULAD:HMDA_ETHNICITIES>\n${T(15)}<ULAD:HMDA_ETHNICITY>\n`;
      parties += el("ULAD:HMDAEthnicityType", dm.ethnicity, T(16));
      parties += `${T(15)}</ULAD:HMDA_ETHNICITY>\n${T(14)}</ULAD:HMDA_ETHNICITIES>\n${T(13)}</ULAD:GOVERNMENT_MONITORING_EXTENSION>\n${T(12)}</OTHER>\n${T(11)}</EXTENSION>\n`;
    }
    parties += `${T(10)}</GOVERNMENT_MONITORING>\n`;
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

  return header + assetsBlock + coll + loan + parties + relationships + footer;
}
