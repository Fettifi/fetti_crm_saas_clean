// SYNTHETIC LEADS — the daily healthcheck must not act like a customer.
//
// The autopilot + doctor health sweeps POST a fake lead to /api/apply every day to
// prove the funnel still accepts leads. That test is worth keeping: it exercises the
// real route, Lead Shield, scoring, dedupe and the DB write. What it must NOT do is
// reach the outside world — a first-touch email to a domain that does not resolve, an
// owner page about a borrower who does not exist, a Meta Lead conversion, four OpenAI
// agent runs. Deleting the test ROW afterward, which the sweep does, undoes none of
// that: the mail is sent, the pixel is trained, the spend is spent.
//
// WHAT WAS ACTUALLY HAPPENING — stated precisely, because the first version of this
// comment got it wrong and shipped. The 35 probes between 2026-06-19 and 2026-07-29
// did NOT send any of that. Checked against activity_log: each one logged
// shield.quarantine + lead.created and nothing else — no agent.ran, no comms.message.
// Lead Shield scored the fake phone and non-resolving email above the quarantine
// threshold and /api/apply took the quarantine branch, which skips the pipeline.
//
// The probes were contained. But nothing in the system had DECIDED to contain them,
// and the containment rests on a runtime setting:
//
//   verdict = (mode === "enforce" && quarantine) || honeypotHit ? "quarantine" : "pass"
//
// SHIELD_MODE is an app_settings value with three states, and assessLead falls back to
// "shadow" when the settings read throws. In shadow or off — a calibration window, a
// bad settings row, a transient DB error — the same probe returns "pass" and takes the
// full pipeline that same day. The safety margin was also thin in the other direction:
// notifyQuarantine emails Ramon on band=gray AND Tier 1, and the 2026-07-29 probe
// scored Tier 1 (70).
//
// So this is not a fix for damage already done. It is the difference between a probe
// that happens to be stopped by a spam filter tuned for other reasons and a probe the
// system refuses to contact on purpose. One predicate, checked at every sending
// chokepoint — the same shape as TCPA quiet hours and the email suppression list.
// One guard is a guard you forget to call.

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
