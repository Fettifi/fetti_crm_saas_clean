// ONE TABLE FOR "WHAT TIME IS IT WHERE THIS PERSON IS". Both TCPA gates read it.
//
// WHY THIS FILE EXISTS. lib/quietHours.ts (SMS) and lib/callingHours.ts (AI outbound voice) each
// carried a private copy of the NANP area-code → time-zone map. On 2026-10-15 I diffed the two
// through their OWN exported resolvers (zoneFor / borrowerTz) across area codes 200–999: they
// disagreed about 4 codes and 24 more existed in only one of the two tables.
//
//   219  Gary / Hammond IN   SMS said Eastern    voice said Central
//   364  western KY          SMS said Central    voice said Eastern
//   432  Midland / Odessa TX SMS said Mountain   voice said Central
//   463  Indianapolis IN     SMS said Eastern    voice said Central
//   502  Louisville KY       absent from SMS     voice said Central
//
// A text and a call to the SAME borrower were therefore measured against different legal windows,
// and in every pair one of the two was wrong. 47 C.F.R. §64.1200(c)(1) is keyed to the CALLED
// PARTY'S local time, not to ours, and the damages are statutory and per message. Two tables that
// can drift apart ARE the defect, so there is now one, and scripts/verify-tcpa-timezones.ts fails
// the commit if a second one reappears.
//
// WHICH ZONE IS CORRECT was settled from county facts, not from whichever table looked tidier:
//   219 CENTRAL   — Lake, Porter, LaPorte, Newton and Jasper counties observe Central, unlike
//                   most of Indiana. Mapping them Eastern started SMS at 7:00 a.m. their time.
//   364 CENTRAL   — overlay of 270 (Paducah, Owensboro, Bowling Green); all Central.
//   432 CENTRAL   — Midland, Odessa, Big Spring, Fort Stockton, Van Horn (Culberson Co.) are all
//                   Central. Texas's only Mountain counties are El Paso and Hudspeth, and both
//                   are area code 915, which stays Mountain.
//   463 EASTERN   — overlay of 317 (Indianapolis). Mapping it Central permitted calls to 9:59 p.m.
//   502 EASTERN   — Louisville. Mapping it Central permitted calls to 9:59 p.m.

export const ET = "America/New_York";
export const CT = "America/Chicago";
export const MT = "America/Denver";
export const AZ = "America/Phoenix";       // no DST
export const PT = "America/Los_Angeles";
export const AK = "America/Anchorage";
export const HT = "Pacific/Honolulu";      // no DST

/**
 * State → IANA zone, using the state's DOMINANT zone. A split state is NOT resolved here: the
 * area code below carries the sub-state correction, and callers intersect the two. Widening this
 * map to "every zone Texas touches" would cost every Texas borrower an hour of sending window to
 * protect El Paso, which already has its own area code.
 */
export const STATE_TZ: Record<string, string> = {
  AL: CT, AK: AK, AZ: AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET,
  HI: HT, ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET,
  MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET,
  NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT,
  UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
  PR: "America/Puerto_Rico", VI: "America/Puerto_Rico",
};

// A code that lands in two groups is how 364 went wrong: callingHours wrote it as "364x" in the
// Eastern list expecting a later Central entry to overwrite it, the Central entry was never
// added, and last-one-wins silently shipped Eastern for western Kentucky. Nothing here relies on
// ordering. A repeat is recorded and the guard fails the commit instead.
export const AREA_TZ_DUPLICATES: string[] = [];
const AC = (zone: string, codes: string) =>
  codes.split(/\s+/).filter(Boolean).map((c) => [c, zone] as const);
function build(entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [code, zone] of entries) {
    if (code in out) { AREA_TZ_DUPLICATES.push(`${code} listed twice (${out[code]} then ${zone})`); continue; }
    out[code] = zone;
  }
  return out;
}

/**
 * NANP area code → its PRIMARY zone (the one most of the code's territory observes). For the
 * codes that genuinely straddle a zone boundary, AREA_TZ_SPLIT below lists every zone they
 * contain; resolve through zonesForAreaCode(), never by reading this map directly.
 *
 * 456 and 483 were dropped: 456 is a carrier-selection prefix, not a geographic code, and 483 is
 * not an assigned geography either. callingHours mapped them to Eastern and Central respectively,
 * which is a guess dressed as a fact. Unmapped is the safe answer — the caller then falls back to
 * the state, and failing that to the window that holds in every CONUS zone.
 */
export const AREA_TZ: Record<string, string> = build([
  ...AC(ET, `201 202 203 207 212 215 216 220 223 227 229 231 234 240 248 252 260 267 269 272 276 283 301 302
             304 305 313 315 317 321 326 330 332 336 339 347 351 352 363 380 386 401 404 407 410 412 413 419
             423 434 440 443 445 448 463 470 475 478 484 502 508 513 516 517 518 540 551 561 567 570 571 574
             582 585 586 603 606 607 609 610 614 616 617 631 640 646 656 667 678 679 680 681 689 703 704 706
             716 717 718 724 727 732 734 740 743 754 757 762 765 770 771 772 774 781 786 802 803 804 810 812
             813 814 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 878 904 906 908 910
             912 914 917 919 929 930 934 937 941 943 947 948 954 959 973 978 980 984 989`),
  ...AC(CT, `205 210 214 217 218 219 224 225 228 251 254 256 262 270 274 281 308 309 312 314 316 318 319 320
             325 327 331 334 337 346 361 364 402 405 409 414 417 430 432 447 464 469 479 501 504 507 512 515
             531 534 539 557 563 572 573 580 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682
             701 708 712 713 715 726 730 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872
             901 903 913 918 920 931 936 938 940 945 952 956 972 975 979 985`),
  ...AC(MT, `208 303 307 385 406 435 505 575 719 720 801 915 970 983 986`),
  ...AC(AZ, `480 520 602 623 928`),
  ...AC(PT, `206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 458 503 509 510 530 541 559 562
             564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925
             935 949 951 971`),
  ...AC(AK, `907`),
  ...AC(HT, `808`),
]);

/**
 * Area codes that contain MORE THAN ONE zone. Every zone the code touches is listed, primary
 * first, and a caller must hold its window in ALL of them. That is the only honest answer when
 * the phone number is the sole location signal: 850 covers both Pensacola (Central) and
 * Tallahassee (Eastern), and picking either one is wrong for the other half of the territory.
 *
 * Intersecting can only ever SHORTEN the window, never lengthen it, so an entry added here can
 * cost sending hours but can never produce an illegal send. That asymmetry is why these are
 * listed even where the minority zone is a few counties.
 */
export const AREA_TZ_SPLIT: Record<string, string[]> = {
  // Idaho: the panhandle — Kootenai (Coeur d'Alene), Nez Perce (Lewiston), Latah (Moscow),
  // Bonner, Boundary, Benewah, Shoshone, Clearwater, Lewis — is PACIFIC. Boise, Twin Falls,
  // Pocatello and Idaho Falls are Mountain. Mountain-only started SMS at 7:00 a.m. in Coeur d'Alene.
  "208": [MT, PT], "986": [MT, PT],
  // Michigan's Upper Peninsula: Gogebic, Iron, Dickinson and Menominee counties are CENTRAL.
  "906": [ET, CT],
  // Florida panhandle: Pensacola and Panama City are Central, Tallahassee / Leon County is Eastern.
  // 448 is the overlay on 850 and inherits the same split.
  "850": [CT, ET], "448": [ET, CT],
  // Southern Indiana: Evansville (Vanderburgh), Posey, Gibson, Warrick, Spencer and Perry
  // counties are CENTRAL; the rest of 812 / 930 is Eastern. 930 is the overlay on 812.
  "812": [ET, CT], "930": [ET, CT],
  // North Dakota: the southwest — Stark (Dickinson), Bowman, Slope, Golden Valley, Billings,
  // Adams, Hettinger, Dunn, Grant and Sioux counties — is MOUNTAIN.
  "701": [CT, MT],
  // South Dakota: west river — Rapid City (Pennington) and the Black Hills — is MOUNTAIN.
  "605": [CT, MT],
  // Nebraska: the Panhandle (Scottsbluff, Chadron, Sidney) is MOUNTAIN; Grand Island, Kearney,
  // Hastings and North Platte are CENTRAL. Both tables had this Mountain-only, which permitted a
  // send at 8:00 p.m. Mountain — 9:00 p.m. for the Central majority of the code.
  "308": [CT, MT],
  // Arizona: the Navajo Nation observes daylight saving, the rest of the state does not, so from
  // March to November the reservation is an hour ahead of Phoenix.
  "928": [AZ, MT],
};

// Known splits NOT listed above, decided rather than overlooked: 541/458 (Malheur County, OR is
// Mountain), 574 (Starke and Pulaski counties, IN are Central), 785 (Sherman County, KS) and 620
// (Greeley, Hamilton and Wallace counties, KS) are single rural counties inside area codes that
// otherwise cover Eugene, Bend, South Bend and Wichita. Listing them would cost those metros an
// hour a day; when a borrower's ZIP is on file, lib/callingHours.ts resolves them exactly.

/** The 3-digit area code of a US phone number, or null if it is not a 10-digit NANP number. */
export function areaCodeOf(phone?: string | null): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten.slice(0, 3) : null;
}

/** Every zone an area code touches, primary first. Empty when the code is unknown. */
export function zonesForAreaCode(areaCode?: string | null): string[] {
  const ac = String(areaCode || "");
  if (AREA_TZ_SPLIT[ac]) return AREA_TZ_SPLIT[ac];
  const z = AREA_TZ[ac];
  return z ? [z] : [];
}

/** Every zone a phone number's area code touches, primary first. */
export function zonesForPhone(phone?: string | null): string[] {
  return zonesForAreaCode(areaCodeOf(phone));
}

/** Dominant zone for a 2-letter US state/territory code, or null. */
export function zoneForState(state?: string | null): string | null {
  const s = String(state || "").trim().toUpperCase();
  return s.length === 2 ? (STATE_TZ[s] || null) : null;
}

// Constructing an Intl.DateTimeFormat is the expensive part and the result is stateless per zone,
// so it is built once. A split area code now asks for two or three zones on every send.
const FMT = new Map<string, Intl.DateTimeFormat>();

/** Hour-of-day (0-23) in an IANA zone. Intl handles DST, so this is correct year-round. */
export function hourIn(tz: string, at: Date = new Date()): number {
  let f = FMT.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }); FMT.set(tz, f); }
  const n = parseInt(f.format(at), 10);
  return n === 24 ? 0 : n;   // some ICU builds render midnight as "24"
}

/**
 * Is `at` inside [startHour, endHour) in EVERY one of these zones? Requiring all of them means a
 * ported number, a split area code or an out-of-area investment property can only narrow the
 * window, never open it. An empty zone list returns false — no signal is never a licence to send.
 */
export function withinWindowEverywhere(zones: string[], startHour: number, endHour: number, at: Date = new Date()): boolean {
  if (!zones.length) return false;
  return zones.every((tz) => { const h = hourIn(tz, at); return h >= startHour && h < endHour; });
}

/** The first zone in which `at` falls OUTSIDE the window, or null when every zone is inside it. */
export function zoneOutsideWindow(zones: string[], startHour: number, endHour: number, at: Date = new Date()): string | null {
  for (const tz of zones) { const h = hourIn(tz, at); if (h < startHour || h >= endHour) return tz; }
  return null;
}
