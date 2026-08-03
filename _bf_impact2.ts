// READ ONLY. DNS MX lookups are free; Twilio Lookup is PAID and is NOT called here —
// we only READ the existing 90-day cache rows in app_settings.
import { config } from "dotenv"; config({ path: "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local" });
import { createClient } from "@supabase/supabase-js";
import { scoreSignals, checkPhonePattern, checkMx, editDistance, type ShieldSignal } from "./lib/leadShield";
import { leadReality } from "./lib/leadReality";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const Q = 60, W = 30, J = 90;

function bandFor(sigs: ShieldSignal[]) {
  const risk = Math.max(0, sigs.reduce((a, s) => a + s.pts, 0));
  const hard = sigs.some((s) => s.ev === "hard");
  const quarantine = hard || risk >= Q;
  const onlySoftHard = sigs.filter((s) => s.ev === "hard").every((s) => s.key === "honeypot" || s.key === "surge.active");
  const band = quarantine ? ((hard && !onlySoftHard) || risk >= J + (hard && onlySoftHard ? 999 : 0) ? "junk" : "gray") : risk >= W ? "watch" : "clean";
  return { risk, hard, quarantine, band };
}
function lookupSignal(lu: any): ShieldSignal | null {
  if (!lu) return null;
  if (!lu.valid || lu.lineType === "invalid") return { key: "phone.lookup_invalid", pts: 60, ev: "strong" };
  switch (lu.lineType) {
    case "tollFree": case "premium": case "pager": case "voicemail": case "sharedCost":
      return { key: "phone.lookup_junk", pts: 35, ev: "strong", note: lu.lineType };
    case "nonFixedVoip": return { key: "phone.voip", pts: 20, ev: "medium" };
    case "fixedVoip": return { key: "phone.voip_fixed", pts: 10, ev: "weak" };
    case "mobile": return { key: "trust.mobile", pts: -15, ev: "trust" };
    default: return null;
  }
}

async function main() {
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: all } = await sb.from("leads").select("*").order("created_at", { ascending: true }).limit(2000);
  const dripEligible = all!.filter((l: any) => l.created_at >= cutoff && !l.nurture_paused &&
    String(l.stage || "").toLowerCase() !== "review" && (l.phone || l.email) && !/@fetti-internal\.test$/i.test(l.email || ""));
  const unverified = dripEligible.filter((l: any) => leadReality({ raw: l.raw, name: l.full_name, email: l.email, phone: l.phone }).level === "unverified");

  // --- 1. Read the existing Twilio Lookup cache (app_settings shield:lookup:<10digits>)
  const { data: cacheRows } = await sb.from("app_settings").select("key, value").like("key", "shield:lookup:%").limit(5000);
  const cache = new Map<string, any>();
  for (const r of cacheRows || []) { try { cache.set(String(r.key).replace("shield:lookup:", ""), JSON.parse(String((r as any).value))); } catch {} }
  console.log("Twilio lookup cache rows in app_settings:", cache.size);

  let withPhone = 0, cached = 0; const lineDist: Record<string, number> = {};
  for (const l of unverified) {
    const p = String(l.phone || "").replace(/\D/g, "").slice(-10);
    if (p.length === 10) { withPhone++; const c = cache.get(p); if (c) { cached++; lineDist[c.lineType] = (lineDist[c.lineType] || 0) + 1; } }
  }
  console.log(`unverified with a 10-digit phone: ${withPhone}; already in the lookup cache: ${cached}`);
  console.log("cached line types among the unverified:", lineDist);

  // Overall line-type mix of the WHOLE cache = best available prior for the uncached ones
  const allLine: Record<string, number> = {};
  for (const c of cache.values()) allLine[c.lineType] = (allLine[c.lineType] || 0) + 1;
  console.log("line-type mix across the entire cache:", allLine);

  // --- 2. MX (free DNS) over every distinct non-freemail domain in the unverified set
  const domains = new Set<string>();
  for (const l of unverified) { const e = String(l.email || "").toLowerCase(); const at = e.lastIndexOf("@"); if (at > 0) domains.add(e.slice(at + 1)); }
  const mxBad = new Set<string>();
  for (const d of domains) { const s = await checkMx(d); if (s) mxBad.add(d); }
  console.log("distinct email domains:", domains.size, "| domains with NO MX:", [...mxBad]);

  // --- 3. Full projection: free signals + MX + (cached lookup where known)
  const byPhone = new Map<string, any[]>();
  for (const l of all!) { const p = String(l.phone || "").replace(/\D/g, "").slice(-10); if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(l); } }
  const groupHit = new Set<string>();
  for (const rows of byPhone.values()) {
    if (rows.length < 2) continue; const firsts: string[] = [];
    for (const r of rows) { const f = String(r.full_name || "").trim().toLowerCase().split(/\s+/)[0]; if (!f) continue;
      if (!firsts.some((x) => x === f || editDistance(x, f) <= 2 || x.startsWith(f) || f.startsWith(x))) firsts.push(f); }
    if (firsts.length >= 3) for (const r of rows) groupHit.add(r.id);
  }

  const scenarios = ["cached_only", "assume_all_mobile", "assume_all_nonFixedVoip"] as const;
  for (const sc of scenarios) {
    const flips: any[] = []; const afterDist: Record<string, number> = {};
    for (const l of unverified) {
      const { signals } = scoreSignals({ body: l as any, channel: "api", ip: null, internal: true }, {});
      const sigs: ShieldSignal[] = [...signals.filter((s) => !["transport.api", "fst.missing", "ua.missing"].includes(s.key))];
      if (groupHit.has(l.id)) sigs.push({ key: "identity.multi_name", pts: 60, ev: "hard" });
      const ph = checkPhonePattern(l.phone); if (ph && !sigs.some((s) => s.key === ph.key)) sigs.push(ph);
      const e = String(l.email || "").toLowerCase(); const at = e.lastIndexOf("@");
      const dom = at > 0 ? e.slice(at + 1) : "";
      if (dom && mxBad.has(dom)) sigs.push({ key: "email.no_mx", pts: 35, ev: "strong", note: dom });
      const p = String(l.phone || "").replace(/\D/g, "").slice(-10);
      let lu: any = null;
      const pre = bandFor(sigs);
      if (p.length === 10 && !pre.hard && pre.risk < Q) {
        if (sc === "cached_only") lu = cache.get(p) || null;
        else if (sc === "assume_all_mobile") lu = cache.get(p) || { lineType: "mobile", valid: true };
        else lu = cache.get(p) || { lineType: "nonFixedVoip", valid: true };
        const ls = lookupSignal(lu); if (ls) sigs.push(ls);
      }
      const b = bandFor(sigs);
      const smsCap = !(lu && (lu.lineType === "landline" || !lu.valid || ["tollFree","premium","pager","voicemail","invalid"].includes(lu.lineType)));
      const hypoRaw = { ...(l.raw || {}), shield: { version: 1, verdict: b.quarantine ? "quarantine" : "pass", band: b.band, risk: b.risk, signals: sigs, lookup: lu, sms_capable: smsCap } };
      const after = leadReality({ raw: hypoRaw, name: l.full_name, email: l.email, phone: l.phone });
      afterDist[after.level] = (afterDist[after.level] || 0) + 1;
      if (after.level === "suspect" || after.level === "invalid") flips.push({ name: l.full_name, email: l.email, phone: l.phone, stage: l.stage, step: l.nurture_step, risk: b.risk, band: b.band, after: after.level, why: after.reason, sigs: sigs.map(s => `${s.key}:${s.pts}`) });
    }
    console.log(`\n--- SCENARIO ${sc}: ${JSON.stringify(afterDist)} | blocked=${flips.length}`);
    for (const f of flips) console.log("   ", JSON.stringify(f));
  }

  // --- 4. Prove the smsCapable key mismatch: applyShieldToRow writes sms_capable, leadReality reads smsCapable
  const landlineRaw = { shield: { band: "clean", risk: 0, signals: [], lookup: { lineType: "landline", valid: true }, sms_capable: false } };
  console.log("\nKEY-MISMATCH PROOF — landline, sms_capable:false as actually persisted =>",
    JSON.stringify(leadReality({ raw: landlineRaw, name: "Jane Smith", email: "j@example.com", phone: "7605551234" })));
  const landlineCamel = { shield: { band: "clean", risk: 0, signals: [], lookup: { lineType: "landline", valid: true }, smsCapable: false } };
  console.log("same lead with the camelCase key leadReality actually reads    =>",
    JSON.stringify(leadReality({ raw: landlineCamel, name: "Jane Smith", email: "j@example.com", phone: "7605551234" })));
}
main().catch((e) => { console.error(e); process.exit(1); });
