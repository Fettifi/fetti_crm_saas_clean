// "" IS ABSENT. 0 IS NOT.
//
// `Number(await cfg("LOAN_MARGIN_PCT")) || 2.75` reads as "default when unset" and is not: `||`
// rejects every falsy value, and 0 is falsy. So the one margin a broker might deliberately set —
// zero, for a file he is doing at no margin, or to take the projection off the dashboard while he
// looks at real numbers — could not be saved. app/api/settings/margin/route.ts validates `pct < 0
// || pct > 100`, which deliberately ADMITS 0, writes the string "0" to app_settings, answers
// `{ ok: true, pct: 0 }`, and then every reader turns it straight back into 2.75.
//
// MEASURED on the live settings store, 2026-10-15: LOAN_MARGIN_PCT is not set at all (it is absent
// from 1,501 app_settings rows), so today the 2.75% default is what everyone sees and the bug is
// dormant — it fires the first time somebody saves a zero. With the pipeline and funded volume on
// the dashboard at that moment, a resurrected 2.75% prints a projected-earnings figure out of a
// margin the broker had just told the system was zero. On a licensed brokerage's dashboard that is
// a number nobody entered.
//
// The shape is the defect, not this one key: `Number(x) || d` silently substitutes the default for
// a legitimate 0, and `x || d` does the same for false and "". Use this helper for any numeric
// setting so "absent" and "zero" cannot be the same answer again.

/**
 * Resolve a numeric setting, distinguishing ABSENT from ZERO.
 *
 * Falls back when the value is null/undefined/blank (absent), unparseable, or outside [min, max].
 * Returns the parsed number otherwise — 0 included.
 *
 * The range check belongs here rather than at the call site because the fallback is the only safe
 * answer for a value that cannot be trusted: a margin of -40 or 4,000 would otherwise reach an
 * earnings projection as a plausible-looking dollar figure.
 */
export function settingNumber(
  raw: string | number | null | undefined,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  if (raw === null || raw === undefined) return fallback;
  const s = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (s === "") return fallback;                 // "" is absent — this is the one falsy value that IS
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;      // "abc", "NaN", Infinity
  const { min, max } = opts || {};
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}
