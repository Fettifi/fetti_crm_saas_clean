// MAY WE TEXT THIS PERSON? ONE ANSWER, ONE PLACE.
//
// Ramon, 2026-08-02. The reply-rate diagnosis found this question being answered by SEVEN
// different expressions in three different strengths, plus one that computed the answer and
// then sent anyway with a "compliance note" attached, plus two senders that never asked at all.
// The two that never asked are the ones that actually put unconsented texts on handsets:
// reconciling the Twilio ledger against the CRM found 16 messages delivered to numbers with no
// consent on file — 15 from the LOS document chaser and 1 from the manual composer — the most
// recent on 2026-08-01. None of them carried STOP language.
//
// The automated engine was NOT the culprit: its gate is the strict form below and it held. The
// leak was in the paths that bypass the governor entirely because a human clicked a button.
// "A human clicked it" is not consent, and one of those buttons fires in bulk across every open
// loan file.
//
// So: this module is the ONLY definition. It is deliberately strict — silence is not consent.
// Ramon is NMLS-licensed; a TCPA claim is statutory damages per message, and the burden of
// proving consent is on the sender.
export type SmsVerdict = { ok: boolean; reason?: string };

/** The shape every sender reads. `raw` is the `leads.raw` JSON blob. */
export type ConsentRaw = {
  sms_consent?: boolean | null;
  sms_optout_at?: string | null;
  sms_undeliverable?: boolean | null;
  historical_import?: boolean | null;
  consent?: { sms_optin?: boolean | null } | boolean | null;
} | null | undefined;

/**
 * MAY WE SEND AN AUTOMATED OR SEMI-AUTOMATED SMS TO THIS LEAD?
 *
 * Order matters: revocation is checked before consent, so a later "yes" can never quietly
 * outrank an earlier STOP. Only an explicit, recorded opt-in returns ok.
 */
export function smsAllowed(raw: ConsentRaw): SmsVerdict {
  const r: any = raw || {};
  // REVOCATION FIRST, and it is permanent until the consumer re-consents through a path that
  // records HOW. A keyword arriving from a number that already opted out is not a new opt-in.
  if (r.sms_optout_at) return { ok: false, reason: "opted out (STOP)" };
  if (r.sms_consent === false) return { ok: false, reason: "SMS consent declined" };
  // A number the carrier has told us is undeliverable is not a number to keep dialling.
  if (r.sms_undeliverable) return { ok: false, reason: "carrier reports the number undeliverable" };
  // A lead imported from an old system carries no consent record we can produce in a dispute.
  if (r.historical_import) return { ok: false, reason: "historical import — no consent artifact on file" };
  // `consent` is sometimes a boolean (the Meta lead-ad path writes `consent: true`, which means
  // "the instant form was submitted", NOT "may be texted"). `true?.sms_optin` is undefined, so
  // that path correctly fails here — but read it defensively rather than relying on the accident.
  const optin = r.consent && typeof r.consent === "object" ? r.consent.sms_optin === true : false;
  if (r.sms_consent === true || optin) return { ok: true };
  return { ok: false, reason: "no SMS consent on file" };
}

/** Convenience for call sites that only branch. */
export const canSms = (raw: ConsentRaw): boolean => smsAllowed(raw).ok;

/**
 * MAY WE SEND ANY AUTOMATED MESSAGE AT ALL — email included?
 *
 * `nurture_paused` is what the one-click CAN-SPAM unsubscribe writes, and what an inbound STOP
 * writes. Before this it was read in exactly two send-path files; the governor and the responder
 * never looked at it, and neither did the document chaser.
 */
export function messagingAllowed(lead: { nurture_paused?: boolean | null; raw?: ConsentRaw }): SmsVerdict {
  if (lead?.nurture_paused) return { ok: false, reason: "unsubscribed / paused by the recipient" };
  return { ok: true };
}

/** The disclosure shown on the one-click opt-in page — and stored verbatim as the artifact.
 *  Mirrors the /apply wizard's SMS_CONSENT so the two paths grant the same thing. */
export const SMS_OPTIN_DISCLOSURE =
  "I agree that Fetti Financial Services LLC (NMLS #2267023) may send me account, application " +
  "and appointment text messages (SMS) at the number on file. Consent is not a condition of any " +
  "service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

/** Every automated SMS must tell the recipient how to stop it. Appended once, never doubled. */
export const STOP_LINE = "Reply STOP to opt out.";
export function withStopLine(body: string): string {
  return /\bSTOP\b/i.test(body) ? body : `${body.replace(/\s+$/, "")} ${STOP_LINE}`;
}

// A REVOCATION IS A REVOCATION ON ANY CHANNEL.
//
// This lived inside the SMS route at module scope, so the EMAIL ingest could not reach it —
// and consequently "stop emailing me" in a reply was logged as a HOT LEAD, auto-answered by
// the concierge, and left in the drip. CAN-SPAM gives 10 business days to honour an opt-out
// request and does not require it to arrive through the unsubscribe link.
//
// TCPA opt-out detection. Under the FCC's 2024 TCPA Report & Order (47 CFR
// 64.1200(a)(10), eff. Apr 2025) a consumer may revoke consent by ANY reasonable
// means, and words like stop/quit/end/cancel/unsubscribe/opt-out are per se
// reasonable EVEN when embedded in a longer message. A bare-keyword-only match
// misses "stop texting me" / "remove me from your list". This detector catches
// embedded revocations while deliberately NOT misfiring on the ambiguous uses the
// funnel must keep as hot replies ("cancel my 3pm appointment", "stop by the office").
export function isRevocation(raw: string): boolean {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return false;
  // 1) The message IS a single opt-out keyword (± trailing punctuation).
  if (/^(stop\s?all|stop|unsubscribe|cancel|end|quit|optout|opt[-\s]?out|revoke|remove)[.!?\s]*$/.test(t)) return true;
  // 2) Words with no other reading in an SMS reply → opt-out even when embedded.
  if (/\bunsubscribe\b|\bopt[-\s]?out\b|\bstop\s?all\b/.test(t)) return true;
  // 3) "stop"/"quit"/"cease"/"no more"/"don't"/"do not" tied to a contact channel.
  if (/\b(?:stop|quit|cease|halt|no more|don'?t|do not|please stop)\b[^.!?]{0,24}\b(?:text|texts|texting|messag|contact|call|calls|calling|email|emails)\b/.test(t)) return true;
  // 4) Explicit removal requests.
  if (/\b(?:remove|take)\s+me\b/.test(t) || /\bno more (?:texts?|messages?|calls?|emails?)\b/.test(t) || /\bleave me alone\b/.test(t)) return true;
  // 5) A leading, standalone "stop" command (but not "stop by ...").
  if (/^stop\b/.test(t) && !/^stop by\b/.test(t)) return true;
  return false;
}
