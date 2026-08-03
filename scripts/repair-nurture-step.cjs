// ONE-OFF: bring `nurture_step` back to what was actually SENT.
//
// A code path live 2026-06-26 → 07-08 advanced the counter on runs that delivered nothing.
// 176 leads carry a step above zero; 65 exceed the number of messages ever sent to them and 13
// have a step with NO message ever. 54 are still nurture-eligible, so on resume they would get
// mid-cadence copy that presupposes a relationship — one lead's first-ever message would have
// been "your file's still sitting on my desk".
//
// Writes min(current, actual). Never raises a counter; a lead can only move BACK toward the
// start of the cadence, which is the safe direction. Dry-run by default.
//
//   node scripts/repair-nurture-step.cjs          # report only
//   node scripts/repair-nurture-step.cjs --apply  # write
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

(async () => {
  const leads = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("leads").select("id, full_name, nurture_step").gt("nurture_step", 0).range(from, from + 999);
    if (error) throw new Error(error.message);
    leads.push(...data);
    if (data.length < 1000) break;
  }
  const acts = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("activity_log").select("lead_id, created_at, detail").eq("action", "comms.message").range(from, from + 999);
    if (error) throw new Error(error.message);
    acts.push(...data);
    if (data.length < 1000) break;
  }
  // Group by minute so a both-channel touch counts once — the same rule the governor's cap
  // and the drip's clamp now use.
  const touches = new Map();
  for (const a of acts) {
    const d = a.detail || {};
    if (!a.lead_id || d.direction !== "outbound") continue;
    if (!["first_touch", "nurture"].includes(String(d.type || ""))) continue;
    if (!touches.has(a.lead_id)) touches.set(a.lead_id, new Set());
    touches.get(a.lead_id).add(String(a.created_at).slice(0, 16));
  }
  const fixes = leads
    .map((l) => ({ ...l, actual: (touches.get(l.id) || new Set()).size }))
    .filter((l) => l.nurture_step > l.actual);

  console.log(`\nleads with nurture_step > 0 : ${leads.length}`);
  console.log(`inflated (step > touches)   : ${fixes.length}`);
  console.log(`  of which step>0, 0 touches: ${fixes.filter((f) => f.actual === 0).length}`);
  for (const f of fixes.slice(0, 12)) console.log(`   ${String(f.nurture_step).padStart(2)} -> ${f.actual}   ${f.full_name || f.id}`);
  if (fixes.length > 12) console.log(`   … ${fixes.length - 12} more`);

  if (!APPLY) { console.log(`\nDRY RUN — re-run with --apply to write.\n`); return; }
  let n = 0;
  for (const f of fixes) {
    const { error } = await sb.from("leads").update({ nurture_step: f.actual }).eq("id", f.id);
    if (!error) n++;
  }
  console.log(`\nrepaired ${n} of ${fixes.length}.\n`);
})();
