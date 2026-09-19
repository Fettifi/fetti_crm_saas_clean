// A LOGIC CHANGE SHOULD NOT COST A RE-READ — AND THE FILE SHOULD NOT WAIT FOR ONE.
//
// 2026-09-17 system check: three live files (Lucki Long $17,633 vs $9,225 from her own facts,
// Osborne $24,218 vs $18,563, Barron $6,341 vs $5,667) had been shipping figures four engine
// versions stale for 6–10 days, because a LOGIC_VERSION bump only takes effect when somebody
// re-verifies — a paid, non-deterministic re-read nobody triggers on a settled file. The route
// now recomputes from the stored facts on a logic-only cache miss (lib/income/recomputeFromFacts.ts).
//
// This guard proves the decision, the computation against REAL stored payloads, the flag merge
// (an old "Omit to add $X" must not survive a recompute), and the route's wiring — and it must
// fail when any of those is removed (GUARD_ROOT=<dir> points the source checks at another tree).
//
//   npm run verify:income-recompute
import "./_env";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { PRIOR_LOGIC_VERSIONS, recomputeDecision, recomputeFromStoredPayload, recomputedFlags } from "../lib/income/recomputeFromFacts";
import { judgeDrift } from "../lib/income/driftGate";

const ROOT = process.env.GUARD_ROOT || ".";
const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

async function main() {
  console.log("\nINCOME RECOMPUTE — a logic-only miss replays the stored facts, nothing else\n");

  // ── 1. The decision. Shapes only — no income facts are invented here.
  {
    const rest = "1 fha  \nd1|p1|100|ok";
    const CUR = "2026-09-17-bank-statement-unnumbered-statement-merges-into-its-account";
    const fingerprint = sha1(CUR + " " + rest), docsKey = sha1(rest);
    const facts = [{ docType: "paystub" }];
    const base = { force: false, fingerprint, docsKey, rest, sha1 };
    const dec = (env: any, force = false) => recomputeDecision({ ...base, force, envelope: env });
    ck("force → re-read", dec({ fingerprint: "x", docsKey, payload: { method: "standard", factsUsed: facts } }, true).action === "reread");
    ck("no earlier read → re-read", dec(null).action === "reread");
    ck("cache hit → not a recompute", dec({ fingerprint, docsKey, payload: { method: "standard", factsUsed: facts } }).action === "reread");
    const d1 = dec({ fingerprint: "old", docsKey, payload: { method: "standard", factsUsed: facts } });
    ck("same docsKey, logic moved, standard with facts → recompute", d1.action === "recompute" && (d1 as any).sameDocsBy === "docsKey");
    ck("docsKey differs (a document changed) → re-read", dec({ fingerprint: "old", docsKey: "other", payload: { method: "standard", factsUsed: facts } }).action === "reread");
    const legacyFp = sha1("2026-09-11-stub-variability-within-year-and-full-periods-only" + " " + rest);
    const d2 = dec({ fingerprint: legacyFp, payload: { method: "standard", factsUsed: facts } });
    ck("legacy envelope (no docsKey) whose fingerprint reproduces under a PRIOR logic version → recompute", d2.action === "recompute" && (d2 as any).sameDocsBy === "priorLogicVersion");
    ck("legacy envelope whose fingerprint reproduces under NO prior version → re-read", dec({ fingerprint: sha1("unknown-version " + rest), payload: { method: "standard", factsUsed: facts } }).action === "reread");
    ck("a legacy envelope is never matched by a docsKey it does not carry", dec({ fingerprint: "old", docsKey: "", payload: { method: "standard", factsUsed: facts } }).action === "reread");
    ck("DSCR → re-read (rebuilt after the engine)", dec({ fingerprint: "old", docsKey, payload: { method: "dscr", factsUsed: facts } }).action === "reread");
    ck("no stored facts → re-read", dec({ fingerprint: "old", docsKey, payload: { method: "standard", factsUsed: [] } }).action === "reread");
    ck("bank_statement without deposit rows → re-read", dec({ fingerprint: "old", docsKey, payload: { method: "bank_statement", factsUsed: facts } }).action === "reread");
    ck("bank_statement with deposit rows → recompute", dec({ fingerprint: "old", docsKey, payload: { method: "bank_statement", factsUsed: facts, bankFactsUsed: { reads: [{}] } } }).action === "recompute");
    ck("the prior-version list is closed and the current version is on it", PRIOR_LOGIC_VERSIONS.includes(CUR) && new Set(PRIOR_LOGIC_VERSIONS).size === PRIOR_LOGIC_VERSIONS.length);
    const routeSrc = code(ROUTE);
    const m = routeSrc.match(/const LOGIC_VERSION = "([^"]+)";/);
    ck("the route's LOGIC_VERSION is in the prior-version list (a bump must add itself here)", !!m && PRIOR_LOGIC_VERSIONS.includes(m[1]), m?.[1] || "not found");
  }

  // ── 2. The flag merge: old add-backs die, informational flags and fresh engine flags live.
  {
    const notice = { text: "NOTICE", addBackMonthly: 0, borrower: 1 as 1 | 2 };
    const out = recomputedFlags(
      [{ text: "QC ⚠️: double-count", addBackMonthly: 0, borrower: 1 }, { text: "Variable pay held back — Omit to add", addBackMonthly: 1200, borrower: 1 }, { text: "fresh engine flag", addBackMonthly: 0, borrower: 2 }],
      [{ text: "fresh engine flag", addBackMonthly: 500, borrower: 2 }],
      notice,
    );
    ck("the notice is first", out[0]?.text === "NOTICE");
    ck("an OLD flag carrying an add-back is dropped (its $ came from the old logic)", !out.some((f) => /held back/.test(f.text)));
    ck("an informational QC flag from the earlier read survives", out.some((f) => /QC/.test(f.text)));
    const fresh = out.filter((f) => f.text === "fresh engine flag");
    ck("a fresh engine flag wins over the old copy of the same text, with ITS add-back", fresh.length === 1 && fresh[0].addBackMonthly === 500);
  }

  // ── 3. Real stored payloads: the recompute equals what the drift gate and the replay compute.
  {
    const { supabaseAdmin } = await import("../lib/supabaseAdminClient");
    const sb: any = supabaseAdmin;
    const { data: rows, error } = await sb.from("app_settings").select("key,value").like("key", "los_income_verify:%");
    if (error) { ck("read live verify envelopes", false, error.message); }
    let standard = 0, bank = 0, agree = 0, pendingInfo: string[] = [];
    for (const r of rows || []) {
      let env: any; try { env = JSON.parse(r.value); } catch { continue; }
      const p = env?.payload; if (!p || !Array.isArray(p.factsUsed) || !p.factsUsed.length) continue;
      const method = String(p.method || "standard");
      const rc = recomputeFromStoredPayload(p);
      if (method === "standard") {
        standard++;
        const j = judgeDrift(p);
        if (rc && j.recomputed != null && Math.abs(rc.qualifyingMonthlyIncome - j.recomputed) <= 1) agree++;
        else ck(`recompute agrees with the drift gate on ${r.key.slice(-8)}`, false, `${rc?.qualifyingMonthlyIncome} vs ${j.recomputed}`);
        if (j.drifted && !p.recomputed) pendingInfo.push(`${r.key.slice(-8)}: ships $${j.shipped} — current engine says $${j.recomputed} (recomputes on the next Verify income, no re-read)`);
      } else if (method === "bank_statement" && p.bankFactsUsed?.reads?.length) {
        bank++;
        ck(`bank-statement recompute produces a number on ${r.key.slice(-8)}`, !!rc && rc.qualifyingMonthlyIncome > 0 && rc.bankCoverage.length > 0);
      }
    }
    ck(`every standard file's recompute equals the drift gate's replay (${agree}/${standard})`, standard > 0 && agree === standard);
    ck(`at least one bank-statement file was recomputed from its deposit rows (${bank})`, bank > 0);
    for (const l of pendingInfo) console.log(`  ⚪ awaiting a click: ${l}`);
  }

  // ── 4. The route is wired: decides before any download, writes both keys, says what it did.
  {
    const src = code(ROUTE);
    const decide = src.search(/recomputeDecision\(\{ force, envelope, fingerprint, docsKey/);
    const download = src.search(/const pdfLooksValid/);
    ck("the route decides to recompute BEFORE the document download path", decide >= 0 && download > decide, `decide@${decide} download@${download}`);
    const writes = src.match(/setSetting\(CACHE_KEY, JSON\.stringify\(\{[^}]*\}\)/g) || [];
    ck("every cache write carries fingerprint, docsKey and logicVersion (2 writes)", writes.length === 2 && writes.every((w) => /docsKey/.test(w) && /logicVersion: LOGIC_VERSION/.test(w)), `${writes.length} write(s)`);
    ck("the recompute branch records income.recomputed with from/to", /action: "income\.recomputed"/.test(src) && /from: prevQ, to: rc\.qualifyingMonthlyIncome/.test(src));
    ck("…and the response says it was recomputed, with the earlier read's date and figure", /recomputed: \{ readAt, previousIncome: prevQ, logicVersion: LOGIC_VERSION/.test(src) && /recomputed: true, verifiedAt/.test(src));
    ck("…and merges flags through recomputedFlags (old add-backs cannot survive)", /recomputedFlags\(prev\.report\?\.flags \|\| \[\], rc\.flags, notice\)/.test(src));
    ck("docsKey is the fingerprint input WITHOUT the logic version", /const fingerprint = sha1\(LOGIC_VERSION \+ " " \+ DOCS_INPUT\)/.test(src) && /const docsKey = sha1\(DOCS_INPUT\)/.test(src));
  }

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — a logic-only miss recomputes from the stored facts; a document change still re-reads\n");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
