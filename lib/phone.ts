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
