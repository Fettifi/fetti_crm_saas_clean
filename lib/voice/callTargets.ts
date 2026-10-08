// WHO PENNY MAY DIAL ON AN ERRAND, AND WHAT SHE MAY DO WHEN SHE GETS THERE.
//
// 2026-10-08, Ramon: "I do want you to create some sort of feature that Penny can make phone calls on
// my behalf and get shit done. I hate having to sit and wait on hold... even if it is just to wait on
// hold till the prompts until you get a live operator and you get me on the phone, for example, if I
// wanted to call the IRS."
//
// THE ONE PROPERTY THIS FILE EXISTS TO GUARANTEE: an errand call CANNOT REACH A CONSUMER.
//
// Everything else about this feature is a convenience. This is the part that is a liability. The
// existing outbound path (app/api/voice/outbound/route.ts) protects borrowers with consent gates,
// calling hours and a one-per-day lock, and it hard-refuses anything outside confirm|callback|
// new_lead with "cold calls are not a thing here". An errand call to a servicer or the IRS cannot
// use those gates — a servicer never gave us ai_call_consent — so it would be trivially easy to
// build a second door that bypasses every borrower protection in the building. This file is that
// door's lock, and it is deny-by-default twice over:
//
//   1. The number must be on the ALLOWLIST below. No arbitrary number is dialable, ever.
//   2. The number must NOT match any phone in the CRM. Checked live, at dial time, against leads,
//      loan_files and co-borrower numbers in leads.raw. If a borrower's number is somehow also on
//      the allowlist, the CRM check wins and the call is refused.
//
// Both must pass. Neither is a judgement the model makes during a call; they are data checks made
// before the dial, which is the only kind that holds. [[a-mechanism-must-be-proven-to-fire]]
//
// THE IRS IS BRIDGE-ONLY, PERMANENTLY, AND THAT IS A LEGAL FACT NOT A PREFERENCE. A third party may
// speak to the IRS about a taxpayer only via Form 2848 (representation), Form 8821 (information
// authorization) or the Practitioner Priority Service — and every one of those routes requires an
// ELIGIBLE PERSON. None is available to a software agent. So Penny may wait in the IRS queue for as
// long as it takes, and the moment a human answers she must say who she is and put Ramon on. She may
// not answer an authentication question, because the only honest answer to "is this the taxpayer?"
// ends the call. `agentMayTransact: false` is enforced here, not asked for in a prompt.

export type CallMode =
  | "bridge"   // wait through the IVR and the hold, then put Ramon on a live human. Never transacts.
  | "errand";  // a bounded, scripted task on a file where we hold the authorization.

export type CallTarget = {
  id: string;
  org: string;
  number: string;              // E.164
  mode: CallMode;
  agentMayTransact: boolean;
  record: boolean;             // CA is ALL-PARTY consent (Penal Code § 632). Default false.
  /** Why this target exists, and what Penny is allowed to say she is doing. */
  purpose: string;
  /** Spoken the moment a HUMAN is detected — never at call setup into an IVR. */
  disclosure: string;
  maxMinutes: number;
  notes?: string;
};

/** Digits only, US 10-digit normalised, leading 1 dropped. "" when not a usable number. */
export function normalize(n: unknown): string {
  const d = String(n ?? "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? d : "";
}

// ── THE ALLOWLIST ────────────────────────────────────────────────────────────────────────────────
// One entry per organisation. Adding one is a deliberate act with a human behind it; nothing here
// is populated from the CRM, from mail, or from anything a model inferred.
export const TARGETS: CallTarget[] = [
  {
    id: "irs-practitioner",
    org: "Internal Revenue Service",
    number: "+18008291040",
    mode: "bridge",
    agentMayTransact: false,     // NEVER. See the header — no 2848/8821/PPS route exists for software.
    record: false,               // NEVER. Do not record a federal tax line.
    maxMinutes: 120,             // IRS holds genuinely run this long; that is the point of the feature.
    purpose:
      "Hold the queue on Ramon's OWN tax matter (2024 and 2025 returns unfiled) and hand him a live agent.",
    disclosure:
      "Good morning — my name is Penny and I am an automated assistant calling on behalf of Ramon Dent. " +
      "I am not able to answer questions about the account. Mr. Dent is here and I am connecting him now — one moment please.",
    notes:
      "BRIDGE ONLY. She waits, she identifies herself, she puts him on. She answers NO authentication " +
      "question — not an SSN, not a date of birth, not a prior-year figure, not even to confirm a name.",
  },
  {
    id: "ad-mortgage-servicing",
    org: "A&D Mortgage LLC — servicing",
    number: "+18557607600",
    mode: "bridge",
    agentMayTransact: false,
    record: false,
    maxMinutes: 45,
    purpose:
      "Chase payoff and servicing items on files where Fetti holds the borrower's signed authorization.",
    disclosure:
      "Hello — my name is Penny, an automated assistant calling from Fetti Financial Services on behalf of our client. " +
      "Ramon Dent is the broker on the file and he is here with me. Connecting him now — one moment please.",
    notes: "Servicing hours Mon-Fri 8am-7pm ET. Payoff requests go to payoff@admortgage.com in writing, not by phone.",
  },
  {
    id: "stewart-title-indy",
    org: "Stewart Title Company — Indianapolis",
    number: "+13178182400",
    mode: "bridge",
    agentMayTransact: false,
    record: false,
    maxMinutes: 30,
    purpose: "Chase title search status on the Indiana portfolios.",
    disclosure:
      "Hello — my name is Penny, an automated assistant calling from Fetti Financial Services. " +
      "Ramon Dent is here with me regarding our Indiana search files. Connecting him now — one moment please.",
  },
];

export const targetById = (id: string) => TARGETS.find((t) => t.id === id) || null;
export const targetByNumber = (n: unknown) => {
  const d = normalize(n);
  return d ? TARGETS.find((t) => normalize(t.number) === d) || null : null;
};

export type DialDecision = { allowed: boolean; target: CallTarget | null; reasons: string[] };

/**
 * The gate. `crmNumbers` is every phone Fetti holds for a human — passed in rather than fetched, so
 * this stays pure and the guard can prove it fires. An EMPTY set is treated as a FAILED LOOKUP and
 * refuses the call: "we found no borrowers" and "we could not check" must never look the same.
 */
export function canDial(
  numberOrId: string,
  crmNumbers: Set<string> | null,
  opts: { crmReadOk: boolean },
): DialDecision {
  const reasons: string[] = [];
  const target = targetById(numberOrId) || targetByNumber(numberOrId);

  if (!target) {
    reasons.push(
      `NOT ON THE ALLOWLIST. Penny dials named organisations only — never a number supplied at call time. ` +
      `Add it to TARGETS in lib/voice/callTargets.ts, deliberately, with a purpose and a disclosure.`,
    );
    return { allowed: false, target: null, reasons };
  }
  if (!opts.crmReadOk) {
    reasons.push(
      `COULD NOT CHECK THE CRM for a borrower match. An unreadable check is not a passed check — refusing.`,
    );
    return { allowed: false, target, reasons };
  }
  const d = normalize(target.number);
  if (!d) reasons.push(`the allowlist entry's number is not a usable 10-digit US number: ${target.number}`);
  if (crmNumbers && crmNumbers.has(d)) {
    reasons.push(
      `THIS NUMBER BELONGS TO SOMEONE IN THE CRM. Errand mode exists to call businesses; a person's ` +
      `number reaching it would route around every borrower protection on the consumer path — consent, ` +
      `calling hours, the one-per-day lock. Refusing even though it is on the allowlist.`,
    );
  }
  return { allowed: reasons.length === 0, target, reasons };
}

/**
 * The closed verb list. Anything the agent might "decide" to do that is not in here is not a
 * capability it has. Checked at the dispatch layer, so a persuasive caller cannot talk it into more.
 */
export const PERMITTED_ACTIONS = [
  "wait",            // hold music, silence, queue
  "press_digits",    // navigate the IVR
  "say_disclosure",  // who she is, that she is automated
  "state_purpose",   // who she is calling for and why, at the level in `purpose`
  "request_hold",    // "please hold for Ramon Dent"
  "bridge",          // conference him in — the successful outcome
  "hang_up",
] as const;
export type PermittedAction = (typeof PERMITTED_ACTIONS)[number];

/** Everything she must never say, whoever asks and however it is phrased. */
export const FORBIDDEN_UTTERANCE =
  /\b(social security|ssn|itin|date of birth|dob|mother'?s maiden|account (?:pin|password)|last four|routing number|adjusted gross|prior[- ]year refund)\b/i;

export function actionAllowed(action: string, target: CallTarget): { ok: boolean; why?: string } {
  if (!(PERMITTED_ACTIONS as readonly string[]).includes(action))
    return { ok: false, why: `"${action}" is not in the closed verb list — Penny has no such capability.` };
  if (!target.agentMayTransact && ["state_purpose", "request_hold", "say_disclosure", "wait", "press_digits", "bridge", "hang_up"].indexOf(action) === -1)
    return { ok: false, why: `${target.org} is bridge-only; "${action}" would be transacting.` };
  return { ok: true };
}
