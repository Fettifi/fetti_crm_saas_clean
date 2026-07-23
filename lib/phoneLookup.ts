// REVERSE PHONE LOOKUP — "a number is calling me; who is this, actually?"
//
// Layers, cheapest/most-authoritative first:
//   1. CRM — leads + active loan files. If they're in the pipeline, that answer
//      beats anything a data broker knows.
//   2. Twilio Lookup v2 (caller_name + line_type_intelligence) — carrier CNAM:
//      registered subscriber name, consumer/business, mobile/voip/landline.
//      ~1¢ per uncached hit; cached 30 days in app_settings.
//   3. Number geography — area code → home metro (instant, offline).
//   4. Deep sweep (deep=1): Google Places reverse lookup (businesses are indexed
//      by phone on Maps — a hit is name + street address), Google web search on
//      the number's common formats, and carrier identification (who services the
//      line + where THEY are — explicitly separated from who is calling, because
//      "Onvoy LLC" on a caller-ID is the phone company, never the caller).
//      Flagship AI synthesizes it all; result cached 7 days.
//
// Every layer fails soft: a dead key or timeout drops that card, never the lookup.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { searchWeb, searchPlaces, type SearchResult, type PlaceResult } from "@/lib/integrations/search";
import { claudeChat } from "@/lib/aiFallback";
import { logActivity } from "@/lib/activity";
import { areaCodeLocation } from "@/lib/areaCodes";

// ------------------------------------------------------------ normalization ---

export type NormalizedPhone = {
  digits10: string | null; // US 10-digit core (null for non-US)
  e164: string;            // what we send to Twilio
  pretty: string;          // (213) 555-1234 for US, raw for international
  us: boolean;
};

export function normalizePhone(input: string): NormalizedPhone | null {
  const raw = String(input || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  // US forms: 10 digits, or 11 starting with 1 (with or without +).
  if (digits.length === 10 && !hasPlus) {
    return { digits10: digits, e164: `+1${digits}`, pretty: prettyUs(digits), us: true };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const d10 = digits.slice(1);
    return { digits10: d10, e164: `+1${d10}`, pretty: prettyUs(d10), us: true };
  }
  // International (or oddball): pass through to Twilio as-is; CRM matches on tail digits.
  if (hasPlus && digits.length >= 8 && digits.length <= 15) {
    return { digits10: null, e164: `+${digits}`, pretty: `+${digits}`, us: false };
  }
  return null;
}

export function prettyUs(d10: string): string {
  return `(${d10.slice(0, 3)}) ${d10.slice(3, 6)}-${d10.slice(6)}`;
}

// ------------------------------------------------------------- CRM matching ---

export type CrmLeadMatch = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
  tier: string | null;
  score: number | null;
  loan_purpose: string | null;
  state: string | null;
  source: string | null;
  created_at: string;
  lastActivity: { action: string; at: string } | null;
};

export type CrmFileMatch = {
  id: string;
  fileNumber: string | null;
  borrowerName: string | null;
  product: string | null;
  propertyAddress: string | null;
  stage: string | null;
  status: string | null;
  leadId: string | null;
  created_at: string;
};

function phonePatterns(n: NormalizedPhone): string[] {
  // Both tables store phones as bare digits (10 or 11 with leading "1"), so a
  // last-10-digit substring match covers both; formatted patterns are a cheap
  // safety net for any legacy rows that kept punctuation.
  const core = n.digits10 || n.e164.replace(/\D/g, "").slice(-9);
  const pats = [`phone.ilike.%${core}%`];
  if (n.digits10) {
    const d = n.digits10;
    pats.push(`phone.ilike.%${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}%`);
    pats.push(`phone.ilike.%(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}%`);
  }
  return pats;
}

export async function findCrmMatches(n: NormalizedPhone): Promise<CrmLeadMatch[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id, created_at, full_name, first_name, last_name, email, phone, stage, tier, score, loan_purpose, state, source, lead_source")
      .or(phonePatterns(n).join(","))
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !data?.length) return [];

    // Latest touch per matched lead so the card can say "last SMS 3 days ago".
    const ids = data.map((l: any) => String(l.id));
    let lastByLead: Record<string, { action: string; at: string }> = {};
    try {
      const { data: acts } = await supabaseAdmin
        .from("activity_log")
        .select("entity_id, action, created_at")
        .eq("entity_type", "lead")
        .in("entity_id", ids)
        .order("created_at", { ascending: false })
        .limit(60);
      for (const a of acts || []) {
        const k = String(a.entity_id);
        if (!lastByLead[k]) lastByLead[k] = { action: String(a.action || ""), at: String(a.created_at || "") };
      }
    } catch { /* activity is garnish, not the meal */ }

    return data.map((l: any) => ({
      id: String(l.id),
      name: l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || "Unnamed lead",
      email: l.email || null,
      phone: l.phone || null,
      stage: l.stage || null,
      tier: l.tier != null ? String(l.tier) : null,
      score: l.score ?? null,
      loan_purpose: l.loan_purpose || null,
      state: l.state || null,
      source: l.source || l.lead_source || null,
      created_at: String(l.created_at),
      lastActivity: lastByLead[String(l.id)] || null,
    }));
  } catch {
    return [];
  }
}

export async function findLoanFileMatches(n: NormalizedPhone): Promise<CrmFileMatch[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("loan_files")
      .select("id, file_number, lead_id, borrower_name, phone, product, property_address, stage, status, created_at")
      .or(phonePatterns(n).join(","))
      .order("created_at", { ascending: false })
      .limit(3);
    if (error || !data?.length) return [];
    return data.map((f: any) => ({
      id: String(f.id),
      fileNumber: f.file_number ? String(f.file_number) : null,
      borrowerName: f.borrower_name || null,
      product: f.product || null,
      propertyAddress: f.property_address || null,
      stage: f.stage || null,
      status: f.status || null,
      leadId: f.lead_id ? String(f.lead_id) : null,
      created_at: String(f.created_at),
    }));
  } catch {
    return [];
  }
}

// ------------------------------------------------- Twilio CNAM + line type ---

export type CallerIdResult = {
  callerName: string | null;   // registered subscriber name (US CNAM)
  callerType: string | null;   // CONSUMER | BUSINESS
  lineType: string;            // mobile | landline | nonFixedVoip | fixedVoip | tollFree | ...
  carrier: string | null;
  valid: boolean;
  checkedAt: string;
};

const CNAM_CACHE_DAYS = 30;

export async function twilioCallerId(n: NormalizedPhone): Promise<CallerIdResult | null> {
  try {
    const key = `lookup:cnam:${n.e164.replace(/\D/g, "")}`;
    const cachedRaw = await getSetting(key);
    if (cachedRaw) {
      try {
        const c = JSON.parse(cachedRaw);
        if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < CNAM_CACHE_DAYS * 86400_000) return c;
      } catch { /* re-fetch */ }
    }
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) return null;
    // caller_name is US-only; requesting it on intl numbers just returns null fields.
    const fields = n.us ? "caller_name,line_type_intelligence" : "line_type_intelligence";
    const r = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(n.e164)}?Fields=${fields}`, {
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64") },
      signal: AbortSignal.timeout(4000),
    });
    if (r.status === 404) {
      const res: CallerIdResult = { callerName: null, callerType: null, lineType: "invalid", carrier: null, valid: false, checkedAt: new Date().toISOString() };
      await setSetting(key, JSON.stringify(res));
      return res;
    }
    if (!r.ok) return null;
    const j = await r.json();
    const cn = j?.caller_name || {};
    const lti = j?.line_type_intelligence || {};
    const res: CallerIdResult = {
      callerName: cn.caller_name ? String(cn.caller_name) : null,
      callerType: cn.caller_type ? String(cn.caller_type) : null,
      lineType: String(lti.type || "unknown"),
      carrier: lti.carrier_name ? String(lti.carrier_name) : null,
      valid: j?.valid !== false,
      checkedAt: new Date().toISOString(),
    };
    await setSetting(key, JSON.stringify(res));
    return res;
  } catch {
    return null;
  }
}

// -------------------------------------------------------- carrier identity ---
// The carrier on a lookup is the PHONE COMPANY that services the line — never
// the caller. Naming it plainly ("Onvoy = wholesale VoIP, Chicago") kills the
// "who is Horizon LLC?" confusion and doubles as a spam signal: wholesale VoIP
// carriers supply the numbers behind most robocalls and app burners.

export type CarrierIntel = {
  name: string;      // raw carrier string from Twilio
  what: string;      // plain-English who/what the carrier is
  hq: string | null; // where the carrier itself sits
  kind: "mobile" | "cable" | "landline" | "cloud-voip" | "wholesale-voip" | "unknown";
};

const CARRIER_BOOK: [RegExp, Omit<CarrierIntel, "name">][] = [
  [/verizon|cellco/i, { what: "Verizon — major consumer mobile carrier", hq: "Basking Ridge, NJ", kind: "mobile" }],
  [/t-?mobile|metro ?pcs|sprint/i, { what: "T-Mobile — major consumer mobile carrier", hq: "Bellevue, WA", kind: "mobile" }],
  [/at&t|cingular|cricket/i, { what: "AT&T (incl. Cricket prepaid) — major consumer mobile carrier", hq: "Dallas, TX", kind: "mobile" }],
  [/u\.?s\.? ?cellular/i, { what: "US Cellular — regional mobile carrier", hq: "Chicago, IL", kind: "mobile" }],
  [/\bdish\b|boost mobile|gen ?mobile/i, { what: "Boost / DISH Wireless — prepaid mobile", hq: "Englewood, CO", kind: "mobile" }],
  [/twilio/i, { what: "Twilio — cloud phone platform used by apps, businesses & call centers", hq: "San Francisco, CA", kind: "cloud-voip" }],
  [/bandwidth/i, { what: "Bandwidth — VoIP wholesaler behind Google Voice, RingCentral and many apps", hq: "Raleigh, NC", kind: "cloud-voip" }],
  [/onvoy|inteliquent|sinch|zipwhip/i, { what: "Onvoy / Inteliquent (Sinch) — wholesale VoIP; supplies numbers to TextNow and many calling apps", hq: "Chicago, IL", kind: "wholesale-voip" }],
  [/peerless/i, { what: "Peerless Network — wholesale VoIP carrier", hq: "Chicago, IL", kind: "wholesale-voip" }],
  [/telnyx/i, { what: "Telnyx — cloud phone platform", hq: "Austin, TX", kind: "cloud-voip" }],
  [/level ?3|lumen|centurylink|qwest|embarq/i, { what: "Lumen (Level 3 / CenturyLink) — wholesale & business carrier", hq: "Monroe, LA", kind: "wholesale-voip" }],
  [/comcast|xfinity/i, { what: "Comcast Xfinity — cable home/business phone", hq: "Philadelphia, PA", kind: "cable" }],
  [/charter|spectrum|time warner|bright ?house/i, { what: "Charter Spectrum — cable phone", hq: "Stamford, CT", kind: "cable" }],
  [/\bcox\b/i, { what: "Cox Communications — cable phone", hq: "Atlanta, GA", kind: "cable" }],
  [/altice|optimum|cablevision|suddenlink/i, { what: "Optimum (Altice) — cable phone", hq: "Long Island, NY", kind: "cable" }],
  [/frontier/i, { what: "Frontier — regional landline/fiber carrier", hq: "Dallas, TX", kind: "landline" }],
  [/windstream/i, { what: "Windstream — regional landline carrier", hq: "Little Rock, AR", kind: "landline" }],
  [/vonage/i, { what: "Vonage — consumer/business VoIP service", hq: "Holmdel, NJ", kind: "cloud-voip" }],
  [/magic ?jack|ymax/i, { what: "magicJack — consumer VoIP", hq: "West Palm Beach, FL", kind: "cloud-voip" }],
  [/google/i, { what: "Google Voice — free internet phone numbers", hq: "Mountain View, CA", kind: "cloud-voip" }],
  [/textnow/i, { what: "TextNow — free app phone numbers (a common burner setup)", hq: "Waterloo, ON, Canada", kind: "wholesale-voip" }],
  [/thinq|commio/i, { what: "Commio (thinQ) — wholesale VoIP", hq: "Raleigh, NC", kind: "wholesale-voip" }],
  [/brightlink/i, { what: "Brightlink — wholesale VoIP", hq: "Atlanta, GA", kind: "wholesale-voip" }],
  [/telephone and data systems|tds telecom/i, { what: "TDS Telecom — regional carrier", hq: "Madison, WI", kind: "landline" }],
];

export function carrierBookLookup(carrier: string | null): CarrierIntel | null {
  if (!carrier) return null;
  for (const [re, info] of CARRIER_BOOK) {
    if (re.test(carrier)) return { name: carrier, ...info };
  }
  return null;
}

export function carrierHint(ci: CarrierIntel | null): string | null {
  if (!ci) return null;
  switch (ci.kind) {
    case "mobile": return "Consumer mobile carrier — most likely a real person's cell.";
    case "cable": case "landline": return "Home or business line from a mainstream carrier.";
    case "cloud-voip": case "wholesale-voip":
      return "Internet-phone number. The carrier is just the phone company that services the line — the actual caller is a customer of some app or calling service. This is also the most common setup behind robocalls.";
    default: return null;
  }
}

// Unknown carrier → identify it once via web search + AI, then cache ~180 days.
async function carrierWebIntel(carrier: string): Promise<CarrierIntel | null> {
  try {
    const slug = carrier.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const key = `lookup:carrier:${slug}`;
    const cached = await getSetting(key);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < 180 * 86400_000) return c;
      } catch { /* re-resolve */ }
    }
    const results = await searchWeb(`"${carrier}" telecom carrier OR voip provider`);
    const evidence = (results || []).slice(0, 5).map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
    if (!evidence) return null;
    const raw = await claudeChat({
      system: 'You identify telephone carriers. Given web results about a company that appears as the carrier-of-record on a phone lookup, say what it is and where it is headquartered. Respond as JSON: {"what": string (one plain-English sentence, e.g. "Horizon — wholesale VoIP provider that leases numbers to calling apps and call centers"), "hq": string|null ("City, ST" or null if unknown), "kind": "mobile"|"cable"|"landline"|"cloud-voip"|"wholesale-voip"|"unknown"}.',
      messages: [{ role: "user", content: `Carrier string from the lookup: "${carrier}"\n\nWeb results:\n\n${evidence}` }],
      maxTokens: 300,
      json: true,
      timeoutMs: 20_000,
    });
    if (!raw) return null;
    const j = JSON.parse(raw);
    const res: CarrierIntel & { checkedAt?: string } = {
      name: carrier,
      what: String(j.what || carrier),
      hq: j.hq ? String(j.hq) : null,
      kind: ["mobile", "cable", "landline", "cloud-voip", "wholesale-voip"].includes(j.kind) ? j.kind : "unknown",
      checkedAt: new Date().toISOString(),
    };
    await setSetting(key, JSON.stringify(res));
    return res;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- flags ---

export function deriveFlags(cid: CallerIdResult | null): { label: string; level: "danger" | "warn" | "ok" }[] {
  if (!cid) return [];
  const flags: { label: string; level: "danger" | "warn" | "ok" }[] = [];
  if (!cid.valid || cid.lineType === "invalid") flags.push({ label: "Carrier says this number does not exist", level: "danger" });
  switch (cid.lineType) {
    case "nonFixedVoip": flags.push({ label: "Internet (VoIP) number — common for spam & spoofed calls", level: "warn" }); break;
    case "fixedVoip": flags.push({ label: "Fixed VoIP line (business internet phone)", level: "ok" }); break;
    case "tollFree": flags.push({ label: "Toll-free number — telemarketing / call center", level: "warn" }); break;
    case "premium": case "sharedCost": case "pager": case "voicemail":
      flags.push({ label: `Junk line type (${cid.lineType})`, level: "danger" }); break;
    case "mobile": flags.push({ label: "Real mobile line", level: "ok" }); break;
    case "landline": flags.push({ label: "Landline", level: "ok" }); break;
  }
  if (cid.callerType === "BUSINESS") flags.push({ label: "Registered to a business", level: "ok" });
  return flags;
}

// --------------------------------------------------------------- deep sweep ---

export type WebIntel = {
  who: string | null;            // best-supported identity of the CALLER
  whoType: "person" | "business" | "unknown";
  callerLocation: string | null; // where the caller (not the carrier) appears to be
  summary: string;               // 2-4 sentences, plain English
  spamLikely: boolean;
  confidence: "high" | "medium" | "low";
  sources: { title: string; url: string }[];
  places: PlaceResult[];         // Google Maps businesses matching this number
  carrier: CarrierIntel | null;  // who services the line + where THEY are
};

const WEB_CACHE_DAYS = 7;

export async function webIntel(
  n: NormalizedPhone,
  context: { cnamName?: string | null; lineType?: string | null; carrier?: string | null; crmNames?: string[]; location?: string | null }
): Promise<WebIntel | null> {
  try {
    const cacheKey = `lookup:web:${n.e164.replace(/\D/g, "")}`;
    const cached = await getSetting(cacheKey);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < WEB_CACHE_DAYS * 86400_000) return c;
      } catch { /* re-sweep */ }
    }

    // Google indexes phone numbers in several formats — sweep the common ones,
    // plus a Places reverse lookup (businesses are indexed by phone on Maps).
    const d = n.digits10;
    const dashed = d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : n.e164;
    const queries = d ? [`"${prettyUs(d)}"`, `"${dashed}"`, `"${d}" OR "+1${d}"`] : [`"${n.e164}"`];

    // Carrier identity: instant from the book, one cached web resolve for unknowns.
    const carrierPromise: Promise<CarrierIntel | null> = context.carrier
      ? (carrierBookLookup(context.carrier)
          ? Promise.resolve(carrierBookLookup(context.carrier))
          : carrierWebIntel(context.carrier))
      : Promise.resolve(null);

    const [placesSettled, carrierResolved, ...searchSettled] = await Promise.allSettled([
      searchPlaces(dashed),
      carrierPromise,
      ...queries.map((q) => searchWeb(q)),
    ]);
    const places: PlaceResult[] = placesSettled.status === "fulfilled" ? (placesSettled.value as PlaceResult[]) : [];
    const carrier: CarrierIntel | null = carrierResolved.status === "fulfilled" ? (carrierResolved.value as CarrierIntel | null) : null;

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const s of searchSettled) {
      if (s.status !== "fulfilled") continue;
      for (const r of (s.value as SearchResult[]) || []) {
        const k = r.url || r.title;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        results.push(r);
        if (results.length >= 10) break;
      }
    }
    const sources = results.filter((r) => r.url).map((r) => ({ title: r.title, url: r.url }));

    const placeEvidence = places.map((p, i) => `[P${i + 1}] ${p.name} — ${p.category || "business"} — ${p.address}${p.phone ? ` — listed phone ${p.phone}` : ""}${p.website ? ` — ${p.website}` : ""}`).join("\n");
    const webEvidence = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
    const ctxBits = [
      context.cnamName ? `Carrier caller-ID (CNAM) registered name: "${context.cnamName}".` : "No CNAM name on file (normal for VoIP/prepaid).",
      context.lineType ? `Line type: ${context.lineType}.` : "",
      context.carrier ? `Carrier of record (the phone company servicing the line — NOT the caller): ${context.carrier}${carrier?.what ? ` = ${carrier.what}${carrier.hq ? `, HQ ${carrier.hq}` : ""}` : ""}.` : "",
      context.location ? `Number's area code is based in ${context.location}.` : "",
      context.crmNames?.length ? `Our CRM already matches this number to: ${context.crmNames.join(", ")}.` : "",
    ].filter(Boolean).join(" ");

    if (!places.length && !results.length) {
      const empty: WebIntel & { checkedAt: string } = {
        who: null, whoType: "unknown", callerLocation: context.location || null,
        summary: "No public listings or web results for this number — typical for a private cell or an app-issued (VoIP) number. The carrier and area-code details above are everything that's publicly knowable.",
        spamLikely: false, confidence: "low", sources: [], places: [], carrier,
        checkedAt: new Date().toISOString(),
      };
      await setSetting(cacheKey, JSON.stringify(empty));
      return empty;
    }

    const raw = await claudeChat({
      system: `You are a reverse-phone-lookup analyst for a mortgage brokerage answering ONE question: who is actually calling from this number?

Hard rules:
- NEVER present the carrier of record (Twilio, Onvoy, Level 3, "…LLC" telecom entities) as the caller — it is the phone company servicing the line. If the only name you can find is the carrier, the caller is UNKNOWN.
- A Google Maps/Places entry whose listed phone matches the number is the strongest identity evidence there is.
- Spam-report sites (whocallsme, 800notes, robokiller, etc.) mentioning this number = spamLikely true.
- Be conservative: only name a person/company the evidence supports; say "unknown" over guessing.

Respond as JSON: {"who": string|null (the CALLER), "whoType": "person"|"business"|"unknown", "callerLocation": string|null (city/state of the CALLER if evidenced, else null), "summary": string (2-4 plain-English sentences a loan officer reads mid-ring: who it is or what we do/don't know, and any spam signals), "spamLikely": boolean, "confidence": "high"|"medium"|"low"}.`,
      messages: [{ role: "user", content: `Phone number: ${n.pretty}. ${ctxBits}\n\nGoogle Maps/Places matches:\n${placeEvidence || "(none)"}\n\nWeb results:\n\n${webEvidence || "(none)"}` }],
      maxTokens: 600,
      json: true,
      timeoutMs: 25_000,
    });

    let out: WebIntel & { checkedAt: string };
    if (!raw) {
      out = {
        who: places[0]?.name || null,
        whoType: places[0] ? "business" : "unknown",
        callerLocation: places[0]?.address || context.location || null,
        summary: places[0]
          ? `Google Maps lists this number as ${places[0].name} (${places[0].address}). AI summary unavailable right now — sources below.`
          : "Web results found (below) — AI summary unavailable right now.",
        spamLikely: false, confidence: places[0] ? "medium" : "low", sources, places, carrier,
        checkedAt: new Date().toISOString(),
      };
    } else {
      const j = JSON.parse(raw);
      out = {
        who: j.who ? String(j.who) : null,
        whoType: j.whoType === "person" || j.whoType === "business" ? j.whoType : "unknown",
        callerLocation: j.callerLocation ? String(j.callerLocation) : null,
        summary: String(j.summary || ""),
        spamLikely: Boolean(j.spamLikely),
        confidence: j.confidence === "high" || j.confidence === "medium" ? j.confidence : "low",
        sources, places, carrier,
        checkedAt: new Date().toISOString(),
      };
    }
    await setSetting(cacheKey, JSON.stringify(out));
    return out;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- orchestr ---

export type PhoneLookup = {
  ok: true;
  pretty: string;
  e164: string;
  us: boolean;
  location: string | null;             // area-code home metro
  crm: CrmLeadMatch[];
  crmFiles: CrmFileMatch[];
  callerId: CallerIdResult | null;
  carrierIntel: CarrierIntel | null;   // instant book hit (deep pass may upgrade)
  flags: { label: string; level: "danger" | "warn" | "ok" }[];
  web?: WebIntel | null;
};

export async function lookupNumber(input: string, opts: { deep?: boolean } = {}): Promise<PhoneLookup | { ok: false; error: string }> {
  const n = normalizePhone(input);
  if (!n) return { ok: false, error: "That doesn't look like a phone number — need at least a 10-digit US number or +international." };
  const [crm, crmFiles, callerId] = await Promise.all([findCrmMatches(n), findLoanFileMatches(n), twilioCallerId(n)]);
  const base: PhoneLookup = {
    ok: true,
    pretty: n.pretty,
    e164: n.e164,
    us: n.us,
    location: n.digits10 ? areaCodeLocation(n.digits10) : null,
    crm,
    crmFiles,
    callerId,
    carrierIntel: carrierBookLookup(callerId?.carrier || null),
    flags: deriveFlags(callerId),
  };
  if (opts.deep) {
    base.web = await webIntel(n, {
      cnamName: callerId?.callerName,
      lineType: callerId?.lineType,
      carrier: callerId?.carrier,
      crmNames: [...crm.map((c) => c.name), ...crmFiles.map((f) => f.borrowerName || "").filter(Boolean)],
      location: base.location,
    });
    if (base.web?.carrier) base.carrierIntel = base.web.carrier;
  }
  // Privacy in the audit trail: last-4 only, same discipline as Lead Shield.
  const last4 = n.e164.replace(/\D/g, "").slice(-4);
  logActivity({
    entity_type: "lookup", entity_id: last4, actor: "staff", action: opts.deep ? "lookup.phone.deep" : "lookup.phone",
    detail: { last4, crmMatches: crm.length + crmFiles.length, lineType: callerId?.lineType || null, cnam: Boolean(callerId?.callerName) },
  }).catch(() => {});
  return base;
}
