// A REPLACED DOCUMENT MUST LEAVE THE FOLDER RAMON PICKS FROM.
//
// Ramon, 2026-09-17: "Make sure that the mirror that I'm pulling documents from when I'm trying to
// sub them actually shows what's there. I'm trying to upload Magali and Milton's government-issued
// photo. My LOS shows it as a PDF. What I'm trying to upload through the portal is still showing
// JPEG."
//
// The LOS and the mirror agreed — both IDs were PDFs on disk. But converting a document gives it a
// new storage_path, and this sync never deletes, so the pre-conversion JPEGs stayed IN THE SAME
// FOLDER, merely renamed "— original". A file picker sorts them straight in between the live PDFs:
//
//     Government-issued photo ID (2).pdf
//     Government-issued photo ID — 20260722_110053 — original.jpg     <- dead
//     Government-issued photo ID — 20260723_211741 — original.jpg     <- dead
//     Government-issued photo ID.pdf
//
// A suffix is not a signal anyone reads in a portal's upload dialog. Labelling was the half-fix;
// the folder a portal browses must hold what the LOS holds. So a replaced copy now MOVES into a
// subfolder of the borrower's folder. Still never deleted — the original is one click away — and
// the push side only reads top-level files, so it can never be re-uploaded from there.
//
// The selection rule is unchanged and load-bearing: "this storage_path is no longer live" is NOT
// sufficient. A dead manifest entry usually points at the very path the download just overwrote
// with the NEW version (same checklist-derived name, new bytes). Selecting on the dead key alone
// moved a live Wells Fargo statement and a live tax return in a dry run on 2026-08-20. A file is
// replaced only when NO live document maps onto it.
import { basename, dirname, extname, join, resolve } from "path";

export const REPLACED_DIR = "_Replaced originals — not in LOS";

export type ManifestEntry = { file: string; bytes: number; label?: string };
export type SupersededMove = { key: string; from: string; to: string };

/**
 * Decide which mirrored files the LOS no longer holds and where each one goes.
 * Pure apart from the injected `exists`, so the guard can run it against a scratch tree.
 */
export function planSupersededMoves(args: {
  root: string;
  manifest: Record<string, ManifestEntry>;
  livePaths: Set<string>;           // storage_paths of documents the LOS holds right now
  exists: (p: string) => boolean;
}): SupersededMove[] {
  const { manifest, livePaths, exists } = args;
  const root = resolve(args.root);
  // Every file a LIVE document is mirrored to. Anything in here stays exactly where it is.
  const liveFiles = new Set<string>();
  for (const [k, v] of Object.entries(manifest)) if (livePaths.has(k) && v?.file) liveFiles.add(v.file);

  const moves: SupersededMove[] = [];
  const claimed = new Set<string>();   // destinations already chosen in this plan
  for (const [key, v] of Object.entries(manifest)) {
    if (livePaths.has(key) || !v?.file || liveFiles.has(v.file) || !exists(v.file)) continue;
    const folder = dirname(v.file);
    // Only a file sitting directly in a borrower folder — the level a picker shows and the push
    // reads. Anything deeper (already moved, or a subfolder Ramon made) is left alone.
    if (resolve(dirname(folder)) !== root) continue;
    if (moves.some((m) => m.from === v.file)) continue;   // two dead keys, one file: move it once
    const ext = extname(v.file);
    let stem = basename(v.file, ext);
    if (!/ — original( \(\d+\))?$/.test(stem)) stem = `${stem} — original`;
    stem = stem.replace(/ \(\d+\)$/, "");
    const dir = join(folder, REPLACED_DIR);
    let to = join(dir, `${stem}${ext}`);
    for (let i = 2; exists(to) || claimed.has(to); i++) to = join(dir, `${stem} (${i})${ext}`);
    claimed.add(to);
    moves.push({ key, from: v.file, to });
  }
  return moves;
}

/**
 * Carry out a plan. Every manifest entry that pointed at a moved file is repointed in the SAME
 * pass — otherwise the pull would think the file vanished and the push side, which treats any
 * unrecorded file as something Ramon dropped in, would see it as new.
 */
export function applySupersededMoves(
  moves: SupersededMove[],
  manifest: Record<string, ManifestEntry>,
  fs: { mkdir: (p: string) => void; rename: (a: string, b: string) => void },
): { moved: SupersededMove[]; failed: { move: SupersededMove; error: string }[] } {
  const moved: SupersededMove[] = [];
  const failed: { move: SupersededMove; error: string }[] = [];
  for (const m of moves) {
    try {
      fs.mkdir(dirname(m.to));
      fs.rename(m.from, m.to);
      for (const [k, v] of Object.entries(manifest)) if (v?.file === m.from) manifest[k] = { ...v, file: m.to };
      moved.push(m);
    } catch (e: any) {
      failed.push({ move: m, error: e?.message || String(e) });   // left exactly where it was
    }
  }
  return { moved, failed };
}
