// READ-ONLY follow-up to measure-1003-completion.ts.
//
// That script probed the LEADS table. Demographics and real-estate-owned came back 0/3 even
// for borrowers who completed everything else — which is exactly the shape of a probe that
// looked in the wrong place, not a gap. URLA data may live on loan_files, not on the lead.
// Before calling anything missing, look where it would actually be stored.
//
// Prints KEY NAMES and booleans only — never a value, so no PII reaches the terminal.
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";

const SHIPPED = "2026-09-09";

(async () => {
  await requireLiveDb("measure:1003-where");

  const files = await rows<any>("measure:1003-where", supabaseAdmin.from("loan_files").select("*"), { minRows: 1 });
  console.log(`\nloan_files columns: ${Object.keys(files[0] || {}).join(", ")}\n`);

  // Which column, if any, holds the URLA?
  const urlaCols = Object.keys(files[0] || {}).filter((c) => /urla|1003|application|data|raw|json/i.test(c));
  console.log(`candidate URLA columns: ${urlaCols.join(", ") || "(none by name)"}`);

  for (const c of urlaCols) {
    const withData = files.filter((f) => f[c] && Object.keys(typeof f[c] === "object" ? f[c] : {}).length);
    console.log(`  ${c}: ${withData.length} / ${files.length} file(s) non-empty`);
    const keys = new Set<string>();
    for (const f of withData) for (const k of Object.keys(f[c] || {})) keys.add(k);
    if (keys.size) console.log(`     top-level keys seen: ${[...keys].sort().join(", ")}`);
    // declarations / demographics / reo specifically
    for (const sub of ["declarations", "demographics", "military", "reo", "assets", "liabilities", "borrower"]) {
      const n = withData.filter((f) => f[c]?.[sub] && Object.keys(f[c][sub] || {}).length).length;
      if (n) console.log(`     ${sub}: present on ${n} file(s)`);
    }
  }

  // The post-ship leads: what did the wizard ACTUALLY store in raw?
  const leads = await rows<any>("measure:1003-where", supabaseAdmin.from("leads").select("id, created_at, raw").gte("created_at", SHIPPED));
  console.log(`\npost-${SHIPPED} leads: ${leads.length}`);
  for (const l of leads) {
    const raw = l.raw || {};
    const ans = raw.answers || raw;
    const keys = Object.keys(ans).sort();
    console.log(`\n  lead ${String(l.id).slice(0, 8)}  created ${String(l.created_at).slice(0, 10)}  — ${keys.length} answer key(s)`);
    console.log(`    ${keys.join(", ")}`);
    for (const probe of ["demographics", "ethnicity", "race", "sex", "reo", "real_estate", "property_owned", "military", "authorization", "auth"]) {
      const hit = keys.filter((k) => k.toLowerCase().includes(probe));
      if (hit.length) console.log(`    [${probe}] -> ${hit.join(", ")}`);
    }
  }
})();
