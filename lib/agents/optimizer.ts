// The Application Coach — the 6th agent. Unlike the per-lead pipeline agents,
// this one LEARNS at the funnel level: it studies how real applicants move
// through the conversational wizard (drop-off, completion, which goals/products
// convert) plus the prior lessons it has already banked, and returns refined,
// compounding guidance. Its `config` output is fed straight back into the live
// wizard so each cohort of applicants benefits from what earlier ones taught us.

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type OptimizerInput = {
  period: string;
  funnel: Record<string, unknown>;     // step views/answers, drop-off, completion
  outcomes: Record<string, unknown>;   // tier mix by product/goal/occupancy from leads
  priorInsights: string[];             // lessons banked in earlier runs (learning memory)
};

export type OptimizerOutput = {
  summary: string;
  insights: string[];          // cumulative lessons (carry forward what still holds)
  recommendations: string[];   // concrete suggestions for the human team
  config: { goal_order?: string[]; tip?: string }; // applied live by the wizard
};

const SYSTEM = `You are the "Application Coach" for Fetti Financial Services — a learning agent that
optimizes a conversational mortgage application wizard. Goal: maximize completed, high-quality
applications without hurting trust or compliance.

The wizard starts by asking the applicant's GOAL, one of these exact values:
["buy","refi","invest","flip","equity","business","reverse"]
Occupancy is the key driver: if a borrower won't live there it's an investment/business loan.
DSCR loans must NOT ask for personal income.

You are given: a FUNNEL summary (where people drop off, completion rate, by goal/product),
OUTCOMES (lead tier mix by product/goal/occupancy), and PRIOR_INSIGHTS (lessons you banked in
earlier runs). LEARN cumulatively: keep prior insights that still hold, drop ones the new data
contradicts, add new ones. Be specific and data-grounded; if the sample is tiny, say so and stay
conservative. Never invent rates, approvals, or guarantees.

Output ONLY valid JSON:
{
  "summary": string,                       // 1-2 sentences: the single most important takeaway
  "insights": string[],                    // cumulative lessons (<=8), most important first
  "recommendations": string[],             // concrete changes for the team (<=6)
  "config": {
    "goal_order": string[],                // the 7 goal values reordered best-converting first (use ONLY the allowed values)
    "tip": string                          // <=90 chars reassuring/social-proof line to show under the first question; compliant, no promises
  }
}`;

export async function runOptimizer(input: OptimizerInput): Promise<OptimizerOutput> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const user = `PERIOD: ${input.period}

FUNNEL:
${JSON.stringify(input.funnel, null, 2)}

OUTCOMES:
${JSON.stringify(input.outcomes, null, 2)}

PRIOR_INSIGHTS (what you've learned so far — refine, don't just repeat):
${input.priorInsights.length ? input.priorInsights.map((s) => `- ${s}`).join("\n") : "(none yet — this is the first run)"}

Return ONLY the JSON for your schema.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      max_tokens: 900,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);

  let out: OptimizerOutput;
  try {
    out = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    out = { summary: "(no output)", insights: [], recommendations: [], config: {} };
  }
  // Sanitize the goal_order to the allowed values, dedup, keep order.
  const allowed = ["buy", "refi", "invest", "flip", "equity", "business", "reverse"];
  const order = Array.isArray(out.config?.goal_order)
    ? out.config!.goal_order.filter((g) => allowed.includes(g))
    : [];
  const goal_order = [...new Set(order)];
  for (const g of allowed) if (!goal_order.includes(g)) goal_order.push(g); // ensure all present
  out.config = { goal_order, tip: typeof out.config?.tip === "string" ? out.config.tip.slice(0, 120) : undefined };
  out.insights = Array.isArray(out.insights) ? out.insights.slice(0, 8) : [];
  out.recommendations = Array.isArray(out.recommendations) ? out.recommendations.slice(0, 6) : [];
  out.summary = typeof out.summary === "string" ? out.summary : "Application Coach run complete.";
  return out;
}
