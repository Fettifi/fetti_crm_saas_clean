// TCPA QUIET HOURS — 47 C.F.R. §64.1200(c)(1): no telephone solicitation to a residential
// subscriber before 8:00 a.m. or after 9:00 p.m. AT THE CALLED PARTY'S LOCAL TIME. Several
// states are stricter (FL is 8am–8pm, and Florida's FTSA is aggressively litigated), so the
// default window here is deliberately 8am–8pm — the tighter of the two — and the recipient's
// own state can narrow it further.
//
// The recipient's local time is derived from, in order of confidence:
//   1) their STATE on the lead record (most reliable — it is what they told us), then
//   2) their phone's NANP area code (a mobile can travel, but it is a solid proxy), then
//   3) UNKNOWN → the conservative intersection: only send when it is inside the window in
//      EVERY continental US zone (i.e. 11:00–20:00 Eastern). Never guess in our favour.
//
// This is enforced centrally in sendSms() so no future call site can forget it. Internal
// owner alerts do NOT go through sendSms (they build their own Twilio request), so paging
// Ramon at 2am about a hot lead still works.

export const QUIET_START_HOUR = 8;   // inclusive — sending allowed from 08:00 local
export const QUIET_END_HOUR = 20;    // exclusive — last send at 19:59 local (8pm, FL-safe)

const ET = "America/New_York";

// State → IANA zone. Split states use their DOMINANT zone; the area-code table below
// corrects the notable exceptions (FL panhandle, west TX, western KY/TN).
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: ET, DE: ET, DC: ET,
  FL: ET, GA: ET, HI: "Pacific/Honolulu", ID: "America/Denver", IL: "America/Chicago",
  IN: ET, IA: "America/Chicago", KS: "America/Chicago", KY: ET, LA: "America/Chicago",
  ME: ET, MD: ET, MA: ET, MI: ET, MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles",
  NH: ET, NJ: ET, NM: "America/Denver", NY: ET, NC: ET, ND: "America/Chicago",
  OH: ET, OK: "America/Chicago", OR: "America/Los_Angeles", PA: ET, RI: ET,
  SC: ET, SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: ET, VA: ET, WA: "America/Los_Angeles", WV: ET, WI: "America/Chicago", WY: "America/Denver",
  PR: "America/Puerto_Rico", VI: "America/Puerto_Rico",
};

const AC = (zone: string, codes: string) => codes.split(/\s+/).filter(Boolean).map((c) => [c, zone] as const);
// NANP area code → zone. Ordered so later entries win for the split-state corrections.
const AREA_TZ: Record<string, string> = Object.fromEntries([
  ...AC(ET, `203 475 860 959 302 202 771 305 321 352 386 407 561 689 727 754 772 786 813 863 904 941 954 656 448
             229 404 470 478 678 706 762 770 912 943 219 260 317 463 574 765 812 930 606 859 207 240 301 410 443 667 227
             339 351 413 508 617 774 781 857 978 231 248 269 313 517 586 616 679 734 810 906 947 989 603
             201 551 609 640 732 848 856 862 908 973 212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934
             252 336 704 743 828 910 919 980 984 216 220 234 283 326 330 380 419 440 513 567 614 740 937
             215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 401 803 839 843 854 864 423 865 802
             276 434 540 571 703 757 804 826 948 304 681`),
  ...AC("America/Chicago", `205 251 256 334 659 938 479 501 870 217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872
             319 515 563 641 712 316 620 785 913 225 318 337 504 985 218 320 507 612 651 763 952 228 601 662 769
             314 417 557 573 636 660 816 975 402 531 701 405 539 572 580 918 605
             210 214 254 281 325 346 361 409 430 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979
             262 274 414 534 608 715 920 615 629 731 901 931 270 364 850`),
  ...AC("America/Denver", `303 719 720 970 983 208 986 406 505 575 385 435 801 307 915 432 308`),
  ...AC("America/Phoenix", `480 520 602 623 928`),
  ...AC("America/Los_Angeles", `209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 935 949 951
             702 725 775 458 503 541 971 206 253 360 425 509 564`),
  ...AC("America/Anchorage", `907`),
  ...AC("Pacific/Honolulu", `808`),
]);

export type QuietVerdict = {
  quiet: boolean;
  localHour: number | null;   // null when the zone is unknown (conservative path)
  tz: string | null;
  basis: "state" | "area_code" | "unknown_conservative";
};

/** IANA zone for a recipient, preferring their stated US state over the phone's area code. */
export function zoneFor(phone?: string | null, state?: string | null): { tz: string | null; basis: QuietVerdict["basis"] } {
  const st = String(state || "").trim().toUpperCase();
  if (st.length === 2 && STATE_TZ[st]) return { tz: STATE_TZ[st], basis: "state" };
  const digits = String(phone || "").replace(/\D/g, "");
  const nat = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nat.length === 10) {
    const tz = AREA_TZ[nat.slice(0, 3)];
    if (tz) return { tz, basis: "area_code" };
  }
  return { tz: null, basis: "unknown_conservative" };
}

/** Hour-of-day (0-23) in the given IANA zone. Intl handles DST, so this is correct year-round. */
export function hourIn(tz: string, at: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(at);
  const n = parseInt(h, 10);
  return n === 24 ? 0 : n;   // some ICU builds render midnight as "24"
}

/**
 * Is it currently QUIET HOURS for this recipient (i.e. must we hold the message)?
 * With no usable zone we require the window to hold in EVERY continental US zone, which
 * means 11:00–19:59 Eastern (08:00 Pacific through 19:59 Eastern).
 */
export function quietHoursFor(phone?: string | null, state?: string | null, at: Date = new Date()): QuietVerdict {
  const { tz, basis } = zoneFor(phone, state);
  if (!tz) {
    const et = hourIn(ET, at);
    // Eastern is UTC-5/-4 and Pacific UTC-8/-7 — a fixed 3-hour spread, so the intersection
    // of [8,20) local across the continental zones is [8+3, 20) in Eastern terms.
    const quiet = et < QUIET_START_HOUR + 3 || et >= QUIET_END_HOUR;
    return { quiet, localHour: null, tz: null, basis };
  }
  const h = hourIn(tz, at);
  return { quiet: h < QUIET_START_HOUR || h >= QUIET_END_HOUR, localHour: h, tz, basis };
}

/** Human-readable reason for logs and the LO-facing error. */
export function quietReason(v: QuietVerdict): string {
  if (v.tz && v.localHour != null) {
    return `quiet hours — it is ${String(v.localHour).padStart(2, "0")}:00 for the recipient (${v.tz}); TCPA allows ${QUIET_START_HOUR}:00–${QUIET_END_HOUR}:00 local`;
  }
  return `quiet hours — the recipient's time zone is unknown (no state on the lead, unrecognized area code), so sending is held to the window that is safe in every US time zone (11:00–20:00 Eastern)`;
}
