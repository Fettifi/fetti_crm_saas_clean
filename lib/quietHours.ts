// TCPA QUIET HOURS — 47 C.F.R. §64.1200(c)(1): no telephone solicitation to a residential
// subscriber before 8:00 a.m. or after 9:00 p.m. AT THE CALLED PARTY'S LOCAL TIME. Several
// states are stricter (FL is 8am–8pm, and Florida's FTSA is aggressively litigated), so the
// window here is deliberately 8am–8pm everywhere — the tighter of the two, applied nationally
// rather than per state, because a number can be anywhere.
//
// THE RECIPIENT'S LOCAL TIME IS NOT ONE SIGNAL, IT IS THE INTERSECTION OF ALL OF THEM.
//
// Until 2026-10-15 zoneFor() returned on the STATE as soon as it recognised one, and only fell
// through to the phone's area code when the state was missing or unrecognised. The area-code
// table exists precisely to correct split states — this module's own comment named "FL panhandle,
// west TX, western KY/TN" — so for every lead that carried a state (lib/notify/leadResponder.ts
// passes `state: l.state` on every send) those corrections were unreachable code. Measured
// against the table as it then stood:
//
//   850 Pensacola  + state FL → Eastern.  SMS released at 08:00 Eastern = 07:00 for the recipient.
//   915 El Paso    + state TX → Central.  Released at 08:00 Central  = 07:00 for the recipient.
//   270 Paducah    + state KY → Eastern.  Released at 08:00 Eastern  = 07:00 for the recipient.
//   423 Chattanooga+ state TN → Central.  Last send 19:59 Central    = 20:59 for the recipient.
//
// Three of those are sends an hour before the federal floor and the fourth is an hour past the
// Florida-safe ceiling, every one of them from a table written to prevent exactly that.
//
// Reversing the priority to "area code first" only moves the error: a borrower who moved from
// Chicago to Phoenix keeps her 312 number. So BOTH signals are now resolved and the window must
// hold in EVERY zone either of them points at, which is what the state-vs-area-code conflict
// actually tells us — that we do not know which, and a narrower window is the only safe reading
// of "we do not know". An area code that straddles a zone boundary (850, 208, 906 …) contributes
// every zone it contains; see lib/usTimeZones.ts.
//
// Falling back when we have nothing:
//   UNKNOWN → the conservative intersection: only send when it is inside the window in EVERY
//   continental US zone (i.e. 11:00–20:00 Eastern). Never guess in our favour.
//
// This is enforced centrally in sendSms() so no future call site can forget it. Internal
// owner alerts do NOT go through sendSms (they build their own Twilio request), so paging
// Ramon at 2am about a hot lead still works.

import { ET, hourIn, zoneForState, zonesForPhone, zoneOutsideWindow } from "@/lib/usTimeZones";

export const QUIET_START_HOUR = 8;   // inclusive — sending allowed from 08:00 local
export const QUIET_END_HOUR = 20;    // exclusive — last send at 19:59 local (8pm, FL-safe)

export { hourIn };

export type QuietVerdict = {
  quiet: boolean;
  localHour: number | null;   // null when the zone is unknown (conservative path)
  tz: string | null;
  basis: "state" | "area_code" | "state+area_code" | "unknown_conservative";
};

/**
 * Every zone this recipient could plausibly be in, from the state they told us AND from the
 * area code of the number we are about to text. `primary` is the single best guess for display;
 * the VERDICT is never taken from it alone.
 */
export function zonesFor(phone?: string | null, state?: string | null): {
  zones: string[]; primary: string | null; basis: QuietVerdict["basis"];
} {
  const st = zoneForState(state);
  const area = zonesForPhone(phone);
  const zones: string[] = [];
  for (const z of [...area, ...(st ? [st] : [])]) if (!zones.includes(z)) zones.push(z);
  const basis: QuietVerdict["basis"] = st && area.length ? "state+area_code"
    : area.length ? "area_code"
    : st ? "state"
    : "unknown_conservative";
  // The area code is the more precise of the two (sub-state), so it leads the display.
  return { zones, primary: area[0] || st || null, basis };
}

/**
 * Single best-guess IANA zone for a recipient — FOR DISPLAY AND LOGGING ONLY. Any send decision
 * has to go through quietHoursFor(), which honours every zone rather than picking one.
 */
export function zoneFor(phone?: string | null, state?: string | null): { tz: string | null; basis: QuietVerdict["basis"] } {
  const { primary, basis } = zonesFor(phone, state);
  return { tz: primary, basis };
}

/**
 * Is it currently QUIET HOURS for this recipient (i.e. must we hold the message)?
 * The window has to hold in every zone the recipient's state or area code points at.
 * With no usable zone we require it to hold in EVERY continental US zone, which
 * means 11:00–19:59 Eastern (08:00 Pacific through 19:59 Eastern).
 */
export function quietHoursFor(phone?: string | null, state?: string | null, at: Date = new Date()): QuietVerdict {
  const { zones, primary, basis } = zonesFor(phone, state);
  if (!zones.length) {
    const et = hourIn(ET, at);
    // Eastern is UTC-5/-4 and Pacific UTC-8/-7 — a fixed 3-hour spread, so the intersection
    // of [8,20) local across the continental zones is [8+3, 20) in Eastern terms.
    const quiet = et < QUIET_START_HOUR + 3 || et >= QUIET_END_HOUR;
    return { quiet, localHour: null, tz: null, basis };
  }
  const blocking = zoneOutsideWindow(zones, QUIET_START_HOUR, QUIET_END_HOUR, at);
  // Report the zone that is actually HOLDING the message, not the primary guess — otherwise the
  // LO reads "it is 09:00 for the recipient" beside a refusal and files a bug against the gate.
  const tz = blocking || primary!;
  return { quiet: blocking !== null, localHour: hourIn(tz, at), tz, basis };
}

/** Human-readable reason for logs and the LO-facing error. */
export function quietReason(v: QuietVerdict): string {
  if (v.tz && v.localHour != null) {
    return `quiet hours — it is ${String(v.localHour).padStart(2, "0")}:00 for the recipient (${v.tz}); TCPA allows ${QUIET_START_HOUR}:00–${QUIET_END_HOUR}:00 local`;
  }
  return `quiet hours — the recipient's time zone is unknown (no state on the lead, unrecognized area code), so sending is held to the window that is safe in every US time zone (11:00–20:00 Eastern)`;
}
