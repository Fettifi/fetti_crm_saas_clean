// Single source of truth for turning a lead's tier/score (+ optional Qualify-agent
// decision) into a visible quality badge. Pure + dependency-free so BOTH the
// server pipeline and the client lead board can use it without divergence.
//
// Two axes, kept separate on purpose: this is LEAD QUALITY (how fundable), which is
// distinct from the funnel STAGE (how far along). Commercial CRMs show both.

export type LeadQualityKey = "hot" | "qualified" | "review" | "nurture" | "declined" | "unknown";

export type LeadQuality = {
  key: LeadQualityKey;
  label: string;
  cls: string;   // Tailwind classes (dark CRM theme)
  rank: number;  // higher = hotter; used to sort qualified leads to the top
};

export function leadQuality(input: { tier?: string | null; score?: number | null; decision?: string | null }): LeadQuality {
  const tier = String(input.tier || "").toLowerCase();
  const decision = String(input.decision || "").toLowerCase();

  // The Qualify agent's explicit decision wins when we have it.
  if (decision === "decline") {
    return { key: "declined", label: "Decline", cls: "bg-slate-700/50 text-slate-400", rank: 0 };
  }
  if (decision === "needs_info") {
    return { key: "review", label: "Needs info", cls: "bg-amber-500/20 text-amber-300", rank: 2 };
  }

  const isTier1 = tier === "tier 1" || (typeof input.score === "number" && input.score >= 70);
  const isTier2 = tier === "tier 2" || (typeof input.score === "number" && input.score >= 40 && input.score < 70);

  if (decision === "qualified") {
    return isTier1
      ? { key: "hot", label: "🔥 Hot", cls: "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/40", rank: 4 }
      : { key: "qualified", label: "Qualified", cls: "bg-emerald-500/15 text-emerald-300", rank: 3 };
  }
  if (isTier1) return { key: "hot", label: "🔥 Hot", cls: "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/40", rank: 4 };
  if (isTier2) return { key: "qualified", label: "Qualified", cls: "bg-emerald-500/15 text-emerald-300", rank: 3 };
  if (tier === "tier 3") return { key: "nurture", label: "Nurture", cls: "bg-slate-700/50 text-slate-300", rank: 1 };
  return { key: "unknown", label: "—", cls: "text-slate-600", rank: 0 };
}
