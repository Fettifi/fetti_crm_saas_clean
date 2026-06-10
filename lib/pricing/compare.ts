// Pricing comparison engine. Vendor-agnostic: products are normalized rows that
// can come from (a) AI-parsed wholesaler rate sheets, or (b) a future PPE/API
// adapter. A scenario filters eligible products across every lender and ranks
// them — one-location comparison across all your wholesalers.
import { getSetting, setSetting } from "@/lib/settings";

export type PricingProduct = {
  id: string;
  lenderId: string;
  lenderName: string;
  productName: string;          // e.g. "30-Yr Fixed Conventional", "DSCR 30 Fixed"
  loanType?: string;            // Conventional | FHA | VA | USDA | Jumbo | DSCR | NonQM | Other
  termMonths?: number;          // 360, 180, ...
  amortization?: string;        // Fixed | ARM
  noteRate?: number;            // %
  pricePercent?: number;        // price as % of par (e.g. 100.250 = 0.25 rebate)
  lockDays?: number;
  // eligibility (any may be omitted = no constraint)
  minFico?: number;
  maxLtv?: number;
  minLoanAmount?: number;
  maxLoanAmount?: number;
  minDscr?: number;
  occupancy?: string[];         // PrimaryResidence | SecondHome | Investment
  purpose?: string[];           // Purchase | Refinance | CashOutRefinance
  propertyTypes?: string[];
  states?: string[];            // 2-letter; empty = all
  notes?: string;
  uploadedAt?: string;
};

export type Scenario = {
  loanAmount?: number; propertyValue?: number; fico?: number;
  occupancy?: string; purpose?: string; propertyType?: string; state?: string;
  loanType?: string; dscr?: number;
};

const PRODUCTS_KEY = "pricing_products";

export async function getProducts(): Promise<PricingProduct[]> {
  const raw = await getSetting(PRODUCTS_KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
export async function saveProducts(p: PricingProduct[]): Promise<void> {
  await setSetting(PRODUCTS_KEY, JSON.stringify(p));
}
export async function addProducts(rows: PricingProduct[]): Promise<number> {
  const all = await getProducts();
  await saveProducts([...all, ...rows]);
  return rows.length;
}
export async function clearLender(lenderId: string): Promise<void> {
  const all = await getProducts();
  await saveProducts(all.filter((p) => p.lenderId !== lenderId));
}

export function lenderSummary(products: PricingProduct[]) {
  const map = new Map<string, { lenderId: string; lenderName: string; count: number; uploadedAt?: string }>();
  for (const p of products) {
    const e = map.get(p.lenderId) || { lenderId: p.lenderId, lenderName: p.lenderName, count: 0, uploadedAt: p.uploadedAt };
    e.count += 1; if (p.uploadedAt && (!e.uploadedAt || p.uploadedAt > e.uploadedAt)) e.uploadedAt = p.uploadedAt;
    map.set(p.lenderId, e);
  }
  return [...map.values()].sort((a, b) => a.lenderName.localeCompare(b.lenderName));
}

function eligible(p: PricingProduct, s: Scenario): { ok: boolean; reason?: string } {
  const ltv = s.propertyValue && s.loanAmount ? (s.loanAmount / s.propertyValue) * 100 : undefined;
  if (s.loanType && p.loanType && p.loanType.toLowerCase() !== s.loanType.toLowerCase()) return { ok: false, reason: "loan type" };
  if (p.minFico && s.fico && s.fico < p.minFico) return { ok: false, reason: `min FICO ${p.minFico}` };
  if (p.maxLtv && ltv && ltv > p.maxLtv + 0.001) return { ok: false, reason: `max LTV ${p.maxLtv}%` };
  if (p.minLoanAmount && s.loanAmount && s.loanAmount < p.minLoanAmount) return { ok: false, reason: "below min loan" };
  if (p.maxLoanAmount && s.loanAmount && s.loanAmount > p.maxLoanAmount) return { ok: false, reason: "above max loan" };
  if (p.minDscr && s.dscr && s.dscr < p.minDscr) return { ok: false, reason: `min DSCR ${p.minDscr}` };
  if (p.occupancy?.length && s.occupancy && !p.occupancy.some((o) => o.toLowerCase() === s.occupancy!.toLowerCase())) return { ok: false, reason: "occupancy" };
  if (p.purpose?.length && s.purpose && !p.purpose.some((o) => o.toLowerCase() === s.purpose!.toLowerCase())) return { ok: false, reason: "purpose" };
  if (p.states?.length && s.state && !p.states.some((st) => st.toUpperCase() === s.state!.toUpperCase())) return { ok: false, reason: "state" };
  return { ok: true };
}

function pi(amount?: number, rate?: number, term = 360): number | undefined {
  if (!amount || !rate) return undefined;
  const r = rate / 100 / 12;
  return r ? (amount * r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1) : amount / term;
}

export type CompareRow = PricingProduct & { monthlyPI?: number };
export function compare(products: PricingProduct[], s: Scenario): { results: CompareRow[]; filtered: number } {
  const elig = products.filter((p) => eligible(p, s).ok);
  const results: CompareRow[] = elig.map((p) => ({ ...p, monthlyPI: pi(s.loanAmount, p.noteRate, p.termMonths || 360) }));
  // best = lowest note rate, then best price (higher rebate)
  results.sort((a, b) => (a.noteRate ?? 99) - (b.noteRate ?? 99) || (b.pricePercent ?? 0) - (a.pricePercent ?? 0));
  return { results, filtered: products.length - elig.length };
}
