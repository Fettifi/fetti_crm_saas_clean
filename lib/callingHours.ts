// TCPA calling hours = 8am–9pm in the CALLED party's LOCAL time. We resolve that
// timezone at SUB-STATE precision so, e.g., a Florida-Panhandle number (850, Central)
// is never dialed on Miami's (Eastern) clock.
//
// Signal priority: (1) borrower ZIP when we have it (most precise for residence),
// (2) the PHONE'S area code (the line we're actually dialing — sub-state accurate and
// always present for a call), (3) the state, (4) a continental-US-safe fallback window.
//
// Any unmapped value falls through to the next signal, and finally to a conservative
// window that is inside 8am–9pm across every CONUS zone — so a gap can never cause a
// too-early/too-late call.
//
// THE AREA-CODE TABLE NO LONGER LIVES HERE. Until 2026-10-15 this module and lib/quietHours.ts
// each kept a private copy, and a diff of the two through their own resolvers (zoneFor /
// borrowerTz, area codes 200–999) found 4 outright disagreements and 24 codes present in only
// one table. Two of the disagreements were this file's:
//
//   502  Louisville KY       mapped CENTRAL here. Louisville is EASTERN, so the dialer would
//                            place an AI outbound call at 20:59 Central = 21:59 recipient-local.
//   463  Indianapolis IN     mapped CENTRAL here. Indianapolis is EASTERN — same 9:59pm call.
//   364  western KY          mapped EASTERN here, written as "364x" in the Eastern list on the
//                            assumption a later Central entry would overwrite it. There was no
//                            later entry, so last-one-wins shipped Eastern for Paducah and
//                            Owensboro and the dialer opened at 08:00 ET = 07:00 local.
//
// Both modules now read lib/usTimeZones.ts, and scripts/verify-tcpa-timezones.ts fails the
// commit if a second table reappears or if the two gates ever answer differently about the
// same area code.

import {
  ET, CT, MT, PT, STATE_TZ, hourIn, zoneForState, zonesForPhone, withinWindowEverywhere,
} from "@/lib/usTimeZones";

export { STATE_TZ };

export const CALL_START_HOUR = 8;   // inclusive — 47 C.F.R. §64.1200(c)(1)
export const CALL_END_HOUR = 21;    // exclusive — last dial at 20:59 recipient-local

// Small ZIP3 (first three digits) → timezone map, ONLY for regions whose zone differs
// from their state's majority — used when we actually have a borrower ZIP. This is the one
// signal precise enough to resolve a split area code, so it stays sub-state and stays here.
const ZIP3_TZ: Record<string, string> = {
  // FL Panhandle (Central): Panama City / Pensacola
  "324": CT, "325": CT,
  // TX El Paso (Mountain)
  "798": MT, "799": MT, "885": MT,
  // W Kansas / W Nebraska (Mountain)
  "677": MT, "679": MT, "691": MT, "693": MT,
  // W North Dakota / W South Dakota (Mountain)
  "577": MT, "586": MT,
  // N Idaho panhandle (Pacific)
  "838": PT,
  // TN Eastern (Knoxville / Chattanooga / Tri-Cities)
  "373": ET, "374": ET, "377": ET, "378": ET, "379": ET,
  // W Kentucky (Central). 426 is Bowling Green — it was missing, and with no phone on the record
  // a Bowling Green ZIP fell through to state KY = Eastern, which opens the dialer at 07:00 local.
  "420": CT, "421": CT, "422": CT, "423": CT, "424": CT, "425": CT, "426": CT, "427": CT,
  // NW + SW Indiana (Central)
  "463": CT, "464": CT, "476": CT, "477": CT,
};

function zipTz(zip?: string | null): string | null {
  const z = String(zip || "").replace(/\D/g, "");
  return z.length >= 3 ? (ZIP3_TZ[z.slice(0, 3)] || null) : null;
}
function areaTz(phone?: string | null): string | null {
  return zonesForPhone(phone)[0] || null;
}
function stateTz(state?: string | null): string | null {
  return zoneForState(state);
}

/** Best single timezone estimate (ZIP → phone area code → state) for display/logging. */
export function borrowerTz(opts: { zip?: string | null; phone?: string | null; state?: string | null }): string | null {
  return zipTz(opts.zip) || areaTz(opts.phone) || stateTz(opts.state) || null;
}

/** TCPA-safe calling-hours check. It must be 8am–9pm in EVERY location signal we have —
 *  the borrower ZIP AND every zone the phone's area code touches. Requiring them to agree means
 *  a ported number, an out-of-area investment property, or an area code that straddles a zone
 *  line (850 covers Pensacola AND Tallahassee) can only NARROW the window, never cause a
 *  too-early/too-late call. With no usable signal, fall back to a window that's inside
 *  8am–9pm across the entire continental US (12:00–20:00 ET = 9am–5pm PT).
 *
 *  `at` exists so a guard can pin the instant. Before it was a parameter this gate could only be
 *  tested at whatever time the test happened to run, which is how 502 sat mapped to Central: the
 *  only input that distinguishes Louisville-Eastern from Louisville-Central is a 9pm clock. */
export function withinCallingHours(
  opts: { zip?: string | null; phone?: string | null; state?: string | null },
  at: Date = new Date(),
): boolean {
  const zones: string[] = [];
  const zip = zipTz(opts.zip);
  // A split area code contributes EVERY zone it contains, not just its primary — see
  // AREA_TZ_SPLIT in lib/usTimeZones.ts. The old table picked one and was wrong for the rest of
  // the territory; this holds the window in all of them.
  for (const z of [...(zip ? [zip] : []), ...zonesForPhone(opts.phone)]) if (!zones.includes(z)) zones.push(z);
  if (!zones.length) { const st = stateTz(opts.state); if (st) zones.push(st); }
  if (!zones.length) { const et = hourIn(ET, at); return et >= 12 && et < 20; }
  return withinWindowEverywhere(zones, CALL_START_HOUR, CALL_END_HOUR, at);
}
