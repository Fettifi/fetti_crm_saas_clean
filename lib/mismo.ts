// MISMO 3.4 (ULAD / URLA) XML exporter. Takes a normalized Urla object and emits
// a well-formed MISMO v3.4 residential loan application document covering the
// core containers most lenders/AUS ingest: SUBJECT_PROPERTY, LOAN terms,
// borrower PARTY (name, taxpayer id, residence, employer, income, declarations,
// HMDA), ASSETS, LIABILITIES, OWNED_PROPERTY (REO), and the LOAN_ORIGINATOR.
//
// This is MISMO-3.4-shaped and well-formed; a specific lender may want a couple
// of enumerations mapped to their exact import profile, which is a small tweak.
import type { Urla, UrlaAddress } from "@/lib/urla";

function esc(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// element helper — omit entirely when value is empty
function el(tag: string, value: any, indent = ""): string {
  if (value === null || value === undefined || value === "") return "";
  return `${indent}<${tag}>${esc(value)}</${tag}>\n`;
}
function ssnDigits(s?: string): string { return (s || "").replace(/[^0-9]/g, "").slice(0, 9); }

function addressXml(a: UrlaAddress | string | undefined, indent: string): string {
  if (!a) return "";
  const ad: UrlaAddress = typeof a === "string" ? { street: a } : a;
  let s = `${indent}<ADDRESS>\n`;
  s += el("AddressLineText", ad.street, indent + "  ");
  s += el("CityName", ad.city, indent + "  ");
  s += el("StateCode", ad.state, indent + "  ");
  s += el("PostalCode", ad.zip, indent + "  ");
  s += el("CountryCode", ad.country || "US", indent + "  ");
  s += `${indent}</ADDRESS>\n`;
  return s;
}

export function buildMismo34(u: Urla): string {
  const b = u.borrowers[0] || {};
  const I = "          "; // base indent inside DEAL

  // ---- SUBJECT PROPERTY (collateral) ----
  let collateral = `${I}<COLLATERALS>\n${I}  <COLLATERAL>\n${I}    <SUBJECT_PROPERTY>\n`;
  collateral += addressXml(u.property.address, I + "      ");
  collateral += `${I}      <PROPERTY_DETAIL>\n`;
  collateral += el("FinancedUnitCount", "1", I + "        ");
  collateral += el("PropertyEstateType", "FeeSimple", I + "        ");
  collateral += el("PropertyMixedUsageIndicator", u.property.mixedUse === "Yes" ? "true" : "false", I + "        ");
  collateral += el("PropertyUsageType", u.property.occupancy, I + "        ");
  collateral += `${I}      </PROPERTY_DETAIL>\n`;
  if (u.property.presentValue) {
    collateral += `${I}      <PROPERTY_VALUATIONS><PROPERTY_VALUATION><PROPERTY_VALUATION_DETAIL>\n`;
    collateral += el("PropertyValuationAmount", u.property.presentValue, I + "        ");
    collateral += `${I}      </PROPERTY_VALUATION_DETAIL></PROPERTY_VALUATION></PROPERTY_VALUATIONS>\n`;
  }
  collateral += `${I}    </SUBJECT_PROPERTY>\n${I}  </COLLATERAL>\n${I}</COLLATERALS>\n`;

  // ---- LOAN ----
  let loan = `${I}<LOANS>\n${I}  <LOAN LoanRoleType="SubjectLoan">\n`;
  loan += `${I}    <AMORTIZATION><AMORTIZATION_RULE>\n`;
  loan += el("AmortizationType", u.loan.amortizationType, I + "      ");
  loan += el("LoanAmortizationPeriodCount", u.loan.termMonths, I + "      ");
  loan += el("LoanAmortizationPeriodType", "Month", I + "      ");
  loan += `${I}    </AMORTIZATION_RULE></AMORTIZATION>\n`;
  loan += `${I}    <LOAN_DETAIL>\n`;
  loan += el("LoanPurposeType", u.loan.purpose, I + "      ");
  loan += `${I}    </LOAN_DETAIL>\n`;
  loan += `${I}    <TERMS_OF_LOAN>\n`;
  loan += el("BaseLoanAmount", u.loan.amount, I + "      ");
  loan += el("LoanPurposeType", u.loan.purpose, I + "      ");
  loan += el("MortgageType", u.loan.loanType, I + "      ");
  loan += el("NoteRatePercent", u.loan.noteRatePercent, I + "      ");
  loan += `${I}    </TERMS_OF_LOAN>\n`;
  if (u.loan.productDescription) {
    loan += `${I}    <LOAN_PRODUCT><LOAN_PRODUCT_DETAIL>\n` + el("LoanProductDescription", u.loan.productDescription, I + "      ") + `${I}    </LOAN_PRODUCT_DETAIL></LOAN_PRODUCT>\n`;
  }
  loan += `${I}  </LOAN>\n${I}</LOANS>\n`;

  // ---- BORROWER PARTY ----
  let party = `${I}<PARTIES>\n${I}  <PARTY>\n`;
  party += `${I}    <INDIVIDUAL>\n${I}      <NAME>\n`;
  party += el("FirstName", b.firstName, I + "        ");
  party += el("LastName", b.lastName, I + "        ");
  party += `${I}      </NAME>\n`;
  party += `${I}      <CONTACT_POINTS>\n`;
  if (b.cellPhone) party += `${I}        <CONTACT_POINT><CONTACT_POINT_TELEPHONE>` + `<ContactPointTelephoneValue>${esc(b.cellPhone)}</ContactPointTelephoneValue>` + `</CONTACT_POINT_TELEPHONE><CONTACT_POINT_DETAIL><ContactPointRoleType>Mobile</ContactPointRoleType></CONTACT_POINT_DETAIL></CONTACT_POINT>\n`;
  if (b.email) party += `${I}        <CONTACT_POINT><CONTACT_POINT_EMAIL><ContactPointEmailValue>${esc(b.email)}</ContactPointEmailValue></CONTACT_POINT_EMAIL></CONTACT_POINT>\n`;
  party += `${I}      </CONTACT_POINTS>\n`;
  party += `${I}    </INDIVIDUAL>\n`;
  party += `${I}    <ROLES>\n${I}      <ROLE>\n${I}        <BORROWER>\n`;
  party += `${I}          <BORROWER_DETAIL>\n`;
  party += el("BorrowerBirthDate", b.dob, I + "            ");
  party += el("CitizenshipResidencyType", b.citizenship, I + "            ");
  party += el("MaritalStatusType", b.maritalStatus, I + "            ");
  party += el("DependentCount", b.dependentsCount, I + "            ");
  party += `${I}          </BORROWER_DETAIL>\n`;
  // taxpayer id (SSN)
  if (b.ssn) {
    party += `${I}          <TAXPAYER_IDENTIFIERS><TAXPAYER_IDENTIFIER>\n`;
    party += el("TaxpayerIdentifierType", "SocialSecurityNumber", I + "            ");
    party += el("TaxpayerIdentifierValue", ssnDigits(b.ssn), I + "            ");
    party += `${I}          </TAXPAYER_IDENTIFIER></TAXPAYER_IDENTIFIERS>\n`;
  }
  // current residence
  if (b.currentAddress) {
    party += `${I}          <RESIDENCES><RESIDENCE>\n`;
    party += addressXml(b.currentAddress, I + "            ");
    party += `${I}            <RESIDENCE_DETAIL>\n`;
    party += el("BorrowerResidencyBasisType", b.housingStatus === "Own" ? "Own" : b.housingStatus === "Rent" ? "Rent" : "", I + "              ");
    party += el("BorrowerResidencyType", "Current", I + "              ");
    party += el("MonthlyRentAmount", b.monthlyHousingExpense, I + "              ");
    party += `${I}            </RESIDENCE_DETAIL>\n`;
    party += `${I}          </RESIDENCE></RESIDENCES>\n`;
  }
  // employer + income
  if (b.employment?.employerName || b.employment?.selfEmployed) {
    party += `${I}          <EMPLOYERS><EMPLOYER>\n`;
    party += `${I}            <LEGAL_ENTITY><LEGAL_ENTITY_DETAIL>` + el("FullName", b.employment?.employerName, "") + `</LEGAL_ENTITY_DETAIL></LEGAL_ENTITY>\n`;
    if (b.employment?.employerAddress) party += addressXml(b.employment.employerAddress, I + "            ");
    party += `${I}            <EMPLOYMENT>\n`;
    party += el("EmploymentBorrowerSelfEmployedIndicator", b.employment?.selfEmployed ? "true" : "false", I + "              ");
    party += el("EmploymentPositionDescription", b.employment?.position, I + "              ");
    party += el("EmploymentStartDate", b.employment?.startDate, I + "              ");
    party += `${I}            </EMPLOYMENT>\n`;
    party += `${I}          </EMPLOYER></EMPLOYERS>\n`;
  }
  const inc = b.income || {};
  const incomeItems: [string, number | undefined][] = [["Base", inc.base], ["Overtime", inc.overtime], ["Bonus", inc.bonus], ["Commissions", inc.commission], ["Other", inc.other]];
  const anyIncome = incomeItems.some(([, v]) => v) || inc.total || u.property.expectedMonthlyRentalIncome;
  if (anyIncome) {
    party += `${I}          <CURRENT_INCOME><CURRENT_INCOME_ITEMS>\n`;
    for (const [type, val] of incomeItems) {
      if (!val) continue;
      party += `${I}            <CURRENT_INCOME_ITEM><CURRENT_INCOME_ITEM_DETAIL>` + el("IncomeType", type, "") + el("CurrentIncomeMonthlyTotalAmount", val, "") + `</CURRENT_INCOME_ITEM_DETAIL></CURRENT_INCOME_ITEM>\n`;
    }
    if (inc.total && !incomeItems.some(([, v]) => v)) {
      party += `${I}            <CURRENT_INCOME_ITEM><CURRENT_INCOME_ITEM_DETAIL>` + el("IncomeType", "Base", "") + el("CurrentIncomeMonthlyTotalAmount", inc.total, "") + `</CURRENT_INCOME_ITEM_DETAIL></CURRENT_INCOME_ITEM>\n`;
    }
    if (u.property.expectedMonthlyRentalIncome) {
      party += `${I}            <CURRENT_INCOME_ITEM><CURRENT_INCOME_ITEM_DETAIL>` + el("IncomeType", "NetRentalIncome", "") + el("CurrentIncomeMonthlyTotalAmount", u.property.expectedMonthlyRentalIncome, "") + `</CURRENT_INCOME_ITEM_DETAIL></CURRENT_INCOME_ITEM>\n`;
    }
    party += `${I}          </CURRENT_INCOME_ITEMS></CURRENT_INCOME>\n`;
  }
  // declarations
  const d = u.declarations;
  const yn = (v?: string) => v === "Yes" ? "true" : v === "No" ? "false" : "";
  party += `${I}          <DECLARATION><DECLARATION_DETAIL>\n`;
  party += el("BankruptcyIndicator", yn(d.bankruptcyPast7Years), I + "            ");
  party += el("PriorPropertyForeclosureCompletedIndicator", yn(d.foreclosurePast7Years), I + "            ");
  party += el("OutstandingJudgmentsIndicator", yn(d.outstandingJudgments), I + "            ");
  party += el("PartyToLawsuitIndicator", yn(d.partyToLawsuit), I + "            ");
  party += el("IntentToOccupyType", d.intendToOccupyAsPrimary === "Yes" ? "Yes" : d.intendToOccupyAsPrimary === "No" ? "No" : "", I + "            ");
  party += el("HomeownerPastThreeYearsType", d.ownsOtherProperty === "Yes" ? "Yes" : d.ownsOtherProperty === "No" ? "No" : "", I + "            ");
  party += `${I}          </DECLARATION_DETAIL></DECLARATION>\n`;
  // HMDA / government monitoring
  const dm = u.demographics;
  party += `${I}          <GOVERNMENT_MONITORING><GOVERNMENT_MONITORING_DETAIL>\n`;
  party += el("HMDAEthnicityRefusalIndicator", dm.providedVoluntarily === false ? "true" : "false", I + "            ");
  party += el("HMDAGenderType", dm.sex, I + "            ");
  party += el("HMDARaceRefusalIndicator", dm.providedVoluntarily === false ? "true" : "false", I + "            ");
  party += `${I}          </GOVERNMENT_MONITORING_DETAIL></GOVERNMENT_MONITORING>\n`;
  party += `${I}        </BORROWER>\n${I}      </ROLE>\n${I}    </ROLES>\n`;

  // assets & liabilities live on the party
  if (u.assets?.length) {
    party += `${I}    <ASSETS>\n`;
    for (const a of u.assets) {
      party += `${I}      <ASSET><ASSET_DETAIL>\n`;
      party += el("AssetType", a.type || "CheckingAccount", I + "        ");
      party += el("AssetAccountIdentifier", a.accountNumber, I + "        ");
      party += el("AssetCashOrMarketValueAmount", a.balance, I + "        ");
      party += `${I}      </ASSET_DETAIL></ASSET>\n`;
    }
    party += `${I}    </ASSETS>\n`;
  }
  if (u.liabilities?.length) {
    party += `${I}    <LIABILITIES>\n`;
    for (const l of u.liabilities) {
      party += `${I}      <LIABILITY><LIABILITY_DETAIL>\n`;
      party += el("LiabilityType", l.type || "Revolving", I + "        ");
      party += el("LiabilityUnpaidBalanceAmount", l.balance, I + "        ");
      party += el("LiabilityMonthlyPaymentAmount", l.monthlyPayment, I + "        ");
      party += `${I}      </LIABILITY_DETAIL></LIABILITY>\n`;
    }
    party += `${I}    </LIABILITIES>\n`;
  }
  // REO (owned property)
  if (u.reo?.length) {
    party += `${I}    <OWNED_PROPERTIES>\n`;
    for (const r of u.reo) {
      party += `${I}      <OWNED_PROPERTY>\n`;
      party += addressXml(r.address, I + "        ");
      party += `${I}        <OWNED_PROPERTY_DETAIL>\n`;
      party += el("OwnedPropertyMaintenanceExpenseAmount", r.monthlyMortgage, I + "          ");
      party += el("OwnedPropertyRentalIncomeGrossAmount", r.monthlyRentalIncome, I + "          ");
      party += el("OwnedPropertySubjectIndicator", "false", I + "          ");
      party += `${I}        </OWNED_PROPERTY_DETAIL>\n`;
      party += `${I}      </OWNED_PROPERTY>\n`;
    }
    party += `${I}    </OWNED_PROPERTIES>\n`;
  }
  party += `${I}  </PARTY>\n`;

  // ---- LOAN ORIGINATOR PARTY ----
  const o = u.originator;
  party += `${I}  <PARTY>\n${I}    <INDIVIDUAL><NAME>` + el("FullName", o.name, "") + `</NAME></INDIVIDUAL>\n`;
  party += `${I}    <LICENSES><LICENSE><LICENSE_DETAIL>` + el("LicenseIdentifier", o.nmls, "") + el("LicenseAuthorityLevelType", "NMLS", "") + `</LICENSE_DETAIL></LICENSE></LICENSES>\n`;
  party += `${I}    <ROLES><ROLE><LOAN_ORIGINATOR><LOAN_ORIGINATOR_DETAIL>` + el("LoanOriginatorIdentifier", o.nmls, "") + el("LoanOriginatorOrganizationName", o.company, "") + el("LoanOriginatorOrganizationIdentifier", o.companyNmls, "") + `</LOAN_ORIGINATOR_DETAIL></LOAN_ORIGINATOR></ROLE></ROLES>\n`;
  party += `${I}  </PARTY>\n`;
  party += `${I}</PARTIES>\n`;

  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:xlink="http://www.w3.org/1999/xlink" MISMOReferenceModelIdentifier="3.4.0.27.00">\n` +
    `  <ABOUT_VERSIONS><ABOUT_VERSION><CreatedDatetime>${esc(u.meta.assembledAt)}</CreatedDatetime>` +
    `<DataVersionName>ULAD-MISMO-3.4</DataVersionName></ABOUT_VERSION></ABOUT_VERSIONS>\n` +
    `  <DEAL_SETS>\n    <DEAL_SET>\n      <DEALS>\n        <DEAL>\n`;
  const footer = `        </DEAL>\n      </DEALS>\n    </DEAL_SET>\n  </DEAL_SETS>\n</MESSAGE>\n`;

  return header + collateral + loan + party + footer;
}
