// RECORD A CLEAN SHIELD VERDICT — the answer the sweep computed and threw away.
//
// Ramon, 2026-08-02: "fix the unverified leads - run shield on all of them".
//
// app/api/cron/shield-sweep scores EVERY in-scope lead and then writes raw.shield only inside
// `if (hard || total >= qTh)`. A lead that scores CLEAN has its verdict computed and discarded,
// four times a day, forever — and lib/leadReality.ts returns "real" only when
// raw.shield.band === "clean", a value nothing in the codebase ever wrote. 166 of 170
// drip-eligible leads therefore read "Not yet screened by Lead Shield" while being screened
// continuously. The sweep does not remember its successes, only its failures.
//
// This runs the SAME scoring — pure functions, no network, no cost, nobody contacted — and
// records the result either way. Dry-run by default.
//
//   npx tsx scripts/shield-backfill.ts            # report only
//   npx tsx scripts/shield-backfill.ts --apply    # write
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { scoreSignals, checkPhonePattern, editDistance, type ShieldSignal } from "../lib/leadShield";
import { leadReality } from "../lib/leadReality";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");
const QUARANTINE_THRESHOLD = 60;   // mirrors SHIELD_RISK_QUARANTINE's default in the sweep

(async () => {
  let leads: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("leads")
      .select("id, full_name, first_name, last_name, email, phone, stage, source, created_at, nurture_paused, raw, credit_score, property_value, loan_amount_requested")
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    leads = leads.concat(data || []);
    if ((data || []).length < 1000) break;
  }

  // Only leads with NO verdict on file. Never re-judge a lead a human already promoted or
  // that Shield already quarantined — that decision stands.
  const target = leads.filter((l) =>
    !l.raw?.shield &&
    !/fetti-internal\.test/i.test(String(l.email || "")) &&
    // NOTHING TO SCREEN. A row with neither an email nor a phone cannot be judged real or fake
    // — there is no identity to check. Two exist: an empty Meta row, and a borrower Ramon
    // created from the Underwriting Desk whose contact details live on the loan file. Writing
    // a "junk" band over the second would libel a real client in his own CRM, and writing
    // "clean" would assert a check we did not perform. leadReality's own fallback already says
    // the accurate thing ("No email or phone on file"), so leave them to it.
    (l.email || l.phone));

  // Same identity-group signal the sweep computes across the whole population.
  const byPhone = new Map<string, any[]>();
  for (const l of leads) {
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

  const plan: any[] = [];
  for (const l of target) {
    const { signals } = scoreSignals({ body: l as any, channel: "api", ip: null, internal: true } as any, {});
    // The transport signals are artifacts of scoring an EXISTING row rather than a live
    // submission — there was no request, so "no user-agent" is not evidence of a bot.
    const sigs: ShieldSignal[] = signals.filter((s) => !["transport.api", "fst.missing", "ua.missing"].includes(s.key));
    if (groupHit.has(l.id)) sigs.push({ key: "identity.multi_name", pts: 60, ev: "hard" } as ShieldSignal);
    const ph = checkPhonePattern(l.phone);
    if (ph && !sigs.some((s) => s.key === ph.key)) sigs.push(ph);

    const risk = Math.max(0, sigs.reduce((a, s) => a + s.pts, 0));
    const hard = sigs.some((s) => s.ev === "hard");
    const quarantine = hard || risk >= QUARANTINE_THRESHOLD;
    const band = quarantine ? (hard || risk >= 90 ? "junk" : "gray") : "clean";

    // The record a CLEARED lead carries. `lookup` is deliberately ABSENT: we did not call
    // Twilio, and leadReality reads lookup.lineType / lookup.valid — a null or invented lookup
    // would either downgrade the lead to suspect or assert a check we never made.
    // `smsCapable` is likewise absent for the same reason (false would read as "landline").
    const shield: any = {
      version: 1,
      verdict: quarantine ? "quarantine" : "clear",
      band, risk, signals: sigs,
      channel: "api", retro: true,
      screened_at: new Date().toISOString(),
      screened_by: "backfill:2026-08-02",
    };
    if (quarantine) { shield.quarantined_at = shield.screened_at; shield.pre_quarantine_stage = l.stage; }

    const before = leadReality({ raw: l.raw, name: l.full_name, email: l.email, phone: l.phone });
    const after = leadReality({ raw: { ...(l.raw || {}), shield }, name: l.full_name, email: l.email, phone: l.phone });
    plan.push({ l, shield, quarantine, risk, sigs, before: before.level, after: after.level });
  }

  // DOWNGRADE-PROOF. leadReality has a NO-SHIELD fallback that flags a placeholder name or a
  // disposable email as "suspect" without any Shield record. Writing band:"clean" over one of
  // those would CLEAR a lead that a cheap check had already caught — the backfill would make
  // the system less suspicious, which is the opposite of the ask. Any lead whose verdict would
  // move suspect/invalid -> real keeps its flag instead.
  for (const p of plan) {
    if ((p.before === "suspect" || p.before === "invalid") && p.after === "real") {
      p.shield.band = p.before === "invalid" ? "junk" : "gray";
      p.shield.verdict = "flagged";
      p.shield.signals = [...p.shield.signals, { key: "reality.fallback", pts: 60, ev: "hard" }];
      p.shield.downgrade_reason = leadReality({ raw: p.l.raw, name: p.l.full_name, email: p.l.email, phone: p.l.phone }).reason;
      p.quarantine = true;
      p.after = leadReality({ raw: { ...(p.l.raw || {}), shield: p.shield }, name: p.l.full_name, email: p.l.email, phone: p.l.phone }).level;
    }
  }

  const moves: Record<string, number> = {};
  for (const p of plan) moves[`${p.before} -> ${p.after}`] = (moves[`${p.before} -> ${p.after}`] || 0) + 1;
  console.log("\ntransitions:");
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(4) + "  " + k);

  const by = (k: string) => plan.filter((p) => p.after === k).length;
  console.log(`\nleads with NO shield verdict : ${target.length}`);
  console.log(`would become real            : ${by("real")}`);
  console.log(`would become suspect         : ${by("suspect")}`);
  console.log(`would become invalid         : ${by("invalid")}`);
  console.log(`would stay unverified        : ${by("unverified")}`);

  const flagged = plan.filter((p) => p.after !== "real");
  if (flagged.length) {
    console.log(`\n── NOT cleared (${flagged.length}) — these lose automated nurture ──`);
    for (const p of flagged) {
      console.log(`  ${String(p.l.full_name || p.l.id).slice(0, 26).padEnd(28)} stage=${String(p.l.stage || "").padEnd(11)} risk=${String(p.risk).padStart(3)}  ${p.sigs.map((s: any) => s.key).join(", ") || "—"}`);
    }
  }
  // A lead being actively worked must not be silenced by a retro screen without it being said.
  const workedNow = flagged.filter((p) => /application|processing|submitted|engaged/i.test(String(p.l.stage || "")));
  console.log(`\nflagged leads that are ACTIVELY being worked: ${workedNow.length}${workedNow.length ? " -> " + workedNow.map((p: any) => p.l.full_name).join(", ") : ""}`);

  if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`); return; }

  let cleared = 0, quarantined = 0;
  for (const p of plan) {
    // Concurrency-safe: re-read the freshest raw and merge ONLY the shield key, so a save
    // that landed since the bulk select is not reverted (the sweep does this for a reason).
    const { data: fresh } = await sb.from("leads").select("raw").eq("id", p.l.id).maybeSingle();
    const raw = ((fresh as any)?.raw && typeof (fresh as any).raw === "object" ? { ...(fresh as any).raw } : {}) as any;
    if (raw.shield) continue;                       // someone screened it in the meantime — leave it
    raw.shield = p.shield;
    const patch: any = { raw };
    // QUARANTINE IS NOT PART OF THIS RUN. Ramon asked for the leads to be SCREENED, not for a
    // retro purge — and moving a lead to Review silences it. Flagged leads keep their stage and
    // are simply now visible as suspect; the existing sweep quarantines on its own schedule.
    const { error } = await sb.from("leads").update(patch).eq("id", p.l.id);
    if (!error) { if (p.quarantine) quarantined++; else cleared++; }
  }
  console.log(`\nrecorded: ${cleared} clear, ${quarantined} flagged (stage untouched).\n`);
})();
