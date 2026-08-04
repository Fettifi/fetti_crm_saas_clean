// THE PROGRAMME ON THE SCREEN MUST BE THE PROGRAMME ON THE LETTER.
//
// The pre-approval form offers twelve programmes. The LOS stores a free-text product — "FHA
// Purchase + Down Payment Assistance", "First-Time Homebuyer (Conventional) + Down Payment
// Assistance", "hardmoney" — and the form dropped that string straight into the <select>. A value
// that is not one of the options cannot be displayed, so the browser rendered the FIRST option,
// "Conventional", while React state still held the raw string.
//
// Verified in the live app on 2026-08-04: Magali's FHA file pulled in reading Conventional. Either
// the screen or the letter was going to be wrong, and the LO had no way to see which.
//
// The rule is the one already applied to occupancy on the same form: map what we know, blank what
// we do not. A blank programme is obvious and gets picked. A wrong one gets signed.
export const LOAN_PROGRAMS = [
  "Conventional", "FHA", "VA", "USDA", "Jumbo", "First-Time Homebuyer", "DSCR",
  "Bank-Statement (Self-Employed)", "Fix & Flip", "Bridge", "HELOC", "Reverse (HECM)",
] as const;

export function programFromProduct(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const exact = LOAN_PROGRAMS.find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const l = s.toLowerCase();
  // ORDER MATTERS. "First-Time Homebuyer (Conventional)" names two programmes; the first-time
  // programme is the one being offered and the parenthetical only says how it is underwritten.
  if (/\bfha\b/.test(l)) return "FHA";
  if (/\bva\b|veterans? affairs/.test(l)) return "VA";
  if (/\busda\b|rural development/.test(l)) return "USDA";
  if (/\bdscr\b|debt.service coverage/.test(l)) return "DSCR";
  if (/bank.statement/.test(l)) return "Bank-Statement (Self-Employed)";
  if (/\bheloc\b|home equity line/.test(l)) return "HELOC";
  if (/\breverse\b|\bhecm\b/.test(l)) return "Reverse (HECM)";
  if (/fix.{0,4}(and|&).{0,4}flip/.test(l)) return "Fix & Flip";
  if (/\bbridge\b/.test(l)) return "Bridge";
  if (/\bjumbo\b/.test(l)) return "Jumbo";
  if (/first.time/.test(l)) return "First-Time Homebuyer";
  if (/conventional|conforming/.test(l)) return "Conventional";
  // "Refinance", "Purchase", "Working Capital", "hardmoney" are all real values in the LOS today.
  // None of them names a programme. Saying nothing is the correct answer.
  return "";
}
