// RENTAL INCOME FROM LEASES — the qualifying income for a DSCR deal.
//
// Why this exists: the income engine could read paystubs, W-2s, 1099s, bank statements and
// benefit letters, but it had no concept of a LEASE. So on a DSCR file — where the property's
// rent IS the income and the borrower's personal income is irrelevant — verifying income read
// the uploaded leases as "other", produced $0, and offered no DSCR income type at all. Every
// investment file in the LOS hit that. Reported on the Michelle Jackson Metoyer file.
//
// Same two-stage split as the rest of the engine: the AI extracts printed lease facts
// (lib/income/docFacts.ts), and THIS file applies the underwriting rules deterministically.
//
// THE RULES (per unit, then summed):
//   • Lease + market rent (1007/1025) both present → the LESSER. A lease can be above market
//     because it is old, or because it is between related parties; the appraiser's market rent
//     is the check on it. This is the standard DSCR gross-rent test, and it is conservative:
//     it can only lower the qualifying rent, never inflate it.
//   • Lease only → the lease rent, flagged that no 1007 is on file to corroborate.
//   • Market rent only (no executed lease) → market rent, flagged. Most DSCR lenders price a
//     vacant unit to a lower tier or require the lease before docs; the LO must see that.
//   • Short-term rental → trailing-12 gross ÷ 12 × 0.80 (the 20% haircut for STR volatility).
//   • Expired or month-to-month lease still counts (a holdover tenancy is real income) but is
//     flagged, because some programmes require a current executed lease.
// Gross rent is NOT haircut for DSCR — the DSCR ratio itself carries the coverage cushion, so
// applying 75% here as well would double-count the same conservatism.
//
// AGENCY mode is the different rule and is deliberately NOT auto-counted: Fannie/Freddie net
// rental income is 75% of gross MINUS that property's full PITIA, and we do not know a
// non-subject property's PITIA from a lease. So agency mode holds the 75% figure behind an
// Omit-to-add flag rather than inventing a number. See lib/income/programs.ts RENTAL_LEASE_75.
import type { DocFact, IncomeFlag, IncomeLine } from "@/lib/income/docFacts";

export type RentUnit = {
  key: string;                 // normalized address + unit — the grouping key
  address?: string | null;
  unit?: string | null;
  leaseRent?: number | null;
  marketRent?: number | null;
  used: number;                // the rent this unit contributes
  source: "lesser_of" | "lease" | "market" | "short_term";
  basis: string;               // human-readable derivation, shown in the worksheet
};

export type RentalResult = {
  monthlyGrossRent: number;
  units: RentUnit[];
  lines: IncomeLine[];
  flags: IncomeFlag[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const money = (n: number) => "$" + Math.round(n).toLocaleString();

// Address normalization for grouping. Two documents describing the same door must land on the
// same key, or a lease and its 1007 become two "units" and the rent doubles — the single most
// dangerous failure mode here, so this is deliberately aggressive about stripping noise.
const SUFFIX: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", boulevard: "blvd", road: "rd", drive: "dr",
  lane: "ln", court: "ct", place: "pl", terrace: "ter", parkway: "pkwy", circle: "cir",
  highway: "hwy", square: "sq", trail: "trl", way: "way", north: "n", south: "s", east: "e", west: "w",
};
const UNIT_IN_ADDRESS = /\b(?:apt|apartment|unit|suite|ste|bldg|building)\b\.?\s*([a-z0-9-]+)|#\s*([a-z0-9-]+)/i;
export function normalizeAddressKey(address?: string | null, unit?: string | null): string {
  const raw = String(address || "").toLowerCase();
  // Split the unit off the street. Both halves matter: the street must not keep the unit
  // (or "12 Oak St Apt 2" would not match "12 Oak St" + unit "2"), and the unit must be
  // RECOVERED from the address when the reader put it there instead of in the unit field —
  // otherwise those two spellings of one door become two doors and the rent doubles.
  const m = raw.match(UNIT_IN_ADDRESS);
  const street = m ? raw.slice(0, m.index) : raw;
  const words = street.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w);
  const u = String(unit || m?.[1] || m?.[2] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return words.join(" ").trim() + (u ? "|" + u : "");
}

// Rent stated per period → per month. Weekly rent is ×52/12, NOT ×4 — a "×4" shortcut
// understates a weekly lease by 8.3%, which on a DSCR file moves the ratio itself.
const TO_MONTHLY: Record<string, number> = { monthly: 1, annual: 1 / 12, weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2 };
export function monthlyRent(amount?: number | null, frequency?: string | null): number | null {
  const a = num(amount);
  if (a == null || !(a > 0)) return null;
  const f = TO_MONTHLY[String(frequency || "monthly").toLowerCase()];
  return a * (f === undefined ? 1 : f);
}

/** A lease/rent-roll/1007 fact carries a rent; nothing else in the doc set does. */
export function isRentalDoc(f: DocFact): boolean {
  return f.docType === "lease" || f.docType === "rent_roll" || f.docType === "appraisal_1007";
}

function ymd(s?: string | null): string | null {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

export function computeRentalIncome(
  facts: DocFact[],
  opts: { mode: "dscr" | "agency"; today?: string; borrower?: 1 | 2 } = { mode: "dscr" },
): RentalResult {
  const mode = opts.mode || "dscr";
  const borrower: 1 | 2 = opts.borrower || 1;
  const today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
  const rentals = (facts || []).filter(Boolean).filter(isRentalDoc);
  const units = new Map<string, RentUnit & { expired?: boolean; m2m?: boolean; str?: boolean; hasLease?: boolean }>();
  const flags: IncomeFlag[] = [];

  for (const f of rentals) {
    const key = normalizeAddressKey(f.propertyAddress, f.unit);
    const cur = units.get(key) || { key, address: f.propertyAddress, unit: f.unit, used: 0, source: "lease" as const, basis: "" };
    if (!cur.address && f.propertyAddress) cur.address = f.propertyAddress;
    if (!cur.unit && f.unit) cur.unit = f.unit;

    if (f.docType === "appraisal_1007") {
      const mr = num(f.marketRent);
      // Several 1007s for one unit (a re-appraisal): keep the LOWER, same conservatism.
      if (mr != null && mr > 0) cur.marketRent = cur.marketRent != null ? Math.min(cur.marketRent, mr) : mr;
    } else {
      const lr = monthlyRent(f.leaseMonthlyRent, f.leaseRentFrequency);
      if (lr != null && lr > 0) {
        // Two leases on one unit (renewal + original): the CURRENT one governs. Without dates
        // to tell them apart, keep the lower rather than guessing upward.
        cur.leaseRent = cur.leaseRent != null ? Math.min(cur.leaseRent, lr) : lr;
        cur.hasLease = true;
      }
      if (f.isShortTermRental) {
        const t12 = num(f.trailing12GrossRent);
        if (t12 != null && t12 > 0) { cur.str = true; cur.leaseRent = (t12 / 12) * 0.8; cur.hasLease = true; }
      }
      if (f.isMonthToMonth) cur.m2m = true;
      const end = ymd(f.leaseEndDate);
      if (end && end < today && !f.isMonthToMonth) cur.expired = true;
    }
    units.set(key, cur);
  }

  const out: RentUnit[] = [];
  for (const u of units.values()) {
    const lease = u.leaseRent ?? null;
    const market = u.marketRent ?? null;
    const label = [u.address || "Subject property", u.unit ? `Unit ${u.unit}` : ""].filter(Boolean).join(" ");
    let used = 0;
    let source: RentUnit["source"] = "lease";
    let basis = "";

    if (u.str && lease != null) {
      used = lease; source = "short_term";
      basis = `Short-term rental: trailing-12 gross ÷ 12 × 0.80 = ${money(used)}/mo`;
    } else if (lease != null && market != null) {
      used = Math.min(lease, market); source = "lesser_of";
      basis = `Lesser of lease ${money(lease)} and market rent ${money(market)} (1007) = ${money(used)}/mo`;
      if (lease > market) {
        flags.push({ text: `${label}: the lease (${money(lease)}) is ABOVE the appraiser's market rent (${money(market)}) — qualified at market. Verify the lease is arm's-length and current.`, addBackMonthly: 0, borrower });
      }
    } else if (lease != null) {
      used = lease; source = "lease";
      basis = `Executed lease ${money(lease)}/mo (no 1007 market rent on file to corroborate)`;
      flags.push({ text: `${label}: qualified on the lease alone — no 1007/1025 market-rent appraisal is in the file. Order one before submission; if market rent comes in lower, the qualifying rent drops to it.`, addBackMonthly: 0, borrower });
    } else if (market != null) {
      used = market; source = "market";
      basis = `Market rent ${money(market)}/mo from the 1007 (no executed lease on file)`;
      flags.push({ text: `${label}: no executed lease — qualified on the appraiser's market rent. Most DSCR programmes price an unleased unit to a lower tier or require the signed lease before docs.`, addBackMonthly: 0, borrower });
    } else {
      flags.push({ text: `${label}: a rental document was read but no monthly rent could be extracted — check the document is legible and states the rent.`, addBackMonthly: 0, borrower });
      continue;
    }

    if (u.expired) flags.push({ text: `${label}: the lease term has ENDED (holdover / month-to-month). The rent still counts, but programmes that require a current executed lease will ask for a renewal.`, addBackMonthly: 0, borrower });
    else if (u.m2m) flags.push({ text: `${label}: month-to-month tenancy. The rent counts, but confirm the programme allows M2M — some require a 12-month executed lease.`, addBackMonthly: 0, borrower });

    out.push({ key: u.key, address: u.address, unit: u.unit, leaseRent: lease, marketRent: market, used: Math.round(used), source, basis });
  }

  // Stable order: highest rent first, then by key, so the worksheet doesn't reshuffle run-to-run.
  out.sort((a, b) => b.used - a.used || a.key.localeCompare(b.key));
  const gross = out.reduce((s, u) => s + u.used, 0);

  const lines: IncomeLine[] = [];
  if (mode === "dscr") {
    for (const u of out) {
      lines.push({
        borrower,
        label: `Rental income — ${[u.address || "subject property", u.unit ? `Unit ${u.unit}` : ""].filter(Boolean).join(" ")}`,
        monthly: u.used,
        basis: u.basis,
        streamId: "RENT:" + u.key,
      });
    }
  } else {
    // AGENCY: 75% of gross less that property's PITIA. We do not know the PITIA here, so the
    // figure is offered as an Omit-to-add flag rather than counted — never invent the net.
    for (const u of out) {
      const seventyFive = Math.round(u.used * 0.75);
      flags.push({
        text: `${[u.address || "Rental property", u.unit ? `Unit ${u.unit}` : ""].filter(Boolean).join(" ")}: agency net rental income = 75% of ${money(u.used)} gross (${money(seventyFive)}) MINUS that property's full PITIA. NOT counted automatically because the property's PITIA is not in the income documents. Enter the PITIA, then Omit this flag to add the net.`,
        addBackMonthly: seventyFive,
        borrower,
      });
    }
  }

  return { monthlyGrossRent: gross, units: out, lines, flags };
}
