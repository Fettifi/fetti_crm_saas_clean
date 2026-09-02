// PACKAGE A LOAN FILE FOR A LENDER.
//
//   npx tsx scripts/package-lender-submission.ts --lender "Dominion Capital" FF-202608-5585 FF-202608-7639
//
// Pulls every document off the given loan files, names each one for WHAT IT IS in the order a
// lender reads them, writes a cover sheet on Fetti letterhead listing the contents, and zips it.
//
// Why the renaming matters: what arrives from a borrower is called IMG_0626.jpeg,
// Drivers_License.pdf and DominionApp.pdf. A processor opening that folder has to guess. Named
// "01 Bridge Application", "05 ID — Driver's Licence", the package reads itself, and anything
// absent is obvious — which is the point of the gap list on the cover sheet.
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { buildLetterPdf, type LetterBlock } from "../lib/letterPdf";
import { safe } from "../lib/docNaming";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const BUCKET = "loan-docs";

// ── how a document is named in the package ──────────────────────────────────────────────────
// Ordered: the first rule that matches wins, and its rank sets the number. Anything unmatched
// sorts last under "Supporting", never dropped — a document nobody classified still has to reach
// the lender.
type Rule = { rank: number; label: (f: string, n: string) => string | null };
const RULES: Rule[] = [
  { rank: 1, label: (f, n) => /bridge[_ ]?application|dfs[_ ]bridge/i.test(f + n) ? "Bridge Application" : null },
  { rank: 2, label: (f, n) => /data[_ ]?tape/i.test(f + n) ? "Data Tape" : null },
  { rank: 3, label: (f, n) => /check[_ ]?list|authorization|dominionapp/i.test(f + n) ? "Checklist & Authorization Forms" : null },
  { rank: 4, label: (f) => {
      const m = /^([A-Za-z0-9_ ]+?)_?(LLC|INC|CORP)?_*-?_*(Operating[_ ]Agreement|Articles[_ ]?Of[_ ]?Organization|EIN|Certificate[_ ]of[_ ]Good[_ ]Standing|Annual[_ ]List[_ ]of[_ ]Managers)/i.exec(f);
      if (!m) return null;
      const entity = m[1].replace(/_/g, " ").replace(/\s+/g, " ").trim() + (m[2] ? ` ${m[2].toUpperCase()}` : "");
      const kind = m[3].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `Entity — ${entity} — ${kind}`;
    } },
  { rank: 4, label: (f, n) => /entity|operating[_ ]agreement|articles|good[_ ]standing|ein\b/i.test(f + n) ? "Entity documents" : null },
  { rank: 5, label: (f, n) => /licen[cs]e|photo[_ ]?id|government|passport|drivers/i.test(f + n) ? "ID — Driver's Licence" : null },
  { rank: 6, label: (f, n) => {
      if (!/bank[_ ]?statement|morgan[_ ]stanley|statement/i.test(f + n)) return null;
      // Say WHICH month. Two files called "Assets — Statement" and "Assets — Statement (2)" make
      // an underwriter open both to find out whether the period they need is even there.
      // Statement exports almost always carry the period as YYYYMM in the filename.
      const m = /(20\d{2})(0[1-9]|1[0-2])(?!\d)/.exec(f);
      if (!m) return "Assets — Statement";
      const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return `Assets — Statement ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    } },
];

function classify(fileName: string, docName: string): { rank: number; label: string } {
  for (const r of RULES) {
    const l = r.label(fileName || "", docName || "");
    if (l) return { rank: r.rank, label: l };
  }
  return { rank: 9, label: `Supporting — ${(docName || fileName).replace(/\.[^.]+$/, "")}` };
}

const ext = (p: string) => (p.split(".").pop() || "pdf").toLowerCase();
const MB = (b: number) => (b / 1048576).toFixed(2);

(async () => {
  const argv = process.argv.slice(2);
  const li = argv.indexOf("--lender");
  const lender = li >= 0 ? argv[li + 1] : "Lender";
  const numbers = argv.filter((a, i) => a.startsWith("FF-") && i !== li + 1);
  // --require "Bridge Application|Data Tape|Checklist"  — the forms the lender said they need.
  // The cover sheet then answers the only question the lender actually asks on receipt: is the
  // set complete? Naming them here means a missing form is caught before the email goes, not
  // after it comes back.
  const ri = argv.indexOf("--require");
  const required = ri >= 0 ? String(argv[ri + 1] || "").split("|").map((x) => x.trim()).filter(Boolean) : [];
  if (!numbers.length) { console.error("Give at least one file number, e.g. FF-202608-5585"); process.exit(1); }

  const ROOT = join(homedir(), "Desktop", safe(`${lender} — submission`, 80));
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });   // rebuild cleanly
  mkdirSync(ROOT, { recursive: true });

  const summary: { folder: string; borrower: string; count: number; bytes: number; missing: string[]; gaps: string[] }[] = [];

  for (const num of numbers) {
    const { data: f, error } = await supabaseAdmin.from("loan_files")
      .select("id,file_number,borrower_name,product,stage,loan_amount,property_address").eq("file_number", num).maybeSingle();
    if (error || !f) { console.error(`  ${num}: not found`); continue; }
    const file: any = f;

    const { data: docs } = await supabaseAdmin.from("loan_documents")
      .select("id,name,status,storage_path,file_name,size_bytes").eq("loan_file_id", file.id).order("created_at");
    const have = (docs || []).filter((d: any) => d.storage_path);
    const missing = (docs || []).filter((d: any) => !d.storage_path).map((d: any) => d.name);

    const folderName = safe(`${file.borrower_name} — ${file.file_number}`, 90);
    const dir = join(ROOT, folderName);
    mkdirSync(dir, { recursive: true });

    // classify, then number within the package so the order is stable and readable
    const items = have.map((d: any) => ({ d, ...classify(d.file_name || "", d.name || "") }))
      .sort((a: any, b: any) => a.rank - b.rank || a.label.localeCompare(b.label));

    const used = new Map<string, number>();
    const written: { name: string; bytes: number; from: string }[] = [];
    let i = 0;
    for (const it of items) {
      const { data: blob, error: dErr } = await supabaseAdmin.storage.from(BUCKET).download(it.d.storage_path);
      if (dErr || !blob) { console.error(`  ! could not download ${it.d.file_name}: ${dErr?.message}`); continue; }
      const bytes = Buffer.from(await blob.arrayBuffer());
      i++;
      let base = `${String(i).padStart(2, "0")} ${it.label}`;
      const seen = used.get(it.label) || 0; used.set(it.label, seen + 1);
      if (seen > 0) base += ` (${seen + 1})`;
      const out = join(dir, `${safe(base, 100)}.${ext(it.d.file_name || it.d.storage_path)}`);
      writeFileSync(out, bytes);
      written.push({ name: out.split("/").pop()!, bytes: bytes.length, from: it.d.file_name || it.d.name });
    }

    // ── cover sheet ──
    const blocks: LetterBlock[] = [
      { kind: "para", text: `Enclosed is the submission package for ${file.borrower_name}. Every document listed below is included in this folder, named in the order shown.` },
      { kind: "space", h: 6 },
      { kind: "kv", label: "Borrower", value: String(file.borrower_name || "—") },
      { kind: "kv", label: "Fetti file", value: String(file.file_number) },
      { kind: "kv", label: "Program", value: String(file.product || "—") },
    ];
    if (file.property_address) blocks.push({ kind: "kv", label: "Property", value: String(file.property_address) });
    if (file.loan_amount) blocks.push({ kind: "kv", label: "Loan amount", value: `$${Number(file.loan_amount).toLocaleString()}` });
    if (required.length) {
      blocks.push({ kind: "space", h: 8 }, { kind: "heading", text: "Forms required for approval" });
      for (const req of required) {
        const hit = items.find((it: any) => it.label.toLowerCase().includes(req.toLowerCase()));
        blocks.push({ kind: "kv", label: req, value: hit ? "Enclosed" : "NOT ENCLOSED" });
      }
    }
    blocks.push({ kind: "space", h: 8 }, { kind: "heading", text: "Contents" });
    let total = 0;
    written.forEach((w, n) => {
      total += w.bytes;
      blocks.push({ kind: "numbered", n: n + 1, title: w.name.replace(/\.[^.]+$/, ""), text: `${w.name}  ·  ${MB(w.bytes)} MB` });
    });
    blocks.push({ kind: "space", h: 6 }, { kind: "kv", label: "Documents enclosed", value: `${written.length}` },
      { kind: "kv", label: "Total size", value: `${MB(total)} MB` });
    if (missing.length) {
      blocks.push({ kind: "space", h: 8 }, { kind: "heading", text: "Still outstanding on our side" },
        { kind: "para", text: missing.join("\n") });
    }

    const pdf = await buildLetterPdf({
      title: `${lender} — Submission Package`,
      toLines: [lender],
      reLines: [`${file.borrower_name} — ${file.file_number}`, String(file.product || "")].filter(Boolean),
      salutation: "",
      blocks,
      signerName: "Ramon Dent",
      signerTitle: "Fetti Financial Services LLC · NMLS #2267023",
      contactLine: "(424) 675-6295 · ramon@fettifi.com",
    });
    writeFileSync(join(dir, "00 Cover Sheet — Contents.pdf"), Buffer.from(pdf));

    const gaps = required.filter((req) => !items.some((it: any) => it.label.toLowerCase().includes(req.toLowerCase())));
    summary.push({ folder: folderName, borrower: file.borrower_name, count: written.length, bytes: total, missing, gaps });
    console.log(`\n${file.borrower_name} — ${file.file_number}`);
    for (const w of written) console.log(`   ${w.name.padEnd(62)} ${MB(w.bytes).padStart(6)} MB   (was ${w.from})`);
    if (missing.length) console.log(`   outstanding: ${missing.join(", ")}`);

    // ── zip it ──
    execFileSync("zip", ["-qr", `${dir}.zip`, folderName], { cwd: ROOT });
  }

  console.log(`\n=== ${ROOT.replace(homedir(), "~")} ===`);
  for (const s of summary) console.log(`  ${s.folder}: ${s.count} documents, ${MB(s.bytes)} MB${s.missing.length ? ` · ${s.missing.length} outstanding on the checklist` : ""}`);
  const anyGap = summary.filter((s) => s.gaps.length);
  if (anyGap.length) {
    console.log("\nREQUIRED FORMS NOT ENCLOSED — do not send until these are in:");
    for (const s of anyGap) console.log(`  ${s.borrower}: ${s.gaps.join(", ")}`);
  } else if (required.length) {
    console.log(`\nEvery required form is enclosed for all ${summary.length} borrower(s).`);
  }
})();
