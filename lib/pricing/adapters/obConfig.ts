// Optimal Blue / Loansifter configuration + OAuth2 token manager.
//
// EVERY OB-specific value is read from app_settings (DB-first via cfg(), env
// fallback) — nothing about OB's gated API (token URL, gateway host, endpoint
// path, request/response field names) is hardcoded, because none of it is
// publicly documented. Ramon pastes the real values from his AUTHENTICATED
// Optimal Blue "Digital Marketplace" Swagger and the adapter works with no
// redeploy. Auth is OAuth 2.0 client-credentials on Azure AD; token is cached +
// self-refreshed, mirroring lib/metaHeal.ts. Secrets are never logged.
import "server-only";
import { getSetting, setSetting, cfg } from "@/lib/settings";

export const OB_KEYS = {
  // --- auth (all from OB onboarding / authenticated portal) ---
  tokenUrl: "OB_TOKEN_URL",
  clientId: "OB_CLIENT_ID",
  clientSecret: "OB_CLIENT_SECRET",
  resource: "OB_RESOURCE",                 // audience/scope string
  tokenParamStyle: "OB_TOKEN_PARAM_STYLE", // "resource" (default) | "scope"
  subscriptionKey: "OB_SUBSCRIPTION_KEY",  // optional Ocp-Apim-Subscription-Key
  // --- endpoint (from authenticated Swagger) ---
  apiBase: "OB_API_BASE",
  pricingPath: "OB_PRICING_PATH",
  pricingMethod: "OB_PRICING_METHOD",      // default POST
  authHeader: "OB_AUTH_HEADER",            // default Authorization
  authScheme: "OB_AUTH_SCHEME",            // default Bearer
  // --- routing identity (OB "Configuration Reports > Entity Selection") ---
  businessChannel: "OB_BUSINESS_CHANNEL",  // Entity_ID
  originatorId: "OB_ORIGINATOR_ID",        // user_index
  // --- field maps (copied from the Swagger request/response examples) ---
  requestMap: "OB_REQUEST_MAP",            // JSON: our scenario key -> OB dot-path
  requestStatic: "OB_REQUEST_STATIC",      // JSON: constant fields merged into the body
  responseMap: "OB_RESPONSE_MAP",          // JSON: { productsPath, fields:{ our: obPath } }
  loanTypeMap: "OB_LOANTYPE_MAP",          // JSON: OB loan-type value -> our enum
  priceIsCost: "OB_PRICE_IS_COST",         // "true" if OB returns cost not price%
  termIsYears: "OB_TERM_IS_YEARS",         // "true" if OB term is in years
  // --- behavior ---
  lenderId: "OB_LENDER_ID",                // default optimal-blue
  lenderName: "OB_LENDER_NAME",            // default Optimal Blue (Loansifter)
  syncScenarios: "OB_SYNC_SCENARIOS",      // JSON array of standing scenarios to sweep
  keepIneligible: "OB_KEEP_INELIGIBLE",    // "true" to persist ineligible products too
  timeoutMs: "OB_TIMEOUT_MS",              // default 12000
} as const;

// The minimum set required before we'll even attempt a connection.
export const REQUIRED_KEYS = [
  OB_KEYS.tokenUrl, OB_KEYS.clientId, OB_KEYS.clientSecret, OB_KEYS.apiBase, OB_KEYS.pricingPath,
];

// Sensible behavioral defaults. NOTE: the request/response MAPS below are
// PLACEHOLDER guesses (OB's real keys are gated) — they only take effect once a
// connection is configured, and testConnection()'s dry-run shows whether they
// matched so Ramon can correct them before any sync writes data.
export const DEFAULT_REQUEST_MAP: Record<string, string> = {
  loanAmount: "loanAmount", propertyValue: "propertyValue", fico: "fico", ltv: "ltv",
  occupancy: "occupancy", purpose: "purpose", loanType: "loanType", termMonths: "termMonths",
  propertyType: "propertyType", state: "state", dscr: "dscr",
  businessChannel: "businessChannel", originatorId: "originatorId",
};
export const DEFAULT_RESPONSE_MAP = {
  productsPath: "products",
  fields: {
    productName: "productName", loanType: "loanType", termMonths: "term",
    noteRate: "rate", pricePercent: "price", lockDays: "lockPeriod",
    minFico: "minFico", maxLtv: "maxLtv", investorName: "investorName", eligible: "eligible",
  } as Record<string, string>,
};

async function jsonCfg<T>(key: string, fallback: T): Promise<T> {
  const raw = await cfg(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
const truthy = (v: string | null) => v === "true" || v === "1";

export type ObConfig = {
  tokenUrl?: string; clientId?: string; clientSecret?: string; resource?: string;
  tokenParamStyle: "resource" | "scope"; subscriptionKey?: string;
  apiBase?: string; pricingPath?: string; pricingMethod: string;
  authHeader: string; authScheme: string;
  businessChannel?: string; originatorId?: string;
  requestMap: Record<string, string>; requestStatic: Record<string, unknown>;
  responseMap: typeof DEFAULT_RESPONSE_MAP; loanTypeMap: Record<string, string>;
  priceIsCost: boolean; termIsYears: boolean;
  lenderId: string; lenderName: string; syncScenarios: any[];
  keepIneligible: boolean; timeoutMs: number;
};

// Bootstrap any OB_* values present in env into the DB on first read, so they're
// runtime-manageable thereafter (same philosophy as metaHeal). Idempotent.
export async function bootstrapObEnv(): Promise<void> {
  for (const key of Object.values(OB_KEYS)) {
    if (process.env[key] && !(await getSetting(key))) {
      await setSetting(key, process.env[key] as string);
    }
  }
}

export async function loadObConfig(): Promise<ObConfig> {
  return {
    tokenUrl: (await cfg(OB_KEYS.tokenUrl)) || undefined,
    clientId: (await cfg(OB_KEYS.clientId)) || undefined,
    clientSecret: (await cfg(OB_KEYS.clientSecret)) || undefined,
    resource: (await cfg(OB_KEYS.resource)) || undefined,
    tokenParamStyle: (await cfg(OB_KEYS.tokenParamStyle)) === "scope" ? "scope" : "resource",
    subscriptionKey: (await cfg(OB_KEYS.subscriptionKey)) || undefined,
    apiBase: (await cfg(OB_KEYS.apiBase)) || undefined,
    pricingPath: (await cfg(OB_KEYS.pricingPath)) || undefined,
    pricingMethod: ((await cfg(OB_KEYS.pricingMethod)) || "POST").toUpperCase(),
    authHeader: (await cfg(OB_KEYS.authHeader)) || "Authorization",
    authScheme: (await cfg(OB_KEYS.authScheme)) || "Bearer",
    businessChannel: (await cfg(OB_KEYS.businessChannel)) || undefined,
    originatorId: (await cfg(OB_KEYS.originatorId)) || undefined,
    requestMap: await jsonCfg(OB_KEYS.requestMap, DEFAULT_REQUEST_MAP),
    requestStatic: await jsonCfg(OB_KEYS.requestStatic, {}),
    responseMap: await jsonCfg(OB_KEYS.responseMap, DEFAULT_RESPONSE_MAP),
    loanTypeMap: await jsonCfg(OB_KEYS.loanTypeMap, {}),
    priceIsCost: truthy(await cfg(OB_KEYS.priceIsCost)),
    termIsYears: truthy(await cfg(OB_KEYS.termIsYears)),
    lenderId: (await cfg(OB_KEYS.lenderId)) || "optimal-blue",
    lenderName: (await cfg(OB_KEYS.lenderName)) || "Optimal Blue (Loansifter)",
    syncScenarios: await jsonCfg<any[]>(OB_KEYS.syncScenarios, []),
    keepIneligible: truthy(await cfg(OB_KEYS.keepIneligible)),
    timeoutMs: Number(await cfg(OB_KEYS.timeoutMs)) || 12000,
  };
}

// Decode the non-secret JWT `roles` claim so the test can confirm entitlement.
function decodeRoles(jwt: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    const r = payload.roles ?? payload.role ?? payload.scope ?? [];
    return Array.isArray(r) ? r : typeof r === "string" ? r.split(/[\s,]+/).filter(Boolean) : [];
  } catch { return []; }
}

export type TokenResult = { token?: string; error?: string; ttlSec?: number; roles?: string[] };

// OAuth2 client-credentials token, cached in app_settings and refreshed ~60s
// before expiry. Never logs the secret or the token.
export async function getAccessToken(force = false): Promise<TokenResult> {
  const c = await loadObConfig();
  if (!c.tokenUrl || !c.clientId || !c.clientSecret) return { error: "missing OAuth config (token URL / client id / secret)" };

  if (!force) {
    const cached = await getSetting("OB_TOKEN");
    const exp = Number(await getSetting("OB_TOKEN_EXP")) || 0;
    if (cached && exp - Date.now() > 60000) {
      return { token: cached, ttlSec: Math.round((exp - Date.now()) / 1000), roles: decodeRoles(cached) };
    }
  }

  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret });
  if (c.tokenParamStyle === "scope") { if (c.resource) body.set("scope", c.resource); }
  else if (c.resource) body.set("resource", c.resource);

  try {
    const r = await fetch(c.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      // j.error / error_description are OB's, not our secret — but keep it short.
      return { error: `token endpoint ${r.status}: ${String(j.error_description || j.error || "no access_token returned").slice(0, 200)}` };
    }
    const ttl = Number(j.expires_in) || 3600;
    await setSetting("OB_TOKEN", j.access_token);
    await setSetting("OB_TOKEN_EXP", String(Date.now() + ttl * 1000));
    return { token: j.access_token, ttlSec: ttl, roles: decodeRoles(j.access_token) };
  } catch (e: any) {
    return { error: `token request failed: ${e?.name === "TimeoutError" ? "timeout" : (e?.message || "network error")}` };
  }
}

// --- dot-path helpers (request building + response reading) ---
export function setPath(obj: any, path: string, value: unknown): void {
  const parts = path.split(".");
  // Guard against prototype-pollution via map keys (admin-set today, defensive).
  if (parts.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return;
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof node[k] !== "object" || node[k] == null) node[k] = {};
    node = node[k];
  }
  node[parts[parts.length - 1]] = value;
}
export function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((n: any, k) => (n == null ? undefined : n[k]), obj);
}
