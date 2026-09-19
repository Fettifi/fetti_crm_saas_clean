// OUR OWN NUMBER IS NOT A LEAD, AND NOT A RECIPIENT.
//
// 2026-08-24: a text whose From was our own toll-free line (TWILIO_FROM) reached
// /api/sms/inbound — an outbound RSVP confirmation reflected back at us. The route did what it
// does for any unmatched sender: filed a lead, opened a "Call back Lead" task, and queued a
// first-touch drip that only AUTOMATION_PAUSED kept from texting our own number every fifteen
// minutes. Found 2026-09-17, twenty-four days later, by a probe — nothing in the funnel could
// tell our number from a borrower's.
//
// One predicate, read by both ends of the pipe: the inbound handler drops a message FROM one
// of our numbers, and sendSms refuses a message TO one. Add further owned lines to
// TWILIO_OWN_NUMBERS (comma-separated) — never to the code.
const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

export function ownNumberLast10s(): Set<string> {
  const out = new Set<string>();
  for (const v of [process.env.TWILIO_FROM, ...String(process.env.TWILIO_OWN_NUMBERS || "").split(",")]) {
    const d = last10(v);
    if (d.length === 10) out.add(d);
  }
  return out;
}

/** True when `phone` is one of the numbers WE send from. */
export function isOwnNumber(phone: unknown): boolean {
  const d = last10(phone);
  return d.length === 10 && ownNumberLast10s().has(d);
}
