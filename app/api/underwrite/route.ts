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
export const maxDuration = 60;

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
function buildRows(headers: string[], dataRows: unknown[][], mapping: Record<string, string>): PropertyRow[] {
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
      id: "p" + rows.length,
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

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return jsonError(`Could not read "${filename}" — upload an .xlsx, .xls, or .csv spreadsheet.`);
  }
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) return jsonError("The spreadsheet has no sheets.");

  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
  if (!grid.length) return jsonError("The first sheet is empty.");

  const headers = (grid[0] || []).map((h) => (h == null ? "" : String(h).trim()));
  if (!headers.some(Boolean)) return jsonError("No header row found on the first sheet.");
  const dataRows = grid.slice(1, 1 + MAX_ROWS);
  if (!dataRows.length) return jsonError("The sheet has a header row but no data rows.");

  const mapping = (await aiMapping(headers, dataRows)) ?? fallbackMapping(headers);
  const rows = buildRows(headers, dataRows, mapping);
  if (!rows.length) {
    return jsonError("No usable rows — could not find an address column. Check the sheet's headers.", 422);
  }

  const { results, summary } = underwritePortfolio(rows, DEFAULT_ASSUMPTIONS);
  return NextResponse.json({ ok: true, columns: headers, mapping, rows, results, summary });
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
