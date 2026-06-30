import { AgentDef } from "@/lib/agents/agents";
import { BRAND_BRIEF } from "@/lib/brand";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

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
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const messages = [
    { role: "system", content: `${BRAND_BRIEF}\n\n${agent.system}` },
    {
      role: "user",
      content:
        `Here is the lead record (JSON). Run your stage and return ONLY the JSON for your schema.\n\nLEAD:\n${leadContext(lead)}`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);

  let output: Record<string, any> = {};
  try {
    output = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    output = { summary: json.choices?.[0]?.message?.content ?? "(no output)" };
  }
  const summary = typeof output.summary === "string" ? output.summary : `${agent.name} completed.`;
  return { summary, output };
}
