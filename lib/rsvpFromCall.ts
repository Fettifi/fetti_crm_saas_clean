// CATCHING AN RSVP THAT CAME IN AS A PHONE MESSAGE.
//
// Penny has no "save RSVP" tool — her brain runs on the external Render bridge, which is not
// in this repo — so a guest who phones in to RSVP is filed as an ordinary phone message and
// nobody is added to the list. Ramon proved it on 2026-08-23: he called, Penny understood him
// completely ("You're calling to RSVP for Ramon and PJ's vow renewal on September 19th"),
// and then took a message. The guest list stayed empty and no confirmation went out.
//
// This reads what Penny already sends us and closes the loop from this side.
//
// TWO RULES, BOTH LEARNED FROM THAT CALL:
//
// 1. ONLY THE CALLER'S OWN WORDS COUNT. Penny's lines are her interpretation, and she narrates
//    confidently — asked how many were coming, the caller said "Boom." and Penny replied
//    "Perfect. You're confirming for two people." A number nobody said would have reached the
//    caterer as fact. So detection reads `Caller:` lines only.
//
// 2. WE NEVER GUESS THE HEAD COUNT. The RSVP is recorded with the size unknown and we text the
//    guest to ask. Their reply sets it (see parsePartyReply + the /api/sms/inbound branch).
//
// Deliberately free of any database import: lib/rsvp re-exports parsePartyReply from here, so
// importing back would be a cycle — and a guard that has to boot a Supabase client is a guard
// that can quietly run against a mock and prove nothing.

/** Just the caller's half of the conversation — never Penny's. */
export function callerLines(transcript?: string | null): string {
  return String(transcript || "")
    .split("\n")
    .filter((l) => /^\s*caller\s*:/i.test(l))
    .map((l) => l.replace(/^\s*caller\s*:\s*/i, ""))
    .join(" ");
}

// "vowel renewal", "bio-renewal" — real transcriptions from the test call. Speech-to-text
// mangles "vow renewal" reliably enough that matching only the correct spelling would miss
// most of them, so the phrases are deliberately loose and the RSVP word does the heavy lifting.
const RSVP_WORD = /\b(r\.?\s?s\.?\s?v\.?\s?p\.?|are\s?ess\s?vee\s?pee)\b/i;
const EVENT_WORDS = /\b(vow(el)?[\s-]*renewal|bio[\s-]*renewal|renewal (party|ceremony)|the renewal)\b/i;
const COMING_WORDS = /\b(i(?:'| a)?m coming|we(?:'| a)?re coming|count me in|i'?ll be there|we'?ll be there|save (me|us) a seat|put me down|add me to the list)\b/i;

// Words that mean this call is ALSO (or really) about a loan. Kelly's call, 2026-08-23: an
// existing refinance client whose audio transcribed as "It's now refinancing the RSVP for the
// weather renewal vials… Au revoir… I'm about to take a bath." The RSVP word was in there, so
// the first version of this file would have added her to the wedding list and texted her asking
// how many were coming to a party she may never have mentioned. A call that is about a loan AND
// says RSVP is not a guest list entry — it is a call Ramon needs to return.
const LOAN_WORDS = /\b(refinanc\w*|refi|mortgage|loan|rate|escrow|closing|appraisal|pre-?approv\w*|credit score|down ?payment)\b/i;

export type CallRsvpSignal = {
  isRsvp: boolean;
  /** Say-so is not enough to write a record. True when a human should look before we text. */
  needsReview: boolean;
  why: string;
  /** Their own stated head count, if they actually said one. Recorded for the transcript only —
   *  it is NEVER written to the list, because a mis-heard number becomes a catering order. */
  spokenPartyHint: number | null;
};

/** Did this caller ask to be put on the guest list? Reads only what they said. */
export function detectRsvp(transcript?: string | null, reason?: string | null): CallRsvpSignal {
  // ONLY what the caller said. `reason` is Penny's own summary of the call — she writes it
  // confidently even when she has misheard, and the first version of this function fed it in
  // here, which contradicted the rule at the top of the file.
  const said = callerLines(transcript);

  const rsvpWord = RSVP_WORD.test(said);
  const eventWord = EVENT_WORDS.test(said);
  const comingWord = COMING_WORDS.test(said);
  const loanWord = LOAN_WORDS.test(said);

  const isRsvp = rsvpWord || (comingWord && eventWord);
  // A loan call that also says RSVP goes to Ramon, not to the guest list. So does an RSVP word
  // with nothing else recognisable around it — that is the shape a garbled transcript takes.
  const needsReview = isRsvp && (loanWord || (rsvpWord && !eventWord && !comingWord));
  const why = !isRsvp ? "no RSVP language in the caller's own words"
    : loanWord ? "says RSVP but the caller is also talking about a loan — needs a human"
    : needsReview ? "says RSVP but nothing else in the call confirms it — needs a human"
    : rsvpWord ? "caller said RSVP, and named the renewal"
    : "caller said they are coming, and named the renewal";

  const m = said.match(/\b(\d{1,2})\s+(?:of us|people|guests|adults)\b/i)
    || said.match(/\b(?:party of|group of|there(?:'| i)?s|bringing)\s+(\d{1,2})\b/i);
  const n = m ? Number(m[1]) : NaN;

  return { isRsvp, needsReview, why, spokenPartyHint: Number.isFinite(n) && n >= 1 && n <= 20 ? n : null };
}

/** The question we text them. Their answer is the only thing that sets the head count. */
export function partyQuestion(firstName: string, label: string, date: string): string {
  const hi = firstName ? `Hi ${firstName} — ` : "Hi — ";
  return `${hi}got your RSVP for ${label} on ${date}. How many of you should we count, including yourself? Just reply with a number. — Ramon`;
}

/** What they hear back once they answer. */
export function partyConfirmation(firstName: string, party: number, label: string, date: string): string {
  const hi = firstName ? `${firstName}, ` : "";
  const heads = party === 1 ? "you" : party === 2 ? "both of you" : `all ${party} of you`;
  return `${hi}you're on the list for ${label} on ${date} — we have ${heads} down. Can't wait to see you! — Ramon`;
}

/** First name only, for a text that should read like a person wrote it. */
export function firstNameOf(name?: string | null): string {
  const n = String(name || "").trim().split(/\s+/)[0] || "";
  return /^(unknown|caller|guest)$/i.test(n) ? "" : n;
}

/** "2" / "two" / "just me" / "me and my wife" → a head count, or null if they did not give one.
 *
 * Order matters and is the whole bug history of this function: an alphabetical word map made
 * "a couple of us" return 1, because "a" was in the map and matched before "couple". Phrases
 * first, then digits, then a word list that contains no articles. When it cannot tell, it
 * returns null and we ask again — a guessed number ends up in a catering order. */
export function parsePartyReply(text: string): number | null {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;

  // Phrases, before anything else.
  if (/\b(just|only)\s+(me|myself)\b/.test(t) || /^\s*(me|myself|solo|alone|1)\s*$/.test(t)) return 1;
  if (/\b(a\s+)?(couple|pair)\b/.test(t)) return 2;
  // "me and my wife", "myself and my husband" — one other person named, so two heads.
  if (/\b(me|myself)\s+(and|\+|&)\s+(my\s+)?(wife|husband|partner|spouse|girlfriend|boyfriend|son|daughter|mom|mother|dad|father|friend)\b/.test(t)) return 2;

  const digits = t.match(/\b(\d{1,2})\b/);
  if (digits) { const n = Number(digits[1]); if (n >= 1 && n <= 20) return n; }

  // No articles in here. "a"/"an" as a count is never worth the false positive.
  const words: [string, number][] = [
    ["twenty", 20], ["nineteen", 19], ["eighteen", 18], ["seventeen", 17], ["sixteen", 16],
    ["fifteen", 15], ["fourteen", 14], ["thirteen", 13], ["twelve", 12], ["eleven", 11],
    ["ten", 10], ["nine", 9], ["eight", 8], ["seven", 7], ["six", 6], ["five", 5],
    ["four", 4], ["three", 3], ["two", 2], ["both", 2], ["one", 1],
  ];
  for (const [w, n] of words) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}
