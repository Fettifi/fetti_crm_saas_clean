// DECIMAL ENTRY — typing 6.5 must not produce 65.
//
// Ramon, 2026-08-02, after the re-audit caught it: BOTH override editors shipped that day mangled
// decimals. A controlled input whose value is String(parsedNumber) erases the decimal point as it
// is typed — "6." parses to 6, re-renders "6", and the next keystroke lands on "6" — so 6.5
// became 65 and 4800.50 became 480050. Not a rejected entry: a confident wrong number, off by a
// factor of ten or a hundred, in a box the user filled in correctly.
//
// Simulates real keystroke-by-keystroke behaviour, because that is where the bug lives; a
// single-shot "does it parse" test passes on the broken version.
//
//   npx tsx scripts/verify-numeric-input.ts
import { commitNumericText, numericBoxValue } from "../lib/numericInput";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

/** Type a string one character at a time, exactly as a controlled input applies each edit. */
function typeIn(seq: string, opts?: { allowNegative?: boolean }) {
  let text = "", value: number | null = null;
  for (const ch of seq) { const c = commitNumericText(text + ch, opts); text = c.text; value = c.value; }
  return { text, value };
}

console.log(`\nDECIMAL ENTRY IN OVERRIDE BOXES\n`);

for (const [seq, want] of [["6.5", 6.5], ["4800.50", 4800.5], ["1250", 1250], ["0.125", 0.125]] as [string, number][]) {
  const r = typeIn(seq);
  chk(r.text === seq && r.value === want,
    `typing ${JSON.stringify(seq)} gives ${JSON.stringify(r.text)} = ${r.value} (the old code gave ${seq.replace(".", "")})`);
}
// A TRAILING DOT keeps the dot on screen and commits the digits so far. That is the point of the
// split: the box shows "12." while the value is already 12, so nothing is lost if the user stops
// there. (My first draft of this guard asserted value===null here and failed — the guard was
// wrong, not the helper. Worth leaving as a note: an assertion is a claim about the contract, and
// getting it backwards manufactures a bug report.)
{ const r = typeIn("12."); chk(r.text === "12." && r.value === 12, `typing "12." shows ${JSON.stringify(r.text)} while committing ${r.value}`); }

// ── Mid-typing states must not commit. "" as 0 would read as a STATED zero — on rent, "vacant".
for (const partial of ["", ".", "-", "-."]) {
  const c = commitNumericText(partial, { allowNegative: true });
  if (c.value !== null) chk(false, `${JSON.stringify(partial)} committed ${c.value} — a mid-typing state is not a figure`);
}
chk(true, `"", ".", "-" and "-." commit nothing — a blank never becomes a stated zero`);

// ── A real zero still commits. This is the $0 rule the rest of the audit turns on.
chk(commitNumericText("0").value === 0, `"0" commits as a real zero`);

// ── One decimal point, minus only in front, and only where negatives are legitimate.
// A second dot is dropped as it is typed, so the digits after it continue the same number:
// "6.5.3" lands on 6.53. What matters is that the text never holds two dots.
{ const r = typeIn("6.5.3"); chk((r.text.match(/\./g) || []).length === 1 && r.value === 6.53,
  `a second decimal point is dropped rather than appended (${JSON.stringify(r.text)} = ${r.value})`); }
chk(commitNumericText("-450", { allowNegative: true }).value === -450, "a negative commits where allowed (a rental LOSS)");
// Where negatives are not legitimate the minus NEVER APPEARS in the box, so the user gets
// immediate feedback instead of a silently flipped sign. Committing 450 from "-450" while
// showing "-450" would be the sign-reversal failure this codebase already hit once today with
// the U+2212 strip in the comparison PDF.
{ const c = commitNumericText("-450");
  chk(!c.text.includes("-") && c.value === 450,
    `where negatives are disallowed the minus is not accepted into the box at all (${JSON.stringify(c.text)} = ${c.value})`); }
chk(commitNumericText("4-50", { allowNegative: true }).text === "450", "a minus in the middle is stripped, not honoured");

// ── Garbage is refused, never reinterpreted as zero.
for (const junk of ["abc", "N/A", "$", "--"]) {
  if (commitNumericText(junk, { allowNegative: true }).value !== null) chk(false, `${JSON.stringify(junk)} became a number`);
}
chk(true, "non-numeric text commits nothing rather than becoming $0");

// ── The render rule: in-progress text wins, else the committed number, else empty.
chk(numericBoxValue("6.", 6) === "6.", "the box shows the user's in-progress text, not the parsed number");
chk(numericBoxValue(undefined, 6) === "6", "with no draft it shows the committed value");
chk(numericBoxValue(undefined, null) === "" && numericBoxValue(undefined, undefined) === "",
  "and an unset field is empty, not '0'");
chk(numericBoxValue(undefined, 0) === "0", "a committed ZERO renders as 0, not as empty");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A box that turns 6.5 into 65 is worse than a read-only field.\n`); process.exit(1); }
console.log(`PASS — decimals survive keystroke-by-keystroke entry.\n`);
