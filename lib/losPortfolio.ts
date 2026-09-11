// PORTFOLIO LOAN FILE — the property SET behind one loan file.
//
// A `loan_files` row describes ONE property: single property_address / property_value /
// loan_amount / state. That is wrong for an acquisition of several properties, and the damage is
// not hypothetical — file FF-202609-9552 had two addresses crammed into one text column because
// there was nowhere else to put the second one.
//
// This module holds the set. It is PURE and isomorphic (its only import is a type), so the server
// route and the "use client" LOS page compute identical numbers from one definition instead of two
// renderers drifting apart.
//
// THREE DECISIONS THAT ARE LOAD-BEARING, AND WHY:
//
// 1. THE FILE OWNS ITS PROPERTIES. It does not point at a `uw_portfolio_<id>`.
//    app/api/underwrite/route.ts deletes those docs with no reference check, so a pointer would
//    dangle the moment somebody tidies the saved list — and the sets are different objects
//    anyway: a 40-row screening sheet is candidates, a loan file's set is collateral. Importing
//    from /underwrite COPIES the rows and records where they came from as provenance only.
//
// 2. IDS ARE STABLE AND OPAQUE. The underwriter assigns `id: "p" + index` at parse time, AFTER a
//    dedupe-by-address map, so those ids are array positions: re-upload a corrected rent roll and
//    every row renumbers. Anything keyed on them — "under contract", a title order, the primary
//    property — would silently re-point to a different parcel. Imported rows are therefore re-keyed
//    to a caller-supplied opaque id that is assigned once and never recomputed.
//
// 3. ROLLUPS ARE NEVER WRITTEN BACK INTO THE SINGLE-PROPERTY COLUMNS, AND ARE NEVER ONE NUMBER.
//    `loan_files.property_value` feeds company volume on the dashboard, the LTV on a wholesaler
//    shopping sheet, and a pre-approval letter a listing agent reads. Summing a set that includes
//    properties merely being LOOKED AT would make every one of those confidently wrong rather than
//    obviously blank. So the columns keep describing the PRIMARY property, and this module reports
//    `committed` (under contract or past it) separately from `identified` (still a candidate).
//    A caller that wants one number has to choose which one it means.

import type { PropertyRow } from "./underwrite/engine";

export const FILE_PORTFOLIO_VERSION = 1 as const;
export const filePortfolioKey = (loanFileId: string) => `FILE_PORTFOLIO:${loanFileId}`;

/** Where a property sits in the deal. `dropped` is a tombstone — never a hard delete, because a
 *  property that was under contract and fell out is part of the file's history. */
export type PropertyStatus = "identified" | "under_contract" | "in_diligence" | "closed" | "dropped";
export const PROPERTY_STATUSES: PropertyStatus[] = ["identified", "under_contract", "in_diligence", "closed", "dropped"];
/** Committed = the borrower is on the hook. These are the only ones that may be summed as exposure. */
export const COMMITTED_STATUSES: PropertyStatus[] = ["under_contract", "in_diligence", "closed"];

export type Occupancy = "Investment" | "Primary residence" | "Second home";
export const OCCUPANCIES: Occupancy[] = ["Investment", "Primary residence", "Second home"];

/** Widens PropertyRow so `activeProperties()` can be handed straight to underwritePortfolio(). */
export type FileProperty = PropertyRow & {
  status: PropertyStatus;
  occupancy?: Occupancy | null;
  contract_price?: number | null;
  requested_loan?: number | null;
  added_at: string;
  dropped_reason?: string | null;
};

export type FilePortfolio = {
  v: typeof FILE_PORTFOLIO_VERSION;
  loan_file_id: string;
  name: string;
  properties: FileProperty[];
  primary_id: string | null;
  source: { kind: "uw_portfolio"; id: string; name: string; imported_at: string; imported_rows: number } | null;
  updated_at: string;
};

export type Rollup = {
  count: number;               // active (non-dropped)
  dropped: number;
  committed_count: number;
  identified_count: number;
  /** Exposure. Sums COMMITTED properties only — never candidates. */
  committed_value: number | null;
  committed_requested_loan: number | null;
  /** Candidates, reported apart so nothing can blend the two into one "portfolio value". */
  identified_value: number | null;
  states: string[];
  occupancies: Occupancy[];
};

const iso = (now: string) => now;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const clean = (s: unknown, max = 200): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function emptyPortfolio(loanFileId: string, name: string, now: string): FilePortfolio {
  return { v: FILE_PORTFOLIO_VERSION, loan_file_id: loanFileId, name: clean(name, 120) || "Portfolio",
    properties: [], primary_id: null, source: null, updated_at: iso(now) };
}

/** Tolerant read: returns null for junk rather than throwing, so a corrupt row cannot 500 a page. */
export function parsePortfolio(raw: string | null | undefined): FilePortfolio | null {
  if (!raw) return null;
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!p || typeof p !== "object" || !Array.isArray(p.properties)) return null;
    return p as FilePortfolio;
  } catch { return null; }
}

export const activeProperties = (p: FilePortfolio): FileProperty[] => p.properties.filter((x) => x.status !== "dropped");
export const committedProperties = (p: FilePortfolio): FileProperty[] =>
  p.properties.filter((x) => COMMITTED_STATUSES.includes(x.status));

export function primaryProperty(p: FilePortfolio): FileProperty | null {
  const act = activeProperties(p);
  if (!act.length) return null;
  return act.find((x) => x.id === p.primary_id) || act[0];
}

/** The price a property is actually on the hook for, preferring an executed contract over a basis. */
const exposureOf = (x: FileProperty): number | null => num(x.contract_price) ?? num(x.price);

export function rollup(p: FilePortfolio): Rollup {
  const act = activeProperties(p);
  const committed = committedProperties(p);
  const identified = act.filter((x) => !COMMITTED_STATUSES.includes(x.status));
  const sum = (rows: FileProperty[], f: (x: FileProperty) => number | null): number | null => {
    const vals = rows.map(f).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return {
    count: act.length,
    dropped: p.properties.length - act.length,
    committed_count: committed.length,
    identified_count: identified.length,
    committed_value: sum(committed, exposureOf),
    committed_requested_loan: sum(committed, (x) => num(x.requested_loan)),
    identified_value: sum(identified, exposureOf),
    states: [...new Set(act.map((x) => clean(x.state, 2).toUpperCase()).filter(Boolean))].sort(),
    occupancies: [...new Set(act.map((x) => x.occupancy).filter(Boolean))] as Occupancy[],
  };
}

// ---------------------------------------------------------------- purpose
// A credit transaction has exactly ONE consumer/business-purpose determination. Reg Z
// § 1026.3(a) exempts credit whose PRIMARY purpose is business — that is a property of the
// EXTENSION OF CREDIT, not of each parcel. So a portfolio file is never "part consumer, part
// business", and the compliance sets must never be computed per property and unioned: a file
// carrying both "Loan Estimate delivered within 3 business days" and "Term sheet issued" shows an
// examiner an un-ticked LE box, which reads as an admitted violation rather than as inapplicable.
//
// This does not decide anything. It REFUSES to guess when the set is inconsistent, so a human
// resolves it before the file carries a determination nobody made.
export type PurposeClass = "business" | "consumer" | "mixed_unresolved" | "unknown";

export function purposeClass(p: FilePortfolio): { cls: PurposeClass; reason: string } {
  const occ = activeProperties(p).map((x) => x.occupancy).filter(Boolean) as Occupancy[];
  if (!occ.length) return { cls: "unknown", reason: "No property on this file records an occupancy." };
  const consumer = occ.filter((o) => o !== "Investment");
  const investment = occ.filter((o) => o === "Investment");
  if (consumer.length && investment.length) {
    return { cls: "mixed_unresolved",
      reason: `${investment.length} propert${investment.length === 1 ? "y is" : "ies are"} investment and ${consumer.length} ${consumer.length === 1 ? "is" : "are"} a principal residence or second home. One extension of credit has one purpose under Reg Z § 1026.3(a); Advisor cannot infer it from a mixed set. Split the file, or correct the occupancies.` };
  }
  return consumer.length
    ? { cls: "consumer", reason: "Every property is a principal residence or second home — consumer credit, TRID applies." }
    : { cls: "business", reason: "Every property is held for investment — business-purpose, TRID-exempt under Reg Z § 1026.3(a)." };
}

// ---------------------------------------------------------------- mutators (pure)
export type Fail = { error: string };
export const isFail = (x: unknown): x is Fail => !!x && typeof x === "object" && "error" in (x as object);

export function addProperty(
  p: FilePortfolio,
  input: Partial<FileProperty> & { address?: string },
  id: string,
  now: string,
): { portfolio: FilePortfolio; property: FileProperty } | Fail {
  const address = clean(input.address);
  if (!address) return { error: "A property needs an address." };
  const key = address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (activeProperties(p).some((x) => x.address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key)) {
    return { error: `"${address}" is already on this file.` };
  }
  const status = (input.status && PROPERTY_STATUSES.includes(input.status)) ? input.status : "identified";
  if (status === "dropped") return { error: "A property cannot be added as dropped." };
  const occupancy = input.occupancy && OCCUPANCIES.includes(input.occupancy) ? input.occupancy : null;
  const property: FileProperty = {
    id, address,
    city: clean(input.city, 80) || null,
    state: clean(input.state, 2).toUpperCase() || null,
    zip: clean(input.zip, 10) || null,
    property_type: clean(input.property_type, 40) || null,
    units: num(input.units),
    price: num(input.price),
    rent_monthly: num(input.rent_monthly),
    back_tax_status: "unknown",
    status, occupancy,
    contract_price: num(input.contract_price),
    requested_loan: num(input.requested_loan),
    notes: clean(input.notes, 500) || null,
    added_at: iso(now),
  };
  const properties = [...p.properties, property];
  return { portfolio: { ...p, properties, primary_id: p.primary_id || property.id, updated_at: iso(now) }, property };
}

const MUTABLE: (keyof FileProperty)[] = ["address","city","state","zip","property_type","units","price",
  "rent_monthly","taxes_annual","insurance_annual","hoa_monthly","rehab_budget","arv","notes",
  "status","occupancy","contract_price","requested_loan"];

export function updateProperty(p: FilePortfolio, id: string, patch: Partial<FileProperty>, now: string): FilePortfolio | Fail {
  const i = p.properties.findIndex((x) => x.id === id);
  if (i < 0) return { error: "No property with that id on this file." };
  if (patch.status === "dropped") return { error: "Use the drop action, which records a reason." };
  if (patch.status && !PROPERTY_STATUSES.includes(patch.status)) return { error: `status must be one of ${PROPERTY_STATUSES.join(", ")}` };
  if (patch.occupancy && !OCCUPANCIES.includes(patch.occupancy)) return { error: `occupancy must be one of ${OCCUPANCIES.join(", ")}` };
  const next = { ...p.properties[i] };
  for (const k of MUTABLE) {
    if (!(k in patch)) continue;
    const v = (patch as Record<string, unknown>)[k];
    (next as Record<string, unknown>)[k] =
      ["units","price","rent_monthly","taxes_annual","insurance_annual","hoa_monthly","rehab_budget","arv","contract_price","requested_loan"].includes(k)
        ? num(v)
        : (k === "state" ? clean(v, 2).toUpperCase() || null : (typeof v === "string" ? clean(v, k === "notes" ? 500 : 200) || null : v));
  }
  if (!clean(next.address)) return { error: "A property needs an address." };
  const properties = [...p.properties]; properties[i] = next as FileProperty;
  return { ...p, properties, updated_at: iso(now) };
}

export function dropProperty(p: FilePortfolio, id: string, reason: string, now: string): FilePortfolio | Fail {
  const i = p.properties.findIndex((x) => x.id === id);
  if (i < 0) return { error: "No property with that id on this file." };
  if (p.properties[i].status === "dropped") return { error: "That property is already dropped." };
  const why = clean(reason, 300);
  if (!why) return { error: "Dropping a property needs a reason — it becomes part of the file's history." };
  const properties = [...p.properties];
  properties[i] = { ...properties[i], status: "dropped", dropped_reason: why };
  const stillPrimary = properties.some((x) => x.id === p.primary_id && x.status !== "dropped");
  const primary_id = stillPrimary ? p.primary_id : (properties.find((x) => x.status !== "dropped")?.id ?? null);
  return { ...p, properties, primary_id, updated_at: iso(now) };
}

export function setPrimary(p: FilePortfolio, id: string, now: string): FilePortfolio | Fail {
  const row = p.properties.find((x) => x.id === id);
  if (!row) return { error: "No property with that id on this file." };
  if (row.status === "dropped") return { error: "A dropped property cannot be the primary property." };
  return { ...p, primary_id: id, updated_at: iso(now) };
}

/** Copy rows out of a saved /underwrite portfolio. Re-keys every row: the underwriter's ids are
 *  array positions and would re-point on the next upload. */
export function fromUwPortfolio(
  doc: { id: string; name: string; rows: PropertyRow[] },
  opts: { loanFileId: string; newId: (i: number) => string; now: string; selectIds?: string[]; occupancy?: Occupancy | null },
): FilePortfolio {
  const wanted = opts.selectIds && opts.selectIds.length ? doc.rows.filter((r) => opts.selectIds!.includes(r.id)) : doc.rows;
  const properties: FileProperty[] = wanted
    .filter((r) => clean(r.address))
    .map((r, i) => ({ ...r, id: opts.newId(i), address: clean(r.address),
      state: clean(r.state, 2).toUpperCase() || null,
      status: "identified" as PropertyStatus, occupancy: opts.occupancy ?? null,
      contract_price: null, requested_loan: null, added_at: opts.now }));
  return { v: FILE_PORTFOLIO_VERSION, loan_file_id: opts.loanFileId, name: clean(doc.name, 120) || "Portfolio",
    properties, primary_id: properties[0]?.id ?? null,
    source: { kind: "uw_portfolio", id: doc.id, name: clean(doc.name, 120), imported_at: opts.now, imported_rows: properties.length },
    updated_at: opts.now };
}
