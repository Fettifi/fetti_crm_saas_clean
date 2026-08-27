// SCANNING A DOCUMENT INTO A LOAN FILE — THE PART THAT IS NOT A USER INTERFACE.
//
// Two things drive a scan: the Terminal tool (scripts/scan-to-file.ts) and the Scan button in the
// CRM, which reaches the scanner through the local agent (scripts/scan-agent.ts). They ask
// completely different questions but they must FILE a document identically, so the filing lives
// here once. A second copy is how the button and the Terminal tool end up disagreeing about where
// a document went — see lib/docNaming.ts for the same reasoning about names.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { safe, loanFolderName } from "@/lib/docNaming";
import { compressPdfIfNeeded } from "@/lib/pdfCompress";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve, sep } from "path";

const execFileP = promisify(execFile);
export const BUCKET = "loan-docs";
export const MIRROR_ROOT = () => process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const FOUR_MB = 4 * 1024 * 1024;

// ── where a scan is allowed to be saved ─────────────────────────────────────────────────────
// The agent takes a destination folder from a web page, so this is the boundary between "Ramon
// picked a folder" and "a page on the internet picked a folder". Writes are confined to these
// roots, resolved through symlinks, so a crafted path cannot land a file in a login item, a
// LaunchAgents folder, or anywhere else that would execute later.
export const ALLOWED_ROOTS = (): string[] => [
  MIRROR_ROOT(),
  join(homedir(), "Desktop"),
  join(homedir(), "Documents"),
  join(homedir(), "Downloads"),
  join(homedir(), "Fetti Clients"),
  join(homedir(), "Fetti Legal"),
];

export function assertAllowedDir(dir: string): string {
  const abs = resolve(dir.replace(/^~(?=$|\/)/, homedir()));
  // Resolve the deepest part that exists, so a new sub-folder is fine but a symlinked parent is not.
  let probe = abs;
  while (!existsSync(probe)) {
    const up = resolve(probe, "..");
    if (up === probe) break;
    probe = up;
  }
  const real = existsSync(probe) ? realpathSync(probe) : probe;
  if (existsSync(real) && !statSync(real).isDirectory()) throw new Error("That destination is a file, not a folder.");
  const ok = ALLOWED_ROOTS().some((r) => {
    const rr = existsSync(r) ? realpathSync(r) : resolve(r);
    return real === rr || real.startsWith(rr + sep);
  });
  if (!ok) throw new Error(`Saving there isn't allowed. Choose a folder inside: ${ALLOWED_ROOTS().map((r) => r.replace(homedir(), "~")).join(", ")}`);
  return abs;
}

// ── the scan itself ─────────────────────────────────────────────────────────────────────────
export type ScanSource = "adf" | "glass";

export async function scanToPdf(source: ScanSource): Promise<Buffer> {
  const out = join(homedir(), "Desktop", `.fetti-scan-${Date.now()}.pdf`);
  const args = [...(source === "adf" ? ["--adf"] : []), "--out", out];
  try {
    await execFileP(join(homedir(), "bin", "scan"), args, { timeout: 5 * 60_000, maxBuffer: 1 << 20 });
  } catch (e: any) {
    // ~/bin/scan already explains itself on stderr; pass that through rather than a generic failure.
    const msg = String(e?.stderr || e?.message || "").trim().split("\n").filter(Boolean).slice(0, 3).join(" ");
    try { if (existsSync(out)) unlinkSync(out); } catch {}
    throw new Error(msg || "The scan didn't complete.");
  }
  if (!existsSync(out)) throw new Error("The scan produced no file.");
  const bytes = readFileSync(out);
  try { unlinkSync(out); } catch {}
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) throw new Error("The scanner returned something that isn't a PDF.");
  return bytes;
}

export async function shrinkIfNeeded(raw: Buffer, onNote?: (s: string) => void): Promise<Buffer> {
  if (raw.length <= FOUR_MB) return raw;
  try {
    const r = await compressPdfIfNeeded(raw, { targetBytes: FOUR_MB, hardMaxBytes: 8 * 1024 * 1024 });
    onNote?.(`${(raw.length / 1048576).toFixed(1)} MB → ${(r.toBytes / 1048576).toFixed(1)} MB${r.note ? ` (${r.note})` : ""}`);
    return r.buf;
  } catch (e: any) {
    onNote?.(`couldn't shrink (${e?.message || e}) — filing it full size`);
    return raw;
  }
}

// ── filing it ───────────────────────────────────────────────────────────────────────────────
export type FileScanInput = {
  file: { id: string; borrower_name?: string | null; file_number?: string | null };
  docName: string;
  bytes: Buffer;
  existingDocId?: string | null;   // fill this checklist row instead of adding a document
  destDir?: string | null;         // where to save the copy on disk; default = the mirror folder
  attachToLoanFile?: boolean;      // default true
};

export type FileScanResult = { name: string; bytes: number; localPath: string | null; storagePath: string | null; docId: string | null };

export async function fileScannedDocument(input: FileScanInput): Promise<FileScanResult> {
  const { file, bytes } = input;
  const attach = input.attachToLoanFile !== false;
  const label = safe(input.docName);
  if (!label || label === "untitled") throw new Error("Give the document a name.");

  let storagePath: string | null = null;
  let docId: string | null = input.existingDocId || null;

  if (attach) {
    storagePath = `${file.id}/${Date.now()}-${label.replace(/\s+/g, "_")}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`Couldn't upload: ${upErr.message}`);

    const patch = {
      storage_path: storagePath, file_name: `${label}.pdf`, size_bytes: bytes.length,
      status: "received", updated_at: new Date().toISOString(),
    };
    const res = input.existingDocId
      ? await supabaseAdmin.from("loan_documents").update(patch).eq("id", input.existingDocId).select("id").maybeSingle()
      : await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: file.id, name: input.docName, category: "Additional", required: false,
          uploaded_by: "lo", ...patch,
        }]).select("id").maybeSingle();
    if (res.error) {
      // The bytes are in the bucket but nothing points at them. Take them back out rather than
      // leaving an orphan no screen will ever show.
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(`Couldn't attach it to the loan file: ${res.error.message}`);
    }
    docId = (res.data as any)?.id || input.existingDocId || null;
  }

  // ── the copy on disk ──
  const mirrorFolder = join(MIRROR_ROOT(), loanFolderName(file.borrower_name || null, file.file_number || null, file.id));
  const dir = input.destDir ? assertAllowedDir(input.destDir) : mirrorFolder;
  mkdirSync(dir, { recursive: true });
  let localPath = join(dir, `${label}.pdf`);
  for (let n = 2; existsSync(localPath); n++) localPath = join(dir, `${label} (${n}).pdf`);
  writeFileSync(localPath, bytes);

  // Record it in the sync manifest ONLY when the copy went to the folder the mirror owns.
  //
  // Without that line the next sync sees a local file it has no record of, treats it as something
  // Ramon added by hand, and pushes it back up as a second copy. But when he chose a DIFFERENT
  // folder, this file is his own copy and the mirror has not written its one yet — claiming it in
  // the manifest would make the mirror believe a document it never downloaded is already current,
  // and the borrower's folder would be permanently missing it.
  if (storagePath && dir === mirrorFolder) {
    const MANIFEST = join(MIRROR_ROOT(), ".fetti-sync.json");
    try {
      const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
      m[storagePath] = { file: localPath, bytes: bytes.length };
      writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
    } catch { /* the mirror self-heals on its next run; never fail a filed document over this */ }
  }

  return { name: `${label}.pdf`, bytes: bytes.length, localPath, storagePath, docId };
}
