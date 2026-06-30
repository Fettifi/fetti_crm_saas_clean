// Loan Comparison persistence (app_settings — no DDL, same pattern as the Scenario
// Desk). Pure types/helpers live in lib/compareTypes.ts and are re-exported here so
// existing imports from "@/lib/compare" keep working. The client page imports the
// pure module directly (this file pulls in supabaseAdmin, which is server-only).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import type { Comparison } from "@/lib/compareTypes";

export * from "@/lib/compareTypes";

const KEY = "LOAN_COMPARISONS";

async function readAll(): Promise<Comparison[]> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = (data as any)?.value;
    if (v == null) return [];
    const parsed = typeof v === "string" ? JSON.parse(v || "[]") : v;
    return Array.isArray(parsed) ? (parsed as Comparison[]) : [];
  } catch { return []; }
}

async function writeAll(arr: Comparison[]): Promise<void> {
  await supabaseAdmin.from("app_settings").upsert(
    { key: KEY, value: JSON.stringify(arr), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

export async function listComparisons(): Promise<Comparison[]> {
  const arr = await readAll();
  return arr.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getComparison(id: string): Promise<Comparison | null> {
  const arr = await readAll();
  return arr.find((c) => c.id === id) || null;
}

export async function saveComparison(c: Comparison): Promise<Comparison> {
  const arr = await readAll();
  const now = new Date().toISOString();
  const next: Comparison = { ...c, updated_at: now, quotes: Array.isArray(c.quotes) ? c.quotes : [] };
  const idx = arr.findIndex((x) => x.id === c.id);
  if (idx >= 0) arr[idx] = next; else arr.unshift(next);
  await writeAll(arr);
  return next;
}

export async function deleteComparison(id: string): Promise<void> {
  const arr = await readAll();
  await writeAll(arr.filter((c) => c.id !== id));
}
