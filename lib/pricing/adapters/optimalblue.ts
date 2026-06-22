// Optimal Blue / Loansifter pricing adapter. Pulls "Scenario Pricing" results
// and normalizes them to the existing PricingProduct shape. Fully config-driven
// (see obConfig.ts) — request body is built from OB_REQUEST_MAP and the response
// is read via OB_RESPONSE_MAP, so OB's gated, account-specific field names are
// DATA, never code. Returns graceful statuses (never throws to the UI); the
// route writes to the DB only after a human verifies the dry-run mapping.
import "server-only";
import type { PricingChannelAdapter, AdapterResult, AdapterStep, ConfigStatus, PricingProduct, Scenario } from "@/lib/pricing/adapters/types";
import {
  OB_KEYS, REQUIRED_KEYS, bootstrapObEnv, loadObConfig, getAccessToken, setPath, getPath, type ObConfig,
} from "@/lib/pricing/adapters/obConfig";
import { cfg } from "@/lib/settings";

const LOANTYPE_ENUM = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "DSCR", "NonQM", "Other"];

function normLoanType(raw: unknown, map: Record<string, string>): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Other";
  if (map[s]) return map[s];
  const hit = LOANTYPE_ENUM.find((e) => e.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  const l = s.toLowerCase();
  if (l.includes("dscr")) return "DSCR";
  if (l.includes("fha")) return "FHA";
  if (l.includes("usda")) return "USDA";
  if (/\bva\b/.test(l)) return "VA";
  if (l.includes("jumbo")) return "Jumbo";
  if (l.includes("non") && l.includes("qm")) return "NonQM";
  if (l.includes("conv")) return "Conventional";
  return "Other";
}
function normOccupancy(raw: unknown): string | undefined {
  const l = String(raw ?? "").toLowerCase();
  if (!l) return undefined;
  if (l.includes("invest") || l.includes("nonowner") || l.includes("non-owner")) return "Investment";
  if (l.includes("second") || l.includes("vacation")) return "SecondHome";
  if (l.includes("primary") || l.includes("owner")) return "PrimaryResidence";
  return undefined;
}
function normPurpose(raw: unknown): string | undefined {
  const l = String(raw ?? "").toLowerCase();
  if (!l) return undefined;
  if (l.includes("cash")) return "CashOutRefinance";
  if (l.includes("refi") || l.includes("rate")) return "Refinance";
  if (l.includes("purchase")) return "Purchase";
  return undefined;
}
const numOrUndef = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : undefined;
};

function scenarioSummary(s: Scenario): string {
  const ltv = s.propertyValue && s.loanAmount ? Math.round((s.loanAmount / s.propertyValue) * 100) : undefined;
  return [
    s.loanType, s.purpose, s.occupancy,
    s.loanAmount ? `$${Math.round(s.loanAmount).toLocaleString()}` : undefined,
    ltv ? `${ltv}% LTV` : undefined, s.fico ? `${s.fico} FICO` : undefined, s.state,
  ].filter(Boolean).join(" · ");
}

function buildRequestBody(c: ObConfig, s: Scenario): any {
  const ltv = s.propertyValue && s.loanAmount ? (s.loanAmount / s.propertyValue) * 100 : undefined;
  const sources: Record<string, unknown> = {
    loanAmount: s.loanAmount, propertyValue: s.propertyValue, fico: s.fico, ltv,
    occupancy: s.occupancy, purpose: s.purpose, loanType: s.loanType,
    propertyType: s.propertyType, state: s.state, dscr: s.dscr,
    businessChannel: c.businessChannel, originatorId: c.originatorId,
  };
  const body: any = { ...(c.requestStatic || {}) };
  for (const [srcKey, obPath] of Object.entries(c.requestMap || {})) {
    const v = sources[srcKey];
    if (v !== undefined && v !== null && obPath) setPath(body, obPath, v);
  }
  return body;
}

function normalizeProduct(c: ObConfig, raw: any, scenario: Scenario): PricingProduct {
  const f = c.responseMap.fields || {};
  const get = (ourKey: string) => (f[ourKey] ? getPath(raw, f[ourKey]) : undefined);

  let pricePercent = numOrUndef(get("pricePercent"));
  if (pricePercent != null && c.priceIsCost) pricePercent = 100 - pricePercent;

  let termMonths = numOrUndef(get("termMonths"));
  if (termMonths != null && c.termIsYears) termMonths = termMonths * 12;

  const investor = get("investorName");
  const eligible = get("eligible");
  const notes = [
    `via Optimal Blue · ${scenarioSummary(scenario)}`,
    investor ? `investor: ${investor}` : undefined,
    eligible === false || String(eligible).toLowerCase() === "false" ? "INELIGIBLE" : undefined,
    raw?.id || raw?.productId ? `obid: ${raw.id || raw.productId}` : undefined,
  ].filter(Boolean).join(" · ");

  return {
    id: crypto.randomUUID(),
    lenderId: c.lenderId,
    lenderName: c.lenderName,
    productName: String(get("productName") ?? "Optimal Blue product"),
    loanType: normLoanType(get("loanType") ?? scenario.loanType, c.loanTypeMap),
    termMonths,
    amortization: undefined,
    noteRate: numOrUndef(get("noteRate")),
    pricePercent,
    lockDays: numOrUndef(get("lockDays")),
    minFico: numOrUndef(get("minFico")),
    maxLtv: numOrUndef(get("maxLtv")),
    minLoanAmount: numOrUndef(get("minLoanAmount")),
    maxLoanAmount: numOrUndef(get("maxLoanAmount")),
    minDscr: numOrUndef(get("minDscr")),
    occupancy: normOccupancy(get("occupancy") ?? scenario.occupancy) ? [normOccupancy(get("occupancy") ?? scenario.occupancy)!] : undefined,
    purpose: normPurpose(get("purpose") ?? scenario.purpose) ? [normPurpose(get("purpose") ?? scenario.purpose)!] : undefined,
    propertyTypes: undefined,
    states: scenario.state ? [scenario.state.toUpperCase()] : undefined,
    notes,
    uploadedAt: new Date().toISOString(),
  };
}

function resolveProducts(c: ObConfig, json: any): any[] {
  const path = c.responseMap.productsPath || "products";
  const at = getPath(json, path);
  if (Array.isArray(at)) return at;
  if (Array.isArray(json)) return json;            // some APIs return a bare array
  return [];
}

const DEFAULT_SCENARIO: Scenario = { loanAmount: 400000, propertyValue: 500000, fico: 740, occupancy: "PrimaryResidence", purpose: "Purchase", loanType: "Conventional", state: "CA" };

async function callPricing(c: ObConfig, token: string, body: any): Promise<{ status: number; json?: any; text?: string }> {
  const url = `${c.apiBase!.replace(/\/$/, "")}/${c.pricingPath!.replace(/^\//, "")}`;
  const headers: Record<string, string> = {
    [c.authHeader]: `${c.authScheme} ${token}`.trim(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (c.subscriptionKey) headers["Ocp-Apim-Subscription-Key"] = c.subscriptionKey;
  const method = c.pricingMethod || "POST";
  const res = await fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(c.timeoutMs),
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

export const optimalBlueAdapter: PricingChannelAdapter = {
  channel: "optimalblue",
  displayName: "Optimal Blue (Loansifter)",

  async configStatus(): Promise<ConfigStatus> {
    await bootstrapObEnv();
    const keys: Record<string, boolean> = {};
    for (const k of Object.values(OB_KEYS)) keys[k] = !!(await cfg(k));
    const missing = REQUIRED_KEYS.filter((k) => !keys[k]);
    return { configured: missing.length === 0, keys, missing };
  },

  async isConfigured(): Promise<boolean> {
    return (await this.configStatus()).configured;
  },

  async testConnection(): Promise<AdapterResult> {
    const cfgStatus = await this.configStatus();
    const c = await loadObConfig();
    const steps: AdapterStep[] = [];
    const base: AdapterResult = { status: "ok", products: [], count: 0, detail: "", lenderId: c.lenderId, steps };

    if (!cfgStatus.configured) {
      steps.push({ name: "Config present", ok: false, info: `missing: ${cfgStatus.missing.join(", ")}` });
      return { ...base, status: "not_configured", detail: `Not configured — set: ${cfgStatus.missing.join(", ")}` };
    }
    steps.push({ name: "Config present", ok: true, info: "all required OB_* keys set" });

    // 1) Token mint
    const tok = await getAccessToken(true);
    if (!tok.token) {
      steps.push({ name: "OAuth token", ok: false, info: tok.error });
      return { ...base, status: "auth_failed", detail: tok.error || "could not mint token", steps };
    }
    steps.push({ name: "OAuth token", ok: true, info: `minted · ~${tok.ttlSec}s · roles: ${(tok.roles || []).join(", ") || "none in JWT"}` });

    // 2) Smallest real pricing call
    const scenario = (Array.isArray(c.syncScenarios) && c.syncScenarios[0]) || DEFAULT_SCENARIO;
    let call = await callPricing(c, tok.token, buildRequestBody(c, scenario));
    if (call.status === 401) {
      const fresh = await getAccessToken(true);
      if (fresh.token) call = await callPricing(c, fresh.token, buildRequestBody(c, scenario));
    }
    if (call.status === 401) {
      steps.push({ name: "Pricing call", ok: false, info: "401 — token valid but client_id not entitled to this API" });
      return { ...base, status: "auth_failed", detail: "401 from pricing endpoint — your client_id isn't entitled to Scenario Pricing / Broker P&P", steps };
    }
    if (call.status < 200 || call.status >= 300) {
      steps.push({ name: "Pricing call", ok: false, info: `HTTP ${call.status} — check OB_PRICING_PATH / request map` });
      return { ...base, status: "endpoint_error", detail: `Pricing endpoint returned HTTP ${call.status}`, steps, raw: (call.text || "").slice(0, 2000) };
    }
    steps.push({ name: "Pricing call", ok: true, info: `HTTP ${call.status}` });

    // 3) Response shape / field map
    const products = resolveProducts(c, call.json);
    if (!products.length) {
      steps.push({ name: "Response shape", ok: false, info: `no array at productsPath "${c.responseMap.productsPath}" — fix OB_RESPONSE_MAP` });
      return { ...base, status: "parse_error", detail: "Connected + authorized, but no products found at the configured productsPath — set OB_RESPONSE_MAP to OB's real keys", steps, raw: (call.text || "").slice(0, 2000) };
    }
    const sample = normalizeProduct(c, products[0], scenario);
    const mappedFields = Object.keys(c.responseMap.fields || {}).filter((k) => getPath(products[0], c.responseMap.fields[k]) != null).length;
    steps.push({ name: "Response shape", ok: true, info: `${products.length} products · ${mappedFields}/${Object.keys(c.responseMap.fields || {}).length} fields mapped` });
    steps.push({ name: "Dry-run normalize", ok: !!sample.noteRate, info: sample.noteRate ? `e.g. ${sample.productName} @ ${sample.noteRate}%` : "normalized, but noteRate didn't map — check OB_RESPONSE_MAP.fields.noteRate" });

    return {
      ...base, status: "ok",
      detail: `Connected. ${products.length} products from a test scenario; ${mappedFields} fields mapped. Verify the sample, then Pull live rates.`,
      count: products.length, sample, mappedFields, roles: tok.roles, tokenTtlSec: tok.ttlSec,
      raw: (call.text || "").slice(0, 2000),
    };
  },

  async fetchProducts(scenario?: Scenario): Promise<AdapterResult> {
    const cfgStatus = await this.configStatus();
    const c = await loadObConfig();
    if (!cfgStatus.configured) {
      return { status: "not_configured", products: [], count: 0, lenderId: c.lenderId, detail: `Not configured — set: ${cfgStatus.missing.join(", ")}` };
    }
    const tok = await getAccessToken();
    if (!tok.token) return { status: "auth_failed", products: [], count: 0, lenderId: c.lenderId, detail: tok.error || "auth failed" };

    const scenarios: Scenario[] = scenario ? [scenario]
      : (Array.isArray(c.syncScenarios) && c.syncScenarios.length ? c.syncScenarios : [DEFAULT_SCENARIO]);

    const all: PricingProduct[] = [];
    let lastErr = "";
    for (const sc of scenarios) {
      let call = await callPricing(c, tok.token, buildRequestBody(c, sc));
      if (call.status === 401) {
        const fresh = await getAccessToken(true);
        if (fresh.token) call = await callPricing(c, fresh.token, buildRequestBody(c, sc));
      }
      if (call.status < 200 || call.status >= 300) { lastErr = `HTTP ${call.status}`; continue; }
      const products = resolveProducts(c, call.json);
      for (const p of products) {
        const norm = normalizeProduct(c, p, sc);
        const isIneligible = (norm.notes || "").includes("INELIGIBLE");
        if (isIneligible && !c.keepIneligible) continue;
        all.push(norm);
      }
    }

    if (!all.length) {
      return { status: lastErr ? "endpoint_error" : "parse_error", products: [], count: 0, lenderId: c.lenderId, detail: lastErr ? `No products pulled (${lastErr})` : "Connected, but no products matched the response map" };
    }
    return { status: "ok", products: all, count: all.length, lenderId: c.lenderId, detail: `Pulled ${all.length} products across ${scenarios.length} scenario(s)` };
  },
};
