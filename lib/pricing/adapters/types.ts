// Channel-adapter contract. A "channel" is a live wholesale-pricing source
// (e.g. Optimal Blue / Loansifter) that returns normalized PricingProduct rows
// so they drop straight into the existing compare() engine alongside AI-parsed
// rate sheets. Adapters NEVER write to the DB themselves — the route orchestrates
// clearLender()+addProducts() after a human-verifiable test. Type-only import of
// the product shape keeps this module free of any server-only runtime deps.
import type { PricingProduct, Scenario } from "@/lib/pricing/compare";

export type AdapterStatus =
  | "ok"
  | "not_configured"
  | "auth_failed"
  | "endpoint_error"
  | "parse_error";

export interface AdapterStep {
  name: string;
  ok: boolean;
  info?: string;
}

export interface AdapterResult {
  status: AdapterStatus;
  products: PricingProduct[];   // already normalized; ready for addProducts()
  count: number;
  detail: string;               // human message for the UI
  lenderId?: string;            // so the route can clearLender() before re-adding
  steps?: AdapterStep[];        // populated by testConnection()
  sample?: PricingProduct | null; // dry-run normalize of the first product (test only)
  mappedFields?: number;        // how many response-map fields resolved to non-null
  roles?: string[];             // JWT roles claim (entitlement check; non-secret)
  tokenTtlSec?: number;
  raw?: unknown;                // truncated raw response, for filling the field maps; NEVER persisted
}

export interface ConfigStatus {
  configured: boolean;
  keys: Record<string, boolean>;   // key -> isSet (boolean ONLY; never the value)
  missing: string[];
}

export interface PricingChannelAdapter {
  readonly channel: string;        // "optimalblue"
  readonly displayName: string;    // "Optimal Blue (Loansifter)"
  configStatus(): Promise<ConfigStatus>;
  isConfigured(): Promise<boolean>;
  testConnection(): Promise<AdapterResult>;             // creds + token + 1 dry-run; no DB write
  fetchProducts(scenario?: Scenario): Promise<AdapterResult>; // pull + normalize; no DB write
}

export type { PricingProduct, Scenario };
