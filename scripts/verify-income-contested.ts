// THE CONTESTED-INCOME GATE MUST ACTUALLY REFUSE.
//
// `qcContested` existed from 2026-08-04 with exactly one reader: a red banner. This checks that
// the flag now STOPS a borrower-facing letter, using the REAL stored records of REAL files —
// never a fabricated payload, because every synthetic income test written for the Magali/Milton
// defects passed while the live file stayed wrong.
//
//   npm run verify:income-contested
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { incomeContestedState, contestedRefusal } from "../lib/income/contested";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

(async () => {
  console.log("\nCONTESTED INCOME GATE — against the live records\n");
  await requireLiveDb("verify:income-contested");

  const files = await rows<any>("verify:income-contested",
    supabaseAdmin.from("loan_files").select("id, file_number, borrower_name"), { minRows: 1 });
  const verifies = await rows<any>("verify:income-contested",
    supabaseAdmin.from("app_settings").select("key, value").like("key", "los_income_verify:%"), { minRows: 1 });

  // Partition the REAL files by what their own stored payload says. The corpus is whatever is in
  // the database today; if the shape of that corpus changes the checks below say so rather than
  // quietly testing nothing.
  const contestedIds: string[] = [], cleanIds: string[] = [];
  for (const r of verifies) {
    const id = String(r.key).split(":")[1];
    let p: any = null; try { p = JSON.parse(r.value)?.payload; } catch { /* counted as neither */ }
    if (!p) continue;
    (p.qcContested === true ? contestedIds : cleanIds).push(id);
  }
  const name = (id: string) => files.find((f) => f.id === id)?.file_number || id;
  console.log(`  corpus: ${contestedIds.length} contested file(s), ${cleanIds.length} clean, out of ${verifies.length} verified\n`);

  ck("there is at least one CLEAN file to prove the gate discriminates", cleanIds.length > 0);
  if (!contestedIds.length) {
    // Not a pass. With no contested file in the corpus every assertion below is vacuous, and a
    // gate proven only against files it does not apply to is exactly the decoration this exists
    // to prevent. Say so and fail.
    ck("there is at least one CONTESTED file to test the gate against", false,
       "no live file currently carries qcContested — this run proves nothing about the refusal path");
  }

  console.log("\n── the predicate reads the real payloads ──");
  for (const id of contestedIds) {
    const s = await incomeContestedState(id);
    ck(`${name(id)} reads as contested`, s.contested === true);
    ck(`${name(id)} carries the QC's own findings`, s.findings.length > 0, `${s.findings.length} high finding(s)`);
    ck(`${name(id)} refusal text names the figure and the objections`,
       contestedRefusal(s).includes("CONTESTED") && s.findings.every((f) => contestedRefusal(s).includes(f.slice(0, 40))));
  }
  for (const id of cleanIds) {
    const s = await incomeContestedState(id);
    ck(`${name(id)} (clean) does NOT trip the gate`, s.contested === false);
  }

  console.log("\n── a file with no verify record at all fails OPEN ──");
  const unverified = files.find((f) => !verifies.some((v) => String(v.key).split(":")[1] === f.id));
  if (unverified) {
    const s = await incomeContestedState(unverified.id);
    ck(`${unverified.file_number}: never income-verified → not blocked`, s.contested === false);
  } else {
    ck("a never-verified file exists to check the fail-open path", false, "every file has a verify record");
  }

  console.log("\n── THE ROUTE ITSELF REFUSES (not just the predicate) ──");
  // Call the real handler. When the gate is INTACT a 409 returns before the insert, the PDF and
  // the emails, so nothing is created and nobody is contacted.
  //
  // BUT THIS GUARD MUST BE SAFE ON THE DAY IT FAILS, which is the only day it matters. Proved on
  // 2026-08-14 by deliberately disabling the gate to confirm this check goes red: it went red —
  // and the run ISSUED A REAL PRE-APPROVAL on Asia Dearman's live loan file (PA-202608-9576,
  // preapprovals 17 -> 18) plus a `preapproval.issued` and an `income.contested_override` row on
  // her file. All four had to be deleted by hand. A verification that damages the record when the
  // thing it guards is broken is a second defect waiting on the first.
  //
  // So the probe now carries a SENTINEL name and sweeps anything bearing it — before AND after —
  // and the sweep failing is itself a failure. It never suppresses the red: cleanup is not
  // absolution, the check still reports the gate let a letter through.
  const SENTINEL = "GATE TEST — must not issue";
  const sweep = async (): Promise<number> => {
    const { data, error } = await supabaseAdmin.from("preapprovals").select("id").ilike("borrower_name", `%${SENTINEL}%`);
    if (error) { console.error("  sentinel sweep failed:", error.message); process.exit(1); }
    for (const r of data || []) {
      const { error: de } = await supabaseAdmin.from("preapprovals").delete().eq("id", (r as any).id);
      if (de) { console.error(`  COULD NOT DELETE probe letter ${(r as any).id}: ${de.message} — DELETE IT BY HAND`); process.exit(1); }
    }
    // The route also logs to the borrower's own file; leaving that behind pollutes a real record.
    const { data: acts, error: ae } = await supabaseAdmin.from("activity_log")
      .select("id, detail").in("action", ["preapproval.issued", "income.contested_override"]);
    if (ae) { console.error("  sentinel activity sweep failed:", ae.message); process.exit(1); }
    for (const a of acts || []) {
      if (!JSON.stringify((a as any).detail || {}).includes(SENTINEL)) continue;
      const { error: de } = await supabaseAdmin.from("activity_log").delete().eq("id", (a as any).id);
      if (de) { console.error(`  COULD NOT DELETE probe activity ${(a as any).id}: ${de.message}`); process.exit(1); }
    }
    return (data || []).length;
  };
  // Anything left by an earlier aborted run would corrupt the before/after count below.
  const stale = await sweep();
  if (stale) console.log(`  (swept ${stale} probe letter(s) left by an earlier run)`);

  const { POST } = await import("../app/api/preapprovals/route");
  const countLetters = async () => {
    const { count, error } = await supabaseAdmin.from("preapprovals").select("id", { count: "exact", head: true });
    if (error) { console.error("  preapprovals count failed:", error.message); process.exit(1); }
    return count ?? -1;
  };
  const before = await countLetters();

  for (const id of contestedIds) {
    const req = new Request("http://local/api/preapprovals", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ borrower_name: SENTINEL, loan_file_id: id, officer_nmls: "2235992" }),
    });
    const res: any = await POST(req as any);
    const body = await res.json().catch(() => ({}));
    ck(`POST /api/preapprovals on ${name(id)} is REFUSED`, res.status === 409, `status ${res.status}`);
    ck(`  …with code income_contested and the findings attached`,
       body?.code === "income_contested" && Array.isArray(body?.findings) && body.findings.length > 0);
  }

  // COUNT FIRST, THEN CLEAN. Sweeping before this read would restore the count and turn the one
  // check that proves the gate held into a check that proves the cleanup ran.
  const after = await countLetters();
  ck("no pre-approval letter was created by this verification", before === after, `${before} → ${after}`);
  const leaked = await sweep();
  if (leaked) console.log(`  ↳ removed ${leaked} letter(s) this run created, and their activity rows, from live records`);

  console.log(fail ? `\n❌ FAILURES — ${fail} check(s) failed\n` : "\n✅ ALL PASS — a contested number cannot become a letter\n");
  process.exit(fail ? 1 : 0);
})();
