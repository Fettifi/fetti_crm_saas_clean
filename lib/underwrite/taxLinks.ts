// BACK-TAX VERIFICATION HELPERS — COUNTY-FIRST DOCTRINE (2026-07-16, Ramon's call
// after the Isaac portfolio sweep): the COUNTY TREASURER record is the authoritative
// source for what's actually owed — current installments, delinquencies, tax-sale
// flags, and the live owner of record. TitlePro/assessment-roll data is the backup
// (annual amounts, parcel identification). Method: search BY THE ADDRESS we hold,
// then CROSS-CHECK the owner name on the county record against the expected entity;
// a mismatch is a title flag, not a match failure.
// The worklist hands you the county portal deep link per property plus a paste-ready
// address; verified status (clear/owed $X) feeds straight into cash-needed.
import type { PropertyRow } from "@/lib/underwrite/engine";

export type TaxLookup = {
  id: string;
  address: string;
  pasteAddress: string;   // one-line, paste-ready for the county portal / TitlePro
  countyUrl: string;      // county treasurer portal (address-first search) — PRIMARY
  countyName: string;     // label for the portal link
  netrUrl: string;        // NETR public-records directory — fallback for unmapped counties
  searchUrl: string;      // targeted web search for the county tax collector
  status: PropertyRow["back_tax_status"];
  amount: number | null;
  taxesAnnual: number | null;  // verified/input annual tax bill (feeds PITIA)
  notes: string | null;        // tax/title narrative (owner of record, parcel quirks, pending checks)
};

// County treasurer portals with address-first search, keyed by "ST|county-lowercase".
// Verified working 2026-07-16. Grow this registry as new portfolios hit new counties.
const COUNTY_PORTALS: Record<string, { name: string; url: string }> = {
  "IN|marion":   { name: "Marion Co Treasurer (indy.gov)", url: "https://www.indy.gov/workflow/property-taxes" },
  "IN|madison":  { name: "Madison Co Treasurer",           url: "http://treasurer.madisoncounty48.us/cgi.exe?CALL_PROGRAM=C009LIST" },
  "IN|johnson":  { name: "IN Gateway Tax Bill Lookup",     url: "https://gateway.ifionline.org/TaxBillLookUp/Default.aspx" },
  "IN|shelby":   { name: "IN Gateway Tax Bill Lookup",     url: "https://gateway.ifionline.org/TaxBillLookUp/Default.aspx" },
  "FL|hillsborough": { name: "Hillsborough Co Tax Collector", url: "https://hillsborough.county-taxes.com/public/search/property_tax" },
  "FL|marion":   { name: "Marion Co FL Tax Collector",     url: "https://marion.county-taxes.com/public/search/property_tax" },
};
// Statewide fallbacks when the county isn't in the registry.
const STATE_PORTALS: Record<string, { name: string; url: string }> = {
  IN: { name: "IN Gateway Tax Bill Lookup", url: "https://gateway.ifionline.org/TaxBillLookUp/Default.aspx" },
  FL: { name: "FL county-taxes.com search", url: "https://county-taxes.net/" },
};

export function taxLookupFor(p: PropertyRow): TaxLookup {
  const parts = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const st = String(p.state || "").trim().toUpperCase();
  const county = String(p.county || "").trim();
  const countyKey = `${st}|${county.toLowerCase().replace(/\s+county$/i, "").trim()}`;
  const portal = COUNTY_PORTALS[countyKey] || STATE_PORTALS[st] || null;
  const netrUrl = st
    ? (county
        ? `https://publicrecords.netronline.com/state/${st}/county/${encodeURIComponent(county.toLowerCase().replace(/\s+county$/i, "").replace(/\s+/g, "_"))}`
        : `https://publicrecords.netronline.com/state/${st}`)
    : "https://publicrecords.netronline.com/";
  const q = county && st
    ? `${county} county ${st} tax collector delinquent property tax search`
    : `${st || ""} tax collector property tax search ${p.address}`.trim();
  return {
    id: p.id,
    address: parts || p.address,
    pasteAddress: parts || p.address,
    countyUrl: portal ? portal.url : netrUrl,
    countyName: portal ? portal.name : "County records (NETR)",
    netrUrl,
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    status: p.back_tax_status,
    amount: p.back_tax_amount ?? null,
    taxesAnnual: p.taxes_annual ?? null,
    notes: p.notes ?? null,
  };
}

export function taxWorklist(rows: PropertyRow[]): TaxLookup[] {
  // Unverified first (the actual work), then owed (needs payoff numbers), then clear.
  const rank = { unknown: 0, owed: 1, clear: 2 } as const;
  return rows.map(taxLookupFor).sort((a, b) => rank[a.status] - rank[b.status]);
}
