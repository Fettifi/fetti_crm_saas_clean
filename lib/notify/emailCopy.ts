// The borrower-facing EMAIL copy engine. Emails are NOT texts: no "(Reply STOP)" strings,
// no "Reply YES", varied human subject lines, short personal notes that give value before
// asking. The touch-set below was produced by a competing-copywriter + judge panel
// (3 writers × 2 judges × synthesis) and is interpolated per-lead; every touch reads like
// Mark typed it between calls. SMS copy stays in lib/nurture.ts — channels are split.
//
// STYLE RULES (from the panel — keep for future edits): one TRUE lending mechanic given
// away free, then exactly ONE question answerable in five words from a phone (binary
// beats open). 40–90 words. Subjects 2–6 words, lowercase-casual, never "Next steps"/
// "Following up". Sign-off "— Mark" in the body; identity/CAN-SPAM live in the footer.
// NEVER: rates/payments/"approved"/"guaranteed", "no obligation", "circling back",
// "I hope this finds you well", CTA buttons, SMS artifacts, mail-merge greeting lines.
import "server-only";
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

// Interpolate a touch for a lead. Tokens: {first_name} {loan_purpose} {state}
// {property_value_range}. Missing optional fields degrade at PHRASE level (never a
// dangling "in ." artifact) so every render reads clean.
export function renderTouch(t: EmailTouch, lead: EmailLead): EmailTouch {
  const first = (lead.first_name || lead.full_name || "").trim().split(/\s+/)[0] || "there";
  const purpose = prettyPurpose(lead.loan_purpose);
  const state = (lead.state || "").trim();
  const value = lead.property_value && lead.property_value > 10000
    ? `$${Math.round(lead.property_value / 1000)}k`
    : "";

  const fillPhrases = (s: string) => {
    // Phrase-level degradation for optional fields:
    s = s.replace(/with \{state\} investors/g, state ? `with ${state} investors` : "with investors");
    s = s.replace(/rents in \{state\}/g, state ? `rents in ${state}` : "local rents");
    s = s.replace(/\{state\}/g, state || "your market");
    s = s.replace(/you put the property around \{property_value_range\}, and honestly that/g,
      value ? `you put the property around ${value}, and honestly that` : "honestly, the property");
    s = s.replace(/\{property_value_range\}/g, value || "what you told me");
    return s;
  };
  const fill = (s: string) => fillPhrases(s)
    .replace(/\{first_name\}/g, first)
    .replace(/\{loan_purpose\}/g, purpose)
    .replace(/[ \t]{2,}/g, " ");
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
  return crypto.createHmac("sha256", process.env.CRON_SECRET || "fetti").update(leadId).digest("hex").slice(0, 16);
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
    body: "Hey {first_name} — saw your inquiry about the {loan_purpose} come through. Before I run anything, one thing worth knowing: the right structure usually depends less on the property and more on how your income shows up on paper. Different programs read that very differently. So I don't point you down the wrong path — is this deal under contract already, or still in the hunting stage?\n\n— Mark",
  },
  d1: {
    subject: "before any paperwork",
    body: "{first_name} — you put the property around {property_value_range}, and honestly that plus how you get paid is most of what I need to sketch options. No documents at this stage — people always brace for a paperwork avalanche that doesn't come until much later. The sketch part takes me maybe twenty minutes. How do you get paid — W-2, self-employed, or rentals?\n\n— Mark",
  },
  d3: {
    subject: "the tax return trap",
    body: "Something most people don't hear until they're deep in it: the loan doesn't have to run off your tax returns. Self-employed folks write everything off — smart for April, brutal for a mortgage, because on paper the income looks tiny. There are programs that read bank deposits instead, and for rentals, ones that only look at what the property earns. Different math entirely. Does your tax return undersell what you actually make?\n\n— Mark",
  },
  d7: {
    subject: "what investors usually do",
    body: "Pattern I keep seeing with {state} investors: they take the deal to their bank first, get slow-walked for three weeks, then end up on a DSCR loan anyway — it qualifies on the property's rent, not their tax returns. No W-2s, no write-off penalty. Not the right fit for every file, but worth knowing about before the detour. If your deal rents (or would), that math is quick to check. What's the rent, roughly?\n\n— Mark",
  },
  d14: {
    subject: "on timing",
    body: "A thought on waiting for the perfect market: prices and competition move at the same time rates do, and rarely in your favor all at once. Plenty of investors take the deal in front of them and revisit the financing later. Not saying rush — just the other half of the math. Still watching, or has the plan changed?\n\n— Mark",
  },
  d30: {
    subject: "still on, or shelved?",
    body: "{first_name} — no pitch in this one. Your file's still sitting on my desk and I'd rather ask than assume. If the {loan_purpose} plan changed, that's genuinely useful to know — I'll close it out and stop taking up inbox space. If it's just slow-moving, also fine; most are. One-word answer works: still on, or shelved?\n\n— Mark",
  },
  d60: {
    subject: "sixty days changes things",
    body: "Been two months since you asked about the {loan_purpose}, and quietly, some of the inputs have probably moved — rents in {state}, your deposits, maybe the property value. Deals that didn't pencil sixty days ago sometimes pencil now, and the reverse, which is worth knowing too. Easy to re-run with current numbers; I keep the old ones for comparison. Anything shifted on your end?\n\n— Mark",
  },
  d90: {
    subject: "leaving the light on",
    body: "{first_name} — last note from me for a while. After this I'll assume the timing's just not now, which is a perfectly good reason. Your file stays open on my desk — nothing expires, nobody pesters you, and if the {loan_purpose} comes back around in three months or twelve, you start warm instead of cold. Anything worth noting in the file before I go quiet?\n\n— Mark",
  },
  r1: {
    subject: "guidelines moved since you asked",
    body: "It's been a minute since you asked about a {loan_purpose}, so quick heads-up: lending guidelines drift more than people realize. Programs that didn't fit when you inquired sometimes fit now — reserve requirements loosen, doc options widen, new products show up. Your original info is still in my file, so re-checking takes minutes on my end. Has anything changed on yours — property, income, plans?\n\n— Mark",
  },
  r2: {
    subject: "quick one",
    body: "{first_name} — tidying up old files today, yours included. That {loan_purpose} you asked about: I figure it's either dead, delayed, or handled elsewhere, and any of those is a fine answer. If it's delayed, I'll just check back when the timing's real. Which one is it?\n\n— Mark",
  },
  r3: {
    subject: "three numbers decide most files",
    body: "Genuinely the last one, {first_name}. If you ever pick this back up, three numbers decide most files: what the property's worth, what it rents for (or how your deposits look if you're self-employed), and your credit ballpark. Reply with those any time and I can give you a straight read on fit — no application, no pull. Keep your file open, or close it out?\n\n— Mark",
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
export function renderFirstTouch(lead: EmailLead, opts: { appLink?: string | null; calendly?: string | null }): EmailTouch {
  if (!opts.appLink) return renderTouch(EMAIL_TOUCHES.first_touch, lead);
  let first = (lead.first_name || lead.full_name || "").trim().split(/\s+/)[0] || "";
  // Merge hygiene: "MARIA —" screams mail-merge; junk/non-name strings drop the greeting.
  if (first && first === first.toUpperCase() && first.length > 1) first = first[0] + first.slice(1).toLowerCase();
  if (!/^[A-Za-z][A-Za-z'.-]*$/.test(first)) first = "";
  const greet = first ? `${first} — your` : "Your"; // broken merge = loudest automation tell
  const purpose = prettyPurpose(lead.loan_purpose);
  const insight = purposeInsight(lead.loan_purpose);
  const ps = opts.calendly
    ? `P.S. Rather talk it through first? Grab a time here: ${opts.calendly}, or just reply and ask me anything.`
    : `P.S. Rather talk it through first? Just reply and ask me anything — I read these.`;
  // Identity/NMLS live in the signature footer (markSignatureLite) — body stays personal.
  return {
    subject: `your ${purpose}`,
    body: `${greet} ${purpose} request just came through, so let me skip the pleasantries and give you the one thing worth knowing up front.\n\n${insight}\n\nYour application is already started: what you sent is loaded in, and finishing takes about 3 minutes with no credit pull at this step.\n${opts.appLink}\n\n— Mark\n\n${ps}`,
  };
}
