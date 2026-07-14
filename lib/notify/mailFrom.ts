// Single source of truth for the visible "From" on all borrower-facing email.
//
// frank@fettifi.com is the ONLY monitored fettifi.com mailbox: the CRM polls it every
// 5 min via Microsoft Graph (/api/cron/email-poll), and it's already the Reply-To on
// every send. So a borrower who hits Reply OR emails the From line directly both reach
// a human — nothing is lost.
//
// The legacy LEAD_RESPONSE_FROM_EMAIL env var points at "Fetti Financial Services
// <hello@fettifi.com>". hello@ has no inbox (Ramon confirmed 2026-07-14), so any mail a
// borrower sent to that From address bounced or vanished into an unread catch-all. We
// coerce that one dead sender to frank@. Any OTHER explicitly-configured sender still
// wins, so setting LEAD_RESPONSE_FROM_EMAIL to a real monitored address overrides this.
const CANONICAL_FROM = "Fetti Financial Services <frank@fettifi.com>";

export function senderFrom(): string {
  const env = (process.env.LEAD_RESPONSE_FROM_EMAIL || "").trim();
  if (!env) return CANONICAL_FROM;
  // The known-dead hello@ sender is never used, no matter how it's cased/formatted.
  if (/hello@fettifi\.com/i.test(env)) return CANONICAL_FROM;
  return env;
}
