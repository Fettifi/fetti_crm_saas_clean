// PENNY MUST NOT BE ABLE TO DIAL A PERSON.
//
// 2026-10-08. Ramon asked for an outbound agent that sits through IVRs and hold music and hands him
// a live human — "for example, if I wanted to call the IRS". That feature necessarily bypasses every
// protection on the consumer calling path: app/api/voice/outbound/route.ts gates on
// ai_call_consent, borrower-local calling hours and a one-per-day lock, and hard-refuses anything
// outside confirm|callback|new_lead with "cold calls are not a thing here". A servicer never gave us
// consent, so an errand call cannot pass those gates — which means errand mode is, structurally, a
// SECOND DOOR INTO THE DIALER with none of the locks on the first one.
//
// This file is the proof that the second door is locked. It asserts on BEHAVIOUR by importing the
// real canDial/actionAllowed and feeding them constructed states — there is no source text here for
// a comment to satisfy.
//
//   npx tsx scripts/verify-errand-safety.ts
import { canDial, normalize, targetByNumber, actionAllowed, TARGETS, PERMITTED_ACTIONS, FORBIDDEN_UTTERANCE } from "../lib/voice/callTargets";

const failures: string[] = [];
const ck = (name: string, cond: boolean, why: string) => { if (!cond) failures.push(`${name}\n        ${why}`); };

const OK = { crmReadOk: true };
const noBorrowers = new Set<string>();

// ---------------------------------------------------------------- 1. the allowlist is the floor
{
  const d = canDial("+13105551234", noBorrowers, OK);
  ck("an arbitrary number is REFUSED", !d.allowed && /NOT ON THE ALLOWLIST/.test(d.reasons[0] || ""),
    "if any number is dialable then 'errand mode' is just an unrestricted auto-dialer with a nicer name");
  ck("…and it names what to do about it", /TARGETS in lib\/voice\/callTargets\.ts/.test(d.reasons[0] || ""),
    "a refusal that does not say how to proceed gets worked around rather than followed");
}
{
  const d = canDial("irs-practitioner", noBorrowers, OK);
  ck("a named allowlist target is allowed", d.allowed && d.target?.id === "irs-practitioner",
    `got allowed=${d.allowed} reasons=${d.reasons.join("; ")}`);
}
{
  // The same target reached by its NUMBER, in a format a human would paste.
  const d = canDial("800-829-1040", noBorrowers, OK);
  ck("the allowlist matches on the NUMBER too, in any format", d.allowed && d.target?.id === "irs-practitioner",
    "a target reachable by id but not by number would be silently undialable from the number-driven path");
}

// ---------------------------------------------------------------- 2. THE PROPERTY THAT MATTERS
{
  // A borrower's number that has somehow also landed on the allowlist. The CRM must win.
  const irs = normalize("+18008291040");
  const d = canDial("irs-practitioner", new Set([irs]), OK);
  ck("a number in the CRM is REFUSED even when allowlisted", !d.allowed && /BELONGS TO SOMEONE IN THE CRM/.test(d.reasons.join(" ")),
    "this is the whole point of the file: a person's number must never reach a path with no consent " +
    "gate, no calling-hours check and no per-day lock");
}
{
  // Deny-by-default on an unreadable CRM — "no borrowers found" and "could not look" are different.
  const d = canDial("irs-practitioner", null, { crmReadOk: false });
  ck("an UNREADABLE CRM refuses the call", !d.allowed && /COULD NOT CHECK/.test(d.reasons.join(" ")),
    "a failed lookup that reads as 'no match' is how every borrower becomes dialable during an outage");
}
{
  // Number normalisation must not be a way through: +1, dashes, spaces, parens all collapse.
  const forms = ["+1 (800) 829-1040", "18008291040", "800.829.1040", "8008291040"];
  const allRefused = forms.every((f) => !canDial(f, new Set([normalize(f)]), OK).allowed);
  ck("every format of a CRM number is refused", allRefused,
    `one unnormalised format is a bypass. Checked: ${forms.join(", ")}`);
  ck("…and normalize() actually collapses them", new Set(forms.map(normalize)).size === 1,
    `got ${JSON.stringify(forms.map(normalize))}`);
}
{
  ck("a non-number normalises to empty, not to something dialable",
    normalize("hello") === "" && normalize("") === "" && normalize(null) === "",
    "a junk value that normalised to a partial number could match nothing in the CRM and sail through");
}

// ---------------------------------------------------------------- 3. the IRS is bridge-only, forever
{
  const irs = TARGETS.find((t) => t.id === "irs-practitioner")!;
  ck("the IRS target may NEVER transact", irs.agentMayTransact === false,
    "no Form 2848 / 8821 / PPS route exists for a software agent — representing him is not lawful, " +
    "waiting on hold for him is");
  ck("the IRS leg is NEVER recorded", irs.record === false,
    "CA Penal Code 632 is all-party consent and this is a federal tax line");
  ck("…and its disclosure says she cannot answer questions",
    /not able to answer questions/i.test(irs.disclosure),
    "the disclosure is the control that stops an authentication question being answered");
}
{
  const bad = TARGETS.filter((t) => t.record === true);
  ck("NO target records by default", bad.length === 0,
    `these record: ${bad.map((t) => t.id).join(", ")}. All-party consent means recording is opt-in per ` +
    `target with the consent captured, never a default.`);
}
{
  const bad = TARGETS.filter((t) => t.mode === "bridge" && t.agentMayTransact);
  ck("no bridge target may transact", bad.length === 0, `contradictory: ${bad.map((t) => t.id).join(", ")}`);
}
{
  const bad = TARGETS.filter((t) => !t.disclosure || t.disclosure.length < 40 || !/automated|A\.I\.|assistant/i.test(t.disclosure));
  ck("every target has a real disclosure naming her as automated", bad.length === 0,
    `missing or inadequate on: ${bad.map((t) => t.id).join(", ")}`);
  const noCap = TARGETS.filter((t) => !Number.isFinite(t.maxMinutes) || t.maxMinutes <= 0);
  ck("every target has a wall-clock cap", noCap.length === 0,
    `a call with no cap burns the Twilio balance silently — there are ZERO usage triggers on this account`);
}

// ---------------------------------------------------------------- 4. the closed verb list
{
  const irs = TARGETS.find((t) => t.id === "irs-practitioner")!;
  ck("'wait' is permitted", actionAllowed("wait", irs).ok, "waiting IS the feature");
  ck("'press_digits' is permitted", actionAllowed("press_digits", irs).ok, "she has to work the phone tree");
  ck("'bridge' is permitted", actionAllowed("bridge", irs).ok, "the successful outcome");
  for (const verb of ["authorize_payment", "agree_to_terms", "confirm_identity", "change_due_date", "provide_ssn"]) {
    ck(`'${verb}' is NOT a capability`, !actionAllowed(verb, irs).ok,
      "anything outside the closed list must be absent, not discouraged — a prompt can be talked around");
  }
  ck("the verb list is actually closed", PERMITTED_ACTIONS.length === 7,

    `grew to ${PERMITTED_ACTIONS.length} — every addition is a new thing she can do on a live call`);
}

// ---------------------------------------------------------------- 5. the things she must never say
{
  const mustCatch = [
    "my social security number is",
    "her SSN is",
    "the date of birth on file",
    "sure, the last four are",
    "the routing number is",
    "mother's maiden name",
    "the adjusted gross income was",
    "prior-year refund",
  ];
  for (const s of mustCatch)
    ck(`refuses to utter: "${s}"`, FORBIDDEN_UTTERANCE.test(s),
      "an agent whose objective is to get past a gate WILL answer an authentication question unless it cannot");
  const mustAllow = ["please hold for Ramon Dent", "I am an automated assistant", "I am calling about a payoff statement"];
  for (const s of mustAllow)
    ck(`does not block ordinary speech: "${s}"`, !FORBIDDEN_UTTERANCE.test(s),
      "a filter that blocks the legitimate script makes the feature useless and gets disabled");
}

// ---------------------------------------------------------------- 6. no duplicate / malformed entries
{
  const nums = TARGETS.map((t) => normalize(t.number));
  ck("every target number is a usable US number", nums.every(Boolean),
    `bad: ${TARGETS.filter((t) => !normalize(t.number)).map((t) => t.id).join(", ")}`);
  ck("no two targets share a number", new Set(nums).size === nums.length, "ambiguous routing");
  ck("no two targets share an id", new Set(TARGETS.map((t) => t.id)).size === TARGETS.length, "ambiguous lookup");
}

if (failures.length) {
  console.error(`\nFAIL — ${failures.length} errand-safety gap(s):\n`);
  for (const f of failures) console.error("  • " + f);
  console.error("");
  process.exit(1);
}
console.log(`\nERRAND SAFETY\n`);
console.log(`  ${TARGETS.length} allowlisted target(s); none records, none transacts, all capped and disclosed.`);
console.log(`  An arbitrary number is refused. A CRM number is refused even if allowlisted.`);
console.log(`  An unreadable CRM refuses the call rather than passing it.\n`);
console.log(`PASS — Penny cannot dial a person.\n`);
