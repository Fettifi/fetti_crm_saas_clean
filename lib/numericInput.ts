// TYPING A DECIMAL INTO A CONTROLLED NUMBER BOX.
//
// Ramon, 2026-08-02, after the re-audit: both override editors shipped that day silently
// mangled decimals.
//
// The trap: a controlled input whose `value` is `String(parsedNumber)` erases the decimal point
// at the instant it is typed. "6." parses to 6, re-renders as "6", and the NEXT keystroke lands
// on "6" instead of "6." — so typing 6 . 5 yields **65**, and 4800.50 yields **480050**. The user
// is not shown a rejected entry. They are shown a confident wrong number, off by a factor of ten
// or a hundred, in a box they just filled in correctly.
//
// The fix is always the same: keep the RAW TEXT on screen while the field is being edited, and
// commit the parsed value underneath. One implementation, so the two editors cannot drift and a
// guard can test what ships.
export type NumericCommit = {
  /** What stays in the box — the user's own text, so a trailing "." survives. */
  text: string;
  /** The committed value, or null while the text is not yet a number ("", "-", "."). */
  value: number | null;
};

/** Coerce a keystroke-level edit. `allowNegative` for figures that can legitimately go below zero
 *  (a net rental loss, a self-employment loss); off by default for money that cannot. */
export function commitNumericText(raw: string, opts: { allowNegative?: boolean } = {}): NumericCommit {
  const allowNeg = opts.allowNegative === true;
  let t = String(raw ?? "").replace(allowNeg ? /[^0-9.\-]/g : /[^0-9.]/g, "");
  // At most one decimal point, and a minus only in front.
  const dots = (t.match(/\./g) || []).length;
  if (dots > 1) t = t.slice(0, t.lastIndexOf("."));
  if (allowNeg) t = (t.startsWith("-") ? "-" : "") + t.replace(/-/g, "");
  // MID-TYPING STATES ARE NOT FIGURES. Committing "" as 0 would read as a stated zero — which on
  // a rent field means "this unit is vacant".
  if (t === "" || t === "-" || t === "." || t === "-.") return { text: t, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { text: t, value: null };
  if (!allowNeg && n < 0) return { text: t, value: null };
  return { text: t, value: n };
}

/** The value to render: the user's in-progress text when present, else the committed number. */
export function numericBoxValue(draft: string | undefined, committed: number | null | undefined): string {
  if (draft !== undefined) return draft;
  return committed == null ? "" : String(committed);
}
