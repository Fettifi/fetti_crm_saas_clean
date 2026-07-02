// Deterministic compliance net for Mark's conversational replies (website chat + any
// surface). A temp>0 model WILL occasionally quote a rate/payment or imply approval no
// matter what the prompt says — for a licensed lender (NMLS #2267023) that's a real
// liability. This catches it AFTER generation and swaps in a safe, still-human deferral.
// Mirrors (and shares intent with) the SMS concierge gate in lib/markConcierge.

// A specific rate/APR/percent — digits ("6.5%", "11 percent", "11 to 12 percent"),
// AND spelled-out numbers ("six and a half percent"), which models love to use to
// dodge digit filters.
const NUM_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
const RATE = new RegExp(
  String.raw`(\b\d{1,2}(\.\d{1,3})?\s?%)` +
  String.raw`|\bapr\b` +
  String.raw`|\b\d{1,2}(\.\d{1,3})?(\s?(to|-|–)\s?\d{1,2}(\.\d{1,3})?)?\s?percent\b` +
  `|\\b${NUM_WORD}(\\s+and\\s+a\\s+(half|quarter))?(\\s+(to|-)\\s+${NUM_WORD})?\\s+percent\\b` +
  String.raw`|\brates?\s+(are|run|start|go|sit)\s+(at|around|about|near)?\s*\d`,
  "i");
// An approval/outcome guarantee.
const APPROVAL = /\b(guarantee|guaranteed)\b|\byou(?:'?re| are)\s+(pre-?)?approved\b|\bguaranteed approval\b|\b100%\s+approv/i;
// A specific monthly PAYMENT quote — a dollar figure tied to payment/month language.
const PAYMENT = /(\$\s?\d[\d,]*(\.\d+)?\s*(\/\s?mo\b|per month|a month|monthly|\bmo\b))|((monthly payment|your payment|the payment|payment would|payment could|principal and interest)[^.!?\n]{0,40}\$\s?\d[\d,]*)/i;

/** True if a reply quotes a rate, a specific payment, or guarantees approval. */
export function markReplyViolates(reply: string): boolean {
  if (!reply) return false;
  return RATE.test(reply) || APPROVAL.test(reply) || PAYMENT.test(reply);
}

/** A safe, human-sounding replacement when a reply would break compliance — no numbers,
 *  no promises; pivots to getting REAL numbers via the application or a call. */
export function markSafeDeferral(opts: { applyUrl?: string | null; calendlyUrl?: string | null }): string {
  const apply = opts.applyUrl ? ` — quickest way is a 2-minute application, no credit pull to start: ${opts.applyUrl}` : " by starting a quick application";
  const book = opts.calendlyUrl ? ` Prefer to talk it through? Grab a time: ${opts.calendlyUrl}` : "";
  return `Honestly, your real numbers come down to your specific scenario, so I won't toss out a figure that turns out wrong. Let's get you the actual numbers${apply}.${book} Want me to walk you through it?`;
}
