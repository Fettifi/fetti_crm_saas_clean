// CAN WE ACTUALLY ORIGINATE THIS? THE CONSUMER LICENCE FOOTPRINT, APPLIED AT APPLICATION TIME.
//
// 2026-10-16. A borrower in GEORGIA completed a FULL 1003 — FHA Purchase + Down Payment
// Assistance, $450,000 — including the signed borrower authorization. The team alert fired and
// said "convert the lead to a loan file and request documents while it's hot."
//
// Fetti is licensed for consumer/owner-occupied lending in CALIFORNIA, FLORIDA and MICHIGAN ONLY.
// `lib/lendingMatrix.ts` has said so since the /lending pages were built, and says a nationwide
// owner-occupied claim "would be a licensing misstatement" — but that knowledge lived only in the
// MARKETING surface. The application flow had no idea, so it took the application, captured the
// authorization, and urged the desk to convert it.
//
// Investment and business programs ARE nationwide, so this must not fire on a DSCR, a fix-and-flip
// or a commercial deal. The distinction is occupancy, not product name.
//
// WHICH WAY TO FAIL: toward flagging. A false flag costs somebody a glance at a lead; a missed one
// is an unlicensed origination. So "unsure" and "unknown" count as consumer until proven otherwise.
import { CONSUMER_STATES } from "./lendingMatrix";

/** CONSUMER_STATES holds lowercase full names ("florida"). Applications carry codes ("FL"). */
const CODE_BY_NAME: Record<string, string> = {
  florida: "FL", michigan: "MI", california: "CA", texas: "TX",
  georgia: "GA", arizona: "AZ", nevada: "NV",
};

/** The two-letter codes we may write consumer/owner-occupied business in. Derived, never retyped. */
export const CONSUMER_STATE_CODES: string[] = CONSUMER_STATES
  .map((n) => CODE_BY_NAME[n])
  .filter((c): c is string => !!c);

export function normalizeState(state: unknown): string {
  const s = String(state ?? "").trim();
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  return CODE_BY_NAME[s.toLowerCase()] || s.toUpperCase();
}

/**
 * Is this an OWNER-OCCUPIED (consumer) request? Occupancy is the real signal; the product name is
 * a fallback because free-text purposes vary ("FHA Purchase + Down Payment Assistance").
 * Returns true when it is consumer OR when we cannot tell — see "which way to fail" above.
 */
export function isConsumerRequest(occupancy: unknown, loanPurpose: unknown): boolean {
  const occ = String(occupancy ?? "").trim().toLowerCase();
  if (occ === "investor") return false;          // investment — nationwide, not consumer
  if (occ === "owner" || occ === "second home") return true;

  const p = String(loanPurpose ?? "").toLowerCase();
  // Clearly non-consumer programs, available in all 50 states.
  if (/\b(dscr|fix[\s&-]*(and|n)?[\s-]*flip|rehab|bridge|commercial|business|investor|rental|portfolio|ground[\s-]*up|construction loan)\b/.test(p)) return false;
  // Clearly consumer programs.
  if (/\b(fha|va\b|usda|conventional purchase|primary|owner[\s-]*occupied|home equity|heloc|reverse|refinance of (my|our) home|down payment assistance)\b/.test(p)) return true;
  // Unknown: treat as consumer so it gets looked at.
  return true;
}

export type LicenceCheck = {
  ok: boolean;
  consumer: boolean;
  state: string;
  /** Present only when ok === false. Plain English, safe to show the desk. */
  reason?: string;
};

export function licenceCheck(input: {
  state?: unknown; occupancy?: unknown; loan_purpose?: unknown;
}): LicenceCheck {
  const state = normalizeState(input.state);
  const consumer = isConsumerRequest(input.occupancy, input.loan_purpose);
  if (!consumer) return { ok: true, consumer: false, state };
  if (!state) {
    return { ok: false, consumer: true, state: "",
      reason: "No state on the application, and this reads as owner-occupied. Consumer lending is licensed in " + CONSUMER_STATE_CODES.join(", ") + " only — confirm the state before anyone works it." };
  }
  if (CONSUMER_STATE_CODES.includes(state)) return { ok: true, consumer: true, state };
  return {
    ok: false, consumer: true, state,
    reason: `Owner-occupied/consumer request in ${state}. Fetti is licensed for consumer lending in ${CONSUMER_STATE_CODES.join(", ")} ONLY. Do not convert, do not pull credit, do not originate — refer it out or decline. (Investment and business programs are nationwide and unaffected.)`,
  };
}
