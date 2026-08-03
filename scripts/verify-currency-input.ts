// A CHARACTER STRIP MUST NEVER CHANGE A NUMBER'S MAGNITUDE.
//
// Ramon, 2026-08-02, round-4 audit. The shared money input defaults to allowCents=false,
// and "false" was implemented as `s.replace(/\./g, "")` — DELETE every decimal point.
// Deleting the point does not drop the cents, it CONCATENATES them onto the dollars:
//
//     "425000.00"  ->  42500000     (100x — a $425k loan becomes $42.5M)
//     "132.50"     ->  13250        (100x — a $132.50 MI quote becomes $13,250/mo)
//     "6.5"        ->  65           (10x)
//
// 56 of the 60 CurrencyInput call sites use that default, including the borrower's own
// application form and the landing-page lead form. Nobody is shown a rejected entry;
// they are shown a confident wrong number.
//
// The correct behaviour for a whole-dollar field is to TRUNCATE at the decimal point —
// the integer part IS the dollars — so the magnitude the user typed always survives.
//
// This guard imports the two functions the component actually calls on every keystroke,
// so it tests what ships rather than a re-implementation of the rules.
//
//   npx tsx scripts/verify-currency-input.ts
import { formatDisplay, toClean } from "../components/ui/CurrencyInput";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

console.log(`\nCURRENCY INPUT — a strip must never change the magnitude\n`);

// ── 1. THE 100x CLASS. What the caller receives must never exceed what was typed.
//    This is the whole defect: every one of these silently multiplied.
const WHOLE: [string, string][] = [
  ["425000.00", "425000"],   // pasted from a lender quote / another sheet
  ["132.50", "132"],
  ["6.5", "6"],
  ["1250.99", "1250"],
  ["0.50", "0"],
  ["$425,000.00", "425000"], // pasted WITH formatting, the realistic case
];
for (const [typed, want] of WHOLE) {
  const got = toClean(typed, false);
  chk(got === want, `whole-dollar field: "${typed}" commits ${got || '""'} (must be ${want}, never ${typed.replace(/[^\d]/g, "")})`);
}

// ── 2. The magnitude invariant, stated directly. A whole-dollar strip may only ever
//    REMOVE value, never add. If this fails, some input somewhere is inflating money.
for (const [typed] of WHOLE) {
  const got = Number(toClean(typed, false) || 0);
  const real = Number(String(typed).replace(/[^\d.]/g, "") || 0);
  chk(got <= Math.ceil(real), `magnitude never grows: "${typed}" -> ${got} <= ${real}`);
}

// ── 3. What is DISPLAYED must agree with what was COMMITTED. A box reading one number
//    while the form holds another is how a wrong figure survives a proof-read.
for (const [typed, want] of WHOLE) {
  const shown = formatDisplay(typed, false).replace(/,/g, "");
  chk(shown === want, `the box shows ${shown || '""'} for "${typed}" — same as the committed ${want}`);
}

// ── 4. allowCents=true must keep the cents intact (the MI quote, closing-cost lines).
const CENTS: [string, string][] = [
  ["132.50", "132.50"],
  ["425000.00", "425000.00"],
  ["6.5", "6.5"],
  ["1250.999", "1250.999"],   // caller rounds; the input must not mangle it
];
for (const [typed, want] of CENTS) {
  chk(toClean(typed, true) === want, `cents field: "${typed}" commits ${toClean(typed, true)} (must be ${want})`);
}

// ── 5. MID-TYPING STATES MUST SURVIVE. A controlled input whose value is the parsed
//    number erases the point at the instant it is typed, so "6." re-renders as "6" and
//    the next keystroke lands on the wrong side. This is the same shape lib/numericInput.ts
//    exists to prevent; the money input must not reintroduce it.
chk(toClean("6.", true) === "6.", `a trailing "." survives while the user is still typing (got ${JSON.stringify(toClean("6.", true))})`);
chk(formatDisplay("6.", true).replace(/,/g, "") === "6.", `and the box still shows it (got ${JSON.stringify(formatDisplay("6.", true))})`);
chk(toClean("", false) === "", "an empty box stays empty — not coerced to 0, which on a money field reads as a stated zero");

// ── 6. Only ONE decimal point survives, and junk is refused rather than reinterpreted.
chk(toClean("1.2.3", true) === "1.23", `a second "." is dropped, not treated as another number (got ${toClean("1.2.3", true)})`);
chk(toClean("abc", false) === "", "letters commit nothing");

// ── 7. Formatting stays readable — the reason this component exists at all.
chk(formatDisplay("1250000", false) === "1,250,000", "thousands separators still render");
chk(formatDisplay("425000.00", true) === "425,000.00", "and cents render alongside them");

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). A money box that changes the magnitude of what was typed is the most expensive kind of bug this repo ships: it is silent, it is borrower-facing, and it is off by a factor of ten.\n`);
  process.exit(1);
}
console.log(`PASS — every money field commits the magnitude that was typed.\n`);
