// Parse a human-entered money string into a dollar NUMBER.
//
// Lead-form answers come in as free-form or multiple-choice text ("$100k+",
// "$50,000–$99,999", "1.2M", "750000", "under $25k"). The old approach
// (`String(x).replace(/[^0-9.]/g,"")`) broke on "k"/"m" suffixes ("$100k" -> 100)
// and on ranges (the dash glued two numbers together). This returns the FIRST
// amount found — i.e. a range's lower bound — so range answers tier to their floor,
// and undefined when there is no positive amount (so "$0–$49,999" scores as nothing).
export function parseMoney(input: unknown): number | undefined {
  if (input == null) return undefined;
  const s = String(input).toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*([kmb])?/);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  const suffix = m[2];
  if (suffix === "k") n *= 1e3;
  else if (suffix === "m") n *= 1e6;
  else if (suffix === "b") n *= 1e9;
  return isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
