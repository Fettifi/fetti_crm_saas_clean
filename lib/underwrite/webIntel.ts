// Web intelligence for investor deal analysis. Pulls the SUBJECT property's facts and its
// NEIGHBORHOOD / market context from public web search (Serper/Google) via AI extraction —
// the same approach the Underwriting Desk uses for a lender underwrite, packaged for reuse.
// Everything here is best-effort and preliminary (public AVMs, not appraisals).
import { searchWeb } from "@/lib/integrations/search";
import { getSetting } from "@/lib/settings";
import { PROPERTY_WEB_SYSTEM, type WebPropertyPull } from "@/lib/underwritingDesk";

const str = (v: any, n = 600) => String(v ?? "").trim().slice(0, n);

// Anthropic vision/JSON helper — same pattern as the desk route (forced JSON, no prefill).
export async function callClaudeJSON(system: string, content: any[], maxTokens = 2000): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(110000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : txt);
}

// Run several Google searches in parallel, dedupe by URL, cap the snippet payload.
async function multiSearch(queries: string[], cap = 14): Promise<{ title: string; url: string; content: string }[]> {
  const batches = await Promise.all(queries.map((q) => searchWeb(q).catch(() => [] as any[])));
  const seen = new Set<string>();
  const out: { title: string; url: string; content: string }[] = [];
  for (const b of batches) for (const r of (b || [])) {
    const k = String(r?.url || r?.title || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ title: str(r.title, 160), url: str(r.url, 300), content: str(r.content, 600) });
    if (out.length >= cap) break;
  }
  return out;
}

// Subject property facts (value/rent/beds/baths/sqft/tax/last sale) — reuses the desk prompt.
export async function pullPropertyFromWeb(addr: string): Promise<WebPropertyPull | null> {
  if ((addr || "").trim().length < 6) return null;
  const results = await multiSearch([
    `${addr} home value Zestimate Redfin estimate beds baths sqft rent`,
    `${addr} county assessor property tax assessed value last sold price`,
  ]);
  if (!results.length) return null;
  const content = [{ type: "text", text: `SUBJECT ADDRESS: ${addr}\n\nWEB RESULTS:\n${JSON.stringify(results)}\n\nExtract the subject property's facts. JSON only.` }];
  try { const r = await callClaudeJSON(PROPERTY_WEB_SYSTEM, content, 1500) as WebPropertyPull; return r || null; }
  catch { return null; }
}

export const NEIGHBORHOOD_SYSTEM = `You are a real-estate investment analyst reading web-search snippets about a neighborhood/market. You are given a SUBJECT address + city/state/zip and a list of {title,url,content} results (Zillow/Redfin/Realtor market pages, news, school/crime sites, recent-sales listings). Summarize what an INVESTOR needs, using ONLY facts stated in the snippets — never invent numbers. Return ONLY valid JSON:
{
 "marketSummary": "<2-3 sentences: is this a strong/soft market for investors, and why>",
 "priceTrend": "<appreciating | flat | declining | unknown>", "priceTrendNote": "<e.g. '+4.2% YoY' or 'prices down 3% in 2025' — only if stated, else null>",
 "medianDaysOnMarket": <number|null>, "buyerOrSellerMarket": "<buyer | seller | balanced | unknown>",
 "rentMarket": {"avgRent": <$|null>, "trend": "<rising | flat | falling | unknown>", "note": "<short, only if stated>"},
 "areaQuality": {"schools": "<short read or null>", "safety": "<short read or null>", "desirability": "<short read or null>"},
 "comps": [{"address":"<comp address>","soldPrice":<$|null>,"soldDate":"<YYYY-MM|null>","beds":<n|null>,"baths":<n|null>,"sqft":<n|null>,"distance":"<if stated|null>"}],
 "demandSignals": ["<short bullets: population/job growth, rental demand, new development, etc. — only if stated>"],
 "investorRisks": ["<short bullets: declining area, high taxes, oversupply, flood zone, HOA, etc. — only if stated>"],
 "sources": [{"label":"<Zillow | Redfin | Realtor.com | GreatSchools | news | ...>","url":"<url>"}],
 "confidence": "<high | medium | low>"
}
RULES: Only include comps that clearly refer to nearby/similar properties in the snippets. Leave fields null when not stated. Be honest — if the snippets show a weak or declining market, say so.`;

export type NeighborhoodIntel = {
  marketSummary?: string; priceTrend?: string; priceTrendNote?: string | null;
  medianDaysOnMarket?: number | null; buyerOrSellerMarket?: string;
  rentMarket?: { avgRent?: number | null; trend?: string; note?: string | null };
  areaQuality?: { schools?: string | null; safety?: string | null; desirability?: string | null };
  comps?: { address?: string; soldPrice?: number | null; soldDate?: string | null; beds?: number | null; baths?: number | null; sqft?: number | null; distance?: string | null }[];
  demandSignals?: string[]; investorRisks?: string[];
  sources?: { label?: string; url?: string }[]; confidence?: string;
};

// Neighborhood / market context + comps for the subject area.
export async function pullNeighborhood(addr: string, cityStateZip: string): Promise<NeighborhoodIntel | null> {
  const loc = cityStateZip || addr;
  const results = await multiSearch([
    `${addr} recently sold comparable homes nearby`,
    `${loc} housing market trends home prices appreciation`,
    `${loc} average rent rental market demand`,
    `${loc} schools crime safety neighborhood`,
  ]);
  if (!results.length) return null;
  const content = [{ type: "text", text: `SUBJECT: ${addr} (${loc})\n\nWEB RESULTS:\n${JSON.stringify(results)}\n\nSummarize the neighborhood & market for an investor. JSON only.` }];
  try { return await callClaudeJSON(NEIGHBORHOOD_SYSTEM, content, 2000) as NeighborhoodIntel; }
  catch { return null; }
}

// Census ACS market medians (median income / home value / gross rent) by ZCTA, latest vintage.
const ACS_VARS = "B19013_001E,B25077_001E,B25064_001E";
export async function acsMarket(zip?: string) {
  const zc = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (zc.length !== 5) return null;
  const key = ((await getSetting("CENSUS_API_KEY")) || process.env.CENSUS_API_KEY || "").trim();
  if (!key) return null;
  for (const v of [2023, 2022, 2021]) {
    try {
      const url = `https://api.census.gov/data/${v}/acs/acs5?get=${ACS_VARS}&for=zip%20code%20tabulation%20area:${encodeURIComponent(zc)}&key=${encodeURIComponent(key)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const row = j?.[1];
      if (!row) continue;
      const n = (x: any) => { const v2 = Number(x); return isFinite(v2) && v2 > 0 ? v2 : null; };
      return { vintage: v, zip: zc, medianIncome: n(row[0]), medianHomeValue: n(row[1]), medianGrossRent: n(row[2]) };
    } catch { /* try older vintage */ }
  }
  return null;
}
