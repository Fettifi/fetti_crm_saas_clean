// WHAT DOES "OMIT" ACTUALLY DO TO *THIS* FLAG?
//
// 2026-09-06, tracing Ricardo Barron (FF-202608-5944). His settled income was $8,452 against a
// documented AI line of $2,678. The difference reconciled exactly: a $5,774 add-back from a flag
// he Omitted. Correct, documented, corroborated by his own 1040. Fine.
//
// The defect was next to it. He Omitted the retirement flag THREE TIMES — 20:39:26, :37, :42 —
// and it added **$0** every time, because that flag carries no `addBackMonthly`. QC had said
// "Documented, countable retirement income omitted: 2025 1040 shows taxable pensions $7,686
// (gross $109,320) and taxable IRA $28,572 — worksheet counted none". He clicked the only button
// on it, three times, and none of that income was ever counted.
//
// The button means "I reviewed this note and it does not hold". On a flag that says money is
// MISSING, that reads as "count it" and does the opposite of what the LO intends. Worse, five
// flags in the live corpus literally end with the words "Omit to count it now" while carrying
// an add-back of $0 — the text promises money the click cannot deliver.
//
// So the UI has to say which kind of flag it is looking at. Classified HERE, in the presentation
// layer, deliberately: this changes no number and touches nothing under lib/income/**. It reads
// the flag the engine already produced and decides what to TELL the loan officer.
//
// Every branch below was written against the 69 real flags in production, not invented examples.

export type FlagAction =
  /** `addBackMonthly > 0` — Omit genuinely adds this money to the qualifying income. */
  | "omit-counts"
  /** The text says "Omit to count it" but the engine attached NO figure. Omitting adds $0. */
  | "omit-counts-zero"
  /** QC says real income was missed or under-counted. Omit dismisses the note; it never counts. */
  | "add-manually"
  /** A document could not be read. The fix is a clean copy, not a click. */
  | "re-request-doc"
  /** An observation, or a dispute that the income is too HIGH. Omit means "reviewed, doesn't hold". */
  | "dismiss";

// "Omit to count it now" / "Omit to count it" — the engine's own invitation. When it appears with
// no add-back the invitation is empty, and that is worth saying out loud.
const PROMISES_COUNT = /\bomit\b[^.]{0,40}\bto\s+count\b/i;

// A document the reader could not open. Checked BEFORE the missed-income test, because these
// also say "income from it was NOT counted" and the action is completely different.
const UNREADABLE = /couldn'?t read|could not read|truncated or corrupt|re-?request a clean copy/i;

// QC asserting money EXISTS in the documents and is not in the worksheet. Deliberately does not
// match "over-count" (the opposite finding) — `under-?count` cannot match inside "over-count".
const MISSED_INCOME =
  /\bunder-?count(?:ed|ing)?\b|\bmissed income\b|\bincome (?:is )?entirely omitted\b|\bincome omitted\b|\bomitted:|\bworksheet counted none\b|\bcounted none\b|\bmaterially under/i;

/**
 * Decide what the Omit button really does to one flag, so the screen can say so.
 *
 * `addBackMonthly` wins over any text: if the engine attached money, Omit moves money, whatever
 * the prose says. Only when there is no figure does the wording decide what to advise.
 */
export function flagAction(text: string | null | undefined, addBackMonthly: number | null | undefined): FlagAction {
  const add = Number(addBackMonthly) || 0;
  if (add > 0) return "omit-counts";
  const t = String(text || "");
  if (PROMISES_COUNT.test(t)) return "omit-counts-zero";
  if (UNREADABLE.test(t)) return "re-request-doc";
  if (MISSED_INCOME.test(t)) return "add-manually";
  return "dismiss";
}

/** One line telling the LO what will happen — shown under a flag whose Omit does not count money. */
export function omitConsequence(action: FlagAction): string | null {
  switch (action) {
    case "omit-counts":
      return null; // the existing green "+$X/mo added" line already says it
    case "omit-counts-zero":
      return "This says “Omit to count it”, but the read attached no figure — omitting adds $0. Use “+ Add income” below and enter the documented monthly amount.";
    case "add-manually":
      return "Omitting only marks this reviewed — it counts $0. To actually count this income, use “+ Add income” below and enter the documented monthly amount.";
    case "re-request-doc":
      return "Omitting only marks this reviewed. Nothing here can be counted until a clean copy of the document is on file.";
    case "dismiss":
      return null;
  }
}

/** Does this flag deserve a one-click “+ Add this as income” shortcut next to Omit? */
export const offersAddIncome = (action: FlagAction) => action === "add-manually" || action === "omit-counts-zero";

/**
 * A short label for a line seeded from a flag.
 *
 * THE AMOUNT IS NEVER TAKEN FROM THE PROSE. These flags are full of figures — "$7,686", "gross
 * $109,320", "$28,572" — and picking one would be the engine inventing a qualifying number out of
 * a sentence. The seeded line carries a label and a blank amount; the loan officer types what the
 * documents support.
 */
export function labelFromFlag(text: string | null | undefined): string {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^QC\s*[⚠️]*\s*:?\s*/i, "");                 // drop the "QC:" / "QC ⚠️:" prefix
  const employer = t.match(/^([A-Z][A-Za-z0-9&.,'\- ]{2,60}?)\s*:/);  // "MARITECH ... :" style
  // Split only on a COLON, a spaced dash, or a sentence end. A bare hyphen lives inside real
  // words — splitting on it turned "The $59,464.76 1099-NEC document…" into "The $59,464.76 1099".
  let out = employer ? employer[1] : (t.split(/:\s|\s[—–-]\s|\.\s/)[0] || t);
  // A FIGURE MUST NEVER REACH THE LABEL. The line it seeds has a blank amount beside it, and a
  // label reading "$4,898.05/mo" would be taken for that amount by the next person to look.
  out = out.replace(/\$\s?[\d,]+(?:\.\d+)?(?:\s*\/\s*\w+)?/g, " ")
           .replace(/\s+/g, " ")
           .replace(/[\s(,;:–—-]+$/, "")
           .trim();
  return out.length >= 3 ? out.slice(0, 60).trim() : "Income added by loan officer";
}
