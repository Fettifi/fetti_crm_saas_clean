// MAGIC APPLICATION LINK — the conversion mechanism. Every lead gets a signed link
// that opens the apply wizard with their contact info + goal ALREADY FILLED, so the
// path from "interested" to "application" is one tap + the qualifying questions.
// (Before this, a nurtured lead had to start the wizard from scratch and re-type
// everything — the #1 reason follow-ups never converted to applications.)
// HMAC-signed with CRON_SECRET (same trust model as the unsubscribe + file links).
import "server-only";
import { signingSecret } from "@/lib/signingSecret";
import crypto from "crypto";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");

export function appLinkToken(leadId: string): string {
  return crypto.createHmac("sha256", signingSecret() + ":apply").update(leadId).digest("hex").slice(0, 16);
}

// Map a stored loan_purpose onto the wizard's goal values.
export function goalFor(purpose?: string | null): string | null {
  const p = (purpose || "").toLowerCase();
  if (!p) return null;
  if (/dscr|invest|rental/.test(p)) return "invest";
  if (/flip|bridge|rehab|construction|fix/.test(p)) return "flip";
  if (/cash.?out|refi/.test(p)) return "refi";
  if (/heloc|equity|second/.test(p)) return "equity";
  if (/commercial|business|sba|equipment/.test(p)) return "business";
  if (/reverse/.test(p)) return "reverse";
  if (/purchase|buy/.test(p)) return "buy";
  return null;
}

/** The lead's personal finish-your-application link. */
export function magicApplyLink(lead: { id: string; loan_purpose?: string | null }): string {
  const goal = goalFor(lead.loan_purpose);
  return `${APP}/apply/form?lead=${encodeURIComponent(lead.id)}&t=${appLinkToken(lead.id)}${goal ? `&goal=${goal}` : ""}`;
}

// ── ONE-CLICK SMS OPT-IN ──────────────────────────────────────────────────────────────────
//
// 136 leads hold a valid 10-digit phone and no SMS consent — and email-only leads reply
// 0 times out of 128, while leads who also get a text reply 20.6%. The only invitation we
// ever made was a line of text in three of the seven email bodies ("Prefer to text? Text me
// at …"): 228 sends carrying it produced exactly ONE consent grant. 0.9%.
//
// A texted-in keyword remains the strongest consent that exists and is untouched. This is
// the second-best thing: one screen, the full disclosure, a genuinely unchecked box. The
// token is scoped to opt-in specifically so a leaked apply link cannot grant consent.
export function optInToken(leadId: string): string {
  return crypto.createHmac("sha256", signingSecret() + ":smsoptin").update(leadId).digest("hex").slice(0, 16);
}

/** The lead's personal "yes, you may text me" link. */
export function smsOptInLink(lead: { id: string }): string {
  return `${APP}/optin/${encodeURIComponent(lead.id)}?t=${optInToken(lead.id)}`;
}
