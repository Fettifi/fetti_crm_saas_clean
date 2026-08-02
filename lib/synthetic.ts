// SYNTHETIC LEADS — the daily healthcheck must not act like a customer.
//
// The autopilot + doctor health sweeps POST a fake lead to /api/apply every day to
// prove the funnel still accepts leads. That test is worth keeping: it exercises the
// real route, Lead Shield, scoring, dedupe and the DB write. What it must NOT do is
// reach the outside world. Until now it did — 35 healthcheck leads between 2026-06-19
// and 2026-07-29 each ran the FULL new-lead pipeline:
//
//   • first-touch email to an address at a domain that does not resolve
//     (@fetti-internal.test) → a hard bounce on the frank@fettifi.com sending domain
//   • an owner alert to Ramon (email + SMS + webhook) for a lead that does not exist —
//     and on 2026-07-29 one scored Tier 1 (70), which is the hot-lead voice pager
//   • a Lead event to the Meta Conversions API → the ad account optimizes toward, and
//     reports, a conversion nobody made
//   • four OpenAI agent runs (qualify → structure → process → close) per test lead
//
// Deleting the test ROW afterward — which the sweep does — cleans up none of that.
// The emails are sent, the pixel is trained, the spend is spent.
//
// So: one predicate, checked at two chokepoints (leadPipeline entry and
// sendMetaLeadEvent), the same two-chokepoint shape used for TCPA quiet hours and the
// email suppression list. One guard is a guard you forget to call.

/** Reserved test domain. Nothing real is ever addressed here — .test is RFC 2606. */
const SYNTHETIC_EMAIL_DOMAIN = /@fetti-internal\.test\s*$/i;

/**
 * Sources the health sweeps write. EXACT match, never substring: a substring test on
 * "test" would swallow real leads (there is a real "testimonial" campaign tag), and a
 * guard that silently eats live traffic is worse than the bug it fixes.
 */
const SYNTHETIC_SOURCES = new Set(["autopilot_healthcheck", "doctor_healthcheck"]);

/**
 * True when this lead is a health-sweep probe rather than a person.
 *
 * Matching is deliberately narrow — an internal-test email address, one of the two
 * known probe sources, or an explicit raw.synthetic flag. A real borrower cannot
 * accidentally satisfy any of the three.
 */
export function isSyntheticLead(lead: any): boolean {
  if (!lead) return false;
  const email = String(lead.email || "");
  if (SYNTHETIC_EMAIL_DOMAIN.test(email)) return true;
  const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
  if (raw.synthetic === true) return true;
  const source = String(lead.source || "").trim().toLowerCase();
  return SYNTHETIC_SOURCES.has(source);
}

/** Human-readable reason, for the activity row that proves the guard fired. */
export function syntheticReason(lead: any): string | null {
  if (!lead) return null;
  if (SYNTHETIC_EMAIL_DOMAIN.test(String(lead.email || ""))) return "internal test email domain";
  const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
  if (raw.synthetic === true) return "raw.synthetic flag";
  const source = String(lead.source || "").trim().toLowerCase();
  if (SYNTHETIC_SOURCES.has(source)) return `healthcheck source (${source})`;
  return null;
}
