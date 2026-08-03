// REPAIR THE RECORDS THE BACKFILL WROTE WRONG.
//
// Ramon, 2026-08-02. The adversarial verification of my own backfill found three defects in
// what it had written, all confirmed against the live rows:
//
//   1. verdict "clear" x190 — the declared union (lib/leadShield.ts:48) is "pass" |
//      "quarantine". "clear" is in neither, so any reader testing the natural inverse of
//      "quarantine" silently mis-sorts every one of them.
//   2. band "clean" on 2 leads whose risk is >= the WATCH threshold (30). Shield bands those
//      as "watch" and leadReality treats watch as SUSPECT — so the backfill laundered two
//      leads the free signals had already caught.
//   3. `smsCapable` (camel) on 184 records while the promote gate reads `sms_capable` (snake).
//      Those records answered "undefined" — i.e. textable — for numbers the carrier had said
//      cannot receive a text.
//
// Reads both spellings, writes both, and re-bands honestly. Dry-run by default.
//
//   npx tsx scripts/shield-normalize.ts            # report
//   npx tsx scripts/shield-normalize.ts --apply
import "./_env";
import { createClient } from "@supabase/supabase-js";
import { leadReality } from "../lib/leadReality";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");
const WATCH = 30;   // SHIELD_RISK_WATCH default, lib/leadShield.ts:462

(async () => {
  let leads: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("leads").select("id, full_name, email, phone, raw").range(f, f + 999);
    if (error) throw new Error(error.message);
    leads = leads.concat(data || []); if ((data || []).length < 1000) break;
  }
  const plan: any[] = [];
  for (const l of leads) {
    const s = l.raw?.shield;
    if (!s) continue;
    const next = { ...s };
    const fixes: string[] = [];

    if (next.verdict === "clear") { next.verdict = "pass"; fixes.push("verdict clear->pass"); }
    // Never touch a quarantine's band — that decision stands.
    if (next.verdict !== "quarantine" && next.band === "clean" && Number(next.risk || 0) >= WATCH) {
      next.band = "watch"; fixes.push(`band clean->watch (risk ${next.risk})`);
    }
    const cap = next.smsCapable ?? next.sms_capable;
    if (cap !== undefined && (next.smsCapable === undefined || next.sms_capable === undefined)) {
      next.smsCapable = cap; next.sms_capable = cap; fixes.push(`sms both spellings = ${cap}`);
    }
    if (!fixes.length) continue;
    const before = leadReality({ raw: l.raw, name: l.full_name, email: l.email, phone: l.phone }).level;
    const after = leadReality({ raw: { ...l.raw, shield: next }, name: l.full_name, email: l.email, phone: l.phone }).level;
    plan.push({ l, next, fixes, before, after });
  }

  const counts: Record<string, number> = {};
  for (const p of plan) for (const f of p.fixes) counts[f.replace(/\(.*\)/, "").trim()] = (counts[f.replace(/\(.*\)/, "").trim()] || 0) + 1;
  console.log(`\nrecords needing repair: ${plan.length}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(4) + "  " + k);
  const moves: Record<string, number> = {};
  for (const p of plan) moves[`${p.before} -> ${p.after}`] = (moves[`${p.before} -> ${p.after}`] || 0) + 1;
  console.log("\nreality transitions:");
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(4) + "  " + k);
  const changed = plan.filter((p) => p.before !== p.after);
  if (changed.length) {
    console.log("\nleads whose verdict actually moves:");
    for (const p of changed) console.log(`   ${String(p.l.full_name || p.l.id).slice(0, 26).padEnd(28)} ${p.before} -> ${p.after}   ${p.fixes.join("; ")}`);
  }

  if (!APPLY) { console.log(`\nDRY RUN — nothing written.\n`); return; }
  let n = 0;
  for (const p of plan) {
    const { data: fresh } = await sb.from("leads").select("raw").eq("id", p.l.id).maybeSingle();
    const raw = ((fresh as any)?.raw && typeof (fresh as any).raw === "object" ? { ...(fresh as any).raw } : {}) as any;
    if (!raw.shield) continue;
    raw.shield = { ...raw.shield, ...p.next };
    const { error } = await sb.from("leads").update({ raw }).eq("id", p.l.id);
    if (!error) n++;
  }
  console.log(`\nrepaired ${n} of ${plan.length}.\n`);
})();
