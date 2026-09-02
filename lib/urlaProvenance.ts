// PROVENANCE OF A NUMBER — client-safe, so it can be imported without dragging in lib/crypto.
//
// The underwriting desk (a client page, through lib/underwritingDesk) needs only these two pure
// helpers from lib/urla, but importing them pulled urla's `decryptField` import — and therefore
// the whole crypto module — into the browser bundle. Same trap as lib/bizProduct.ts; see the
// note there. The rules themselves are unchanged.

/** Collapse a source string ("web:Rent Zestimate", "web:estimate", "web:recent sale", "entered")
 *  into the provenance vocabulary the URLA/MISMO layer speaks.
 *
 *  ANYTHING UNRECOGNISED BECOMES "unknown", NEVER "entered". Guessing in the optimistic direction
 *  is the entire bug this exists to prevent: it is how an automated valuation acquires a human
 *  author it never had and goes to a wholesale lender looking like an appraisal. Lives here rather
 *  than in the route so a guard can test the real function instead of a copy of its rules. */
export function valueProvenance(src: any): "entered" | "avm" | "recent-sale" | "unknown" {
  const s = String(src || "").toLowerCase();
  if (s === "entered") return "entered";
  if (s.includes("recent sale")) return "recent-sale";
  if (s.startsWith("web")) return "avm";
  return "unknown";
}

/** Rent has no "recent sale" concept — a comparable sale says nothing about the rent roll. */
export function rentProvenance(src: any): "entered" | "avm" | "lease" | "unknown" {
  const p = valueProvenance(src);
  if (p === "entered") return "entered";
  if (p === "avm") return "avm";
  return String(src || "").toLowerCase().includes("lease") ? "lease" : "unknown";
}

