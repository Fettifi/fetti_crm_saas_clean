// TEXT "RSVP" TO THE OFFICE LINE AND BE ON THE GUEST LIST.
//
// 2026-09-05, Ramon: "Calling penny is becoming difficult. So just give me something simple
// number or some sort of text code or QR code that one can scan or text to RSVP."
//
// The phone path already works ([[phone-rsvp-capture]]) but it costs the guest a phone call and
// costs us a transcription that has to be right. A text is one thumb and the words arrive
// exactly as typed — nothing has to be heard correctly for it to work.
//
// THE DANGER THIS MODULE EXISTS TO AVOID: /api/sms/inbound is a MORTGAGE funnel. Before this,
// a wedding guest texting "RSVP" fell straight through to the lead paths and would have been
// filed as a mortgage lead, stamped with a campaign, and sent marketing. Same failure the phone
// path was fixed for — "a guest is not a lead" — so this branch runs BEFORE every lead path and
// answers on its own.
//
// Deliberately deterministic. No model, no transcription, no inference: the guest either typed
// the keyword or they did not.
import { parsePartyReply } from "./rsvpFromCall";

/** Placeholder held while we know the phone but have not been told the name yet. */
export const NAME_PENDING = "(name pending)";
export const isNamePending = (n?: string | null) => String(n || "").trim() === NAME_PENDING;

/** The published code. Kept to ONE word so a printed card can say it without a footnote. */
export const RSVP_KEYWORD = "RSVP";

export type SmsRsvpIntent = {
  /** The message opens with the RSVP keyword. Nothing else in this module runs unless it does. */
  isRsvp: boolean;
  /** "no"/"can't make it" after the keyword — a regret, recorded, never chased. */
  declined: boolean;
  name: string | null;
  party: number | null;
};

const NONE: SmsRsvpIntent = { isRsvp: false, declined: false, name: null, party: null };

// Words that are an ANSWER, not a name. Without this "RSVP yes 2" books a guest called "Yes".
const NOT_A_NAME = new RegExp(
  "^(yes|yeah|yep|yup|no|nope|nah|maybe|sure|ok|okay|attending|going|coming|confirm(ed|ing)?|" +
  "for|of|us|we|people|guests?|adults?|plus|and|party|total|me|myself|im|i|am|is|are|was|were|" +
  "will|be|been|there|here|all|our|my|his|her|their|its|the|a|an|family|kids?|children)$",
  "i",
);

const DECLINE = /\b(can'?t|cannot|can not|won'?t|will not|unable|not going|not able|no thanks|regrets?|decline|sorry)\b/i;

/**
 * Read one inbound SMS body as an RSVP.
 *
 * MUST OPEN WITH THE KEYWORD. A mortgage lead writing "I'll rsvp to that open house later" is
 * not answering a wedding invitation, and putting them on the guest list — then texting them
 * about a party — is exactly the mistake the phone path made with Kelly the refinance client.
 */
export function parseRsvpText(body: string | null | undefined): SmsRsvpIntent {
  const raw = String(body || "").trim();
  if (!raw) return NONE;

  // Leading punctuation/emoji tolerated; the keyword must be the first WORD.
  const m = raw.replace(/^[^A-Za-z]+/, "").match(/^r\.?s\.?v\.?p\.?\b([\s\S]*)$/i);
  if (!m) return NONE;

  let rest = m[1].replace(/^[\s,:;.\-–—]+/, "").trim();
  if (!rest) return { isRsvp: true, declined: false, name: null, party: null };

  if (DECLINE.test(rest) || /^\s*(no|nope|nah)\b/i.test(rest)) {
    return { isRsvp: true, declined: true, name: null, party: null };
  }

  // Pull the head count off the tail FIRST so it can never be read as part of the name.
  // Only a trailing count is taken: in "RSVP 2 Chainz" the 2 is part of the name, not a party
  // of two — so a bare leading number with words after it is left alone for the name pass.
  let party: number | null = null;
  const tail = rest.match(/[\s,;]+(?:party\s+of\s+|for\s+|x\s*)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:people|guests?|adults?|of\s+us|heads?)?\s*$/i);
  if (tail) {
    const n = parsePartyReply(tail[1]);
    if (n) { party = n; rest = rest.slice(0, tail.index).trim(); }
  } else if (/^\s*\d{1,2}\s*$/.test(rest)) {
    party = parsePartyReply(rest); rest = "";
  } else if (!/\d/.test(rest)) {
    // "RSVP just me", "RSVP me and my wife" — a WORD phrase, no digits. A bare digit that is
    // not on the tail is deliberately left alone: in "RSVP 2 Chainz" the 2 belongs to the name,
    // and guessing a party of two there books a guest who does not exist.
    const phrase = parsePartyReply(rest);
    if (phrase && !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(rest.replace(/\b(just|only|me|myself|and|my|wife|husband|partner|spouse|a|couple|pair|both|of|us)\b/gi, "").trim())) {
      party = phrase; rest = "";
    }
  }

  // Whatever survives is the name, minus filler words that are answers rather than names.
  const words = rest.replace(/[^A-Za-z'’\-.\s]/g, " ").split(/\s+/).filter(Boolean).filter((w) => !NOT_A_NAME.test(w));
  const name = words.length ? words.join(" ").replace(/\s+/g, " ").trim().slice(0, 80) : null;

  return { isRsvp: true, declined: false, name: name || null, party };
}

/**
 * Read the FOLLOW-UP text from a guest we are still waiting on, where we may need a name, a head
 * count, or both. Same tolerance as the keyword line, without requiring the keyword again — they
 * are answering a question we just asked them.
 */
export function parseFollowUp(body: string | null | undefined, needName: boolean): { name: string | null; party: number | null } {
  const raw = String(body || "").trim();
  if (!raw) return { name: null, party: null };
  // Reuse the keyword parser by prefixing the code, so one set of rules governs both messages.
  const asIfKeyword = parseRsvpText(`RSVP ${raw}`);
  return { name: needName ? asIfKeyword.name : null, party: asIfKeyword.party };
}

/**
 * The FIRST question after a bare keyword. ONE thing is asked, and it is the head count.
 *
 * The first cut of this asked for a name and a count together ("Reply with your name and how
 * many are coming, like: John Smith, 2") and Ramon corrected it the next day: a text that asks
 * two things gets one answered. The count leads because it is the number the caterer needs;
 * the name is asked straight after and can be fixed by hand, a wrong head count cannot.
 */
export function askCountFirst(label: string, date: string): string {
  return `You're on the guest list for ${label} — ${date}. How many in your party, including you? Just reply with a number.`;
}

/** Asked once the count is in and we still do not know who they are. */
export function askNameAfterCount(party: number): string {
  return `Got it — ${party} ${party === 1 ? "seat" : "seats"}. And what name should we put it under?`;
}

/** Kept for the one-shot/lead-in copy that still asks for both at once. */
export function askDetails(label: string, date: string): string {
  return `You're on the guest list for ${label} — ${date}. Reply with your name and how many are coming, like: John Smith, 2`;
}

/** What a guest gets back when we have the name but not the count. */
export function askCount(firstName: string): string {
  return `Thanks ${firstName}! How many of you should we count, including you? Reply with a number.`;
}

/** The regret acknowledgement. Recorded, never chased. */
export function declineReply(label: string): string {
  return `Thank you for letting us know — you'll be missed at ${label}. ❤️`;
}
