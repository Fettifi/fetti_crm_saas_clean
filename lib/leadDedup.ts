// LEAD DEDUPLICATION — the self-healing safety net.
//
// Every intake path (/api/apply, meta webhook, metaHeal importer, calendly, sms)
// already does a best-effort SELECT-then-INSERT dedup by canonical phone / email.
// But without a DB unique constraint (schema migrations are gated in this env),
// concurrent submissions of the SAME person via DIFFERENT paths — the Meta lead-ad
// webhook AND a landing-page form firing within the same minute, or Meta re-importing
// a person under a new leadgen_id days later — can still race past those checks and
// create a second row. That's the residual duplicate problem Ramon keeps seeing.
//
// This reconciler doesn't try to win the race at insert time. It runs AFTER the fact
// (on a schedule + on demand), groups every lead by canonical phone (then email),
// and for each group with more than one LIVE row it KEEPS the best one and neutralizes
// the rest (stage "Dead", nurture_paused, raw.duplicate_of = keeperId). It is
// idempotent, reversible (nothing is deleted), and catches duplicates no matter how
// they were created. Rows that carry a loan file are never neutralized — a documented
// deal is always kept.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { canonicalPhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/leadShield";

// Higher = further along; the keeper is the most-advanced (then oldest) row.
const STAGE_RANK: Record<string, number> = {
  funded: 7, closed: 7, submitted: 6, processing: 6, application: 5,
  engaged: 4, contacted: 3, "new lead": 2, new: 2, review: 1,
  "not qualified": 0, dead: -1, lost: -1,
};
const stageRank = (s?: string | null) => STAGE_RANK[String(s || "").toLowerCase()] ?? 2;

export type DedupeReport = {
  scanned: number;
  dupGroups: number;
  collapsed: number;
  skippedHasFile: number;
  keepers: number;
  details: Array<{ key: string; keep: string; dup: string; dupName: string | null; dupStage: string | null; skipped?: string }>;
};

/** Collapse duplicate leads. apply=false is a dry run (reports, writes nothing). */
export async function reconcileLeadDuplicates(apply = false, limit = 8000): Promise<DedupeReport> {
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, created_at, full_name, email, phone, stage, nurture_paused, raw")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (!leads || !leads.length) return { scanned: 0, dupGroups: 0, collapsed: 0, skippedHasFile: 0, keepers: 0, details: [] };

  // Never neutralize a lead that has a loan file — that's a real, documented deal.
  const { data: lf } = await supabaseAdmin.from("loan_files").select("lead_id");
  const hasFile = new Set((lf || []).map((r: any) => r.lead_id).filter(Boolean));

  // Group by canonical phone; fall back to normalized email when there's no phone.
  const groups = new Map<string, any[]>();
  for (const l of leads as any[]) {
    const cp = canonicalPhone(l.phone);
    const key = cp ? "p:" + cp : (l.email ? "e:" + normalizeEmail(l.email) : null);
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)!).push(l);
  }

  const details: DedupeReport["details"] = [];
  let dupGroups = 0, collapsed = 0, skippedHasFile = 0, keepers = 0;

  for (const [key, arr] of groups) {
    // Only rows not already neutralized as duplicates count toward a group.
    const active = arr.filter((l) => !(l.raw && l.raw.duplicate_of));
    if (active.length < 2) continue;
    dupGroups++;

    // Keeper: has a loan file > furthest stage > oldest.
    active.sort((a, b) => {
      const fa = hasFile.has(a.id) ? 1 : 0, fb = hasFile.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const ra = stageRank(a.stage), rb = stageRank(b.stage);
      if (ra !== rb) return rb - ra;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const keep = active[0];
    keepers++;

    for (const dup of active.slice(1)) {
      if (hasFile.has(dup.id)) {
        // Two documented rows for one contact — needs a human merge, don't auto-kill.
        skippedHasFile++;
        details.push({ key, keep: keep.id, dup: dup.id, dupName: dup.full_name, dupStage: dup.stage, skipped: "has_loan_file" });
        continue;
      }
      collapsed++;
      details.push({ key, keep: keep.id, dup: dup.id, dupName: dup.full_name, dupStage: dup.stage });
      if (apply) {
        const raw2 = { ...(dup.raw || {}), duplicate_of: keep.id, duplicate_key: "reconcile:" + key };
        await supabaseAdmin.from("leads").update({ stage: "Dead", nurture_paused: true, raw: raw2 }).eq("id", dup.id);
      }
    }
  }
  return { scanned: leads.length, dupGroups, collapsed, skippedHasFile, keepers, details };
}
