// ONE SHARE TOKEN, ONE EXPIRY DATE, ONE ANSWER.
//
// A pre-approval letter is read through four surfaces that all answer "is this still valid?" from
// the same `preapprovals.expires_on` column, and on 2026-10-15 they disagreed three ways:
//
//   app/api/letter/[token]/pdf/route.ts  new Date("2026-10-20")                 -> 2026-10-19 17:00 PT
//   app/api/letter/[token]/route.ts      new Date("2026-10-20T23:59:59-07:00")  -> 2026-10-20 23:59 PT
//   app/letter/[token]/page.tsx          same as the JSON route                 -> 2026-10-20 23:59 PT
//   lib/preapprovalPdf.ts                Date.parse("2026-10-20T23:59:59Z")     -> 2026-10-20 16:59 PT
//
// The PDF route was the broken one, and by 30h59m59s: a bare "YYYY-MM-DD" parses as UTC
// MIDNIGHT, which is 5pm Pacific on the day BEFORE the date the letter itself prints as "valid
// through". So the download link 410'd while the web page served the same letter as live, and the
// listing agent on the other side of the deal was the one who found out.
//
// WHY END OF DAY PACIFIC AND NOT UTC. The date is typed into a <input type="date"> by Ramon in Los
// Angeles (app/preapprovals/page.tsx) and printed back to the reader as "Valid through October 20,
// 2026". A letter valid through the 20th is valid until the 20th is over where it was written.
//
// WHY THE FIXED -07:00 AND NOT A TIME ZONE LIBRARY. -07:00 is Pacific DAYLIGHT time, which is what
// the two surfaces that already got this right have used since the day the UTC-midnight bug was
// fixed. In winter, when Los Angeles is at -08:00, a -07:00 boundary falls at 22:59:59 PST — one
// hour SHORT. That is the direction to err: a letter that dies an hour early is a phone call, and a
// letter that outlives its printed date is an expired pre-approval circulating with an offer
// attached, which is the thing the desk already has a watcher for. The window never runs LONGER
// than the date printed on the document, in either season.
//
// Guarded by scripts/verify-letter-expiry.ts, which checks the boundary behaviour AND that every
// reader surface computes the same instant from the same date.

/** End of the expiry DAY in Pacific time. Fixed offset — deliberately short in PST, never long. */
export const LETTER_EXPIRY_SUFFIX = "T23:59:59-07:00";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a letter stops being valid, in epoch ms, or null when it never expires.
 *
 * A date-only value becomes the end of that day Pacific. A full timestamp is honoured as written —
 * an explicit instant is somebody's deliberate choice, not a date to be rounded up.
 *
 * NULL FOR AN UNPARSEABLE VALUE IS DELIBERATE, and it preserves what all four surfaces already did:
 * `new Date("soon") < new Date()` is false, because every comparison with NaN is false. A letter
 * carrying a malformed date therefore reads as "no expiry" rather than "expired". Changing that
 * here would start 410-ing live letters over a typo, which is a worse failure than the one this
 * module exists to fix.
 */
export function letterExpiryMs(expiresOn?: string | null): number | null {
  if (!expiresOn) return null;
  const raw = String(expiresOn).trim();
  if (!raw) return null;
  const ms = Date.parse(DATE_ONLY.test(raw) ? `${raw}${LETTER_EXPIRY_SUFFIX}` : raw);
  return Number.isFinite(ms) ? ms : null;
}

/** True once the expiry instant has passed. `now` is injectable so a guard can test the boundary. */
export function isLetterExpired(expiresOn?: string | null, now: number = Date.now()): boolean {
  const ms = letterExpiryMs(expiresOn);
  return ms !== null && ms < now;
}

/**
 * The one question every public reader of a share token asks: is this letter gone?
 *
 * Void is revocation (someone pulled the letter) and expiry is the clock. Both mean the link must
 * stop serving the document — a shared link that keeps serving a revoked or stale pre-approval is
 * a letter a borrower can present as current.
 */
export function isLetterGone(
  letter: { status?: string | null; expires_on?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!letter) return true;
  if (letter.status === "void") return true;
  return isLetterExpired(letter.expires_on, now);
}
