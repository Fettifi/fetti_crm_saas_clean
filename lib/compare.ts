// Loan Comparison persistence (app_settings — no DDL, same pattern as the Scenario
// Desk). Pure types/helpers live in lib/compareTypes.ts and are re-exported here so
// existing imports from "@/lib/compare" keep working. The client page imports the
// pure module directly (this file pulls in supabaseAdmin, which is server-only).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import type { Comparison } from "@/lib/compareTypes";

export * from "@/lib/compareTypes";

const KEY = "LOAN_COMPARISONS";

/** THE DANGEROUS FAILURE: this returned [] for BOTH "no comparisons exist" and "the read failed".
 *  Every write is a read-modify-write of one JSON blob, so a transient read error made
 *  saveComparison write back an array containing ONLY the new record — silently deleting every
 *  other comparison in the system. A read that fails must THROW, so the write never happens. */
async function readAll(): Promise<Comparison[]> {
  const { data, error } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(`comparisons: read failed (${error.message}) — refusing to continue, a write now would erase the others`);
  const v = (data as any)?.value;
  if (v == null) return [];
  let parsed: unknown;
  try { parsed = typeof v === "string" ? JSON.parse(v || "[]") : v; }
  catch (e: any) { throw new Error(`comparisons: stored value is not valid JSON (${e?.message}) — refusing to overwrite it`); }
  // A non-array is corruption, not emptiness. Overwriting it would destroy whatever is there.
  if (!Array.isArray(parsed)) throw new Error("comparisons: stored value is not an array — refusing to overwrite it");
  return parsed as Comparison[];
}

/** And a write that fails must not report success — the LO saw "Saved." on a dropped upsert. */
async function writeAll(arr: Comparison[]): Promise<void> {
  const { error } = await supabaseAdmin.from("app_settings").upsert(
    { key: KEY, value: JSON.stringify(arr), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(`comparisons: save failed (${error.message}) — nothing was stored`);
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
