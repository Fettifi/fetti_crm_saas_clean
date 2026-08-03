// READ ONLY. No writes, no network except Supabase SELECTs.
import { config } from "dotenv"; config({ path: "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local" });
import { createClient } from "@supabase/supabase-js";
import { scoreSignals, checkPhonePattern, editDistance, type ShieldSignal } from "./lib/leadShield";
import { leadReality } from "./lib/leadReality";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const Q = 60, W = 30, J = 90;

function bandFor(sigs: ShieldSignal[]) {
  const risk = Math.max(0, sigs.reduce((a, s) => a + s.pts, 0));
  const hard = sigs.some((s) => s.ev === "hard");
  const quarantine = hard || risk >= Q;
  const onlySoftHard = sigs.filter((s) => s.ev === "hard").every((s) => s.key === "honeypot" || s.key === "surge.active");
  const band = quarantine
    ? ((hard && !onlySoftHard) || risk >= J + (hard && onlySoftHard ? 999 : 0) ? "junk" : "gray")
    : risk >= W ? "watch" : "clean";
  return { risk, hard, quarantine, band };
}

async function main() {
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: all, error } = await sb.from("leads")
    .select("id, full_name, first_name, last_name, email, phone, loan_purpose, stage, created_at, tier, nurture_step, nurture_paused, last_nurture_at, raw, credit_score, property_value, loan_amount_requested, source")
    .order("created_at", { ascending: true }).limit(2000);
  if (error) throw error;
  console.log("TOTAL LEADS:", all!.length);

  // nurture.ts gates prior to the reality check (lib/nurture.ts:279-376)
  const dripEligible = all!.filter((l: any) =>
    l.created_at >= cutoff &&
    !l.nurture_paused &&
    String(l.stage || "").toLowerCase() !== "review" &&
    (l.phone || l.email) &&
    !/@fetti-internal\.test$/i.test(l.email || ""));
  console.log("DRIP-ELIGIBLE (pre-reality gates):", dripEligible.length);

  const today = new Map<string, any>();
  for (const l of dripEligible) today.set(l.id, leadReality({ raw: l.raw, name: l.full_name, email: l.email, phone: l.phone }));
  const dist: Record<string, number> = {};
  for (const r of today.values()) dist[r.level] = (dist[r.level] || 0) + 1;
  console.log("TODAY reality distribution:", dist);

  const unverified = dripEligible.filter((l: any) => today.get(l.id)!.level === "unverified");
  console.log("UNVERIFIED COUNT:", unverified.length);

  // ---- Replicate the sweep's identity-group detection over the WHOLE lead table
  // (a real backfill would consider all leads, not just New Lead/Contacted)
  const byPhone = new Map<string, any[]>();
  for (const l of all!) {
    const p = String(l.phone || "").replace(/\D/g, "").slice(-10);
    if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(l); }
  }
  const groupHit = new Set<string>();
  for (const rows of byPhone.values()) {
    if (rows.length < 2) continue;
    const firsts: string[] = [];
    for (const r of rows) {
      const f = String(r.full_name || "").trim().toLowerCase().split(/\s+/)[0];
      if (!f) continue;
      if (!firsts.some((x) => x === f || editDistance(x, f) <= 2 || x.startsWith(f) || f.startsWith(x))) firsts.push(f);
    }
    if (firsts.length >= 3) for (const r of rows) groupHit.add(r.id);
  }

  // ---- Score each unverified lead with the sweep's FREE-signal path
  const results: any[] = [];
  for (const l of unverified) {
    const { signals } = scoreSignals({ body: l as any, channel: "api", ip: null, internal: true }, {});
    const sigs: ShieldSignal[] = [...signals.filter((s) => !["transport.api", "fst.missing", "ua.missing"].includes(s.key))];
    if (groupHit.has(l.id)) sigs.push({ key: "identity.multi_name", pts: 60, ev: "hard" });
    const ph = checkPhonePattern(l.phone);
    if (ph && !sigs.some((s) => s.key === ph.key)) sigs.push(ph);
    const b = bandFor(sigs);
    // What leadReality would return if this verdict were written to raw.shield
    const hypoRaw = { ...(l.raw || {}), shield: { version: 1, verdict: b.quarantine ? "quarantine" : "pass", band: b.band, risk: b.risk, signals: sigs, channel: "api", retro: true, lookup: null, sms_capable: true } };
    const after = leadReality({ raw: hypoRaw, name: l.full_name, email: l.email, phone: l.phone });
    results.push({ id: l.id, name: l.full_name, email: l.email, phone: l.phone, stage: l.stage, source: l.source,
      nurture_step: l.nurture_step, last_nurture_at: l.last_nurture_at, created_at: l.created_at,
      risk: b.risk, band: b.band, hard: b.hard, quarantine: b.quarantine,
      sigs: sigs.map((s) => `${s.key}:${s.pts}${s.note ? `(${s.note})` : ""}`), after: after.level, afterReason: after.reason });
  }

  const bandDist: Record<string, number> = {};
  const afterDist: Record<string, number> = {};
  for (const r of results) { bandDist[r.band] = (bandDist[r.band] || 0) + 1; afterDist[r.after] = (afterDist[r.after] || 0) + 1; }
  console.log("\nBACKFILL band distribution (free signals only, NO Twilio lookup):", bandDist);
  console.log("POST-BACKFILL reality level distribution:", afterDist);

  const blocked = results.filter((r) => r.after === "suspect" || r.after === "invalid");
  console.log("\n=== WOULD BE BLOCKED FROM NURTURE AFTER BACKFILL:", blocked.length, "===");
  for (const r of blocked) {
    console.log(JSON.stringify({ id: r.id, name: r.name, email: r.email, phone: r.phone, stage: r.stage, source: r.source,
      nurture_step: r.nurture_step, last_nurture_at: r.last_nurture_at, created_at: r.created_at,
      risk: r.risk, band: r.band, after: r.after, reason: r.afterReason, sigs: r.sigs }));
  }

  // signal frequency across all 166
  const sigFreq: Record<string, number> = {};
  for (const r of results) for (const s of r.sigs) { const k = s.split(":")[0]; sigFreq[k] = (sigFreq[k] || 0) + 1; }
  console.log("\nSIGNAL FREQUENCY across the unverified set:", sigFreq);

  // How many are in the shield-sweep's scope at all (New Lead/Contacted)?
  const inSweepScope = unverified.filter((l: any) => /^(new lead|contacted|new)$/i.test(String(l.stage || "")));
  console.log("\nUNVERIFIED in shield-sweep scope (New Lead/Contacted):", inSweepScope.length, "of", unverified.length);
  const stageDist: Record<string, number> = {};
  for (const l of unverified) stageDist[String(l.stage)] = (stageDist[String(l.stage)] || 0) + 1;
  console.log("Stage distribution of the unverified set:", stageDist);

  // Are the blocked ones being actively worked?
  const blockedIds = blocked.map((r) => r.id);
  if (blockedIds.length) {
    const { data: acts } = await sb.from("activity_log").select("lead_id, action, actor, detail, created_at")
      .in("lead_id", blockedIds).order("created_at", { ascending: false }).limit(3000);
    const byLead = new Map<string, any[]>();
    for (const a of acts || []) { if (!byLead.has(a.lead_id)) byLead.set(a.lead_id, []); byLead.get(a.lead_id)!.push(a); }
    console.log("\n=== ACTIVITY ON BLOCKED LEADS ===");
    for (const r of blocked) {
      const rows = byLead.get(r.id) || [];
      const inbound = rows.filter((a) => a.action === "comms.message" && a.detail?.direction === "inbound");
      const outbound = rows.filter((a) => a.action === "comms.message" && a.detail?.direction !== "inbound");
      console.log(`${r.name} <${r.email}> ${r.phone} | acts=${rows.length} inbound=${inbound.length} outbound=${outbound.length} | last=${rows[0]?.action}@${rows[0]?.created_at}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
