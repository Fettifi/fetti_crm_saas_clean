// Fallback chain for the conversion-critical AI paths. When OpenAI errors
// (quota exhausted, outage — the 2026-07-08 insufficient_quota incident silently
// killed the agent pipeline and Mark's replies), the CRM keeps answering leads:
//   1. Claude Opus (ANTHROPIC_API_KEY — app_settings or env; add it and it wins)
//   2. Gemini 2.5 Pro (GEMINI_API_KEY — already on the account)
// Owner rule (highest-model-always): flagship tiers only, never a mini/flash.
// Fail-soft: no keys / dead keys return null and callers keep their existing
// degraded behavior (template first touch, canned chat line, human task alert).
import { cfg } from "@/lib/settings";

const CLAUDE_MODEL = "claude-opus-4-8";
const GEMINI_MODEL = "gemini-2.5-pro";

export type ClaudeMsg = { role: "user" | "assistant"; content: string };

type ChatOpts = {
  system: string;
  messages: ClaudeMsg[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;               // ask for a bare JSON object and strip fences
  timeoutMs?: number;
};

function stripToJson(text: string): string {
  let t = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

/** Provider chain: Claude Opus → Gemini 2.5 Pro. Returns null only when ALL fail. */
export async function claudeChat(opts: ChatOpts): Promise<string | null> {
  const viaClaude = await claudeOnly(opts);
  if (viaClaude) return viaClaude;
  return geminiOnly(opts);
}

async function claudeOnly(opts: ChatOpts): Promise<string | null> {
  try {
    const key = ((await cfg("ANTHROPIC_API_KEY")) || "").trim();
    if (!key) return null;
    const system = opts.json
      ? `${opts.system}\n\nRespond with ONLY a valid JSON object — no prose, no markdown fences.`
      : opts.system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      // NB: no `temperature` — deprecated on claude-opus-4-8, the API 400s on it.
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: opts.maxTokens ?? 900,
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
    return opts.json ? stripToJson(text) : text;
  } catch (e) {
    console.warn("[aiFallback] claude failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function geminiOnly(opts: ChatOpts): Promise<string | null> {
  try {
    const key = ((await cfg("GEMINI_API_KEY")) || "").trim();
    if (!key) { console.warn("[aiFallback] no fallback provider keys configured"); return null; }
    const contents = (opts.messages.length ? opts.messages : [{ role: "user" as const, content: "(begin)" }])
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system + (opts.json ? "\n\nRespond with ONLY a valid JSON object — no prose, no markdown fences." : "") }] },
        contents,
        // Gemini 2.5 Pro ALWAYS thinks (min budget 128) and thinking tokens count
        // against maxOutputTokens — cap the thinking small and give the answer
        // explicit headroom, or short replies come back EMPTY (finish MAX_TOKENS).
        generationConfig: { maxOutputTokens: (opts.maxTokens ?? 900) + 512, temperature: opts.temperature ?? 0.6, thinkingConfig: { thinkingBudget: 128 }, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    const j = await res.json();
    if (!res.ok) {
      console.warn("[aiFallback] gemini error:", j?.error?.status || res.status);
      return null;
    }
    const text = String((j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("")).trim();
    if (!text) return null;
    return opts.json ? stripToJson(text) : text;
  } catch (e) {
    console.warn("[aiFallback] gemini failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
