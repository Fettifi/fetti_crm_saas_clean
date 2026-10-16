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
  // Declared rather than reached through `as any`. All three were already being read by
  // messagingAllowed() and by lib/notify/docRequest.ts through casts, which is how
  // email_marketing_optout_at could have been misspelled at a call site and silently read
  // as undefined — a consent field that is `undefined` by typo always answers "allowed".
  email_optout_at?: string | null;
  /** The CAN-SPAM commercial opt-out: see emailOptOutRecord() below. */
  email_marketing_optout_at?: string | null;
  email_marketing_optout_source?: string | null;
  do_not_contact?: boolean | null;
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
 *
 * ── 2026-10-14: A MARKETING PAUSE WAS SILENTLY BLOCKING TRANSACTIONAL SENDS ────────────────────
 *
 * Ramon could not send Andrej Strapko a credit-card authorization. The LO panel said it could not
 * reach the borrower; `card_auth.sent` logged `channels=[]`. The cause was this function: his lead
 * carries `nurture_paused = true`, so the email leg's gate returned false and the send died with no
 * reason surfaced. His own record says why the flag was set:
 *
 *     "nurture_paused = true DELIBERATELY. He wrote on 2026-10-06: 'The automated system keeps
 *      requesting information I previously provided.' HE IS NOT UNSUBSCRIBED FROM RAMON — this only
 *      blocks automated sequences."
 *
 * The intent was recorded and the code did something else. There is no revocation artifact on that
 * lead at all — no sms_optout_at, no email_optout_at, no STOP. 32 leads carry this flag, and for
 * every one of them an LO-initiated card authorization, e-sign link or document request was dead.
 *
 * So `nurture_paused` is overloaded: it means BOTH "stop the drip campaign" and "I unsubscribed".
 * Only the second should stop a document the borrower is actively waiting for. A card authorization
 * an LO clicks send on for one named borrower on a live file is a TRANSACTIONAL / relationship
 * message, which is what CAN-SPAM exempts from the commercial opt-out (15 U.S.C. §7702(2)(B),(17)).
 *
 * `transactional: true` therefore ignores a bare pause — and ONLY a bare pause. An explicit
 * revocation still blocks, on every channel, every time. An inbound STOP is absolute for SMS under
 * the TCPA and is never bypassed: smsGate still requires smsAllowed() on top of this.
 */
export function messagingAllowed(
  lead: { nurture_paused?: boolean | null; raw?: ConsentRaw },
  opts?: { transactional?: boolean },
): SmsVerdict {
  const r = (lead?.raw ?? {}) as NonNullable<ConsentRaw>;
  // A REVOCATION the recipient actually made. These bind regardless of why we are writing.
  if (r.email_optout_at) return { ok: false, reason: "recipient opted out of email" };
  if (r.sms_optout_at) return { ok: false, reason: "opted out (STOP)" };
  if (r.do_not_contact) return { ok: false, reason: "do-not-contact on file" };
  // ── THE ONE-CLICK UNSUBSCRIBE HAD NO ARTIFACT, AND `nurture_paused` IS NOT ONE. ─────────────
  //
  // 2026-10-15: app/api/unsubscribe/route.ts recorded a CAN-SPAM opt-out by writing
  // `nurture_paused: true` and nothing else. After the 2026-10-14 transactional fix above, that
  // boolean is explicitly documented as NOT a revocation — it is also the switch an LO flips to
  // stop a drip — so the consumer's own act left no durable record anywhere.
  //
  // And the column does not survive. lib/leadShield.ts:534 (promoteQuarantined) writes
  // `nurture_paused: false` UNCONDITIONALLY and then replays the full new-lead pipeline,
  // first-touch email included. It is reached by autoPromoteIfQuarantined from five places —
  // app/api/apply/prefill (a LINK CLICK), the portal upload route, the Calendly webhook, inbound
  // SMS and lib/inbound/ingestEmail. The unsubscribe link and the pre-filled apply link sit in
  // the footer and the body of the SAME drip email, so one borrower in Review stage clicking
  // Unsubscribe and later clicking the apply link erases the opt-out and restarts the drip.
  //
  // So the opt-out now writes its own field, in `raw`, which promoteQuarantined preserves.
  // It is SCOPED: a one-click link in a follow-up email is a request to stop COMMERCIAL mail,
  // and 15 U.S.C. §7702(2)(B),(17) puts a transactional/relationship message outside the
  // commercial-message definition the opt-out governs. Writing `email_optout_at` here instead
  // would have killed the borrower's own card authorizations and e-sign links — the exact
  // Strapko failure the lines above exist to prevent. Marketing stops absolutely; a document
  // they are waiting on does not.
  if (r.email_marketing_optout_at && !opts?.transactional) {
    return { ok: false, reason: "recipient unsubscribed from marketing email (one-click opt-out)" };
  }
  // A bare marketing pause stops campaigns, not a document the borrower is waiting on.
  if (lead?.nurture_paused && !opts?.transactional) {
    return { ok: false, reason: "unsubscribed / paused by the recipient" };
  }
  return { ok: true };
}

/**
 * THE DURABLE ARTIFACT A ONE-CLICK UNSUBSCRIBE MUST LEAVE BEHIND.
 *
 * Returns the `raw` fields to merge — never overwriting an EARLIER opt-out stamp, the same
 * preserve-first shape lib/inbound/ingestEmail.ts uses for an inbound "stop emailing me".
 * In a CAN-SPAM dispute the burden is ours and the evidence is this timestamp plus its source;
 * 15 U.S.C. §7704(a)(4) gives 10 business days to honour the request.
 */
export function emailOptOutRecord(
  raw: ConsentRaw,
  via: string,
  at: string = new Date().toISOString(),
): { email_marketing_optout_at: string; email_marketing_optout_source: string } {
  const prior = (raw as NonNullable<ConsentRaw>)?.email_marketing_optout_at;
  return {
    email_marketing_optout_at: prior || at,
    email_marketing_optout_source: via,
  };
}

/**
 * MAY A HUMAN LO SEND THIS ONE PERSON THIS ONE MESSAGE?
 *
 * The LO-initiated paths (the Conversations inbox composer, Rupee's send tools) had no gate at
 * all — they read consent with hand-rolled expressions, or computed the verdict and sent anyway.
 * Reconciling the Twilio ledger against the CRM found 1 of the 16 unconsented deliveries came
 * from the manual composer; "a human clicked it" is not consent and never was.
 *
 * TRANSACTIONAL, because it is one named recipient on a live file and a human chose to write
 * them — so a bare marketing pause does not stop it. A revocation always does. On SMS,
 * smsAllowed() still has to pass on its own recorded evidence: the TCPA puts the burden of
 * proving consent on the sender and a human's intent is not evidence.
 */
export function loSendAllowed(
  lead: { nurture_paused?: boolean | null; raw?: ConsentRaw },
  channel: "sms" | "email",
): SmsVerdict {
  const base = messagingAllowed(lead, { transactional: true });
  if (!base.ok) return base;
  if (channel === "email") return { ok: true };
  return smsAllowed(lead?.raw);
}

/**
 * IS THIS TEXT A REPLY THE RECIPIENT ASKED FOR?
 *
 * sendSms's `allowQuietHours` is the only way past the TCPA window, and its own comment reserves
 * it for "an internal alert, or a direct reply the recipient just asked for". The Conversations
 * inbox claimed it unconditionally — on the free-text composer AND on the application-link push,
 * which is a solicitation by any reading. 47 C.F.R. §64.1200(c)(1) bars a solicitation outside
 * 8am-9pm local (lib/quietHours.ts holds the tighter 8am-8pm window because Florida's FTSA does).
 *
 * An inbound message inside the window below means a person is waiting on an answer, so the LO's
 * reply is invited and is not a solicitation. Silence means it is outreach, and it waits.
 */
// THREE HOURS, NOT TWENTY-FOUR — AND THE REASON IS ARITHMETIC, NOT TASTE.
// A 24-hour window SPANS AN ENTIRE NIGHT: a borrower who wrote at 2pm Monday would license a text
// at 3am Tuesday as an "invited reply". Any window long enough to contain the quiet period defeats
// the rule it claims to respect, so the number cannot be chosen for convenience.
// Three hours covers the case this exemption exists for — she wrote at 7:55pm, the LO answers at
// 8:05pm — and cannot reach across a night from any starting point inside the 8am-8pm window.
// This is a judgement, not a statute: 47 C.F.R. §64.1200(c)(1) governs solicitations and says
// nothing about how stale a conversation may be before a reply stops being one. Erring narrow is
// the only safe direction — a held text costs minutes, a 3am text is strict liability.
export const INVITED_REPLY_HOURS = 3;

export function invitedReply(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
  windowHours = INVITED_REPLY_HOURS,
): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  // A future timestamp is a clock problem, not an invitation.
  return age >= 0 && age <= windowHours * 3600_000;
}

/** The disclosure shown on the one-click opt-in page — and stored verbatim as the artifact.
 *  Mirrors the /apply wizard's SMS_CONSENT so the two paths grant the same thing. */
export const SMS_OPTIN_DISCLOSURE =
  "I agree that Fetti Financial Services LLC (NMLS #2267023) may send me account, application " +
  "and appointment text messages (SMS) at the number on file. Consent is not a condition of any " +
  "service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

/** Every automated SMS must tell the recipient how to stop it. Appended once, never doubled. */
export const STOP_LINE = "Reply STOP to opt out.";
/**
 * THE WORD "STOP" IS NOT THE DISCLOSURE. THE INSTRUCTION IS.
 *
 * The test was `/\bSTOP\b/i`, so any body that merely CONTAINED the word stop — in any sense —
 * had the required opt-out disclosure silently removed. The three bodies in
 * lib/notify/docRequest.ts interpolate caller-supplied text straight into the message:
 * `r.docs` (smsDocRequest), `r.title` (smsSign) and `r.lo_name` (all three). A document named
 * "Stop Payment Authorization" or a note to "stop by the office" therefore produced a text with
 * no way to opt out — which is a CTIA/carrier requirement on every program message and the TCPA
 * hygiene the three hand-rolled senders in that file were gated for in the first place.
 *
 * So match the INSTRUCTION, not the keyword. Deliberately narrow: "reply/text/respond/send STOP".
 * Checked against the real tree — the five bodies that already carry their own opt-out language
 * (lib/nurture.ts's seven steps, lib/connect.ts, lib/scoutMessages.ts, lib/markConcierge.ts and
 * the inbound auto-replies) all phrase it as "Reply STOP to opt out.", so nothing doubles up.
 */
const OPT_OUT_INSTRUCTION = /\b(?:reply|text|respond|send)\s+(?:with\s+)?["“'`]?stop\b/i;
export function withStopLine(body: string): string {
  return OPT_OUT_INSTRUCTION.test(body) ? body : `${body.replace(/\s+$/, "")} ${STOP_LINE}`;
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
/** Our own email footer contains the word "unsubscribe". A quoted reply that keeps it must not
 *  read back as the borrower's own revocation — an HTML-only reply flattened by the tag-stripper
 *  keeps that footer verbatim. */
function stripOwnFooter(t: string): string {
  return t
    .replace(/click here to unsubscribe[^.]*/g, " ")
    .replace(/to unsubscribe[^.]*/g, " ")
    .replace(/unsubscribe\s*[|·\-–]\s*(?:privacy|terms|nmls)[^.]*/g, " ")
    .replace(/reply stop to opt out[^.]*/g, " ")
    .replace(/nmls\s*#?\s*\d+[^.]*/g, " ");
}

export function isRevocation(raw: string): boolean {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return false;

  const body = stripOwnFooter(t);

  // ── PER SE REVOCATIONS COME FIRST. NOTHING OVERRIDES AN EXPLICIT OPT-OUT KEYWORD. ───────────
  // These two rules used to sit BELOW the preference pre-guards, so a message containing the word
  // "prefer", "instead" or "rather than" returned false before they were ever evaluated:
  //
  //     "STOP. I'd prefer you don't contact me again."      -> dropped
  //     "Please unsubscribe me, I prefer not to be contacted." -> dropped
  //
  // Under the FCC's 2024 TCPA Report & Order (47 CFR 64.1200(a)(10)) stop/unsubscribe/opt-out are
  // PER SE reasonable means of revoking consent, and TCPA is strict liability — $500 to $1,500 for
  // every message sent after it. A borrower who wrote STOP and kept receiving texts is the single
  // most expensive sentence in this file, and the false-positive guard below — written to protect
  // live borrowers from being silenced — was quietly doing the opposite thing to the clearest
  // revocations we receive.
  //
  // 1) The message IS a single opt-out keyword (± trailing punctuation).
  if (/^(stop\s?all|stop|unsubscribe|cancel|end|quit|optout|opt[-\s]?out|revoke|remove)[.!?\s]*$/.test(t)) return true;
  // 1b) The message OPENS with an unambiguous opt-out as its own clause: "STOP. I'd prefer you
  //     don't contact me again." Rule 1 requires the keyword to be the WHOLE message, so any
  //     trailing sentence defeated it — and a borrower who writes STOP and then explains why is
  //     the most natural revocation there is.
  //     Restricted to keywords with no innocent reading, and REQUIRES punctuation closing the
  //     clause, so "stop by the office tomorrow" and "cancel my 3pm appointment" cannot match.
  if (/^(?:stop\s?all|stop|unsubscribe|opt[-\s]?out|optout|quit)\b\s*[.!?,:;]/.test(t)) return true;
  // 2) Words with no other reading in a reply → opt-out even when embedded. Evaluated against
  //    the body with OUR OWN footer removed.
  if (/\bunsubscribe\b|\bopt[-\s]?out\b|\bstop\s?all\b/.test(body)) return true;

  // ── FALSE POSITIVES SILENCE LIVE BORROWERS, AND NOTHING EVER CLEARS THE FLAG. ──────────────
  // A conditional PREFERENCE is not a revocation: "don't call me before 9am, texts are fine"
  // and "no calls, email me instead" are a borrower telling us HOW to reach them. The old rule
  // 3 fired on both. lib/inbound/ingestEmail.ts gates the suppression write, the drip pause and
  // an early return on this function, and nothing in the repo ever un-suppresses an address.
  //
  // These now guard ONLY the heuristic rules below, which is all they were ever meant to do. They
  // run against `body` (our own footer stripped) so the word "prefer" inside a quoted signature
  // cannot disarm the fuzzy rules either.
  if (/\b(?:is|are)\s+(?:fine|ok|okay|good|better|preferred)\b/.test(body)) return false;
  if (/\b(?:instead|rather than|prefer)\b/.test(body) && !/\b(?:all contact|any contact|everything)\b/.test(body)) return false;
  // 3) A stop verb whose OBJECT is a contact channel. The gerunds matter: `\bemail\b` cannot
  //    match "emailing", so "please stop emailing me" — the exact sentence this detector was
  //    written for, and the one quoted in the commit that added the email path — was FALSE.
  if (/\b(?:stop|quit|cease|halt|no more|please stop)\b[^.!?]{0,24}\b(?:text|texts|texting|messag|contact|contacting|call|calls|calling|e-?mail|e-?mails|e-?mailing)\b/.test(body)) return true;
  // 3a) "don't" / "do not" is only a stop instruction when a contact VERB follows it directly.
  //     Allowing 24 characters of slack matched "I don't have your email address, can you send
  //     it?" — a borrower ASKING to be emailed, read as a demand never to be.
  if (/\b(?:don'?t|do not|never)\s+(?:ever\s+|any\s+more\s+|again\s+)?(?:call|text|e-?mail|contact|message|phone|reach out)\b/.test(body)) return true;
  // 3b) The formal register — "I no longer wish to receive these emails" — which the verb list
  //     above misses entirely.
  if (/\b(?:no longer wish|do not wish|don'?t wish|no longer want|do not want|don'?t want)\b[^.!?]{0,30}\b(?:receive|contact|contacted|e-?mail|text|call|hear)\b/.test(body)) return true;
  // 3c) "not interested" paired with a stop/remove is a complete revocation in practice.
  if (/\bnot interested\b/.test(body) && /\b(?:stop|remove|unsubscribe|no more)\b/.test(body)) return true;
  // 4) Removal from a LIST — not from anything else. The old bare `remove me` / `take me` also
  //    matched "remove me as authorized user on the card" and "take me to the closing table".
  if (/\b(?:remove|take)\s+me\s+(?:from|off)\b/.test(body)) return true;
  if (/\b(?:remove|delete)\s+my\s+(?:e-?mail|number|phone|info|information|details)\b/.test(body)) return true;
  if (/\bno more (?:texts?|messages?|calls?|e-?mails?)\b/.test(body) || /\bleave me alone\b/.test(body)) return true;
  // 5) A leading, standalone "stop" command (but not "stop by ...").
  if (/^stop\b/.test(t) && !/^stop by\b/.test(t)) return true;
  return false;
}
