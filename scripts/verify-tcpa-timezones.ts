// THE SMS GATE AND THE DIALER MUST AGREE ABOUT WHAT TIME IT IS WHERE THE BORROWER IS.
//
// 47 C.F.R. §64.1200(c)(1) is keyed to the CALLED PARTY'S local time: no solicitation before
// 8:00 a.m. or after 9:00 p.m. there. Damages are statutory and per message, and Ramon is the
// NMLS licensee whose name is on it. So "which time zone is this number in" is a compliance
// answer, not a convenience.
//
// WHAT WENT WRONG, 2026-10-15. lib/quietHours.ts and lib/callingHours.ts each carried a private
// copy of the NANP area-code table. Diffing the two through their own exported resolvers across
// area codes 200–999 found 4 outright disagreements and 24 codes present in only one table:
//
//   219 Gary/Hammond IN    SMS Eastern   / voice Central   → SMS released at 7:00 a.m. local
//   364 western KY         SMS Central   / voice Eastern   → dialer opened at 7:00 a.m. local
//   432 Midland/Odessa TX  SMS Mountain  / voice Central   → SMS sent at 8:59 p.m. local
//   463 Indianapolis IN    SMS Eastern   / voice Central   → dialer ran to 9:59 p.m. local
//   502 Louisville KY      absent in SMS / voice Central   → dialer ran to 9:59 p.m. local
//
// And quietHours resolved the STATE before the AREA CODE, so the split-state corrections its own
// comment advertised ("FL panhandle, west TX, western KY/TN") were unreachable for any lead that
// carried a state — which lib/notify/leadResponder.ts passes on every send.
//
// WHAT THIS GUARD HOLDS. Everything below is a DECISION at a pinned instant, not a grep for a
// string. The expected zone for every disputed and every split area code is written out here
// from county geography, independently of the table being tested — so if someone edits
// lib/usTimeZones.ts to say Louisville is Central again, these go red rather than agreeing with
// the new mistake.
//
//   npx tsx scripts/verify-tcpa-timezones.ts
import { readFileSync } from "fs";
import {
  AREA_TZ, AREA_TZ_SPLIT, AREA_TZ_DUPLICATES, STATE_TZ, zonesForPhone, hourIn,
} from "../lib/usTimeZones";
import { quietHoursFor, zonesFor, QUIET_START_HOUR, QUIET_END_HOUR } from "../lib/quietHours";
import { withinCallingHours, CALL_START_HOUR, CALL_END_HOUR } from "../lib/callingHours";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
/** Assert on CODE, not on the comments that describe the defect. */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// IANA zone names written literally, so the fixture below does not borrow the module's own idea
// of which constant is which.
const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver",
  AZ = "America/Phoenix", PT = "America/Los_Angeles", AK = "America/Anchorage", HT = "Pacific/Honolulu";
const ZONES = [ET, CT, MT, AZ, PT, AK, HT, "America/Puerto_Rico"];

// Pinned instants. January 2026 is US standard time (DST runs Mar 8 – Nov 1 2026); July is DST.
// Local hours are written out so a reader can check the arithmetic without running anything.
const T = (iso: string) => new Date(iso);
const W_0759 = T("2026-01-15T12:59:00Z");   // ET 07:59  CT 06:59  MT 05:59  PT 04:59
const W_0800 = T("2026-01-15T13:00:00Z");   // ET 08:00  CT 07:00  MT 06:00  PT 05:00
const W_0900 = T("2026-01-15T14:00:00Z");   // ET 09:00  CT 08:00  MT 07:00  PT 06:00
const W_0930 = T("2026-01-15T14:30:00Z");   // ET 09:30  CT 08:30  MT 07:30  AZ 07:30  PT 06:30
const W_1000 = T("2026-01-15T15:00:00Z");   // ET 10:00  CT 09:00  MT 08:00  PT 07:00
const W_1100 = T("2026-01-15T16:00:00Z");   // ET 11:00  CT 10:00  MT 09:00  PT 08:00
const W_1130 = T("2026-01-15T16:30:00Z");   // ET 11:30  CT 10:30  MT 09:30  PT 08:30
const W_1230 = T("2026-01-15T17:30:00Z");   // ET 12:30  CT 11:30  MT 10:30  PT 09:30
const W_1900 = T("2026-01-16T00:00:00Z");   // ET 19:00  CT 18:00  MT 17:00  PT 16:00
const W_1959 = T("2026-01-16T00:59:00Z");   // ET 19:59  CT 18:59  MT 17:59  PT 16:59
const W_2000 = T("2026-01-16T01:00:00Z");   // ET 20:00  CT 19:00  MT 18:00  PT 17:00
const W_2030 = T("2026-01-16T01:30:00Z");   // ET 20:30  CT 19:30  MT 18:30  AZ 18:30  PT 17:30
const W_2059 = T("2026-01-16T01:59:00Z");   // ET 20:59  CT 19:59  MT 18:59  PT 17:59
const W_2100 = T("2026-01-16T02:00:00Z");   // ET 21:00  CT 20:00  MT 19:00  PT 18:00
const W_2130 = T("2026-01-16T02:30:00Z");   // ET 21:30  CT 20:30  MT 19:30  PT 18:30
const S_AZ18 = T("2026-07-16T01:00:00Z");   // AZ 18:00  MT 19:00  (summer: AZ keeps MST, MT is MDT)
const S_AZ19 = T("2026-07-16T02:00:00Z");   // AZ 19:00  MT 20:00

const ph = (ac: string) => `${ac}5550123`;
const quiet = (ac: string | null, st: string | null, at: Date) => quietHoursFor(ac ? ph(ac) : null, st, at).quiet;
const dial = (ac: string | null, at: Date, extra: { zip?: string; state?: string } = {}) =>
  withinCallingHours({ phone: ac ? ph(ac) : null, ...extra }, at);

console.log("\nTCPA TIME ZONES — one table, and both gates read it\n");

// ── 1. THE ZONE OF EVERY DISPUTED AND EVERY SPLIT AREA CODE, FROM GEOGRAPHY ──────────────────
// Each line is a county fact, not a copy of the table. A split code lists EVERY zone inside it;
// the gates must hold the window in all of them, because the phone number alone cannot say which
// half of the territory the borrower is in.
console.log("  -- the area code resolves to the zone its counties actually observe --");
const EXPECT: Array<[string, string[], string]> = [
  // the five that the two tables fought over
  ["219", [CT],     "Gary / Hammond — Lake, Porter, LaPorte, Newton, Jasper counties IN are Central"],
  ["364", [CT],     "overlay of 270: Paducah, Owensboro, Bowling Green KY are Central"],
  ["432", [CT],     "Midland, Odessa, Van Horn TX are Central; TX Mountain is El Paso + Hudspeth only"],
  ["463", [ET],     "overlay of 317: Indianapolis is Eastern"],
  ["502", [ET],     "Louisville KY is Eastern"],
  // the rest of the split-state corrections the old resolution order could never reach
  ["270", [CT],     "western KY is Central"],
  ["606", [ET],     "eastern KY (Ashland, Somerset, Pikeville) is Eastern"],
  ["915", [MT],     "El Paso TX is Mountain"],
  ["423", [ET],     "Chattanooga / Tri-Cities TN is Eastern"],
  ["865", [ET],     "Knoxville TN is Eastern"],
  ["901", [CT],     "Memphis TN is Central"],
  ["615", [CT],     "Nashville TN is Central"],
  ["317", [ET],     "Indianapolis is Eastern"],
  ["574", [ET],     "South Bend / Elkhart IN is Eastern"],
  ["260", [ET],     "Fort Wayne IN is Eastern"],
  // area codes that straddle a zone line — every zone they contain
  ["850", [CT, ET], "FL panhandle: Pensacola / Panama City Central, Tallahassee Eastern"],
  ["448", [ET, CT], "overlay on 850 — same panhandle split"],
  ["208", [MT, PT], "Idaho: Boise Mountain, the panhandle (Coeur d'Alene, Lewiston) Pacific"],
  ["986", [MT, PT], "overlay on 208 — same Idaho split"],
  ["906", [ET, CT], "Michigan UP: Gogebic, Iron, Dickinson, Menominee counties are Central"],
  ["812", [ET, CT], "southern IN: Evansville / Vanderburgh and neighbours are Central"],
  ["930", [ET, CT], "overlay on 812 — same southern Indiana split"],
  ["701", [CT, MT], "North Dakota: the southwest (Dickinson, Bowman) is Mountain"],
  ["605", [CT, MT], "South Dakota: west river (Rapid City, Black Hills) is Mountain"],
  ["308", [CT, MT], "Nebraska: Grand Island / Kearney Central, the Panhandle Mountain"],
  ["928", [AZ, MT], "Arizona: the Navajo Nation observes DST, the rest of the state does not"],
  // ordinary metros — these must NOT be narrowed, or the guard is costing real sending hours
  ["212", [ET],     "New York NY"],
  ["305", [ET],     "Miami FL"],
  ["404", [ET],     "Atlanta GA"],
  ["313", [ET],     "Detroit MI"],
  ["312", [CT],     "Chicago IL"],
  ["214", [CT],     "Dallas TX"],
  ["713", [CT],     "Houston TX"],
  ["612", [CT],     "Minneapolis MN"],
  ["504", [CT],     "New Orleans LA"],
  ["402", [CT],     "Omaha NE"],
  ["303", [MT],     "Denver CO"],
  ["801", [MT],     "Salt Lake City UT"],
  ["505", [MT],     "Albuquerque NM"],
  ["602", [AZ],     "Phoenix AZ"],
  ["213", [PT],     "Los Angeles CA"],
  ["415", [PT],     "San Francisco CA"],
  ["206", [PT],     "Seattle WA"],
  ["702", [PT],     "Las Vegas NV"],
  ["541", [PT],     "Eugene / Bend OR"],
  ["907", [AK],     "Alaska"],
  ["808", [HT],     "Hawaii"],
];
for (const [ac, want, why] of EXPECT) {
  const got = zonesForPhone(ph(ac));
  chk(got.length === want.length && want.every((z, i) => got[i] === z),
    `${ac} → ${want.map((z) => z.split("/")[1]).join(" + ")} — ${why}${got.join("+") === want.join("+") ? "" : `  [GOT ${got.join(" + ") || "UNMAPPED"}]`}`);
}
// 456 is a carrier-selection prefix and 483 is not an assigned geography. callingHours mapped
// them Eastern and Central — a guess dressed as a fact. Unmapped is the honest answer.
for (const junk of ["456", "483"]) chk(zonesForPhone(ph(junk)).length === 0, `${junk} is not a geographic area code and stays UNMAPPED`);

// ── 2. (A) THE STATE NO LONGER OUTRANKS THE AREA CODE ───────────────────────────────────────
// These four are the actual historical sends. Each pair proves the window MOVED: the first line
// is the instant the old resolution order released the message, the second is the instant the
// recipient's own clock reaches 8:00 a.m. (or has not yet passed 8:00 p.m.).
console.log("\n  -- a state that disagrees with the area code narrows the window, it does not win --");
chk(quiet("850", "FL", W_0800) === true,  "850 Pensacola + state FL held at 08:00 Eastern — it is 07:00 for the recipient");
chk(quiet("850", "FL", W_0900) === false, "…and released at 08:00 Central, when the recipient's own clock says 8am");
chk(quiet("915", "TX", W_0900) === true,  "915 El Paso + state TX held at 08:00 Central — it is 07:00 for the recipient");
chk(quiet("915", "TX", W_1000) === false, "…and released at 08:00 Mountain");
chk(quiet("270", "KY", W_0800) === true,  "270 Paducah + state KY held at 08:00 Eastern — it is 07:00 for the recipient");
chk(quiet("270", "KY", W_0900) === false, "…and released at 08:00 Central");
chk(quiet("423", "TN", W_2000) === true,  "423 Chattanooga + state TN held at 19:00 Central — it is 20:00 for the recipient");
chk(quiet("423", "TN", W_1900) === false, "…and still open an hour earlier, at 19:00 Eastern");
// The reported zone has to be the one doing the HOLDING, or the LO reads "it is 09:00 for the
// recipient" beside a refusal and files a bug against the gate.
chk(quietHoursFor(ph("850"), "FL", W_0800).tz === CT, "the refusal names the zone that is actually blocking (Chicago, not the state's New_York)");
chk(quietHoursFor(ph("850"), "FL", W_0800).localHour === 7, "…and the hour it reports is the recipient's 07:00, not ours");
chk(quietHoursFor(ph("850"), "FL", W_0800).basis === "state+area_code", "…and the basis says both signals were read");

// Pure logic, no table content: a cross-country conflict must be held at BOTH ends of the day.
console.log("\n  -- a ported number (area code and state on opposite coasts) is held at both ends --");
chk(quiet("212", "CA", W_0800) === true,  "212 number + state CA held at 08:00 Eastern — 05:00 in California");
chk(quiet("212", "CA", W_1100) === false, "…released at 08:00 Pacific");
chk(quiet("212", "CA", W_2000) === true,  "…and held again at 20:00 Eastern even though California is at 17:00");
chk(quiet("213", "NY", W_1000) === true,  "213 number + state NY held at 07:00 Pacific");
chk(quiet("213", "NY", W_1100) === false, "…released at 08:00 Pacific");
chk(quiet("213", "NY", W_2000) === true,  "…and held at 20:00 Eastern, the earlier of the two ceilings");

// ── 3. (B) 219 — ONE ANSWER, AND BOTH GATES GIVE IT ─────────────────────────────────────────
console.log("\n  -- 219 Gary/Hammond is Central on BOTH gates --");
chk(quiet("219", "IN", W_0800) === true,  "SMS to 219 + state IN held at 08:00 Eastern — Lake County is at 07:00");
chk(quiet("219", "IN", W_0900) === false, "…and released at 08:00 Central");
chk(quiet("219", null, W_0800) === true,  "and with no state on the lead at all, still held at 07:00 Central");
chk(dial("219", W_0800) === false,        "the dialer refuses 219 at 07:00 Central");
chk(dial("219", W_0900) === true,         "…and places the call at 08:00 Central");

// ── 4. (C) 502 AND 463 — EASTERN, SO THE DIALER STOPS AN HOUR EARLIER ───────────────────────
console.log("\n  -- 502 Louisville and 463 Indianapolis are Eastern, so 9pm means 9pm there --");
chk(dial("502", W_2130) === false, "no AI outbound call to 502 at 21:30 Eastern (Central would have allowed it: 20:30)");
chk(dial("502", W_2059) === true,  "…and 20:59 Eastern is still a legal dial — the gate does not over-block");
chk(dial("502", W_2130, { state: "KY" }) === false, "and state KY cannot re-open it");
chk(dial("463", W_2130) === false, "no call to 463 at 21:30 Eastern");
chk(dial("463", W_2059) === true,  "…and 20:59 Eastern still dials");
chk(dial("364", W_0800) === false, "no call to 364 western KY at 07:00 Central (Eastern would have allowed it: 08:00)");
chk(dial("364", W_0900) === true,  "…and 08:00 Central dials");
chk(quiet("432", "TX", W_2130) === true,  "no SMS to 432 Midland at 20:30 Central (Mountain would have allowed it: 19:30)");
chk(quiet("432", "TX", W_1959) === false, "…and 18:59 Central is well inside the window");

// ── 5. SPLIT AREA CODES — THE INTERSECTION, AT BOTH ENDS ────────────────────────────────────
console.log("\n  -- an area code that straddles a zone line holds the window in every zone it contains --");
chk(quiet("850", null, W_0800) === true,  "850 held at 07:00 Central (Pensacola half)");
chk(quiet("850", null, W_0900) === false, "…open at 08:00 Central / 09:00 Eastern");
chk(quiet("850", null, W_2000) === true,  "…and closed again at 20:00 Eastern (Tallahassee half), not 20:00 Central");
chk(quiet("208", null, W_1000) === true,  "208 held at 07:00 Pacific (Coeur d'Alene) though Boise is already at 08:00");
chk(quiet("208", null, W_1100) === false, "…open at 08:00 Pacific");
chk(quiet("906", null, W_0800) === true,  "906 held at 07:00 Central (Menominee) though the rest of the UP is at 08:00");
chk(quiet("308", null, W_0900) === true,  "308 held at 07:00 Mountain (Scottsbluff) though Grand Island is at 08:00");
chk(quiet("308", null, W_1000) === false, "…open at 08:00 Mountain");
chk(quiet("928", null, S_AZ19) === true,  "928 held at 19:00 Phoenix in July — the Navajo Nation is already at 20:00");
chk(quiet("928", null, S_AZ18) === false, "…and 18:00 Phoenix / 19:00 on the reservation is still open");
// A ZIP is the one signal precise enough to resolve a split, so it must still be consulted.
chk(dial("850", W_0800, { zip: "32501" }) === false, "a Pensacola ZIP on an 850 number is refused at 07:00 Central");
chk(dial("212", W_1000, { zip: "79901" }) === true,  "an El Paso ZIP (Mountain) on a 212 number dials at 08:00 Mountain / 10:00 Eastern");
chk(dial("212", W_0900, { zip: "79901" }) === false, "…and is refused at 07:00 Mountain even though New York is at 09:00");

// ── 6. THE STATUTORY EDGES. These pin the constants to a behaviour, not to a number literal. ─
console.log("\n  -- the edges of the window --");
chk(quiet("212", "NY", W_0759) === true,  `SMS held at 07:59 local (floor is ${QUIET_START_HOUR}:00)`);
chk(quiet("212", "NY", W_0800) === false, "SMS released exactly at 08:00 local");
chk(quiet("212", "NY", W_1959) === false, "SMS still allowed at 19:59 local");
chk(quiet("212", "NY", W_2000) === true,  `SMS held from 20:00 local (FL-safe ceiling is ${QUIET_END_HOUR}:00)`);
chk(dial("212", W_0759) === false,        `dialer refuses 07:59 local (floor is ${CALL_START_HOUR}:00)`);
chk(dial("212", W_0800) === true,         "dialer places a call at 08:00 local");
chk(dial("212", W_2059) === true,         "dialer still allowed at 20:59 local");
chk(dial("212", W_2100) === false,        `dialer refuses 21:00 local (federal ceiling is ${CALL_END_HOUR}:00)`);
chk(QUIET_END_HOUR < CALL_END_HOUR, "the SMS ceiling is stricter than the voice ceiling (FL FTSA 8pm vs federal 9pm)");

// ── 7. NOTHING TO GO ON. Unknown must mean the window that is safe everywhere in CONUS. ─────
console.log("\n  -- an unmapped number with no state falls back, and the fallback is narrow --");
chk(quiet("456", null, W_0930) === true,  "SMS held at 09:30 Eastern — it is 06:30 in California");
chk(quiet("456", null, W_1230) === false, "…released at 12:30 Eastern, inside 8am–8pm in every CONUS zone");
chk(quiet("456", null, W_2000) === true,  "…and held again at 20:00 Eastern");
chk(dial("456", W_1130) === false,        "dialer refuses an unmapped number at 11:30 Eastern");
chk(dial("456", W_1230) === true,         "…and dials at 12:30 Eastern");
chk(quiet(null, null, W_0930) === true,   "no phone and no state is not a licence to send");

// ── 8. THE TABLE ITSELF — the invariants that let the fixture above stand for all 349 codes ──
console.log("\n  -- the shared table is internally sound --");
chk(AREA_TZ_DUPLICATES.length === 0,
  `no area code is listed twice${AREA_TZ_DUPLICATES.length ? ` — ${AREA_TZ_DUPLICATES.join("; ")}` : ""}`);
// A canary against the table being gutted, with headroom: unassigned codes get retired and new
// overlays get added, so this is deliberately well below the 349 in the table today.
chk(Object.keys(AREA_TZ).length >= 300, `the table still covers the country (${Object.keys(AREA_TZ).length} area codes)`);
const unknownZone = Object.entries(AREA_TZ).filter(([, z]) => !ZONES.includes(z)).map(([a, z]) => `${a}=${z}`);
chk(unknownZone.length === 0, `every area code maps to a known US zone${unknownZone.length ? ` — ${unknownZone.join(" ")}` : ""}`);
const badState = Object.entries(STATE_TZ).filter(([, z]) => !ZONES.includes(z)).map(([s]) => s);
chk(badState.length === 0, `every state maps to a known US zone${badState.length ? ` — ${badState.join(" ")}` : ""}`);
const splitProblems: string[] = [];
for (const [ac, zs] of Object.entries(AREA_TZ_SPLIT)) {
  if (!AREA_TZ[ac]) splitProblems.push(`${ac} is split but absent from AREA_TZ`);
  else if (zs[0] !== AREA_TZ[ac]) splitProblems.push(`${ac} split lists ${zs[0]} first but AREA_TZ says ${AREA_TZ[ac]}`);
  if (new Set(zs).size < 2) splitProblems.push(`${ac} is declared split but names ${new Set(zs).size} zone(s)`);
  for (const z of zs) if (!ZONES.includes(z)) splitProblems.push(`${ac} names unknown zone ${z}`);
}
chk(splitProblems.length === 0, `every split area code is consistent with the primary table${splitProblems.length ? ` — ${splitProblems.join("; ")}` : ""}`);
// Every zone name has to be one Intl will actually accept. A typo here throws inside sendSms.
let resolves = 0;
for (const z of ZONES) { try { hourIn(z, W_0930); resolves++; } catch { /* counted by the check below */ } }
chk(resolves === ZONES.length, `all ${ZONES.length} zone names resolve in Intl (a typo would throw inside sendSms)`);

// ── 9. ONE TABLE. Neither gate may grow a private copy again. ───────────────────────────────
// Source-shaped, so it is paired with the behavioural sweep in §10: the absence of a local table
// is only meaningful because the two gates demonstrably move together.
console.log("\n  -- neither gate carries its own copy of the table --");
for (const f of ["lib/quietHours.ts", "lib/callingHours.ts"]) {
  const src = code(f);
  chk(!/(?:const|let|var)\s+\w*AREA_TZ\w*\s*[:=]/.test(src), `${f} declares no area-code table of its own`);
  chk(!/TZ_GROUPS/.test(src), `${f} has no TZ_GROUPS block`);
  // The `x` suffix trick — "364x" in one list expecting a later list to overwrite it — is what
  // shipped Eastern for Paducah. Ordering must never decide a zone again.
  chk(!/"\d{3}x"/.test(src), `${f} has no order-dependent "NNNx" overrides`);
}
chk(!/"\d{3}x"/.test(code("lib/usTimeZones.ts")), "and neither does the shared table");

// ── 10. THE SWEEP. Two properties over EVERY area code, neither of them a self-comparison. ──
// (a) MONOTONICITY — adding the lead's state can only ever narrow the window. This is the exact
//     property the old "state wins" resolution order violated: 850+FL sent at 07:00 local while
//     850 alone would have held it. If anyone reinstates a priority order, this goes red for
//     hundreds of codes at once.
// (b) CONTAINMENT — the SMS window (8am–8pm) sits inside the dialer's (8am–9pm). If the two
//     modules ever read different tables again, there will be an area code where SMS releases a
//     message and the dialer refuses a call at the same instant.
console.log("\n  -- every area code in the table, swept --");
const codes = Object.keys(AREA_TZ);
const INSTANTS = [W_0800, W_0900, W_1000, W_1900, W_2000, W_2130];
const STATES = ["CA", "NY", "TX", "FL", "ID"];
let monoBreaks = 0, containBreaks = 0, pairs = 0, swept = 0;
const firstMono: string[] = [], firstContain: string[] = [];
for (const ac of codes) {
  const p = ph(ac);
  for (const at of INSTANTS) {
    const qPhoneOnly = quietHoursFor(p, null, at).quiet;
    const callable = withinCallingHours({ phone: p }, at);
    swept++;
    if (!qPhoneOnly && !callable) { containBreaks++; if (firstContain.length < 5) firstContain.push(`${ac} @ ${at.toISOString()}`); }
    for (const st of STATES) {
      pairs++;
      if (qPhoneOnly && !quietHoursFor(p, st, at).quiet) {
        monoBreaks++;
        if (firstMono.length < 5) firstMono.push(`${ac}+${st} @ ${at.toISOString()}`);
      }
    }
  }
}
// A sweep that passes on an empty set is the vacuous shape this repo has already been burned by.
chk(swept === codes.length * INSTANTS.length && codes.length > 300, `the sweep actually ran — ${swept} decisions over ${codes.length} area codes`);
chk(monoBreaks === 0,
  `adding a state never WIDENS the window, over ${pairs} area-code × state × instant pairs${monoBreaks ? ` — e.g. ${firstMono.join(", ")}` : ""}`);
chk(containBreaks === 0,
  `the SMS window sits inside the dialer's for every area code${containBreaks ? ` — e.g. ${firstContain.join(", ")}` : ""}`);
// And the two gates must be reading the SAME zones, not merely compatible ones.
let zoneMismatch = 0;
for (const ac of codes) {
  const a = zonesFor(ph(ac), null).zones.join("+"), b = zonesForPhone(ph(ac)).join("+");
  if (a !== b) zoneMismatch++;
}
chk(zoneMismatch === 0, `the SMS gate resolves the same zone set as the shared table for all ${codes.length} codes`);

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). A text or a call outside 8am–9pm RECIPIENT-local is statutory damages per message, and the two gates disagreeing means one of them is already doing it.\n`);
  process.exit(1);
}
console.log(`PASS — one table, ${codes.length} area codes, both gates agree, and every disputed code resolves to the zone its counties observe.\n`);
