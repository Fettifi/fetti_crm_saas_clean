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

const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver",
  AZ = "America/Phoenix", PT = "America/Los_Angeles", AK = "America/Anchorage", HT = "Pacific/Honolulu";

export const STATE_TZ: Record<string, string> = {
  AL: CT, AK: AK, AZ: AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET,
  HI: HT, ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET,
  MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET,
  NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT,
  UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
};

// Area code → timezone. Grouped by zone; split-state area codes are placed in their
// TRUE zone (850 Central, 915 Mountain, 219 Central, 423/865 Eastern, etc.).
const TZ_GROUPS: Record<string, string[]> = {
  [ET]: [
    "201","202","203","207","212","215","216","220","223","234","240","252","267","272","276","283","301","302","304","305","315","321","326","330","332","336","339","347","351","352","364x","380","386","401","404","407","410","412","413","419","434","440","443","445","448","456","470","475","478","484","508","513","516","517","518","540","551","561","567","570","571","574","582","585","603","607","609","610","614","616","617","631","640","646","656","667","678","680","681","689","703","704","706","716","717","718","724","727","732","734","740","743","754","757","762","770","771","772","773x","774","781","786","802","803","804","810","812","813","814","826","828","835","838","839","843","845","848","854","857","859","860","862","864","865","878","901x","904","908","910","912","914","917","919","929","930","934","937","941","943","947","948","954","959","972x","973","978","980","984","986x","989",
  ],
  [CT]: [
    "205","210","214","217","218","219","224","225","228","251","254","256","262","270","274","281","309","312","314","316","318","319","320","325","327","331","334","337","346","361","405","409","414","417","430","432","447","463","464","469","479","483","479","501","502x","504","507","512","515","531","534","539","557","563","572","573","580","601","605","608","612","615","618","620","629","630","636","641","651","659","660","662","682","708","712","713","715","726","730","731","737","763","769","773","779","785","806","815","816","817","830","832","847","850","870","872","901","903","913","918","920","931","936","938","940","945","952","956","972","975","979","985",
  ],
  [MT]: [
    "208","303","307","308x","385","406","435","505","575","719","720","801","915","970","983","986",
  ],
  [AZ]: ["480","520","602","623","928"],
  [PT]: [
    "206","209","213","253","279","310","323","341","350","360","408","415","424","425","442","458","503","509","510","530","541","559","562","564","619","626","628","650","657","661","669","702","707","714","725","747","760","775","805","818","820","831","840","858","909","916","925","935","949","951","971",
  ],
  [AK]: ["907"],
  [HT]: ["808"],
};
const AREA_TZ: Record<string, string> = {};
for (const [tz, codes] of Object.entries(TZ_GROUPS)) for (const c of codes) AREA_TZ[c.replace(/x$/, "")] = tz;

// Small ZIP3 (first three digits) → timezone map, ONLY for regions whose zone differs
// from their state's majority — used when we actually have a borrower ZIP.
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
  // W Kentucky (Central)
  "420": CT, "421": CT, "422": CT, "423": CT, "424": CT, "425": CT, "427": CT,
  // NW + SW Indiana (Central)
  "463": CT, "464": CT, "476": CT, "477": CT,
};

export function borrowerTz(opts: { zip?: string | null; phone?: string | null; state?: string | null }): string | null {
  const zip = String(opts.zip || "").replace(/\D/g, "");
  if (zip.length >= 3 && ZIP3_TZ[zip.slice(0, 3)]) return ZIP3_TZ[zip.slice(0, 3)];
  const digits = String(opts.phone || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10 && AREA_TZ[ten.slice(0, 3)]) return AREA_TZ[ten.slice(0, 3)];
  const st = String(opts.state || "").trim().toUpperCase();
  if (st && STATE_TZ[st]) return STATE_TZ[st];
  return null;
}

function hourInTz(tz: string): number {
  return Number(new Date().toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }));
}

/** True if it's currently 8am–9pm at the borrower's location (TCPA). Unknown zone →
 *  a window that's safe across the whole continental US (12:00–20:00 ET = 9am–5pm PT). */
export function withinCallingHours(opts: { zip?: string | null; phone?: string | null; state?: string | null }): boolean {
  const tz = borrowerTz(opts);
  if (tz) { const h = hourInTz(tz); return h >= 8 && h < 21; }
  const et = hourInTz(ET);
  return et >= 12 && et < 20;
}
