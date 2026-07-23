// REVERSE PHONE LOOKUP — "a number is calling me; who is this, actually?"
//
// Three sources, cheapest/most-authoritative first:
//   1. CRM — the leads table + last activity. If they're already in the pipeline
//      that answer beats anything a data broker knows.
//   2. Twilio Lookup v2 (caller_name + line_type_intelligence) — carrier CNAM
//      database: registered subscriber name, consumer/business, mobile/voip/landline.
//      ~1¢ per uncached hit; cached 30 days in app_settings (CNAM changes rarely).
//   3. Web sweep (deep=1) — Serper Google search on the number's common formats,
//      synthesized by the flagship AI chain into "who this likely is" + spam signals.
//
// Every layer fails soft: a dead key or timeout drops that card, never the lookup.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { searchWeb, type SearchResult } from "@/lib/integrations/search";
import { claudeChat } from "@/lib/aiFallback";
import { logActivity } from "@/lib/activity";

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

export async function findCrmMatches(n: NormalizedPhone): Promise<CrmLeadMatch[]> {
  try {
    // Leads store phones as bare digits (10 or 11 with leading "1"), so a
    // last-10-digit substring match covers both; extra formatted patterns are a
    // cheap safety net for any legacy rows that kept punctuation.
    const core = n.digits10 || n.e164.replace(/\D/g, "").slice(-9);
    const pats = [`phone.ilike.%${core}%`];
    if (n.digits10) {
      const d = n.digits10;
      pats.push(`phone.ilike.%${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}%`);
      pats.push(`phone.ilike.%(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}%`);
    }
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id, created_at, full_name, first_name, last_name, email, phone, stage, tier, score, loan_purpose, state, source, lead_source")
      .or(pats.join(","))
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

// --------------------------------------------------------------- web sweep ---

export type WebIntel = {
  who: string | null;         // best guess at the person/company behind the number
  summary: string;            // 2-3 sentence "here's what the internet says"
  spamLikely: boolean;
  confidence: "high" | "medium" | "low";
  sources: { title: string; url: string }[];
};

export async function webIntel(n: NormalizedPhone, context: { cnamName?: string | null; lineType?: string | null; crmNames?: string[] }): Promise<WebIntel | null> {
  try {
    // Google indexes phone numbers in several formats — sweep the common ones.
    const queries = n.digits10
      ? [`"${prettyUs(n.digits10)}"`, `"${n.digits10.slice(0, 3)}-${n.digits10.slice(3, 6)}-${n.digits10.slice(6)}"`]
      : [`"${n.e164}"`];
    const settled = await Promise.allSettled(queries.map((q) => searchWeb(q)));
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const r of s.value || []) {
        const k = r.url || r.title;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        results.push(r);
        if (results.length >= 8) break;
      }
    }
    const sources = results.filter((r) => r.url).map((r) => ({ title: r.title, url: r.url }));
    if (!results.length) {
      return { who: null, summary: "No public web results for this number — most private mobiles have none.", spamLikely: false, confidence: "low", sources: [] };
    }

    const evidence = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
    const ctxBits = [
      context.cnamName ? `Carrier caller-ID name on file: "${context.cnamName}".` : "",
      context.lineType ? `Line type: ${context.lineType}.` : "",
      context.crmNames?.length ? `Our CRM already matches this number to: ${context.crmNames.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    const raw = await claudeChat({
      system: "You are a reverse-phone-lookup analyst for a mortgage brokerage. Given web search results about a phone number, identify who the number most likely belongs to (person or company) and whether it shows spam/robocall/scam reports. Be conservative: only name someone the evidence supports. Respond as JSON: {\"who\": string|null, \"summary\": string (2-3 sentences, plain English), \"spamLikely\": boolean, \"confidence\": \"high\"|\"medium\"|\"low\"}.",
      messages: [{ role: "user", content: `Phone number: ${n.pretty}. ${ctxBits}\n\nWeb results:\n\n${evidence}` }],
      maxTokens: 500,
      json: true,
      timeoutMs: 25_000,
    });
    if (!raw) return { who: null, summary: "Web results found (below) — AI summary unavailable right now.", spamLikely: false, confidence: "low", sources };
    const j = JSON.parse(raw);
    return {
      who: j.who ? String(j.who) : null,
      summary: String(j.summary || ""),
      spamLikely: Boolean(j.spamLikely),
      confidence: j.confidence === "high" || j.confidence === "medium" ? j.confidence : "low",
      sources,
    };
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
  crm: CrmLeadMatch[];
  callerId: CallerIdResult | null;
  flags: { label: string; level: "danger" | "warn" | "ok" }[];
  web?: WebIntel | null;
};

export async function lookupNumber(input: string, opts: { deep?: boolean } = {}): Promise<PhoneLookup | { ok: false; error: string }> {
  const n = normalizePhone(input);
  if (!n) return { ok: false, error: "That doesn't look like a phone number — need at least a 10-digit US number or +international." };
  const [crm, callerId] = await Promise.all([findCrmMatches(n), twilioCallerId(n)]);
  const base: PhoneLookup = {
    ok: true,
    pretty: n.pretty,
    e164: n.e164,
    us: n.us,
    crm,
    callerId,
    flags: deriveFlags(callerId),
  };
  if (opts.deep) {
    base.web = await webIntel(n, {
      cnamName: callerId?.callerName,
      lineType: callerId?.lineType,
      crmNames: crm.map((c) => c.name),
    });
  }
  // Privacy in the audit trail: last-4 only, same discipline as Lead Shield.
  const last4 = n.e164.replace(/\D/g, "").slice(-4);
  logActivity({
    entity_type: "lookup", entity_id: last4, actor: "staff", action: opts.deep ? "lookup.phone.deep" : "lookup.phone",
    detail: { last4, crmMatches: crm.length, lineType: callerId?.lineType || null, cnam: Boolean(callerId?.callerName) },
  }).catch(() => {});
  return base;
}
