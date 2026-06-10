// Wholesale lender directory — every lender you're approved with. Stored in
// app_settings so it persists without DDL. Drives the pricing comparison (all
// lenders show up) and the "Send file to lender" action on the loan file.
import { getSetting, setSetting } from "@/lib/settings";

export type WholesaleLender = {
  id: string;
  name: string;
  submissionEmail?: string;     // where files get emailed for submission
  portalUrl?: string;           // their TPO portal
  aeName?: string;
  aeEmail?: string;
  aePhone?: string;
  loanTypes?: string[];         // Conventional | FHA | VA | Jumbo | DSCR | NonQM | ...
  states?: string[];            // 2-letter; empty = all
  active?: boolean;
  notes?: string;
};

const KEY = "wholesale_lenders";

export async function getLenders(): Promise<WholesaleLender[]> {
  const raw = await getSetting(KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
export async function saveLenders(l: WholesaleLender[]): Promise<void> {
  await setSetting(KEY, JSON.stringify(l));
}
function slug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export async function upsertLender(input: WholesaleLender): Promise<WholesaleLender> {
  const all = await getLenders();
  const id = input.id || slug(input.name || "lender") || `lender-${all.length + 1}`;
  const lender: WholesaleLender = { active: true, ...input, id };
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx] = { ...all[idx], ...lender }; else all.push(lender);
  await saveLenders(all);
  return lender;
}
export async function removeLender(id: string): Promise<void> {
  const all = await getLenders();
  await saveLenders(all.filter((x) => x.id !== id));
}

// Which lenders fit a loan? (loose: loan type + state). Empty constraint = fits all.
export function eligibleLenders(lenders: WholesaleLender[], opts: { loanType?: string; state?: string }): WholesaleLender[] {
  return lenders.filter((l) => {
    if (l.active === false) return false;
    if (opts.loanType && l.loanTypes?.length && !l.loanTypes.some((t) => t.toLowerCase() === opts.loanType!.toLowerCase())) return false;
    if (opts.state && l.states?.length && !l.states.some((s) => s.toUpperCase() === opts.state!.toUpperCase())) return false;
    return true;
  });
}
