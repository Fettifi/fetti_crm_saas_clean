// PORTFOLIO UNDERWRITING API — parse a rent-roll/portfolio spreadsheet, AI-map its
// columns to the canonical PropertyRow shape, and underwrite it with the shared engine
// (lib/underwrite/engine.ts — identical math to the /underwrite page). Persistence
// follows the scenarioStore pattern: JSON docs in app_settings, zero new DDL.
//
// Auth is handled by proxy.ts (the API gate) — no auth logic in here.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  DEFAULT_ASSUMPTIONS,
  underwritePortfolio,
  type Assumptions,
  type PropertyRow,
} from "@/lib/underwrite/engine";
import { claudeChat } from "@/lib/aiFallback";
import { getSetting, setSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 120; // headroom for the PDF document-reader vision call

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB decoded
const MAX_ROWS = 1000;

// ---------------------------------------------------------------- canonical fields
const STRING_FIELDS = ["address", "city", "state", "zip", "county", "property_type", "notes"] as const;
const NUMBER_FIELDS = [
  "units", "price", "rent_monthly", "other_income_monthly", "taxes_annual",
  "insurance_annual", "hoa_monthly", "rehab_budget", "arv", "back_tax_amount",
] as const;
const CANONICAL_FIELDS: string[] = [...STRING_FIELDS, ...NUMBER_FIELDS];

// ---------------------------------------------------------------- helpers
function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** "$1,250.00" | "65%" | " 1 200 " → number; blanks/garbage → null. */
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Deterministic header-synonym matcher — the fallback when AI is unavailable or
// returns something unusable. First header to claim a canonical field wins.
function synonymFor(header: string): string | null {
  const h = norm(header);
  if (!h) return null;
  const has = (...words: string[]) => words.every((w) => h.includes(w));
  const is = (...cands: string[]) => cands.includes(h);

  // order matters: most specific first
  if (is("full address", "property address", "street address", "address", "property", "addr", "street", "site address", "location")) return "address";
  if (has("address")) return "address";
  if (is("city", "town", "municipality")) return "city";
  if (is("state", "st", "province")) return "state";
  if (is("zip", "zipcode", "zip code", "postal code", "postal")) return "zip";
  if (has("county")) return "county";
  if (is("property type", "type", "prop type", "asset type", "asset class", "product type")) return "property_type";
  if (is("units", "unit count", "of units", "number of units", "doors", "beds units")) return "units";
  if (has("back", "tax") || has("delinquent", "tax") || has("tax", "owed") || has("tax", "lien") || has("past", "due", "tax")) return "back_tax_amount";
  if (has("tax")) return "taxes_annual"; // "annual taxes", "property tax", "taxes", "re taxes"
  if (has("insurance") || is("ins", "annual ins", "hazard")) return "insurance_annual";
  if (has("hoa") || has("association")) return "hoa_monthly";
  if (has("rehab") || has("repair") || has("reno") || has("construction budget") || is("budget")) return "rehab_budget";
  if (is("arv") || has("after repair") || has("after rehab")) return "arv";
  if (has("other", "income") || has("misc", "income") || has("additional", "income") || is("laundry", "parking income", "storage income")) return "other_income_monthly";
  if (has("rent") || has("gross income") || has("monthly income") || is("income")) return "rent_monthly"; // "monthly rent", "gross rent", "rent"
  if (is("purchase price", "list price", "asking price", "price", "value", "current value", "cost", "purchase", "contract price", "sales price", "sale price", "market value", "av", "assessed value")) return "price";
  if (has("price") || has("value")) return "price";
  if (has("note") || has("comment") || has("remark") || has("description")) return "notes";
  return null;
}

function fallbackMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const h of headers) {
    const f = synonymFor(h);
    if (f && !claimed.has(f)) { mapping[h] = f; claimed.add(f); }
    else mapping[h] = "ignore";
  }
  return mapping;
}

// AI column mapping — headers + 3 sample rows only (never per-row AI).
async function aiMapping(headers: string[], sampleRows: unknown[][]): Promise<Record<string, string> | null> {
  try {
    const samples = sampleRows.slice(0, 3).map((r) =>
      headers.map((h, i) => `${h}: ${String(r?.[i] ?? "").slice(0, 60)}`).join(" | ")
    );
    const raw = await claudeChat({
      system:
        `You map spreadsheet column headers to canonical real-estate underwriting fields. ` +
        `Canonical fields: ${CANONICAL_FIELDS.join(", ")}. ` +
        `Respond with a strict JSON object mapping EVERY sheet header to exactly one canonical field, ` +
        `or the string "ignore" if it fits none. Use each canonical field at most once. ` +
        `Example: {"Street":"address","Asking":"price","Gross Rent":"rent_monthly","Agent":"ignore"}`,
      messages: [{
        role: "user",
        content:
          `Sheet headers: ${JSON.stringify(headers)}\n\nSample rows:\n${samples.join("\n")}\n\n` +
          `Return ONLY the JSON mapping {"<sheet header>": "<canonical field or ignore>"}.`,
      }],
      maxTokens: 800,
      json: true,
      timeoutMs: 25000,
    });
    if (!raw) return null;
    // claudeChat(json:true) already strips fences, but be defensive anyway.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const mapping: Record<string, string> = {};
    const claimed = new Set<string>();
    for (const h of headers) {
      const v = typeof (parsed as any)[h] === "string" ? String((parsed as any)[h]).trim() : "";
      if (CANONICAL_FIELDS.includes(v) && !claimed.has(v)) { mapping[h] = v; claimed.add(v); }
      else mapping[h] = "ignore";
    }
    // A mapping that found nothing useful is unusable — let the fallback try.
    if (claimed.size === 0) return null;
    return mapping;
  } catch (e) {
    console.warn("[underwrite] AI mapping failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Row mapping happens in CODE — cheap, deterministic, no per-row AI.
function buildRows(headers: string[], dataRows: unknown[][], mapping: Record<string, string>, sourceSheet?: string, idOffset = 0): PropertyRow[] {
  // header index → canonical field
  const fieldAt: (string | null)[] = headers.map((h) => {
    const f = mapping[h];
    return f && f !== "ignore" && CANONICAL_FIELDS.includes(f) ? f : null;
  });

  const rows: PropertyRow[] = [];
  for (const raw of dataRows) {
    const rec: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const f = fieldAt[i];
      if (f) rec[f] = raw?.[i];
    }
    const address = toStr(rec.address);
    if (!address) continue; // rows without an address are skipped

    const backTax = toNum(rec.back_tax_amount);
    rows.push({
      id: "p" + (idOffset + rows.length),
      source_sheet: sourceSheet ?? null,
      address,
      city: toStr(rec.city),
      state: toStr(rec.state),
      zip: toStr(rec.zip),
      county: toStr(rec.county),
      property_type: toStr(rec.property_type),
      units: toNum(rec.units),
      price: toNum(rec.price),
      rent_monthly: toNum(rec.rent_monthly),
      other_income_monthly: toNum(rec.other_income_monthly),
      // Map what's on the sheet verbatim — even if a taxes value looks monthly, do NOT
      // guess a conversion; the engine flags estimates and humans verify.
      taxes_annual: toNum(rec.taxes_annual),
      insurance_annual: toNum(rec.insurance_annual),
      hoa_monthly: toNum(rec.hoa_monthly),
      rehab_budget: toNum(rec.rehab_budget),
      arv: toNum(rec.arv),
      back_tax_status: backTax != null && backTax > 0 ? "owed" : "unknown",
      back_tax_amount: backTax,
      notes: toStr(rec.notes),
    });
  }
  return rows;
}

// ---------------------------------------------------------------- persistence
// app_settings JSON store, scenarioStore-style: one doc per portfolio + a small index.
const INDEX_KEY = "uw_portfolios_index";
const portfolioKey = (id: string) => `uw_portfolio_${id}`;

type PortfolioDoc = { id: string; name: string; rows: PropertyRow[]; assumptions: Assumptions; updated_at: string };
type IndexEntry = { id: string; name: string; count: number; updated_at: string };

async function readIndex(): Promise<IndexEntry[]> {
  try {
    const v = await getSetting(INDEX_KEY);
    if (!v) return [];
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch { return []; }
}

async function writeIndex(arr: IndexEntry[]): Promise<void> {
  await setSetting(INDEX_KEY, JSON.stringify(arr));
}

// ---------------------------------------------------------------- actions
// Read a PDF property list / rent roll into the SAME 2D grid a spreadsheet yields (row 0 =
// headers, each following row = one property), via the Anthropic document reader with a
// FORCED tool call so the reply structurally IS the grid. Feeds the identical column-map +
// underwrite pipeline below — no separate PDF code path downstream.
async function extractGridsFromPdf(buf: Buffer, filename: string): Promise<{ sheets?: { name: string; grid: unknown[][] }[]; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "Reading a PDF needs the AI document reader — or upload the portfolio as an .xlsx / .csv." };
  const SYSTEM = "You extract a U.S. real-estate rent-roll / property-portfolio table from a PDF into a clean 2D grid. Return ONLY the tool call.";
  const userText = 'This PDF is a property portfolio / rent roll. Extract EVERY property into a 2D array "grid": grid[0] is the column HEADER names exactly as printed (e.g. "Address","Units","Gross Monthly Rent","Market Value","Annual Taxes","Loan Balance","Rate"), and each following array is ONE property\'s cells in the SAME column order. Every property must include its street address. Read ALL pages. Use null for blanks and plain numbers (strip $ and commas). Do not invent columns or rows.';
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
          { type: "text", text: userText },
        ] }],
        tools: [{ name: "report_grid", description: "Return the extracted property table as a 2D array (row 0 = headers).", input_schema: { type: "object", properties: { grid: { type: "array", items: { type: "array" } } }, required: ["grid"] } }],
        tool_choice: { type: "tool", name: "report_grid" },
      }),
      signal: AbortSignal.timeout(100000),
    });
    const jr: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const em = String(jr?.error?.message || res.status);
      if (/overloaded|rate.?limit|429|529/i.test(em)) return { error: "The document reader is busy right now — try again in a few seconds, or upload an .xlsx / .csv." };
      return { error: `Couldn't read that PDF (${em}). Try a clearer PDF, or upload the portfolio as an .xlsx / .csv.` };
    }
    const tu = (jr?.content || []).find((b: any) => b?.type === "tool_use" && Array.isArray(b?.input?.grid));
    const grid: unknown[][] | undefined = tu?.input?.grid;
    if (!Array.isArray(grid) || grid.length < 2) return { error: `Couldn't find a property table in "${filename}" — make sure it lists properties in rows with an address column, or upload an .xlsx / .csv.` };
    const norm = grid.filter((r) => Array.isArray(r)).map((r: any) => (r as any[]).map((c) => (c == null ? null : typeof c === "object" ? JSON.stringify(c) : c)));
    return { sheets: [{ name: (filename.replace(/\.pdf$/i, "").trim() || "PDF"), grid: norm }] };
  } catch (e: any) {
    return { error: `Couldn't read that PDF (${e?.message || "timed out"}). Try again, or upload an .xlsx / .csv.` };
  }
}

async function handleParse(body: any) {
  const filename = toStr(body?.filename) || "upload";
  const fileB64 = typeof body?.file_b64 === "string" ? body.file_b64 : "";
  if (!fileB64) return jsonError("Missing file_b64");

  // Cheap pre-check before allocating: base64 expands ~4/3.
  if (fileB64.length > (MAX_FILE_BYTES * 4) / 3 + 1024) {
    return jsonError("File too large — max 4MB. Trim the sheet and re-upload.", 413);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(fileB64.replace(/^data:[^;]+;base64,/, ""), "base64");
  } catch {
    return jsonError("file_b64 is not valid base64");
  }
  if (!buf.length) return jsonError("Decoded file is empty");
  if (buf.length > MAX_FILE_BYTES) return jsonError("File too large — max 4MB. Trim the sheet and re-upload.", 413);

  // A property list can arrive as a spreadsheet OR a PDF (rent roll / portfolio printout).
  // Spreadsheets parse locally; a PDF is read by the AI document reader into the SAME grid
  // shape, so everything below (header detect, column map, underwrite) is identical.
  type ParsedSheet = { name: string; grid: unknown[][] };
  const isPdf = /\.pdf$/i.test(filename) || buf.subarray(0, 5).toString("latin1") === "%PDF-";
  let sheets: ParsedSheet[];
  if (isPdf) {
    const ext = await extractGridsFromPdf(buf, filename);
    if (ext.error) return jsonError(ext.error, 422);
    sheets = ext.sheets || [];
  } else {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      return jsonError(`Could not read "${filename}" — upload an .xlsx, .xls, .csv, or a PDF rent roll / property list.`);
    }
    sheets = wb.SheetNames.map((n) => ({ name: n, grid: (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true, blankrows: false }) : []) as unknown[][] }));
  }
  const sheetNames = sheets.map((s) => s.name);
  // Portfolio workbooks spread properties across MULTIPLE tabs (per city / pool /
  // category), often with cover pages and title rows. So: for EVERY sheet, detect its
  // own header row (synonym hits weigh heaviest), map its own columns (headers differ
  // tab to tab), rescue an address column when none is named, and AGGREGATE all rows
  // into one portfolio. Properties appearing on two tabs are de-duplicated by address
  // so the totals never double-count.
  const detectHeader = (grid: unknown[][]) => {
    let best: { headerIdx: number; headers: string[]; score: number } | null = null;
    for (let hi = 0; hi < Math.min(grid.length - 1, 15); hi++) {
      const cand = (grid[hi] || []).map((h) => (h == null ? "" : String(h).trim()));
      const textCells = cand.filter((c) => c && !/^[\d$.,%\s-]+$/.test(c));
      if (textCells.length < 2) continue;
      const synHits = cand.filter((c) => c && synonymFor(c)).length;
      const dataBelow = grid.length - hi - 1;
      const score = synHits * 10 + textCells.length + Math.min(dataBelow, 50) / 10;
      if (!best || score > best.score) best = { headerIdx: hi, headers: cand, score };
    }
    return best;
  };
  const rescueAddress = (headers: string[], dataRows: unknown[][], mapping: Record<string, string>) => {
    if (Object.values(mapping).includes("address")) return mapping;
    let bestCol = -1, bestScore = 0;
    for (let i = 0; i < headers.length; i++) {
      const vals = dataRows.slice(0, 50).map((r) => (r?.[i] == null ? "" : String(r[i]).trim())).filter(Boolean);
      if (vals.length < 2) continue;
      const addressish = vals.filter((v) => /\d+\s+\S+/.test(v) && /[a-z]/i.test(v)).length / vals.length;
      const uniq = new Set(vals).size / vals.length;
      const textish = vals.filter((v) => /[a-z]/i.test(v)).length / vals.length;
      const score = addressish * 3 + (textish > 0.8 ? uniq : 0);
      if (score > bestScore) { bestScore = score; bestCol = i; }
    }
    return bestCol >= 0 && bestScore >= 0.5 ? { ...mapping, [headers[bestCol]]: "address" } : mapping;
  };

  const allRows: PropertyRow[] = [];
  const mergedMapping: Record<string, string> = {};
  const sheetsRead: { sheet: string; header_row: number; rows: number }[] = [];
  const sheetsSkipped: string[] = [];
  const mappingCache = new Map<string, Record<string, string>>(); // same headers across tabs → one AI call
  let aiCalls = 0;

  for (const { name: sheetName, grid } of sheets) {
    if (allRows.length >= MAX_ROWS) break;
    if (!grid || grid.length < 2) { sheetsSkipped.push(sheetName); continue; }
    const det = detectHeader(grid);
    if (!det) { sheetsSkipped.push(sheetName); continue; }
    const headers = det.headers;
    const dataRows = grid.slice(det.headerIdx + 1, det.headerIdx + 1 + (MAX_ROWS - allRows.length));

    const sig = headers.map(norm).join("|");
    let mapping = mappingCache.get(sig);
    if (!mapping) {
      // Cap AI mapping calls at 4 distinct header shapes per workbook; synonym
      // fallback handles the rest (and everything when AI is unavailable).
      mapping = (aiCalls < 4 ? (aiCalls++, await aiMapping(headers, dataRows)) : null) ?? fallbackMapping(headers);
      mappingCache.set(sig, mapping);
    }
    mapping = rescueAddress(headers, dataRows, mapping);

    const rows = buildRows(headers, dataRows, mapping, sheetName, allRows.length);
    if (!rows.length) { sheetsSkipped.push(sheetName); continue; }
    allRows.push(...rows);
    Object.assign(mergedMapping, mapping);
    sheetsRead.push({ sheet: sheetName, header_row: det.headerIdx + 1, rows: rows.length });
  }

  if (!allRows.length) {
    return jsonError(
      `No usable rows found. Sections seen: ${sheetNames.join(", ") || "none"}. None had a column readable as a property address — make sure each property has an address column (rename it "Address" if needed) and re-upload.`,
      422
    );
  }

  // De-dupe by normalized address across tabs — keep the row with MORE filled fields
  // (a detail tab beats a summary tab), so portfolio totals never double-count.
  const filled = (r: PropertyRow) => Object.values(r).filter((v) => v != null && v !== "").length;
  const byAddr = new Map<string, PropertyRow>();
  for (const r of allRows) {
    const key = r.address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prev = byAddr.get(key);
    if (!prev || filled(r) > filled(prev)) byAddr.set(key, r);
  }
  const rows = Array.from(byAddr.values()).map((r, i) => ({ ...r, id: "p" + i }));
  const dupesRemoved = allRows.length - rows.length;

  const { results, summary } = underwritePortfolio(rows, DEFAULT_ASSUMPTIONS);
  return NextResponse.json({
    ok: true, columns: Object.keys(mergedMapping), mapping: mergedMapping, rows, results, summary,
    sheets: sheetsRead, sheets_skipped: sheetsSkipped, duplicates_removed: dupesRemoved,
  });
}

function sanitizeAssumptions(a: unknown): Partial<Assumptions> {
  const out: Partial<Assumptions> = {};
  if (a && typeof a === "object") {
    for (const k of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) {
      const v = toNum((a as any)[k]);
      if (v != null) out[k] = v;
    }
  }
  return out;
}

async function handleUnderwrite(body: any) {
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return jsonError("rows must be a non-empty array");
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...sanitizeAssumptions(body?.assumptions) };
  const { results, summary } = underwritePortfolio(rows as PropertyRow[], assumptions);
  return NextResponse.json({ ok: true, results, summary });
}

// ---- MARKET INTEL: Census ACS hard data (by ZIP) + AI area analysis ----------------
// Census API requires a (free) key — app_settings CENSUS_API_KEY (or env). AI brief
// rides the existing claudeChat fallback chain and is labeled as a knowledge-based assessment.
const ACS_VARS = "B19013_001E,B25077_001E,B25064_001E,B25003_001E,B25003_003E"; // income, home value, rent, tenure total, renter-occupied

// ACS vintages before 2020 reject bare ZCTA queries ("ambiguous geography") — they
// must be qualified with the state FIPS via &in=state:NN. 2020+ dropped the hierarchy.
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

async function acsFetch(vintage: number, zip: string, state?: string | null): Promise<number[] | null> {
  try {
    const key = ((await getSetting("CENSUS_API_KEY")) || process.env.CENSUS_API_KEY || "").trim();
    if (!key) return null;
    const fips = STATE_FIPS[String(state || "").trim().toUpperCase()] || null;
    if (vintage < 2020 && !fips) return null; // pre-2020 without a state would 400 anyway
    const inState = vintage < 2020 && fips ? `&in=state:${fips}` : "";
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(
      `https://api.census.gov/data/${vintage}/acs/acs5?get=${ACS_VARS}&for=zip%20code%20tabulation%20area:${encodeURIComponent(zip)}${inState}&key=${encodeURIComponent(key)}`,
      { signal: ctl.signal }
    );
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || j.length < 2) return null;
    return (j[1] as string[]).slice(0, 5).map((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : NaN;
    });
  } catch { return null; }
}

async function handleMarket(body: any) {
  const zip = (toStr(body?.zip) || "").replace(/\D/g, "").slice(0, 5);
  const city = toStr(body?.city), state = toStr(body?.state), address = toStr(body?.address);
  if (!zip && !city) return jsonError("Need a ZIP or city for market intel");

  // 1) Census: latest available vintage + a ~5-years-earlier vintage for trend.
  let census: any = null;
  if (zip) {
    let nowVals: number[] | null = null, nowVintage = 0;
    for (const v of [2023, 2022, 2021]) {
      nowVals = await acsFetch(v, zip, state);
      if (nowVals) { nowVintage = v; break; }
    }
    if (nowVals) {
      const oldVintage = nowVintage - 5;
      const oldVals = await acsFetch(oldVintage, zip, state);
      const pct = (now: number, old: number | undefined) =>
        old && Number.isFinite(old) && old > 0 && Number.isFinite(now) ? Math.round(((now - old) / old) * 1000) / 10 : null;
      const [inc, hv, rent, tenTotal, renters] = nowVals;
      census = {
        zip, vintage: nowVintage, trend_from: oldVals ? oldVintage : null,
        median_income: Number.isFinite(inc) ? inc : null,
        median_home_value: Number.isFinite(hv) ? hv : null,
        median_rent: Number.isFinite(rent) ? rent : null,
        renter_share_pct: Number.isFinite(tenTotal) && Number.isFinite(renters) && tenTotal > 0 ? Math.round((renters / tenTotal) * 100) : null,
        income_change_pct: oldVals ? pct(inc, oldVals[0]) : null,
        home_value_change_pct: oldVals ? pct(hv, oldVals[1]) : null,
        rent_change_pct: oldVals ? pct(rent, oldVals[2]) : null,
      };
    }
  }

  // 2) AI area analysis, anchored to the census figures + the deal's numbers.
  let ai: any = null;
  try {
    const raw = await claudeChat({
      system:
        `You are a rigorous residential real-estate investment analyst. Given a property location, ` +
        `census figures, and deal numbers, produce a JSON assessment. Be SPECIFIC to the neighborhood/ZIP ` +
        `(landmarks, corridors, developments you know of), honest about uncertainty, and never invent statistics — ` +
        `qualitative claims only, anchored to the census numbers provided. Respond with STRICT JSON: ` +
        `{"trajectory":"gentrifying|improving|stable|declining + 1-2 sentences why","gentrification_signals":["..."],` +
        `"rent_context":"is the required/entered rent realistic for this area — 1-2 sentences",` +
        `"price_context":"is the price/ARV realistic for this area — 1-2 sentences",` +
        `"risks":["top 3 area-specific risks"],"strategy":"the single best play for this deal (rental/flip/BRRRR/avoid) and why, 2-3 sentences"}`,
      messages: [{
        role: "user",
        content:
          `Property: ${address || "(address withheld)"}, ${city}, ${state} ${zip}\n` +
          `Census (ACS${census?.vintage ? ` ${census.vintage}` : ""}): ${JSON.stringify(census || "unavailable")}\n` +
          `Deal: price ${body?.price ?? "?"}, entered rent/mo ${body?.rent_monthly ?? "none"}, rehab ${body?.rehab_budget ?? "none"}, ARV ${body?.arv ?? "none"}\n` +
          `Qualifier math: rent needed for target DSCR ${body?.required_rent ?? "?"}/mo; ARV needed for a profitable flip ${body?.arv_needed ?? "?"}.\n` +
          `Return ONLY the JSON object.`,
      }],
      json: true, maxTokens: 900, timeoutMs: 30000,
    });
    if (raw) { try { ai = JSON.parse(raw); } catch { ai = null; } }
  } catch { ai = null; }

  if (!census && !ai) return jsonError("Market intel unavailable right now — census and AI both unreachable.", 502);
  return NextResponse.json({ ok: true, census, ai });
}

async function handleSave(body: any) {
  const p = body?.portfolio;
  const name = toStr(p?.name);
  if (!p || !name) return jsonError("portfolio.name is required");
  if (!Array.isArray(p.rows)) return jsonError("portfolio.rows must be an array");

  const id: string = toStr(p.id) || crypto.randomUUID();
  const doc: PortfolioDoc = {
    id,
    name,
    rows: p.rows as PropertyRow[],
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...sanitizeAssumptions(p.assumptions) },
    updated_at: new Date().toISOString(),
  };
  const saved = await setSetting(portfolioKey(id), JSON.stringify(doc));
  if (!saved) return jsonError("Failed to save the portfolio — storage write did not land.", 500);

  const idx = await readIndex();
  const entry: IndexEntry = { id, name, count: doc.rows.length, updated_at: doc.updated_at };
  const at = idx.findIndex((e) => e.id === id);
  if (at >= 0) idx[at] = entry; else idx.unshift(entry);
  await writeIndex(idx);

  return NextResponse.json({ ok: true, id });
}

async function handleList() {
  const idx = await readIndex();
  idx.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return NextResponse.json({ ok: true, portfolios: idx });
}

async function handleGet(body: any) {
  const id = toStr(body?.id);
  if (!id) return jsonError("id is required");
  const v = await getSetting(portfolioKey(id));
  if (!v) return jsonError("Portfolio not found", 404);
  let doc: PortfolioDoc;
  try {
    doc = typeof v === "string" ? JSON.parse(v) : (v as any);
  } catch {
    return jsonError("Stored portfolio is corrupted", 500);
  }
  if (!doc || typeof doc !== "object") return jsonError("Portfolio not found", 404);
  return NextResponse.json({
    ok: true,
    portfolio: {
      id: doc.id,
      name: doc.name,
      rows: Array.isArray(doc.rows) ? doc.rows : [],
      assumptions: { ...DEFAULT_ASSUMPTIONS, ...sanitizeAssumptions(doc.assumptions) },
      updated_at: doc.updated_at,
    },
  });
}

async function handleDelete(body: any) {
  const id = toStr(body?.id);
  if (!id) return jsonError("id is required");
  await setSetting(portfolioKey(id), ""); // tombstone the doc (empty value reads as absent)
  const idx = await readIndex();
  await writeIndex(idx.filter((e) => e.id !== id));
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------- entrypoint
export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body");
    }
    const action = String(body?.action || "");
    switch (action) {
      case "parse": return await handleParse(body);
      case "underwrite": return await handleUnderwrite(body);
      case "market": return await handleMarket(body);
      case "save": return await handleSave(body);
      case "list": return await handleList();
      case "get": return await handleGet(body);
      case "delete": return await handleDelete(body);
      default:
        return jsonError(`Unknown action "${action}" — expected parse | underwrite | save | list | get | delete`);
    }
  } catch (e) {
    console.error("[underwrite] error:", e);
    return jsonError(e instanceof Error ? e.message : "Internal error", 500);
  }
}
