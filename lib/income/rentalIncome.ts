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
//     If a long-term lease rent is ALSO on file for that door, the lower of the two, flagged:
//     the document set does not say which is in force, and guessing upward is not available.
//   • Expired or month-to-month lease still counts (a holdover tenancy is real income) but is
//     flagged, because some programmes require a current executed lease.
// Gross rent is NOT haircut for DSCR — the DSCR ratio itself carries the coverage cushion, so
// applying 75% here as well would double-count the same conservatism.
//
// AGENCY mode is the different rule and is deliberately NOT auto-counted: Fannie/Freddie net
// rental income is 75% of gross MINUS that property's full PITIA, and we do not know a
// non-subject property's PITIA from a lease. So agency mode holds the 75% figure behind an
// Omit-to-add flag rather than inventing a number. See lib/income/programs.ts RENTAL_LEASE_75.
//
// DIRECTION (added 2026-08-21). A lease has two sides and the engine had no idea which one the
// borrower was on. `tenantName` had been extracted off every lease since the rental path shipped
// and was read by NOTHING — the field existed, travelled all the way into the stored DocFact, and
// changed no outcome. So any document the reader called a "lease" contributed its rent as INCOME,
// including the borrower's OWN residential lease — a document LOs upload routinely as proof of
// housing history. On an investment file that lease lands in the DSCR gross rent and inflates the
// qualifying income by the borrower's own housing PAYMENT, which is the opposite sign.
// Found on the Lucki Long file (FF-202608-2047), where the executed C.A.R. RLMM happens to run
// the right way — she is the Housing Provider, Javed Woodley the tenant, $2,000/mo — so the
// $2,000 is real income. Nothing in the code checked that; it would have counted the same either
// way. The rule now: rent counts only when the borrower RECEIVES it.
import { isSamePerson, type DocFact, type IncomeFlag, type IncomeLine } from "@/lib/income/docFacts";

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
  opts: { mode: "dscr" | "agency"; today?: string; borrower?: 1 | 2; applicants?: string[] } = { mode: "dscr" },
): RentalResult {
  const mode = opts.mode || "dscr";
  const borrower: 1 | 2 = opts.borrower || 1;
  const today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
  const applicants = (opts.applicants || []).filter(Boolean);
  const allRentals = (facts || []).filter(Boolean).filter(isRentalDoc);

  // ── DIRECTION GATE ────────────────────────────────────────────────────────────────────────
  // Only rent the borrower RECEIVES is income. A 1007/1025 states an appraiser's market-rent
  // opinion and names no parties, so it is never gated — only executed leases and rent rolls are.
  //
  // This EXCLUDES rather than merely warns, because the engine's own QC naming an error while the
  // wrong number ships is the failure this codebase keeps paying for. But every excluded unit
  // carries its rent in `addBackMonthly`, so an LO who knows the read is wrong Omits the flag and
  // the rent comes back — the gate is visible and reversible, not silent.
  //
  // With no roster supplied nothing is gated: absent the applicant names there is no evidence
  // about direction either way, and a missing document is not a fact about the borrower.
  const rentals: DocFact[] = [];
  const flags: IncomeFlag[] = [];
  for (const f of allRentals) {
    const rent = monthlyRent(f.leaseMonthlyRent, f.leaseRentFrequency);
    const label = [f.propertyAddress || "A rental property", f.unit ? `Unit ${f.unit}` : ""].filter(Boolean).join(" ");
    const tenantIsBorrower = applicants.some((a) => isSamePerson(a, f.tenantName));
    const landlordIsBorrower = applicants.some((a) => isSamePerson(a, f.landlordName));
    if (f.docType !== "appraisal_1007" && tenantIsBorrower && !landlordIsBorrower) {
      flags.push({
        text: `${label}: the applicant is named as the TENANT on this lease${f.landlordName ? ` (landlord: ${f.landlordName})` : ""} — this rent is money the borrower PAYS, not receives, so it is NOT counted as rental income. If the applicant is in fact the landlord here, Omit this flag to count it.`,
        addBackMonthly: rent && rent > 0 ? Math.round(rent) : 0,
        borrower,
      });
      continue;
    }
    if (f.docType !== "appraisal_1007" && tenantIsBorrower && landlordIsBorrower) {
      flags.push({
        text: `${label}: the applicant is named on BOTH sides of this lease (tenant "${f.tenantName}" and landlord "${f.landlordName}"), so the document does not establish who receives the rent — NOT counted. Confirm which party the applicant is, then Omit this flag to count it.`,
        addBackMonthly: rent && rent > 0 ? Math.round(rent) : 0,
        borrower,
      });
      continue;
    }
    rentals.push(f);
  }
  // strMonthly / strT12 are SEPARATE from leaseRent on purpose — see the STR block below. The
  // haircut used to be parked in `leaseRent`, where the lease-resolution pass overwrote it.
  type Acc = RentUnit & { expired?: boolean; m2m?: boolean; str?: boolean; strMonthly?: number; strT12?: number; strNoT12?: boolean; hasLease?: boolean; superseded?: number; leaseCandidates?: { rent: number; start: string | null; end: string | null; m2m: boolean }[] };
  const units = new Map<string, Acc>();

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
        // Collect every lease figure for this unit; which one governs is decided below, once
        // all of them are known. Resolving pairwise here is what made the Jackson Metoyer
        // file qualify 4235 8th Ave at its 2021 rent of $2,750 while a 2026 rent-increase
        // notice for $2,954 sat in the same folder.
        (cur.leaseCandidates ||= []).push({ rent: lr, start: ymd(f.leaseStartDate), end: ymd(f.leaseEndDate), m2m: !!f.isMonthToMonth });
        cur.hasLease = true;
      }
      // SHORT-TERM RENTAL — the haircut must survive the lease-resolution pass below.
      //
      // This used to write the haircut figure into `cur.leaseRent`, the same slot the lease
      // candidates resolve into. So on any STR document that ALSO carries a printed monthly
      // rent — an Airbnb/VRBO statement that prints a monthly average, or an STR statement
      // filed alongside a 12-month lease for the same door — `u.leaseRent = chosen` on the
      // resolution line overwrote it, the 20% haircut was discarded, and the worksheet still
      // printed "trailing-12 gross ÷ 12 × 0.80 =" beside the UN-haircut number.
      //
      // Measured on the real shape (4 STR Ln, trailing-12 $60,000, printed monthly $5,000):
      // the engine reported $5,000/mo under a derivation whose own arithmetic is
      // 60,000 ÷ 12 × 0.80 = $4,000. $1,000/mo — 25% — of qualifying rent that does not
      // exist, on a DSCR file where the rent IS the income, under a line of arithmetic an
      // underwriter can check in two seconds and will not believe again.
      //
      // So: the STR figure keeps its OWN slot, and the trailing-12 input is kept with it so
      // the printed derivation states the number it was derived from instead of asserting it.
      if (f.isShortTermRental) {
        const t12 = num(f.trailing12GrossRent);
        if (t12 != null && t12 > 0) {
          cur.str = true;
          cur.hasLease = true;
          // Several STR statements for one unit: keep the LOWER trailing-12, the same
          // conservatism the 1007 and the undated-lease paths already apply.
          if (cur.strT12 == null || t12 < cur.strT12) { cur.strT12 = t12; cur.strMonthly = (t12 / 12) * 0.8; }
        } else {
          // Marked short-term with no trailing-12 to haircut. The unit falls through to the
          // lease/market path at FULL rent, which is the un-haircut number — say so rather
          // than let a silent absence of the haircut look like a decision.
          cur.strNoT12 = true;
        }
      }
      // Term status is judged on the GOVERNING lease only (resolved below) — a renewal that
      // supersedes an expired lease means the unit is NOT expired.
    }
    units.set(key, cur);
  }

  const out: RentUnit[] = [];
  for (const u of units.values()) {
    // WHICH LEASE GOVERNS this unit. A folder routinely holds the original lease, a renewal,
    // a rent-increase notice, and the same PDF uploaded twice.
    //   • Dated documents: the LATEST start date wins — a 2026 increase supersedes a 2021
    //     lease. Same date, different amounts → the higher (an amendment raises rent).
    //   • Undated documents: no way to order them, so keep the LOWEST and say so. Guessing
    //     upward on an undated pair would qualify a deal on a rent nobody can evidence.
    //   • Identical amounts are the same lease uploaded twice — deduped silently.
    const cands = u.leaseCandidates || [];
    if (cands.length) {
      const dated = cands.filter((c) => c.start);
      let chosen: number;
      if (dated.length) {
        const latest = dated.reduce((a, b) => (b.start! > a.start! ? b : a));
        chosen = Math.max(...dated.filter((c) => c.start === latest.start).map((c) => c.rent));
      } else {
        chosen = Math.min(...cands.map((c) => c.rent));
      }
      const others = [...new Set(cands.map((c) => c.rent))].filter((r) => r !== chosen);
      if (others.length) u.superseded = Math.max(...others);
      if (others.length && !dated.length) {
        flags.push({ text: `${u.address || "Subject property"}${u.unit ? ` Unit ${u.unit}` : ""}: ${cands.length} lease documents show different rents (${[...new Set(cands.map((c) => money(c.rent)))].join(", ")}) and none states a start date — qualified at the LOWEST. Confirm which lease is current.`, addBackMonthly: 0, borrower });
      }
      u.leaseRent = chosen;
      // Judge the term on the document that actually governs. A rent-increase notice carries
      // a start date and no end date — that is a month-to-month tenancy, not an expired one.
      const gov = (dated.length ? dated.filter((c) => c.start === dated.reduce((a, b) => (b.start! > a.start! ? b : a)).start) : cands)
        .find((c) => c.rent === chosen) || cands[0];
      if (gov.m2m || !gov.end) u.m2m = true;
      else if (gov.end < today) u.expired = true;
    }
    const lease = u.leaseRent ?? null;
    const market = u.marketRent ?? null;
    const label = [u.address || "Subject property", u.unit ? `Unit ${u.unit}` : ""].filter(Boolean).join(" ");
    let used = 0;
    let source: RentUnit["source"] = "lease";
    let basis = "";

    if (u.str && u.strMonthly != null && u.strT12 != null) {
      // THE PRINTED DERIVATION IS THE ARITHMETIC THAT PRODUCED THE FIGURE, with its input
      // stated. "trailing-12 gross ÷ 12 × 0.80 = $X" with no trailing-12 in it is unverifiable
      // even when it is true, and was false whenever a printed monthly rent clobbered it.
      source = "short_term";
      if (lease != null && lease < u.strMonthly) {
        // A long-term lease figure for a door that is also documented as a short-term rental:
        // the document set does not establish which method is in force. Take the LOWER, the
        // same rule this file already applies to an undated pair of leases (above) — guessing
        // upward would qualify a deal on a rent nobody can evidence.
        used = lease;
        basis = `Short-term rental: trailing-12 gross ${money(u.strT12)} ÷ 12 × 0.80 = ${money(u.strMonthly)}/mo, but a long-term lease for this unit states ${money(lease)}/mo — qualified at the LOWER, ${money(used)}/mo`;
      } else {
        used = u.strMonthly;
        basis = `Short-term rental: trailing-12 gross ${money(u.strT12)} ÷ 12 × 0.80 = ${money(used)}/mo`;
      }
      if (lease != null) {
        flags.push({ text: `${label}: this unit is documented BOTH as a short-term rental (trailing-12 gross ${money(u.strT12)} → ${money(u.strMonthly)}/mo after the 20% STR haircut) and with a long-term lease rent of ${money(lease)}/mo — qualified at the lower of the two (${money(used)}/mo). Confirm which is in force; the STR haircut does not apply to an executed 12-month lease.`, addBackMonthly: 0, borrower });
      }
      if (market != null) {
        flags.push({ text: `${label}: a 1007/1025 market rent of ${money(market)}/mo is on file but was NOT used — the appraiser's market rent is a long-term-tenancy opinion and the short-term-rental method governs here. Verify the programme accepts STR trailing-12 income.`, addBackMonthly: 0, borrower });
      }
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

    if (u.superseded != null && u.superseded !== used && source !== "market") {
      flags.push({ text: `${label}: qualified at ${money(used)} — a second lease document for this unit shows ${money(u.superseded)}. The most recently dated one governs; confirm it is the lease in force.`, addBackMonthly: 0, borrower });
    }
    // Marked short-term, nothing to haircut. The figure above is the FULL rent, so name the
    // absence — an un-haircut STR is the overstatement this unit was supposed to be protected
    // from, and "no flag" reads as "the haircut was considered and did not apply".
    if (u.strNoT12 && source !== "short_term") {
      flags.push({ text: `${label}: read as a SHORT-TERM rental but no trailing-12-month gross is stated on the document, so the 20% STR haircut could not be applied — qualified at the FULL ${money(used)}/mo. Supply the trailing-12 gross (the platform's annual statement) or confirm this is a long-term tenancy.`, addBackMonthly: 0, borrower });
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
