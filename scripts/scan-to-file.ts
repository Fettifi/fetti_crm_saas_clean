// SCAN STRAIGHT INTO A LOAN FILE.
//
// Ramon: "Build me a scanner tool so I can scan documents directly to files and be able to find
// them." The CRM itself cannot do this — it runs in the cloud and the scanner is on his LAN — so
// this runs on the Mac, talks to the scanner over eSCL and to the LOS over the service key.
//
// Everything is a native macOS picker, so it is a few clicks and no typing:
//   1. pick the borrower        (active loan files, most recently touched first)
//   2. pick what the document IS (that file's own checklist, so it files itself correctly)
//   3. it scans, uploads, and names the file after the checklist item
//
// The point is the last part. A scan called "Scan-2026-08-27-135451.pdf" on a Desktop holding
// 170 items is a document you have lost. Named for what it is, on the loan file it belongs to,
// it is a document you can find.
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { execFileSync } from "child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { compressPdfIfNeeded } from "../lib/pdfCompress";

import { safe, loanFolderName } from "../lib/docNaming";

const BUCKET = "loan-docs";

// ── native pickers ──────────────────────────────────────────────────────────────────────────
// PROMPT IN THE TERMINAL, NOT IN A DIALOG.
//
// The first three attempts used AppleScript `choose from list`. Launched from a .command the
// process is not frontmost, so the picker opened BEHIND whatever was on screen — once behind
// Outlook, twice behind System Settings — with osascript blocking patiently and nothing to see.
// System Events reported the window existed; it just never came forward.
//
// The .command already opens a Terminal window, so a numbered menu is visible by construction.
// No focus to win, no second display to lose it on, and it works over SSH too.
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });

// If input goes away mid-run — the Terminal window is closed, or the tool is driven from a pipe
// that ends — readline throws ERR_USE_AFTER_CLOSE from whatever question is outstanding. Nothing
// has been uploaded at that point, so the right response is to leave quietly rather than print a
// stack trace at someone who just closed a window.
let closed = false;
rl.on("close", () => { closed = true; });
const ask = (q: string): Promise<string> =>
  closed ? Promise.resolve("") : new Promise((res) => {
    try { rl.question(q, (a) => res(a.trim())); } catch { res(""); }
  });

async function choose(prompt: string, items: string[]): Promise<string | null> {
  console.log(`\n${prompt}\n`);
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}.  ${it}`));
  console.log("   q.  cancel\n");
  for (;;) {
    const a = await ask("Choose a number: ");
    if (!a || a.toLowerCase() === "q") return null;
    const n = Number(a);
    if (n >= 1 && n <= items.length) return items[n - 1];
    console.log(`  "${a}" isn't one of the options.`);
  }
}
const say = (msg: string) => console.log(`\n${msg}\n`);

// ONE DOCUMENT, START TO FINISH. Returns the path it wrote on disk, or null if nothing was filed.
// A failure here is never fatal — the caller offers another go, because the usual cause is a
// misfed page and the fix is to straighten the stack and pick the same item again.
async function scanOneDocument(file: any): Promise<string | null> {
  // ── what is it ──
  // The file's OWN checklist, outstanding items first: a scan named after the item it satisfies
  // lands where the LO is already looking for it.
  const { data: docs } = await supabaseAdmin.from("loan_documents")
    .select("id,name,status,storage_path").eq("loan_file_id", file.id).order("required", { ascending: false });
  const open = (docs || []).filter((d: any) => !d.storage_path).map((d: any) => d.name);
  const filled = (docs || []).filter((d: any) => d.storage_path).map((d: any) => `${d.name}  (replace)`);
  const options = [...open, ...filled, "Something else…"];
  const pickedDoc = await choose(`${file.borrower_name} — what is this document?`, options);
  if (!pickedDoc) return null;

  let docName = pickedDoc.replace(/\s+\(replace\)$/, "");

  // REPLACING SOMETHING ALREADY THERE IS A DESTRUCTIVE ANSWER TO A MENU. Confirm it.
  // A mistyped digit is one keystroke, and the items already holding a document sit directly
  // under the outstanding ones in the same numbered list. Overwriting a bank statement that took
  // three weeks to chase down should take more than an off-by-one.
  if (/\s\(replace\)$/.test(pickedDoc)) {
    const yes = (await ask(`\n"${docName}" already has a document. Replace it? (y/N): `)).toLowerCase();
    if (yes !== "y" && yes !== "yes") { say("Left as it was."); return null; }
  }

  if (pickedDoc === "Something else…") {
    docName = await ask("Name this document: ");
    if (!docName) return null;
  }

  // ── feeder or glass ──
  const src = await choose("Where is the document?", ["Document feeder (multi-page)", "Glass (single page)"]);
  if (!src) return null;
  const adf = src.startsWith("Document feeder");

  // ── scan ──
  const out = join(homedir(), "Desktop", `.fetti-scan-${Date.now()}.pdf`);
  try {
    execFileSync(join(homedir(), "bin", "scan"), [...(adf ? ["--adf"] : []), "--out", out], { stdio: "inherit" });
  } catch {
    say("The scan didn't complete. Check the feeder and the printer panel, then try again.");
    return null;
  }
  if (!existsSync(out)) { say("The scan produced no file."); return null; }
  const raw = readFileSync(out);

  // ── shrink if it needs it ──
  // A ten-page ADF scan lands around 300 dpi colour and clears 4 MB without trying. Uploading it
  // at that size is how the LOS filled up before; shrinking here means the copy in the loan file
  // and the copy on disk are the one Ramon can actually send to a lender portal.
  let bytes: Buffer = raw;
  const FOUR_MB = 4 * 1024 * 1024;
  if (raw.length > FOUR_MB) {
    process.stdout.write(`  ${(raw.length / 1048576).toFixed(1)} MB — shrinking… `);
    try {
      const r = await compressPdfIfNeeded(raw, { targetBytes: FOUR_MB, hardMaxBytes: 8 * 1024 * 1024 });
      bytes = r.buf;
      console.log(`${(r.toBytes / 1048576).toFixed(1)} MB${r.note ? ` (${r.note})` : ""}`);
    } catch (e: any) {
      console.log(`couldn't shrink (${e?.message || e}) — filing it full size`);
    }
  }

  // ── file it ──
  const label = safe(docName);
  const storagePath = `${file.id}/${Date.now()}-${label.replace(/\s+/g, "_")}.pdf`;
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) { say(`Couldn't upload: ${upErr.message}`); return null; }

  // Fill the checklist item if it was one; otherwise add the document to the file.
  const existing = (docs || []).find((d: any) => d.name === docName);
  const attach = existing
    ? await supabaseAdmin.from("loan_documents").update({
        storage_path: storagePath, file_name: `${label}.pdf`, size_bytes: bytes.length,
        status: "received", updated_at: new Date().toISOString(),
      }).eq("id", existing.id)
    : await supabaseAdmin.from("loan_documents").insert([{
        loan_file_id: file.id, name: docName, category: "Additional", required: false,
        status: "received", storage_path: storagePath, file_name: `${label}.pdf`,
        size_bytes: bytes.length, uploaded_by: "lo",
      }]);
  if (attach.error) {
    // The bytes are in the bucket but nothing points at them. Take them back out rather than
    // leaving an orphan no screen will ever show.
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    say(`Couldn't attach it to the loan file: ${attach.error.message}`);
    return null;
  }

  // ── and into the borrower's folder, THE WAY THE MIRROR WOULD HAVE WRITTEN IT ──
  //
  // Same root, same folder name, same filename, and the manifest entry recorded in lockstep.
  // Without the manifest line the next `sync-loan-docs` run sees a local file it has no record of,
  // treats it as something Ramon added by hand, and pushes it back up as a SECOND copy of the
  // document that was just scanned.
  const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
  const folder = join(ROOT, loanFolderName(file.borrower_name, file.file_number, file.id));
  mkdirSync(folder, { recursive: true });
  let local = join(folder, `${label}.pdf`);
  for (let n = 2; existsSync(local); n++) local = join(folder, `${label} (${n}).pdf`);
  writeFileSync(local, bytes);

  const MANIFEST = join(ROOT, ".fetti-sync.json");
  try {
    const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
    m[storagePath] = { file: local, bytes: bytes.length };
    writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
  } catch (e: any) {
    console.warn(`  (couldn't record it in the sync manifest: ${e?.message || e} — run \`npm run docs:sync -- --dry\` before the next sync)`);
  }
  try { execFileSync("rm", ["-f", out]); } catch {}

  say(`Filed to ${file.borrower_name}\n\n  ${label}.pdf  (${(bytes.length / 1048576).toFixed(1)} MB)\n\n${local.replace(homedir(), "~")}`);
  return local;
}

(async () => {
  const { data: files } = await supabaseAdmin.from("loan_files")
    .select("id,file_number,borrower_name,lead_id")
    .eq("status", "active").order("updated_at", { ascending: false }).limit(40);
  if (!files?.length) { say("No active loan files found."); rl.close(); process.exit(1); }
  const labels = files.map((f: any) => `${f.borrower_name || "Borrower"} — ${f.file_number}`);

  // A loan file almost never needs exactly one document, so stay open until he says he's done.
  // Re-launching the tool for every page of a bank statement is how a good tool goes unused.
  let file: any = null;
  let filed = 0;
  for (;;) {
    if (!file) {
      const picked = await choose("Scan into which loan file?", labels);
      if (!picked) break;
      file = files[labels.indexOf(picked)];
    }
    if (await scanOneDocument(file)) filed++;

    const next = await choose("Anything else?", [
      `Another document for ${file.borrower_name}`,
      "A different loan file",
      "Done",
    ]);
    if (!next || next === "Done") break;
    if (next === "A different loan file") file = null;
  }

  rl.close();
  say(filed === 0 ? "Nothing filed." : `Done — ${filed} document${filed === 1 ? "" : "s"} filed.`);
})();
