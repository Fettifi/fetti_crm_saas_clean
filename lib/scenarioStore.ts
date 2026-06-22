// Scenario Desk persistence — a clean, storage-agnostic data-access layer.
//
// Today it persists to the existing `app_settings` key-value table (one JSON doc for
// scenarios, one for wholesalers) via the service role — zero new DDL required, works
// immediately. Because every caller goes through these functions, swapping to dedicated
// `loan_scenarios` / `wholesalers` tables later is an internal change here only — no API
// or UI edits. Deal volume for a single shop is tiny, so a JSON doc is more than fine.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import type { Scenario, Wholesaler, Quote } from "@/lib/scenario";

const SCENARIOS_KEY = "SCENARIOS";
const WHOLESALERS_KEY = "WHOLESALERS";

// app_settings.value may be stored as text or jsonb depending on the column — handle both.
async function readArr<T>(key: string): Promise<T[]> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    const v = (data as any)?.value;
    if (v == null) return [];
    const parsed = typeof v === "string" ? JSON.parse(v || "[]") : v;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch { return []; }
}

async function writeArr<T>(key: string, arr: T[]): Promise<void> {
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key, value: JSON.stringify(arr), updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export function genId(): string {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 24);
}

export function scenarioNumber(): string {
  const d = new Date();
  return `SC-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ---- Scenarios ----
export async function listScenarios(): Promise<Scenario[]> {
  const arr = await readArr<Scenario>(SCENARIOS_KEY);
  return arr.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getScenario(id: string): Promise<Scenario | null> {
  const arr = await readArr<Scenario>(SCENARIOS_KEY);
  return arr.find((s) => s.id === id) || null;
}

// Upsert a scenario by id. Returns the saved record. Always refreshes updated_at.
export async function saveScenario(s: Scenario): Promise<Scenario> {
  const arr = await readArr<Scenario>(SCENARIOS_KEY);
  const now = new Date().toISOString();
  const next: Scenario = { ...s, updated_at: now, quotes: Array.isArray(s.quotes) ? s.quotes : [] };
  const idx = arr.findIndex((x) => x.id === s.id);
  if (idx >= 0) arr[idx] = next; else arr.unshift(next);
  await writeArr(SCENARIOS_KEY, arr);
  return next;
}

export async function deleteScenario(id: string): Promise<void> {
  const arr = await readArr<Scenario>(SCENARIOS_KEY);
  await writeArr(SCENARIOS_KEY, arr.filter((s) => s.id !== id));
}

// Merge a quote into a scenario (by quote.id, or by wholesaler_id if no id yet).
export async function upsertQuote(scenarioId: string, quote: Quote): Promise<Scenario | null> {
  const arr = await readArr<Scenario>(SCENARIOS_KEY);
  const idx = arr.findIndex((s) => s.id === scenarioId);
  if (idx < 0) return null;
  const s = arr[idx];
  const quotes = Array.isArray(s.quotes) ? [...s.quotes] : [];
  const qi = quotes.findIndex((q) => (quote.id && q.id === quote.id) || q.wholesaler_id === quote.wholesaler_id);
  if (qi >= 0) quotes[qi] = { ...quotes[qi], ...quote }; else quotes.push(quote);
  arr[idx] = { ...s, quotes, updated_at: new Date().toISOString() };
  await writeArr(SCENARIOS_KEY, arr);
  return arr[idx];
}

// ---- Wholesalers ----
export async function listWholesalers(): Promise<Wholesaler[]> {
  const arr = await readArr<Wholesaler>(WHOLESALERS_KEY);
  return arr.sort((a, b) => a.company.localeCompare(b.company));
}

export async function saveWholesaler(w: Wholesaler): Promise<Wholesaler> {
  const arr = await readArr<Wholesaler>(WHOLESALERS_KEY);
  const idx = arr.findIndex((x) => x.id === w.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...w }; else arr.push(w);
  await writeArr(WHOLESALERS_KEY, arr);
  return w;
}

export async function deleteWholesaler(id: string): Promise<void> {
  const arr = await readArr<Wholesaler>(WHOLESALERS_KEY);
  await writeArr(WHOLESALERS_KEY, arr.filter((w) => w.id !== id));
}
