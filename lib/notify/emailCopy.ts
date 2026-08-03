// The borrower-facing EMAIL copy engine. Emails are NOT texts: no "(Reply STOP)" strings,
// no "Reply YES", varied human subject lines, short personal notes that give value before
// asking. The touch-set below was produced by a competing-copywriter + judge panel
// (3 writers × 2 judges × synthesis) and is interpolated per-lead; every touch reads like
// Mark typed it between calls. SMS copy stays in lib/nurture.ts — channels are split.
//
// STYLE RULES (from the panel — keep for future edits): one TRUE lending mechanic given
// away free, then exactly ONE question answerable in five words from a phone (binary
// beats open). 40–90 words. Subjects 2–6 words, lowercase-casual, never "Next steps"/
// "Following up". The body sign-off is COMMS_PERSONA — never a hardcoded name.
//
// 2026-08-02: it WAS hardcoded "— Mark" in all twelve bodies while the signature block said
// Frank and the From header said "Fetti Financial Services" — three different people on one
// email, across 448 of 576 sends. Two borrowers wrote back to ask who they were talking to.
// The persona constant had been wired into SMS, doc requests and the footer, and into no email
// body at all. scripts/verify-persona.ts now fails if a hardcoded sign-off returns.
// NEVER: rates/payments/"approved"/"guaranteed", "no obligation", "circling back",
// "I hope this finds you well", CTA buttons, SMS artifacts, mail-merge greeting lines.
import { COMMS_PERSONA } from "@/lib/markPersona";
import "server-only";
import { signingSecret } from "@/lib/signingSecret";
import crypto from "crypto";

export type EmailTouch = { subject: string; body: string };
export type EmailLead = {
  first_name?: string | null;
  full_name?: string | null;
  loan_purpose?: string | null;
  state?: string | null;
  property_value?: number | null;
};

// Normalize a stored loan_purpose ("dscr", "cash-out_refi") into a BARE natural noun
// phrase ("DSCR purchase") — templates add their own article ("the …", "your …", "a …").
export function prettyPurpose(raw?: string | null): string {
  const p = (raw || "").replace(/[-_]+/g, " ").trim().toLowerCase();
  if (!p) return "financing";
  if (/dscr/.test(p)) return "DSCR loan";
  if (/cash.?out/.test(p)) return "cash-out refi";
  if (/refi/.test(p)) return "refinance";
  if (/first.?time|homebuyer/.test(p)) return "home purchase";
  if (/fha/.test(p)) return "FHA purchase";
  if (/\bva\b/.test(p)) return "VA purchase";
  if (/multi.?family/.test(p)) return "multi-family loan";
  if (/equipment/.test(p)) return "equipment financing";
  if (/purchase|buy/.test(p)) return "home purchase";
  if (/bridge|fix|flip/.test(p)) return "bridge loan";
  if (/bank ?statement/.test(p)) return "bank-statement loan";
  if (/heloc|equity/.test(p)) return "equity loan";
  return p;
}


/**
 * THE ONLY FIRST-NAME FUNCTION. Returns "" when there is no name worth using, so the caller
 * drops the greeting rather than inventing one.
 *
 * The drip path used `|| "there"` with no rejection list at all, so eight real sends opened
 * "Hey there —", "Test —", "Shield —" and "Wtwo —". A broken merge is the loudest automation
 * tell there is, and it was only guarded on the first-touch path — two implementations, one
 * of them wrong, which is why this is now one function used by both.
 */
const JUNK_NAMES = new Set([
  "there", "test", "testing", "shield", "na", "n/a", "none", "null", "undefined", "unknown",
  "admin", "user", "customer", "borrower", "lead", "sample", "demo", "asdf", "wtwo", "noname",
]);
export function safeFirstName(lead: { first_name?: string | null; full_name?: string | null }): string {
  let first = String(lead.first_name || lead.full_name || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  // "MARIA —" screams mail-merge; normalise before judging it.
  if (first === first.toUpperCase() && first.length > 1) first = first[0] + first.slice(1).toLowerCase();
  if (!/^[A-Za-z][A-Za-z'.-]{1,}$/.test(first)) return "";
  if (JUNK_NAMES.has(first.toLowerCase())) return "";
  // A "first name" that does not appear in the stored full name is a parsing artifact.
  const full = String(lead.full_name || "").toLowerCase();
  if (full && !full.includes(first.toLowerCase())) return "";
  return first;
}

// Interpolate a touch for a lead. Tokens: {first_name} {loan_purpose} {state}
// {property_value_range}. Missing optional fields degrade at PHRASE level (never a
// dangling "in ." artifact) so every render reads clean.
export function renderTouch(t: EmailTouch, lead: EmailLead): EmailTouch {
  const first = safeFirstName(lead);
  const purpose = prettyPurpose(lead.loan_purpose);
  const state = (lead.state || "").trim();
  const value = lead.property_value && lead.property_value > 10000
    ? `$${Math.round(lead.property_value / 1000)}k`
    : "";

  const fillPhrases = (s: string) => {
    // Phrase-level degradation for optional fields:
    // DEGRADE TO A DIFFERENT KNOWN FACT, never to nothing. The old degradation stripped the
    // only specific thing in the sentence and still produced grammatical English, so it passed
    // review while saying nothing: d1 shipped WITHOUT its dollar hook on 36 of 86 sends, and d7
    // lost the state on 32 of 43. `loan_purpose` is present on essentially every lead.
    s = s.replace(/with \{state\} investors/g, state ? `with ${state} investors` : "with investors like you");
    s = s.replace(/rents in \{state\}/g, state ? `rents in ${state}` : "local rents");
    s = s.replace(/\{state\}/g, state || "your market");
    s = s.replace(/you put the property around \{property_value_range\}, and honestly that/g,
      value
        ? `you put the property around ${value}, and honestly that`
        : `you're looking at a ${purpose}, and honestly that`);
    s = s.replace(/\{property_value_range\}/g, value || "what you told me");
    return s;
  };
  const fill = (s: string) => fillPhrases(s)
    // NO NAME = DROP THE GREETING, not print an empty one. "Hey  — saw your inquiry" and a
    // leading " — you put the property" are worse than no greeting at all, and substituting
    // "there" is what produced "Hey there —" on eight real sends.
    .replace(/^Hey \{first_name\} — /g, first ? `Hey ${first} — ` : "")
    .replace(/^\{first_name\} — /g, first ? `${first} — ` : "")
    .replace(/, \{first_name\}\./g, first ? `, ${first}.` : ".")
    .replace(/\{first_name\}/g, first)
    .replace(/\{loan_purpose\}/g, purpose)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s*—\s*/, "");
  return { subject: fill(t.subject), body: fill(t.body) };
}

// Strip SMS-isms if any legacy/shared copy reaches an email body.
export function scrubSmsIsms(body: string): string {
  return body
    // consume the whole "(Reply STOP to opt out.)" including inner dots + close paren
    .replace(/\s*\(?\s*Reply\s+STOP[^)\n]*\)?\s*\.?/gi, "")
    // consume a leading "Just " so the replacement never yields "Just Just hit reply."
    .replace(/\s*(?:Just\s+)?[Rr]eply\s+YES\b[^.\n]*\.?/g, " Just hit reply.")
    .replace(/\s*Text\s+HELP\b[^.\n]*\.?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Signed one-click unsubscribe URL (CAN-SPAM). HMAC keyed on CRON_SECRET.
const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");
export function unsubToken(leadId: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(leadId).digest("hex").slice(0, 16);
}
export function unsubUrl(leadId: string): string {
  return `${APP}/api/unsubscribe?l=${encodeURIComponent(leadId)}&t=${unsubToken(leadId)}`;
}

// ---------------------------------------------------------------------------
// THE TOUCH-SET (panel-crafted 2026-07-02; keys map to the nurture cadence)
// ---------------------------------------------------------------------------
export const EMAIL_TOUCHES: Record<string, EmailTouch> = {
  first_touch: {
    subject: "your {loan_purpose}",
    body: "Hey {first_name} — saw your inquiry about the {loan_purpose} come through. Before I run anything, one thing worth knowing: the right structure usually depends less on the property and more on how your income shows up on paper. Different programs read that very differently. So I don't point you down the wrong path — is this deal under contract already, or still in the hunting stage?\n\n— " + COMMS_PERSONA,
  },
  d1: {
    subject: "before any paperwork",
    body: "{first_name} — you put the property around {property_value_range}, and honestly that plus how you get paid is most of what I need to sketch options. No documents at this stage — people always brace for a paperwork avalanche that doesn't come until much later. The sketch part takes me maybe twenty minutes. How do you get paid — W-2, self-employed, or rentals?\n\n— " + COMMS_PERSONA,
  },
  d3: {
    subject: "the tax return trap",
    // REWRITTEN 2026-08-02. The 55 sends of the previous body named nobody and earned nothing.
    // The only two drip templates that ever got a reply (d1, d30) share one shape: the person's
    // name, then their own deal, then ONE question with named options, short. That shape is
    // copied here rather than invented.
    body: "{first_name} — one thing worth knowing about your {loan_purpose}: the loan doesn't have to run off your tax returns. Write-offs are smart in April and brutal on a mortgage, so there are programs that read bank deposits instead, and for rentals, ones that only look at what the property earns.\n\nWhich sounds more like you — W-2, self-employed, or rental income?\n\n— " + COMMS_PERSONA,
  },
  d7: {
    subject: "what investors usually do",
    body: "{first_name} — pattern I keep seeing with {state} investors: they take the deal to their bank first, get slow-walked three weeks, then end up on a DSCR loan anyway. It qualifies on the property's rent instead of tax returns — no W-2s, no write-off penalty.\n\nWorth a two-minute check on your {loan_purpose}: what would it rent for, roughly?\n\n— " + COMMS_PERSONA,
  },
  d14: {
    subject: "on timing",
    // The highest-volume email in the database (66 sends, 0 replies) and it named nobody.
    body: "{first_name} — quick one on the {loan_purpose}. Prices and competition move when rates do, and rarely in your favour all at once, so plenty of people take the deal in front of them and revisit the financing later. Not saying rush — just the other half of the math.\n\nWhere's your head at: still watching, actively looking, or shelved for now?\n\n— " + COMMS_PERSONA,
  },
  d30: {
    subject: "still on, or shelved?",
    body: "{first_name} — no pitch in this one. Your file's still sitting on my desk and I'd rather ask than assume. If the {loan_purpose} plan changed, that's genuinely useful to know — I'll close it out and stop taking up inbox space. If it's just slow-moving, also fine; most are. One-word answer works: still on, or shelved?\n\n— " + COMMS_PERSONA,
  },
  d60: {
    subject: "sixty days changes things",
    body: "{first_name} — been two months since you asked about the {loan_purpose}, and quietly, some of the inputs have probably moved — rents in {state}, your deposits, maybe the property value. Deals that didn't pencil sixty days ago sometimes pencil now, and the reverse, which is worth knowing too. Easy to re-run with current numbers; I keep the old ones for comparison. Anything shifted on your end?\n\n— " + COMMS_PERSONA,
  },
  d90: {
    subject: "leaving the light on",
    body: "{first_name} — last note from me for a while. After this I'll assume the timing's just not now, which is a perfectly good reason. Your file stays open on my desk — nothing expires, nobody pesters you, and if the {loan_purpose} comes back around in three months or twelve, you start warm instead of cold. Anything worth noting in the file before I go quiet?\n\n— " + COMMS_PERSONA,
  },
  r1: {
    subject: "guidelines moved since you asked",
    body: "{first_name} — it's been a minute since you asked about the {loan_purpose}, so quick heads-up: lending guidelines drift more than people realize. Programs that didn't fit when you inquired sometimes fit now — reserve requirements loosen, doc options widen, new products show up. Your original info is still in my file, so re-checking takes minutes on my end. Has anything changed on yours — property, income, plans?\n\n— " + COMMS_PERSONA,
  },
  r2: {
    subject: "quick one",
    body: "{first_name} — tidying up old files today, yours included. That {loan_purpose} you asked about: I figure it's either dead, delayed, or handled elsewhere, and any of those is a fine answer. If it's delayed, I'll just check back when the timing's real. Which one is it?\n\n— " + COMMS_PERSONA,
  },
  r3: {
    subject: "three numbers decide most files",
    body: "Genuinely the last one, {first_name}. If you ever pick the {loan_purpose} back up, three numbers decide most files: what the property's worth, what it rents for (or how your deposits look if you're self-employed), and your credit ballpark. Reply with those any time and I can give you a straight read on fit — no application, no pull. Keep your file open, or close it out?\n\n— " + COMMS_PERSONA,
  },
};

// Map nurture drip step numbers -> touch keys.
export const STEP_TOUCH: Record<number, string> = { 1: "d1", 2: "d3", 3: "d7", 4: "d14", 5: "d30", 6: "d60", 7: "d90" };
export const REACTIVATION_KEYS = ["r1", "r2", "r3"];

// ---------------------------------------------------------------------------
// CONVERSION FIRST TOUCH (know-first). The lead just told us WHO they are and
// WHAT they're doing — so the opener never asks if they're interested or what
// they want. It acknowledges the exact deal, gives ONE purpose-specific true
// mechanic free, and moves them to their PRE-FILLED application (magic link,
// ~3 min, no credit pull) with booking/reply as the secondary path.
// ---------------------------------------------------------------------------

// One true mechanic per purpose — value first, zero rates/promises. Panel-crafted
// (3 competing writers × 2 judges × synthesis, 2026-07-02 — "advisor" angle won).
export const FIRST_TOUCH_INSIGHTS: Record<string, string> = {
  dscr: "A DSCR loan qualifies on the property's rent covering the payment, not your tax returns — so the write-offs that make your income look small on paper never enter the conversation.",
  flip: "Fix-and-flip financing is sized against the after-repair value, not just the purchase price — the deal gets judged on your numbers and your exit, not your W-2.",
  cashout: "Cash-out is driven by today's appraised value rather than what you paid, so any appreciation since you bought is equity you can actually borrow against.",
  refi: "A refinance is really a break-even problem: the monthly savings has to outrun the closing costs within the time you'll keep the loan, and that break-even month is the number that matters most.",
  purchase: "The offer that wins is usually the one with a completed application behind it, because sellers read a fully documented buyer as a buyer who actually closes.",
  equity: "A HELOC sits in second position behind your current mortgage, so you can draw on your equity while your existing first loan stays exactly as it is.",
  bankstatement: "Bank-statement loans qualify you on 12 to 24 months of real deposits instead of tax returns, so the deductions that shrink your taxable income stop working against you.",
  default: "A lender's math starts with the same two numbers no matter the goal — the property's value and what's owed against it — so having those handy makes everything downstream faster.",
};

// Pick the insight for a stored loan_purpose string.
export function purposeInsight(raw?: string | null): string {
  const p = (raw || "").toLowerCase();
  if (/dscr|rental|invest/.test(p)) return FIRST_TOUCH_INSIGHTS.dscr;
  if (/flip|bridge|rehab|fix|hard/.test(p)) return FIRST_TOUCH_INSIGHTS.flip;
  if (/cash.?out/.test(p)) return FIRST_TOUCH_INSIGHTS.cashout;
  if (/refi/.test(p)) return FIRST_TOUCH_INSIGHTS.refi;
  if (/bank ?statement|self.?employ/.test(p)) return FIRST_TOUCH_INSIGHTS.bankstatement;
  if (/heloc|equity|second/.test(p)) return FIRST_TOUCH_INSIGHTS.equity;
  if (/purchase|buy/.test(p)) return FIRST_TOUCH_INSIGHTS.purchase;
  return FIRST_TOUCH_INSIGHTS.default;
};

/**
 * Render the conversion first-touch email. Falls back to the classic template
 * when no app link is available (should be rare — every lead gets one).
 */
export function renderFirstTouch(
  lead: EmailLead,
  // `optInLink` is the one-click SMS consent page. The first touch is the highest-attention
  // email in the funnel and it was the ONE place the invitation to text never appeared —
  // it ran only on three of the seven drip bodies.
  opts: { appLink?: string | null; calendly?: string | null; optInLink?: string | null },
): EmailTouch {
  if (!opts.appLink) return renderTouch(EMAIL_TOUCHES.first_touch, lead);
  const first = safeFirstName(lead);
  const greet = first ? `${first} — your` : "Your"; // broken merge = loudest automation tell
  const purpose = prettyPurpose(lead.loan_purpose);
  const insight = purposeInsight(lead.loan_purpose);
  // ONE ASK PER EMAIL. This closed with two questions in a single sentence ("where are you in
  // the process right now, and what's your timeline looking like?") and then a P.S. offering a
  // booking link — a third, heavier ask competing with the reply it had just requested. The two
  // drip templates that ever earned a reply asked ONE question with named options. Everything
  // here is now pointed at the reply; the calendar stays available on request, not as a rival CTA.
  const ps = opts.optInLink
    ? `P.S. Rather text than type? Tap once and I'll text you instead: ${opts.optInLink}`
    : `P.S. Rather talk than type? Say the word and I'll call you.`;
  // Identity/NMLS live in the signature footer (markSignatureLite) — body stays personal.
  return {
    subject: `your ${purpose}`,
    body: `${greet} ${purpose} request just came through, so let me skip the pleasantries and give you the one thing worth knowing up front.\n\n${insight}\n\nSo I point you the right way instead of guessing — is this deal already under contract, still hunting, or just early research?\n\n— ${COMMS_PERSONA}\n\n${ps}`,
  };
}
