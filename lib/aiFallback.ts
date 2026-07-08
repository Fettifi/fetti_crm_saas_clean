// Claude fallback for the conversion-critical AI paths. When OpenAI errors
// (quota exhausted, outage — like the 2026-07-08 insufficient_quota incident
// that silently killed the agent pipeline and Mark's replies), the CRM keeps
// answering leads on Anthropic's flagship instead of going dark.
//
// Owner rule (highest-model-always): fallback is Claude Opus — never a mini.
// Key: ANTHROPIC_API_KEY via app_settings (cfg) first, then env — so a key can
// be added/rotated without a redeploy. Fail-soft: no key or a dead key just
// returns null and callers keep their existing degraded behavior.
import { cfg } from "@/lib/settings";

const CLAUDE_MODEL = "claude-opus-4-8";

export type ClaudeMsg = { role: "user" | "assistant"; content: string };

export async function claudeChat(opts: {
  system: string;
  messages: ClaudeMsg[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;               // ask for a bare JSON object and strip fences
  timeoutMs?: number;
}): Promise<string | null> {
  try {
    const key = ((await cfg("ANTHROPIC_API_KEY")) || "").trim();
    if (!key) return null;
    const system = opts.json
      ? `${opts.system}\n\nRespond with ONLY a valid JSON object — no prose, no markdown fences.`
      : opts.system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: opts.maxTokens ?? 900,
        temperature: opts.temperature ?? 0.6,
        system,
        messages: opts.messages.length ? opts.messages : [{ role: "user", content: "(begin)" }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    const j = await res.json();
    if (!res.ok) {
      console.warn("[aiFallback] claude error:", j?.error?.type || res.status);
      return null;
    }
    let text = String((j?.content || []).map((c: any) => c?.text || "").join("")).trim();
    if (!text) return null;
    if (opts.json) {
      // strip accidental fences and grab the outermost object
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) text = text.slice(start, end + 1);
    }
    return text;
  } catch (e) {
    console.warn("[aiFallback] claude failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
