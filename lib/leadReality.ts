// LEAD REALITY CHECK — "is this a real, reachable person, or a bot / fake / dead number?"
//
// This is the third axis the CRM shows next to QUALITY (how fundable, lib/leadQuality)
// and STAGE (how far along, lib/leadStage). It answers the question Ramon actually asks
// of every new lead: should I bother reaching out, or is this junk I paid for?
//
// It does NOT re-run detection — Lead Shield (lib/leadShield.ts assessLead) already did
// the expensive work at intake and stored the verdict + Twilio line-type lookup on
// raw.shield. We read that authoritative result and render it. For leads that predate
// Shield (or came in while SHIELD_MODE was off), we fall back to a couple of cheap,
// obvious red flags so the badge is never blank when it can be useful.
//
// Pure + dependency-free so the server API (lib/comms listPipeline) and any client
// component share ONE definition — no divergence between what the list shows and what
// the thread header shows.

export type LeadRealityLevel = "real" | "suspect" | "invalid" | "unverified";

export type LeadReality = {
  level: LeadRealityLevel;
  label: string;   // short badge label (with a leading glyph)
  reason: string;  // one-line "why" for a tooltip
  cls: string;     // Tailwind classes for the dark CRM theme
};

// Obvious placeholder names people type to get past a form.
const FAKE_NAMES = new Set([
  "test", "testing", "test test", "tester", "test user", "abc", "abc abc", "aaa",
  "john doe", "jane doe", "asdf", "asdf asdf", "qwerty", "fake name", "none",
  "na", "n/a", "no name", "your name", "first last", "anonymous",
]);

const DISPOSABLE_RE = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|trashmail|yopmail|sharklasers|throwaway|getnada|dispostable|maildrop|fakeinbox|mohmal)\./i;

const REAL_CLS = "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
const SUSPECT_CLS = "bg-amber-500/15 text-amber-300";
const INVALID_CLS = "bg-red-500/15 text-red-300";
const UNVERIFIED_CLS = "bg-slate-700/40 text-slate-400";

function real(reason: string): LeadReality { return { level: "real", label: "✓ Real", reason, cls: REAL_CLS }; }
function suspect(reason: string): LeadReality { return { level: "suspect", label: "⚠ Suspect", reason, cls: SUSPECT_CLS }; }
function invalid(reason: string): LeadReality { return { level: "invalid", label: "✕ Invalid", reason, cls: INVALID_CLS }; }
function unverified(reason: string): LeadReality { return { level: "unverified", label: "Unverified", reason, cls: UNVERIFIED_CLS }; }

/** Prettify a Shield signal into a human "why". */
function signalReason(shield: any): string {
  const sigs = Array.isArray(shield?.signals) ? shield.signals : [];
  if (!sigs.length) return "flagged by Lead Shield";
  // The heaviest-weighted signal is the headline reason.
  const top = sigs.slice().sort((a: any, b: any) => (Number(b?.pts) || 0) - (Number(a?.pts) || 0))[0];
  if (top?.note) return String(top.note);
  const key = String(top?.key || "").replace(/[._]/g, " ").trim();
  return key || "flagged by Lead Shield";
}

export function leadReality(input: {
  raw?: any;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): LeadReality {
  const raw = input.raw || {};
  const shield = raw.shield || null;
  const lookup = shield?.lookup || null;
  const name = String(input.name || "").trim().toLowerCase();
  const email = String(input.email || "").trim().toLowerCase();

  // HARD: Twilio told us the phone is not a real, dialable number. Nothing to work.
  if (lookup && lookup.valid === false) return invalid("Phone number is invalid or unreachable");

  // Authoritative Shield verdict (the common, post-intake case).
  if (shield && shield.band) {
    const band = String(shield.band);
    if (band === "junk") return invalid(signalReason(shield));
    if (band === "gray" || band === "watch" || shield.verdict === "quarantine") return suspect(signalReason(shield));
    if (band === "clean") {
      const line = String(lookup?.lineType || "").toLowerCase();
      // Clean intake but the number is VoIP → could still be a burner; nudge to verify.
      if (line && /voip|virtual|non[- ]?fixed/.test(line)) return suspect("VoIP number — confirm it's a real person");
      if (shield.smsCapable === false) return suspect("Number can't receive texts (landline/other)");
      return real(line === "mobile" ? "Mobile line, passed Lead Shield" : "Passed Lead Shield");
    }
  }

  // No Shield verdict (pre-Shield lead or SHIELD_MODE off): cheap, obvious flags only.
  if (!input.email && !input.phone) return invalid("No email or phone on file");
  if (name && FAKE_NAMES.has(name)) return suspect("Placeholder / fake name");
  if (email && DISPOSABLE_RE.test(email)) return suspect("Disposable email domain");
  return unverified("Not yet screened by Lead Shield");
}
