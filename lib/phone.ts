// Canonical US phone normalization — THE one way a phone number is stored + matched.
// Root cause of duplicate leads (2026-07-02): the website path stored 10-digit numbers
// while the Meta webhook/importer kept the leading country code ("15612012765" vs
// "5612012765"), so email/phone dedup never matched and the same person became two
// leads (double first-touch emails + drip). Canonical form: bare 10 digits (strip a
// leading "1" from 11-digit US numbers). For dedup queries, match BOTH forms since
// historical rows are mixed.
export function canonicalPhone(raw?: string | null): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** Both stored representations of a canonical number ("5612012765" + "15612012765"). */
export function phoneMatchForms(canonical: string): string[] {
  return canonical.length === 10 ? [canonical, "1" + canonical] : [canonical];
}

// Is this a VALID North American (NANP) phone we can actually call/text? Fetti
// lends US only, so a non-NANP number (e.g. Ahmed's "0545294177" — a Saudi mobile)
// is not a working contact for our Twilio line. NANP rule: exactly 10 digits after
// normalization, area code AND exchange each start 2–9 (never 0 or 1), and it isn't
// an obvious fake (all-same, sequential). Used to flag intake — NOT to reject a lead
// (foreign investors are real business), but to mark the number uncallable + feed Shield.
export function isValidNanp(raw?: string | null): boolean {
  const c = canonicalPhone(raw);
  if (!c || c.length !== 10) return false;         // 11-digit non-"1" intl (e.g. "0545294177") fails here
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(c)) return false; // area + exchange must start 2–9
  if (/^(\d)\1{9}$/.test(c)) return false;          // 0000000000 / 5555555555
  if (c === "1234567890" || c === "0123456789") return false;
  return true;
}

/** Classify a raw phone for intake: canonical form + whether it's a usable US line. */
export function classifyPhone(raw?: string | null): { canonical: string | null; validNanp: boolean; hasDigits: boolean } {
  const digits = String(raw || "").replace(/\D/g, "");
  return { canonical: canonicalPhone(raw), validNanp: isValidNanp(raw), hasDigits: digits.length >= 7 };
}
