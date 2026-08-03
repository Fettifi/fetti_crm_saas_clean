// ONE DEFINITION OF WHAT A PRE-APPROVAL LETTER SAYS.
//
// Ramon, 2026-08-03: "make sure that everything that I upload in the term sheet is captured and
// showed on the preapproval that I issue."
//
// It was not, and the reason was structural: the letter existed in TWO renderers that each kept
// their own hand-written list of rows.
//   • lib/preapprovalPdf.ts        rendered ~18 rows including every extracted term-sheet field
//   • app/letter/[token]/page.tsx  rendered EIGHT, and its API route did not even SELECT the
//                                  extra terms — so the web link he sends to a borrower or a
//                                  listing agent showed no LTV, no payment, no points, no fees,
//                                  no prepay, no reserves, no DSCR, no lock. The PDF and the web
//                                  letter were two different documents for the same letter.
//
// Two lists for one fact drift apart the moment either is edited — the same shape as the
// smsCapable/sms_capable split and the 1003 field drop. So there is now ONE list, here, and both
// renderers consume it. Adding a term-sheet field is a single entry in FIELDS below and it
// appears on the PDF, on the web letter, and in the LO's form.
import { PA_FIELDS, PA_SECTIONS, type PaField } from "@/lib/preapprovalFields";

export type TermRow = { key: string; label: string; value: string };
export type TermSection = { name: string; rows: TermRow[] };

const money = (n?: number | null) =>
  n == null || !isFinite(Number(n)) ? null : "$" + Math.round(Number(n)).toLocaleString();

/**
 * LTV, resolved once for every renderer.
 *
 * Precedence was backwards and it was fixed in the PDF only. A STATED ltv — typed by the LO, or
 * read off the lender's own term sheet — must win; a recomputed figure only fills a blank. And
 * the recomputation must use the SAME basis the Scenario Desk uses (lib/scenario.ts ltvBasis:
 * the lesser of as-is value and price on a purchase), or the letter and the desk print two
 * different ratios for one deal.
 */
export function resolveLtv(l: any, x: any): string | null {
  const stated = x?.ltv != null && String(x.ltv).trim() !== "" ? String(x.ltv).trim() : null;
  if (stated) return stated.endsWith("%") ? stated : `${stated}%`;
  const asIs = Number(x?.as_is_value) > 0 ? Number(x.as_is_value) : null;
  const price = Number(l?.purchase_price) > 0 ? Number(l.purchase_price) : null;
  const purpose = String(x?.loan_purpose || "");
  const isPurchase = /purchase|acquisition/i.test(purpose) && !/refi/i.test(purpose);
  const basis = (isPurchase && asIs != null && price != null) ? Math.min(asIs, price) : (asIs ?? price);
  if (!(Number(l?.loan_amount) > 0) || !basis) return null;
  return `${Math.round((Number(l.loan_amount) / basis) * 1000) / 10}%`;
}

/** Format a captured value for display according to its declared kind. */
function fmt(f: PaField, raw: any): string | null {
  // A ZERO IS AN ANSWER. "0" points, "$0" lender fees and a "None" prepay are terms the borrower
  // is entitled to see — and are often the BEST terms on the sheet. Only null/undefined/"" is
  // absent. Every truthy test here would have silently deleted them.
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (f.valueKind === "money") {
    const n = Number(s.replace(/[^0-9.\-]/g, ""));
    return isFinite(n) && /^[\s$\-0-9.,]+$/.test(s) ? money(n) : s;
  }
  return s;
}

/**
 * Every row the letter should show, grouped into sections, in letter order.
 * `l` is the preapprovals row; `x` is the PA_TERMS extras blob.
 * Rows with no captured value are omitted — except the small always-show core, which prints an
 * em dash so a letter never looks like it forgot the loan amount.
 */
export function letterSections(l: any, x: any): TermSection[] {
  const extra = x && typeof x === "object" ? x : {};
  const ltv = resolveLtv(l, extra);
  // Values live in two places: real columns on `preapprovals`, and the extras blob. Read both
  // through one accessor so no field's home has to be remembered at the call site.
  const valueOf = (f: PaField): any => {
    if (f.key === "ltv") return ltv;
    if (f.column) return (l || {})[f.key];
    return (extra as any)[f.key];
  };

  const out: TermSection[] = [];
  for (const section of PA_SECTIONS) {
    const rows: TermRow[] = [];
    for (const f of PA_FIELDS) {
      if (f.section !== section) continue;
      if (f.internalOnly) continue;              // captured for the LO, never on the letter
      const v = fmt(f, valueOf(f));
      if (v == null) { if (f.alwaysShow) rows.push({ key: f.key, label: f.label, value: "—" }); continue; }
      rows.push({ key: f.key, label: f.label, value: v });
    }
    if (rows.length) out.push({ name: section, rows });
  }
  return out;
}

/** Flat row list (sections dropped) — for renderers that want one continuous table. */
export function letterRows(l: any, x: any): TermRow[] {
  return letterSections(l, x).flatMap((s) => s.rows);
}
