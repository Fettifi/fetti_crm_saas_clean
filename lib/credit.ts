// Credit (CoreLogic Credco) tri-merge module. Builds a MISMO credit request from
// the 1003, and parses a MISMO credit response into scores + tradelines.
//
// IMPORTANT: Credco's exact request envelope + auth are proprietary (per your
// account's integration guide). The XML builder below is a MISMO-3.4-shaped
// starting point; the transport (endpoint, auth, MISMO version) is env-driven and
// finalized once you provide the Credco spec + credentials. Nothing fires a real
// pull unless CREDCO_URL + credentials are configured (use the CERT env first).
import type { Urla, UrlaLiability } from "@/lib/urla";

export type CreditScore = { bureau: string; score?: number };
export type CreditResult = {
  scores: CreditScore[];
  representativeScore?: number;       // middle of 3 (or lower of 2)
  liabilities: UrlaLiability[];
  pulledAt: string;
  reference?: string;
};

// Required borrower fields for a credit pull.
export function readyForCredit(u: Urla): { ready: boolean; missing: string[] } {
  const b = u.borrowers?.[0] || {};
  const missing: string[] = [];
  if (!(b.firstName && b.lastName)) missing.push("Borrower name");
  if (!b.ssn) missing.push("SSN");
  if (!b.dob) missing.push("Date of birth");
  if (!(b.currentAddress?.street && (b.currentAddress?.city || b.currentAddress?.zip))) missing.push("Current address");
  return { ready: missing.length === 0, missing };
}

export const CREDCO_ENV = ["CREDCO_URL", "CREDCO_ACCOUNT", "CREDCO_USER", "CREDCO_PASSWORD"];
export function credcoConfigured(): boolean {
  return !!(process.env.CREDCO_URL && process.env.CREDCO_USER && process.env.CREDCO_PASSWORD);
}

function esc(v: any) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// MISMO-3.4-shaped credit request (starting point — confirm against Credco spec).
export function buildCreditRequestXml(u: Urla): string {
  const b = u.borrowers?.[0] || {};
  const a = b.currentAddress || {};
  const ssn = (b.ssn || "").replace(/[^0-9]/g, "");
  return `<?xml version="1.0" encoding="utf-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" MISMOReferenceModelIdentifier="3.4.0">
  <DEAL_SETS><DEAL_SET><DEALS><DEAL>
    <SERVICES><SERVICE>
      <CREDIT><CREDIT_REQUEST><CREDIT_REQUEST_DATAS><CREDIT_REQUEST_DATA>
        <CREDIT_REQUEST_DATA_DETAIL>
          <CreditReportRequestActionType>Submit</CreditReportRequestActionType>
          <CreditReportType>Merge</CreditReportType>
        </CREDIT_REQUEST_DATA_DETAIL>
        <CREDIT_REPOSITORY_INCLUDED>
          <CreditRepositoryIncludedEquifaxIndicator>true</CreditRepositoryIncludedEquifaxIndicator>
          <CreditRepositoryIncludedExperianIndicator>true</CreditRepositoryIncludedExperianIndicator>
          <CreditRepositoryIncludedTransUnionIndicator>true</CreditRepositoryIncludedTransUnionIndicator>
        </CREDIT_REPOSITORY_INCLUDED>
      </CREDIT_REQUEST_DATA></CREDIT_REQUEST_DATAS></CREDIT_REQUEST></CREDIT>
    </SERVICE></SERVICES>
    <PARTIES><PARTY>
      <INDIVIDUAL><NAME><FirstName>${esc(b.firstName)}</FirstName><LastName>${esc(b.lastName)}</LastName></NAME></INDIVIDUAL>
      <ADDRESSES><ADDRESS><AddressLineText>${esc(a.street)}</AddressLineText><CityName>${esc(a.city)}</CityName><StateCode>${esc(a.state)}</StateCode><PostalCode>${esc(a.zip)}</PostalCode></ADDRESS></ADDRESSES>
      <ROLES><ROLE><BORROWER><BORROWER_DETAIL><BorrowerBirthDate>${esc(b.dob)}</BorrowerBirthDate></BORROWER_DETAIL></BORROWER><ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL></ROLE></ROLES>
      <TAXPAYER_IDENTIFIERS><TAXPAYER_IDENTIFIER><TaxpayerIdentifierType>SocialSecurityNumber</TaxpayerIdentifierType><TaxpayerIdentifierValue>${esc(ssn)}</TaxpayerIdentifierValue></TAXPAYER_IDENTIFIER></TAXPAYER_IDENTIFIERS>
    </PARTY></PARTIES>
  </DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>`;
}

function tag(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  const out: string[] = []; let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

// Parse a MISMO credit response — best-effort across common element names.
export function parseCreditResponse(xml: string): CreditResult {
  const scores: CreditScore[] = [];
  // CREDIT_SCORE blocks: pair repository source + value
  const scoreBlocks = xml.match(/<CREDIT_SCORE[\s\S]*?<\/CREDIT_SCORE>/g) || [];
  for (const blk of scoreBlocks) {
    const val = tag(blk, "CreditScoreValue")[0] || tag(blk, "CreditScoreFICOValue")[0];
    const src = tag(blk, "CreditRepositorySourceType")[0] || tag(blk, "CreditRepositorySource")[0];
    if (val) scores.push({ bureau: src || "Unknown", score: parseInt(val, 10) || undefined });
  }
  // representative score: middle of 3, lower of 2
  const nums = scores.map((s) => s.score).filter((n): n is number => !!n).sort((a, b) => a - b);
  let representativeScore: number | undefined;
  if (nums.length >= 3) representativeScore = nums[1];
  else if (nums.length === 2) representativeScore = nums[0];
  else if (nums.length === 1) representativeScore = nums[0];

  const liabilities: UrlaLiability[] = [];
  const liabBlocks = xml.match(/<CREDIT_LIABILITY[\s\S]*?<\/CREDIT_LIABILITY>/g) || [];
  for (const blk of liabBlocks) {
    const creditor = tag(blk, "FullName")[0] || tag(blk, "_NAME")[0];
    const balance = parseFloat(tag(blk, "CreditLiabilityUnpaidBalanceAmount")[0] || tag(blk, "_UnpaidBalanceAmount")[0] || "");
    const pmt = parseFloat(tag(blk, "CreditLiabilityMonthlyPaymentAmount")[0] || tag(blk, "_MonthlyPaymentAmount")[0] || "");
    const type = tag(blk, "CreditLiabilityAccountType")[0] || "Other";
    if (creditor || balance) liabilities.push({ creditor, type, balance: isNaN(balance) ? undefined : balance, monthlyPayment: isNaN(pmt) ? undefined : pmt });
  }
  const reference = tag(xml, "CreditReportIdentifier")[0] || tag(xml, "CreditReportReferenceIdentifier")[0];
  return { scores, representativeScore, liabilities, pulledAt: new Date().toISOString(), reference };
}
