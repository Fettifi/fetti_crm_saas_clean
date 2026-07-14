// Runtime-writable config (DB). Env vars can't be changed while the app runs;
// these can — which is what lets the system self-heal (e.g. refresh a token).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export async function getSetting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    return data?.value ?? null;
  } catch { return null; }
}

// Return whether the write actually landed. Previously this swallowed EVERY error and
// still reported success, so a token refresh / lock / message-queue write could be
// silently lost. Callers that ignore the boolean behave exactly as before; the ones
// that must not lose data (queue CAS, token refresh) can now detect failure and react.
export async function setSetting(key: string, value: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) { console.warn(`[settings] setSetting(${key}) failed:`, error.message); return false; }
    return true;
  } catch (e: any) { console.warn(`[settings] setSetting(${key}) threw:`, e?.message); return false; }
}

// STRICT read for read-modify-write callers. Unlike getSetting (which returns null on
// ANY error), this DISTINGUISHES "absent" (null) from "DB read failed" (throws). A RMW
// over a shared JSON blob must abort on a transient read error instead of treating it
// as empty and overwriting good data with [] — that is how the phone-message queue used
// to wipe its whole history on a blip. Also returns updated_at for compare-and-set.
export type SettingRow = { value: string | null; updated_at: string | null };
export async function getSettingRow(key: string): Promise<SettingRow | null> {
  const { data, error } = await supabaseAdmin.from("app_settings").select("value, updated_at").eq("key", key).maybeSingle();
  if (error) throw new Error(`getSettingRow(${key}) failed: ${error.message}`);
  return data ? { value: (data as any).value ?? null, updated_at: (data as any).updated_at ?? null } : null;
}

// Optimistic concurrency: write only if the row's updated_at still equals `expected`
// (or the row is absent when expected === null). Returns false when another writer won
// the race, so the caller can re-read and retry — turning the shared JSON blob into a
// safe compare-and-set cell instead of a lossy last-writer-wins overwrite.
export async function casSetting(key: string, expected: string | null, value: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  if (expected === null) {
    // Row is expected to be brand-new — a concurrent insert loses on the PK conflict.
    const { error } = await supabaseAdmin.from("app_settings").insert({ key, value, updated_at: nowIso });
    if (error) { if ((error as any).code === "23505") return false; throw new Error(`casSetting(${key}) insert failed: ${error.message}`); }
    return true;
  }
  const { data, error } = await supabaseAdmin.from("app_settings")
    .update({ value, updated_at: nowIso }).eq("key", key).eq("updated_at", expected).select("key");
  if (error) throw new Error(`casSetting(${key}) update failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// DB value first, then env. Lets self-healed values override the static env.
export async function cfg(key: string): Promise<string | null> {
  return (await getSetting(key)) || process.env[key] || null;
}
