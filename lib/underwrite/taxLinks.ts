// BACK-TAX VERIFICATION HELPERS. There is no free nationwide API for delinquent
// property taxes, and TitlePro247 has no public API — so the tool can't pull the
// number automatically. What it CAN do: hand you a per-property worklist with the
// exact lookup links (county public records via NETR + a targeted search), a
// paste-ready address for TitlePro, and a status field (unknown → clear/owed $X)
// that feeds straight back into the underwrite (owed taxes add to cash-needed).
import type { PropertyRow } from "@/lib/underwrite/engine";

export type TaxLookup = {
  id: string;
  address: string;
  pasteAddress: string;   // one-line, paste-ready for TitlePro247 / county search
  netrUrl: string;        // NETR public-records directory → county assessor/collector
  searchUrl: string;      // targeted web search for the county tax collector
  status: PropertyRow["back_tax_status"];
  amount: number | null;
};

export function taxLookupFor(p: PropertyRow): TaxLookup {
  const parts = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const st = String(p.state || "").trim().toUpperCase();
  const county = String(p.county || "").trim();
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
    netrUrl,
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    status: p.back_tax_status,
    amount: p.back_tax_amount ?? null,
  };
}

export function taxWorklist(rows: PropertyRow[]): TaxLookup[] {
  // Unverified first (the actual work), then owed (needs payoff numbers), then clear.
  const rank = { unknown: 0, owed: 1, clear: 2 } as const;
  return rows.map(taxLookupFor).sort((a, b) => rank[a.status] - rank[b.status]);
}
