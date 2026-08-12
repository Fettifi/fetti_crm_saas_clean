// EVERY SIGNED AGREEMENT AND CERTIFICATE, MIRRORED TO A REAL FOLDER ON THE MAC.
//
// Ramon, 2026-08-12: "Where did the document go after I signed it. Create a folder inside of
// Fetti for all of the signed esign agreements and completion letters."
//
// They were never lost — a completed envelope attaches its signed copy and its Certificate of
// Completion to the loan file, and both open on /esign. But they only live in Supabase storage,
// which means they cannot be dragged into an email, attached in a portal, or handed to an
// auditor without going through the app first. And envelopes with no loan file attached
// (Isaac O'Dell, 615-617 N Temple, the AAR) are not mirrored by com.fetti.docsync at all.
//
// This pulls both PDFs for every envelope that has them into
//     ~/Fetti Signed Agreements/<YYYY-MM-DD> <Title>/
//         <Title> — Signed.pdf
//         <Title> — Certificate of Completion.pdf
//
// Keyed on its own manifest by STORAGE PATH, never on a size column — `size_bytes` went stale
// once already and made a sync re-download the same file forever (see local-loan-file-mirror).
//
//   npx tsx scripts/sync-esign-docs.ts          # sync new/changed only
//   npx tsx scripts/sync-esign-docs.ts --all    # re-download everything
import "./_env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { ESIGN_BUCKET, listRequests } from "../lib/esign";

const ROOT = join(homedir(), "Fetti Signed Agreements");
const MANIFEST = join(ROOT, ".fetti-esign-sync.json");
const ALL = process.argv.includes("--all");

/** Filesystem-safe, but still readable to a human scanning the folder in Finder. */
function safe(s: string): string {
  return String(s || "document")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

(async () => {
  mkdirSync(ROOT, { recursive: true });
  const seen: Record<string, string> = ALL || !existsSync(MANIFEST)
    ? {}
    : JSON.parse(readFileSync(MANIFEST, "utf8"));

  const envs = await listRequests();
  let wrote = 0, skipped = 0, failed = 0, folders = 0;

  for (const e of envs) {
    const wants: [string | null | undefined, string][] = [
      [e.signed_path, "Signed"],
      [e.cert_path, "Certificate of Completion"],
    ];
    if (!wants.some(([p]) => p)) continue;

    const day = String(e.created_at || "").slice(0, 10) || "undated";
    const dir = join(ROOT, safe(`${day} ${e.title}`));
    let made = false;

    for (const [path, label] of wants) {
      if (!path) continue;
      const dest = join(dir, `${safe(e.title)} — ${label}.pdf`);
      if (seen[path] === dest && existsSync(dest)) { skipped++; continue; }

      const { data, error } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(path);
      if (error || !data) { console.warn(`  ! ${label}: ${path} — ${error?.message || "no data"}`); failed++; continue; }
      if (!made) { mkdirSync(dir, { recursive: true }); made = true; folders++; }
      const buf = Buffer.from(await data.arrayBuffer());
      // A PDF that is not a PDF is a silent corruption; refuse it rather than file it.
      if (buf.subarray(0, 5).toString("latin1").indexOf("%PDF") !== 0) {
        console.warn(`  ! ${label}: ${path} is not a PDF — skipped`); failed++; continue;
      }
      writeFileSync(dest, buf);
      seen[path] = dest;
      wrote++;
      console.log(`  + ${safe(e.title).slice(0, 46)} — ${label} (${(buf.length / 1024).toFixed(0)} KB)`);
    }
  }

  writeFileSync(MANIFEST, JSON.stringify(seen, null, 1));
  console.log(`\n${ROOT}`);
  console.log(`  ${wrote} written · ${skipped} already current · ${failed} failed · ${folders} folder(s) touched`);
  if (failed) process.exitCode = 1;
})();
