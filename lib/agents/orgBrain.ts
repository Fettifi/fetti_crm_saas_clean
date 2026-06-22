// The Enterprise Brain. Sits above the per-lead pipeline and the wizard's
// Application Coach: it reads the whole company's activity stream + pipeline +
// funnel and learns, run over run, how Fetti is tracking toward its North Star
// (funded loans/month). It returns org-wide insights, the team's next best
// actions, and brand guidance — so every part of the CRM pulls one direction.
import { BRAND, BRAND_BRIEF } from "@/lib/brand";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type OrgBrainInput = {
  period: string;
  metrics: Record<string, unknown>;     // leads, tiers, pipeline by stage, funded, activity volume
  activity: Record<string, unknown>;    // action counts across the org
  priorInsights: string[];              // compounding memory
};

export type OrgBrainOutput = {
  summary: string;
  north_star: { metric: string; label: string; target: number; current: number; progress_pct: number; on_track: boolean };
  insights: string[];
  priorities: string[];                 // next best actions for the team, ranked
  brand: { voice: string; do: string[]; dont: string[] };
};

const SYSTEM = `You are the Enterprise Brain for ${BRAND.company} — the single intelligence that keeps the
whole mortgage operation pulling toward one goal. ${BRAND_BRIEF}

PURPOSE: This business exists to protect and provide for the Dent family (Ramon, Piaget, Adisen, and Giselle Dent). Every judgment you make serves one end — grow and secure the family's financial future by funding more loans, profitably, and protecting the operation. Optimize for REVENUE, not vanity metrics.

You are given METRICS (leads, lead quality, loan pipeline by stage, funded count, activity volume, and
REVENUE_BY_SOURCE — funded dollars + estimated revenue per lead source, the margin %, and est_revenue_30d),
ACTIVITY (counts of actions across the company this period), and PRIOR_INSIGHTS (what you learned before).
Learn cumulatively. Your job is to find where the MONEY actually comes from and tell the team the highest-
REVENUE-leverage next actions: double down on the sources/activities that produce funded dollars, cut or fix
what costs effort/spend but never funds, and remove the biggest leak between lead and FUNDED. Tie priorities
to dollars where you can. Be specific and grounded; if data is thin, say so plainly. Never promise approvals or rates.

Output ONLY valid JSON:
{
  "summary": string,                                  // 1-2 sentences: where the business stands + the one thing to do
  "north_star": {
    "metric": "funded_loans_per_month",
    "label": string,
    "target": number,
    "current": number,                                // funded this period from metrics
    "progress_pct": number,                           // 0-100 toward target
    "on_track": boolean
  },
  "insights": string[],                               // <=8 cumulative lessons about the business
  "priorities": string[],                             // <=6 ranked next best actions for the team
  "brand": { "voice": string, "do": string[], "dont": string[] }  // brand guidance the whole CRM should follow
}`;

export async function runOrgBrain(input: OrgBrainInput): Promise<OrgBrainOutput> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const user = `PERIOD: ${input.period}
NORTH_STAR_TARGET: ${BRAND.northStar.target} funded loans/month

METRICS:
${JSON.stringify(input.metrics, null, 2)}

ACTIVITY (action counts this period):
${JSON.stringify(input.activity, null, 2)}

PRIOR_INSIGHTS (refine, don't just repeat):
${input.priorInsights.length ? input.priorInsights.map((s) => `- ${s}`).join("\n") : "(none yet)"}

Return ONLY the JSON for your schema.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      max_tokens: 1000,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);

  let out: OrgBrainOutput;
  try { out = JSON.parse(json.choices?.[0]?.message?.content ?? "{}"); }
  catch { out = {} as OrgBrainOutput; }

  out.summary = typeof out.summary === "string" ? out.summary : "Enterprise Brain run complete.";
  out.insights = Array.isArray(out.insights) ? out.insights.slice(0, 8) : [];
  out.priorities = Array.isArray(out.priorities) ? out.priorities.slice(0, 6) : [];
  const ns = out.north_star || ({} as OrgBrainOutput["north_star"]);
  out.north_star = {
    metric: "funded_loans_per_month",
    label: ns.label || BRAND.northStar.label,
    target: typeof ns.target === "number" ? ns.target : BRAND.northStar.target,
    current: typeof ns.current === "number" ? ns.current : 0,
    progress_pct: Math.max(0, Math.min(100, typeof ns.progress_pct === "number" ? ns.progress_pct : 0)),
    on_track: !!ns.on_track,
  };
  out.brand = {
    voice: out.brand?.voice || BRAND.voice,
    do: Array.isArray(out.brand?.do) ? out.brand!.do.slice(0, 6) : [],
    dont: Array.isArray(out.brand?.dont) ? out.brand!.dont.slice(0, 6) : [],
  };
  return out;
}
