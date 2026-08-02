// EVAL HARNESS — the number that makes "it got better" checkable.
//
// Ramon, 2026-08-01: "build the training loop."
//
// This comes FIRST, before any training, for one reason: a fine-tune without a held-out
// baseline is unfalsifiable. You can always feel like the model improved. The only honest
// version of "self-improving" is a number that moves on data the model never saw.
//
//   npx tsx scripts/dataset/evaluate.ts                 baselines only (no model, no installs)
//   npx tsx scripts/dataset/evaluate.ts --model <path>  score an MLX checkpoint against them
//
// THE TASK WE CAN ACTUALLY WIN. Of the three mined sets, only comms has the volume for a small
// model: 760 examples of "did this outreach earn a human reply?". Underwriting has 25 — that is
// a handful of demonstrations, not a training set, and claiming otherwise would be the same
// dishonesty as a green dashboard over a dead cron.
//
// THE BASELINE THAT MATTERS is not 50%. It is ALWAYS-SAY-NO: 93.6% of outreach got no reply, so
// a model that answers "NO REPLY" every single time scores 93.6% and is completely useless. Any
// honest report has to beat that, and has to be judged on the MINORITY class — recall on the
// messages that actually earned a reply. That is the only prediction with business value.
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const DS = path.join(ROOT, "dataset");

type Row = { messages: { role: string; content: string }[]; meta: any };
function load(name: string): Row[] {
  const p = path.join(DS, name);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const evalRows = load("comms.eval.jsonl");
const trainRows = load("comms.train.jsonl");
if (!evalRows.length) {
  console.error("No dataset/comms.eval.jsonl — run: npm run dataset -- --write");
  process.exit(1);
}

const label = (r: Row) => (r.messages.find((m) => m.role === "assistant")?.content || "").includes("EARNED") ? 1 : 0;
const text = (r: Row) => r.messages.find((m) => m.role === "user")?.content || "";

const y = evalRows.map(label);
const positives = y.filter((v) => v === 1).length;

/** Precision/recall/F1 on the MINORITY class — accuracy alone is a lie on 6% base rate. */
function score(name: string, pred: number[]) {
  let tp = 0, fp = 0, fn = 0, correct = 0;
  for (let i = 0; i < y.length; i++) {
    if (pred[i] === y[i]) correct++;
    if (pred[i] === 1 && y[i] === 1) tp++;
    if (pred[i] === 1 && y[i] === 0) fp++;
    if (pred[i] === 0 && y[i] === 1) fn++;
  }
  const prec = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  console.log(
    `  ${name.padEnd(34)} acc ${((correct / y.length) * 100).toFixed(1).padStart(5)}%   ` +
    `replies caught ${tp}/${positives}   precision ${(prec * 100).toFixed(0).padStart(3)}%   F1 ${(f1 * 100).toFixed(1).padStart(5)}`,
  );
  return f1;
}

console.log(`EVAL — "will this outreach earn a human reply?"\n`);
console.log(`  train ${trainRows.length} / held-out ${evalRows.length}   (${positives} of ${evalRows.length} earned a reply = ${((positives / evalRows.length) * 100).toFixed(1)}% base rate)\n`);

// ── Baseline 1: the trap. Always predict the majority class.
const alwaysNo = score("always say NO REPLY (the trap)", y.map(() => 0));

// ── Baseline 2: a keyword heuristic, so we know whether a model is beating anything real.
//    Built from what actually earns replies in a lending conversation: a question, a person's
//    own words, no link-dump. Deliberately simple — if a fine-tune cannot beat THIS, it is not
//    earning its cost.
const heuristic = evalRows.map((r) => {
  const t = text(r);
  const asksQuestion = /\?/.test(t);
  const isShort = t.length < 220;
  const linkDump = (t.match(/https?:\/\//g) || []).length > 0;
  const nag = /finish your application|complete your application|3 min|two minutes/i.test(t);
  return asksQuestion && isShort && !linkDump && !nag ? 1 : 0;
});
const heur = score("question + short + no link/nag", heuristic);

console.log(`\n  THE BAR: accuracy is a trap here. "Always NO" scores ${((y.filter(v=>v===0).length / y.length) * 100).toFixed(1)}% and is worthless.`);
console.log(`  A fine-tune has to beat F1 ${(Math.max(alwaysNo, heur) * 100).toFixed(1)} — i.e. actually FIND the replies.`);

const modelIdx = process.argv.indexOf("--model");
if (modelIdx === -1) {
  console.log(`\n  (baselines only — pass --model <adapter-path> to score a trained checkpoint)`);
} else {
  console.log(`\n  Model scoring runs through scripts/dataset/train.sh, which shells to mlx_lm.`);
  console.log(`  Not implemented inline: it must load the SAME checkpoint the trainer wrote, and`);
  console.log(`  a second loader here would be a second source of truth about what "the model" is.`);
}
