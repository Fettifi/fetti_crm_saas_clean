// Rupee long-term memory ("The Vault"). Deterministic save + recall so secrets
// you tell Rupee are persisted forever and re-injected into her context on every
// message. This does NOT rely on the LLM choosing to call a tool — when you ask
// her to remember something, the server saves it directly.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export type Memory = { topic: string; insight: string };

/** Persist a fact. Upserts by topic so repeats update rather than duplicate. */
export async function rememberFact(insight: string, topic?: string): Promise<boolean> {
  const cleanInsight = insight.trim();
  if (!cleanInsight) return false;
  const t = (topic || cleanInsight).slice(0, 80);
  try {
    const { data: existing } = await supabaseAdmin
      .from("rupee_memory")
      .select("id")
      .eq("topic", t)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("rupee_memory")
        .update({ insight: cleanInsight, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("rupee_memory").insert([{ topic: t, insight: cleanInsight }]);
    }
    return true;
  } catch (e) {
    console.error("[memory] save failed:", e);
    return false;
  }
}

export async function getAllMemories(): Promise<Memory[]> {
  try {
    const { data } = await supabaseAdmin
      .from("rupee_memory")
      .select("topic, insight")
      .order("created_at", { ascending: true });
    return (data as Memory[]) || [];
  } catch {
    return [];
  }
}

const INTENT = /\b(remember|don'?t forget|never forget|note that|keep in mind|make a note|save this|memoriz|my (name|secret|password|goal|birthday|address|preference|wife|kid|kids|number) is|the secret is|for the record)\b/i;

/** If the message asks Rupee to remember something, return the text to store. */
export function detectMemoryIntent(message: string): string | null {
  const m = (message || "").trim();
  if (!m) return null;
  return INTENT.test(m) ? m : null;
}
