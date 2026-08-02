// PATTERN DETECTOR — every lesson that can be checked mechanically, checked on every commit.
//
// Ramon, 2026-08-01: "I want you to become self learning, autonomous, a constant growth engine."
//
// This is the part of that which is real. A lesson written as prose is static — it tells you
// about one incident. A DETECTOR is generative: it goes looking for instances nobody has hit
// yet. Each shape below was learned from an expensive failure, and now hunts the whole repo for
// its siblings, free, forever.
//
// ADDING A SHAPE IS THE GROWTH. When a new failure is understood, ask "what is the mechanical
// signature?" and add a check here. The detector set only ever grows, and it runs whether or not
// anyone remembers the incident that created it.
//
// Deliberately LOW false-positive. A noisy detector gets disabled, and a disabled detector is
// worth nothing. Every rule here must be defensible on its own.
import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const ROOT = process.cwd();
const sh = (cmd: string) => { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8" }); } catch { return ""; } };
const files = sh(`grep -rl "" --include=*.ts --include=*.tsx lib app 2>/dev/null`).split("\n").filter(Boolean);

type Hit = { file: string; line: number; why: string };
// A comment DESCRIBING a bug is not the bug. v1 flagged lib/nurture.ts and lib/automationGate.ts
// for the comments that document the 2026-07-26 incident — the detector reading prose as code.
const isComment = (ln: string) => /^\s*(\/\/|\*|\/\*)/.test(ln);
const problems: Hit[] = [];
const notes: string[] = [];

// ── SHAPE 1 — a cap that silently discards data ──────────────────────────────────────────────
// MAX_DOCS = 4 in credit-liabilities silently deleted a borrower's 5th credit document via a
// bare .slice(). A guard MAY trim; it must never trim in silence.
for (const f of files) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((ln, i) => {
    if (isComment(ln)) return;
    const m = ln.match(/\.slice\(\s*0\s*,\s*([A-Z][A-Z0-9_]{2,})\s*\)/);
    if (!m) return;
    // Fine when the same file also captures what was dropped.
    const flagged = /overflow|dropped|truncated|omitted|excess|remaining|\bheld\b|notCounted/i.test(src);
    if (!flagged) {
      problems.push({ file: f, line: i + 1, why: `.slice(0, ${m[1]}) truncates with no overflow/dropped variable anywhere in the file — anything past the cap vanishes silently. A guard may TRIM but must FLAG what it trimmed.` });
    }
  });
}

// ── SHAPE 2 — an authoritative-looking export with ZERO importers ────────────────────────────
// EXTRACT_SYSTEM looked like the live AI prompt. It had no importers; a fix written there
// shipped and changed nothing, costing a full cycle.
const DECOY = /export const ([A-Z][A-Z0-9_]*(?:_SYSTEM|_PROMPT|_TEMPLATE|_RULES|_DOCTRINE))\b/;
for (const f of files) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  src.split("\n").forEach((ln, i) => {
    const m = ln.match(DECOY);
    if (!m) return;
    const sym = m[1];
    // Only an IMPORT counts. A symbol referenced elsewhere in its own file is used, and one
    // imported anywhere is live. v1 grepped for the bare name and mis-declared four live AI
    // prompts as dead, which is how a detector loses the right to be believed.
    const importers = sh(`grep -rlE "import[^;]*\\b${sym}\\b" --include=*.ts --include=*.tsx lib app scripts 2>/dev/null`)
      .split("\n").filter(Boolean).filter((x) => x !== f);
    const usedInOwnFile = (src.match(new RegExp(`\\b${sym}\\b`, "g")) || []).length > 1;
    if (importers.length === 0 && !usedInOwnFile) {
      problems.push({ file: f, line: i + 1, why: `${sym} is exported and looks like live behaviour, but NOTHING imports it. Editing it changes nothing — the exact trap that made a YTD fix a no-op. Delete it or leave a pointer to what actually runs.` });
    }
  });
}

// ── SHAPE 3 — null coerced to 0, disabling a safeguard ───────────────────────────────────────
// Number(cfg("NURTURE_FIRST_TOUCH_CAP")) → cfg() returns null when unset → Number(null) === 0 →
// the "default 8" branch never ran and 159 texts went out at once.
for (const f of files) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  src.split("\n").forEach((ln, i) => {
    if (isComment(ln)) return;
    if (!/Number\(\s*(await\s+)?(cfg|getSetting)\s*\(/.test(ln)) return;
    // TWO legitimate guards, and missing either of them made this detector cry wolf on its
    // first run — flagging three call sites that were already correct, including one whose
    // comment cites the very incident this rule encodes. A detector that reports problems that
    // are not there gets switched off, and then it protects nothing. Same failure shape it hunts.
    //
    //   (a) an explicit isFinite / isNaN test within a few lines, or
    //   (b) a NON-ZERO `|| default` / `?? default` on the same line — which catches the 0 that
    //       Number(null) produces and substitutes something safe.
    const fallback = /(\|\||\?\?)\s*[1-9][0-9._]*/.test(ln);
    const window = src.split("\n").slice(i, i + 6).join(" ");
    const explicit = /isFinite|isNaN|Number\.isInteger/.test(window);
    if (!fallback && !explicit) {
      problems.push({ file: f, line: i + 1, why: `Number(cfg(...)) with no isFinite/isNaN guard within 3 lines. cfg() returns NULL when unset and Number(null) === 0 — an unset setting silently becomes a limit of ZERO, which usually means "off" or "no cap".` });
    }
  });
}

// ── SHAPE 4 — a settings key written with one string and read with another ───────────────────
// Silent drift: the write lands, the read never sees it, and nothing errors.
const keyRe = /(?:cfg|getSetting|setSetting)\(\s*["'`]([A-Z][A-Z0-9_]{3,})["'`]/g;
const keyUses = new Map<string, { reads: number; writes: number; where: string }>();
for (const f of files) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(keyRe)) {
    const isWrite = src.slice(Math.max(0, m.index! - 12), m.index! + 10).includes("setSetting");
    const cur = keyUses.get(m[1]) || { reads: 0, writes: 0, where: f };
    isWrite ? cur.writes++ : cur.reads++;
    keyUses.set(m[1], cur);
  }
}
for (const [k, v] of keyUses) {
  if (v.writes > 0 && v.reads === 0) {
    notes.push(`settings key "${k}" is WRITTEN but never read (${v.where}) — either dead, or the reader spells it differently.`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`note: ${n}`);
if (!problems.length) {
  console.log(`PASS — ${files.length} files scanned, no known failure shape found.`);
  process.exit(0);
}
console.error(`\nFAIL — ${problems.length} instance(s) of a known failure shape:\n`);
for (const p of problems) console.error(`  ${p.file}:${p.line}\n     ${p.why}\n`);
console.error("Each of these is a shape that already cost real money once. Fix, or if genuinely");
console.error("intentional, make the intent explicit in code (flag the overflow, guard the NaN,");
console.error("delete the decoy) so the detector stops seeing it.");
process.exit(1);
