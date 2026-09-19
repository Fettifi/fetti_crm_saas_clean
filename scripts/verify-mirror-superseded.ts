// THE FOLDER A PORTAL BROWSES HOLDS WHAT THE LOS HOLDS — NOTHING THE LOS HAS REPLACED.
//
// Ramon, 2026-09-17, uploading Magali and Milton's IDs to a lender portal: "My LOS shows it as a
// PDF. What I'm trying to upload through the portal is still showing JPEG." The mirror had the
// PDFs; it ALSO had the pre-conversion JPEGs, renamed "— original", sorted between them. This
// guard holds three things:
//
//   1. the planner moves a replaced copy out of the top level and NEVER moves a live file — not
//      even when a dead manifest entry points at the very path a new version was written to
//   2. sync-loan-docs.ts actually runs this code (comments stripped before matching)
//   3. in the real ~/Fetti Loan Files, no top-level file is a copy the LOS no longer holds
//
//   npm run verify:mirror-superseded
import "./_env";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync, renameSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import { join, dirname } from "path";
import { planSupersededMoves, applySupersededMoves, REPLACED_DIR, ManifestEntry } from "../lib/mirrorSuperseded";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { requireLiveDb, rows } from "./_liveDb";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

function countFiles(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

(async () => {
  console.log("\nMIRROR — replaced copies leave the folder a portal browses\n");

  // ── 1. scratch tree ──────────────────────────────────────────────────────────────────────
  console.log("── planner + apply on a scratch tree ──");
  const root = mkdtempSync(join(tmpdir(), "mirror-superseded-"));
  const b = join(root, "Test Borrower — FF-000000-0001");
  mkdirSync(join(b, "my own subfolder"), { recursive: true });
  const f = (name: string) => { const p = join(b, name); writeFileSync(p, name); return p; };
  const livePdf = f("Government-issued photo ID.pdf");
  const deadJpg = f("Government-issued photo ID — 20260722_110053.jpg");
  const labelled = f("Pay stubs — last 30 days — original.jpeg");
  const labelled2 = f("Pay stubs — last 30 days — original (2).jpeg");
  const overwritten = f("W-2s — last 2 years.pdf");       // dead key AND live key point here
  const resaved = f("Bank statement — June.pdf");          // dead path, but Ramon saved NEW bytes over it
  const deeper = join(b, "my own subfolder", "old scan.pdf"); writeFileSync(deeper, "x");
  mkdirSync(join(b, REPLACED_DIR));
  writeFileSync(join(b, REPLACED_DIR, "Pay stubs — last 30 days — original.jpeg"), "already there");

  // Manifest bytes are what the sync wrote; the scratch files hold their own name, so the byte
  // counts below are the real sizes — except D7, which deliberately disagrees with the disk.
  const sz = (p: string) => statSync(p).size;
  const manifest: Record<string, ManifestEntry> = {
    "L1": { file: livePdf, bytes: sz(livePdf) },
    "D1": { file: deadJpg, bytes: sz(deadJpg) },
    "D2": { file: labelled, bytes: sz(labelled) },
    "D3": { file: labelled2, bytes: sz(labelled2) },
    "D4": { file: overwritten, bytes: 1 },    // the 2026-08-20 trap: dead key on a path the live key now owns
    "L4": { file: overwritten, bytes: sz(overwritten) },
    "D5": { file: deeper, bytes: sz(deeper) },
    "D6": { file: join(b, "gone.pdf"), bytes: 1 },
    "D7": { file: resaved, bytes: 999 },      // manifest remembers 999 bytes; the file on disk is not that
  };
  const livePaths = new Set(["L1", "L4"]);
  const before = countFiles(root);
  const sizeOf = (p: string) => { try { return statSync(p).size; } catch { return -1; } };
  const plan = planSupersededMoves({ root, manifest, livePaths, exists: existsSync, sizeOf });
  const from = new Set(plan.map((m) => m.from));
  ck("a file whose bytes no longer match the manifest (Ramon re-saved it) is left alone", !from.has(resaved));

  ck("a replaced JPEG is selected", from.has(deadJpg));
  ck("an already-labelled '— original' copy is selected", from.has(labelled) && from.has(labelled2));
  ck("a LIVE file is never selected", !from.has(livePdf));
  ck("a file a dead key AND a live key share is never selected (the 08-20 trap)", !from.has(overwritten));
  ck("a file in a subfolder Ramon made is left alone", !from.has(deeper));
  ck("a manifest entry whose file is gone is ignored", plan.every((m) => !m.from.endsWith("gone.pdf")));
  ck("every destination is inside the borrower's replaced folder", plan.every((m) => dirname(m.to) === join(b, REPLACED_DIR)));
  ck("no two moves share a destination", new Set(plan.map((m) => m.to)).size === plan.length);
  ck("an existing file in the replaced folder is not overwritten", plan.every((m) => !existsSync(m.to)));

  const { moved, failed } = applySupersededMoves(plan, manifest, {
    mkdir: (d) => mkdirSync(d, { recursive: true }), rename: (a, c) => renameSync(a, c),
  });
  ck("every planned move happened", moved.length === plan.length && failed.length === 0, `${moved.length}/${plan.length}`);
  ck("NOTHING was deleted", countFiles(root) === before, `${before} files before, ${countFiles(root)} after`);
  const top = readdirSync(b).filter((e) => statSync(join(b, e)).isFile()).sort();
  ck("the top level now holds exactly the live files plus the re-saved one", JSON.stringify(top) === JSON.stringify(["Bank statement — June.pdf", "Government-issued photo ID.pdf", "W-2s — last 2 years.pdf"]), top.join(" | "));
  ck("the manifest follows every moved file (the push side must not see it as new)",
    Object.entries(manifest).every(([, v]) => existsSync(v.file) || v.file.endsWith("gone.pdf")));
  ck("the pre-existing replaced copy kept its bytes", readFileSync(join(b, REPLACED_DIR, "Pay stubs — last 30 days — original.jpeg"), "utf8") === "already there");
  const again = planSupersededMoves({ root, manifest, livePaths, exists: existsSync, sizeOf });
  ck("a second run moves nothing", again.length === 0, `${again.length} planned`);
  rmSync(root, { recursive: true, force: true });

  // ── 2. the shipping script runs it ───────────────────────────────────────────────────────
  console.log("\n── sync-loan-docs.ts uses this code ──");
  const src = readFileSync("scripts/sync-loan-docs.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // a comment is not wiring
  ck("calls planSupersededMoves with the live storage paths", /planSupersededMoves\(\s*\{[\s\S]{0,200}?livePaths/.test(src));
  ck("refuses to plan a move when the live set does not match the LOS count", /liveSetComplete\s*\?\s*planSupersededMoves/.test(src) && /docs\.length === docCount/.test(src));
  ck("calls applySupersededMoves on the real manifest", /applySupersededMoves\(\s*plan\s*,\s*manifest\s*,/.test(src));
  ck("no in-place '— original' rename survives in the script", !/— original\$\{ext\}/.test(src));

  // ── 3. the real folder ───────────────────────────────────────────────────────────────────
  console.log("\n── ~/Fetti Loan Files, live ──");
  await requireLiveDb("verify:mirror-superseded");
  const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
  const MANIFEST = join(ROOT, ".fetti-sync.json");
  ck("the mirror manifest exists", existsSync(MANIFEST));
  const real: Record<string, ManifestEntry> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const docs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rows<any>("verify:mirror-superseded",
      supabaseAdmin.from("loan_documents").select("storage_path").not("storage_path", "is", null).order("id").range(from, from + 999) as any);
    docs.push(...page); if (page.length < 1000) break;
  }
  const { count: docCount } = await supabaseAdmin.from("loan_documents").select("id", { count: "exact", head: true }).not("storage_path", "is", null);
  ck("the live document set was read in full (paged past PostgREST's 1000-row cap)", docCount != null && docs.length === docCount && docs.length > 0, `${docs.length} read, ${docCount} in the LOS`);
  const live = new Set(docs.map((d) => String(d.storage_path)));
  const liveFiles = new Set(Object.entries(real).filter(([k]) => live.has(k)).map(([, v]) => v.file));
  const deadTop: string[] = [];
  let scanned = 0;
  for (const [k, v] of Object.entries(real)) {
    if (live.has(k) || !v?.file || liveFiles.has(v.file) || !existsSync(v.file)) continue;
    if (dirname(dirname(v.file)) !== ROOT) continue;
    deadTop.push(v.file.replace(ROOT + "/", ""));
  }
  for (const dir of readdirSync(ROOT)) {
    const p = join(ROOT, dir);
    if (dir.startsWith(".") || !statSync(p).isDirectory()) continue;
    for (const e of readdirSync(p)) if (!e.startsWith(".") && statSync(join(p, e)).isFile()) scanned++;
  }
  for (const o of deadTop.slice(0, 8)) console.log(`     ↳ ${o}`);
  ck("no top-level file in any borrower folder is a copy the LOS has replaced", deadTop.length === 0, `${deadTop.length} found`);
  ck("…and the check read real files and real documents — not vacuous", scanned > 0 && live.size > 0, `${scanned} top-level files, ${live.size} live documents`);

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — the folder a portal browses holds what the LOS holds\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
