// Runtime-writable config (DB). Env vars can't be changed while the app runs;
// these can — which is what lets the system self-heal (e.g. refresh a token).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export async function getSetting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    return data?.value ?? null;
  } catch { return null; }
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    await supabaseAdmin.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch { /* best-effort */ }
}

// DB value first, then env. Lets self-healed values override the static env.
export async function cfg(key: string): Promise<string | null> {
  return (await getSetting(key)) || process.env[key] || null;
}
