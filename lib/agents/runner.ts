import { AgentDef } from "@/lib/agents/agents";
import { BRAND_BRIEF } from "@/lib/brand";
import { claudeChat } from "@/lib/aiFallback";

// HARD FLOOR (owner rule): borrower-facing copy never runs on a mini/nano model —
// the mini ignores the capture prompt's banned-phrase + app-link rules ("thanks for
// reaching out…" regression, verified live 2026-07-07). Env can upgrade, never downgrade.
const envModel = process.env.OPENAI_MODEL || "";
const OPENAI_MODEL = envModel && !/mini|nano/i.test(envModel) ? envModel : "gpt-4o";

// Compact a lead record into the fields the agents care about.
function leadContext(lead: Record<string, any>): string {
  const keep = [
    "full_name", "first_name", "last_name", "email", "phone", "state", "city",
    "loan_purpose", "occupancy", "property_type", "property_value",
    "loan_amount_requested", "credit_band", "credit_score", "liquid_assets",
    "income", "stage", "tier", "score", "notes", "source",
  ];
  const obj: Record<string, any> = {};
  for (const k of keep) if (lead[k] !== undefined && lead[k] !== null) obj[k] = lead[k];
  return JSON.stringify(obj, null, 2);
}

export type AgentResult = { summary: string; output: Record<string, any> };

export async function runAgent(agent: AgentDef, lead: Record<string, any>): Promise<AgentResult> {
  const systemPrompt = `${BRAND_BRIEF}\n\n${agent.system}`;
  const userPrompt = `Here is the lead record (JSON). Run your stage and return ONLY the JSON for your schema.\n\nLEAD:\n${leadContext(lead)}`;

  let content: string | null = null;
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 900,
          response_format: { type: "json_object" },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
      content = json.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      console.warn(`[runner] OpenAI failed for ${agent.name} — trying Claude fallback:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  // FALLBACK (2026-07-08 quota incident): OpenAI down/out-of-credit must not
  // silence the agent pipeline — Claude Opus picks it up (highest-model rule).
  if (!content) {
    content = await claudeChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 900, temperature: 0.4, json: true,
    });
  }
  if (!content) throw new Error("all AI providers failed (OpenAI + Claude)");

  let output: Record<string, any> = {};
  try {
    output = JSON.parse(content);
  } catch {
    output = { summary: content };
  }
  const summary = typeof output.summary === "string" ? output.summary : `${agent.name} completed.`;
  return { summary, output };
}
