// TRAINING-SET MINER — turn Ramon's accumulated judgment into fine-tuning data.
//
// Ramon, 2026-08-01: "I want you to become self learning... changing the weights."
//
// This is the honest first step of that. A model's weights cannot be changed by a chat session,
// but a model HE OWNS can be trained on HIS decisions, and the raw material already exists: two
// months of a licensed broker overriding an engine, writing to borrowers, and closing files.
// This script turns that history into JSONL pairs and — more importantly — reports the REAL
// usable count after quality filtering, so the decision to train is made on a number.
//
//   npx tsx scripts/dataset/build.ts            report only, writes nothing
//   npx tsx scripts/dataset/build.ts --write    also writes dataset/*.jsonl (gitignored)
//
// ── PRIVACY IS THE FIRST REQUIREMENT, NOT A POLISH STEP ──────────────────────────────────────
// Every row here is a real borrower's financial life. Anything that reaches a training corpus
// can be memorized and later emitted verbatim by the model, so identity is stripped BEFORE the
// pair is built, never after. Names become stable pseudonyms (BORROWER_1) so the model still
// learns co-borrower structure without learning who anyone is. SSNs, cards, account numbers,
// phones, emails, and street addresses are removed outright. A row that still looks identifying
// after redaction is DROPPED rather than shipped.
//
// The financial SHAPE is what has value — "$6,803 and $3,129 from one employer is one job" —
// and that survives redaction completely.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "dataset");
const WRITE = process.argv.includes("--write");

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    out[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  }
  return out;
}
const e = env();
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

// ── Redaction ────────────────────────────────────────────────────────────────────────────────
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const STREET = /\b\d{1,6}\s+[A-Za-z0-9.\s]{2,40}\b(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|cir|circle|hwy|pkwy)\b\.?(?:\s*(?:apt|unit|ste|#)\s*[\w-]+)?/gi;
const ACCT = /\b(?:acct|account)\s*#?\s*[\w-]{4,}/gi;

/** Names → stable pseudonyms. Order matters: longest first, so "Paul L Davis" is replaced
 *  before "Paul" leaves an orphan surname behind. */
function redact(text: string, names: string[]): string {
  let t = String(text || "");
  const ordered = [...new Set(names.filter(Boolean).map((n) => n.trim()).filter((n) => n.length > 2))]
    .sort((a, b) => b.length - a.length);
  ordered.forEach((n, i) => {
    const who = `BORROWER_${i + 1}`;
    // full name, then each name part of 3+ chars
    t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), who);
    for (const part of n.split(/\s+/)) {
      if (part.length >= 3) t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), who);
    }
  });
  return t
    .replace(SSN, "[SSN]").replace(EMAIL, "[EMAIL]").replace(STREET, "[ADDRESS]")
    .replace(ACCT, "[ACCOUNT]").replace(PHONE, "[PHONE]").replace(CARD, "[CARD]")
    .replace(/\s{2,}/g, " ").trim();
}

/** A row that still carries an obvious identifier after redaction is dropped, not shipped. */
function stillIdentifying(t: string): boolean {
  return SSN.test(t) || EMAIL.test(t) || /\b\d{9,}\b/.test(t);
}

type Pair = { messages: { role: string; content: string }[]; meta: Record<string, unknown> };
const pairs: Record<string, Pair[]> = { underwriting: [], income: [], comms: [] };
const dropped: Record<string, number> = { redaction: 0, tooShort: 0, testLead: 0, noSignal: 0 };

const isTest = (s: string) => /fetti-internal\.test|@test\.|\btest\b|dummy|qa wiring/i.test(s || "");

async function main() {
  const { data: leads } = await sb.from("leads").select("id, full_name, email, raw");
  const nameOf = new Map<string, string>();
  const testLeads = new Set<string>();
  for (const l of (leads || []) as any[]) {
    nameOf.set(l.id, l.full_name || "");
    if (isTest(`${l.full_name} ${l.email}`)) testLeads.add(l.id);
  }
  const { data: files } = await sb.from("loan_files").select("id, lead_id, borrower_name, product");
  const fileInfo = new Map((files || []).map((f: any) => [f.id, f]));

  // ── 1. THE GOLD: Ramon overruled the engine ────────────────────────────────────────────────
  // Each row is literally "the machine said X, the licensed broker said no". There is no richer
  // supervision signal in the business than a professional's correction of an automated answer.
  const { data: omits } = await sb.from("activity_log")
    .select("created_at, detail, loan_file_id, lead_id").eq("action", "income.flag_omitted");
  for (const r of (omits || []) as any[]) {
    if (r.lead_id && testLeads.has(r.lead_id)) { dropped.testLead++; continue; }
    const f: any = fileInfo.get(r.loan_file_id);
    const names = [f?.borrower_name, nameOf.get(r.lead_id || "")].filter(Boolean) as string[];
    const flag = redact(String(r.detail?.flag || ""), names);
    const reason = redact(String(r.detail?.reason || ""), names);
    if (flag.length < 40) { dropped.tooShort++; continue; }
    if (stillIdentifying(flag + reason)) { dropped.redaction++; continue; }
    pairs.underwriting.push({
      messages: [
        { role: "system", content: "You are a senior U.S. mortgage underwriter reviewing an automated income worksheet. Decide whether a flag raised by the engine should stand, or whether the income it is holding back should be COUNTED." },
        { role: "user", content: `Program: ${f?.product || "unknown"}\nEngine flag: ${flag}` },
        { role: "assistant", content: `Decision: COUNT the income — override this flag.${reason ? `\nReason: ${reason}` : ""}` },
      ],
      meta: { source: "income.flag_omitted", at: r.created_at, product: f?.product || null },
    });
  }

  // ── 2. Settled worksheets: documents in, qualifying income out ─────────────────────────────
  const { data: verified } = await sb.from("activity_log")
    .select("created_at, detail, loan_file_id, lead_id").eq("action", "income.verified");
  for (const r of (verified || []) as any[]) {
    if (r.lead_id && testLeads.has(r.lead_id)) { dropped.testLead++; continue; }
    const d = r.detail || {};
    const monthly = Number(d.monthlyIncome);
    if (!Number.isFinite(monthly) || monthly <= 0) { dropped.noSignal++; continue; }
    const f: any = fileInfo.get(r.loan_file_id);
    pairs.income.push({
      messages: [
        { role: "system", content: "Given a loan file's income documents, state the qualifying monthly income and your confidence." },
        { role: "user", content: `Program: ${f?.product || "unknown"}\nDocuments read: ${d.docsRead ?? "?"}\nUnreadable: ${d.unreadable ?? 0}` },
        { role: "assistant", content: `Qualifying monthly income: $${Math.round(monthly).toLocaleString()}\nConfidence: ${d.confidence || "medium"}\nOpen flags: ${d.flags ?? 0}` },
      ],
      meta: { source: "income.verified", at: r.created_at, product: f?.product || null, monthly },
    });
  }

  // ── 3. Comms, LABELLED BY WHETHER A HUMAN ANSWERED ─────────────────────────────────────────
  // An outbound message on its own teaches nothing. An outbound message followed by a real
  // inbound reply is a positive example; 96% of them were never answered, and that ratio is the
  // most honest thing in this dataset.
  const { data: msgs } = await sb.from("activity_log")
    .select("created_at, detail, lead_id").eq("action", "comms.message").order("created_at");
  const byLead = new Map<string, any[]>();
  for (const m of (msgs || []) as any[]) {
    if (!m.lead_id || testLeads.has(m.lead_id)) continue;
    const arr = byLead.get(m.lead_id) || []; arr.push(m); byLead.set(m.lead_id, arr);
  }
  let answered = 0, unanswered = 0;
  for (const [leadId, thread] of byLead) {
    const names = [nameOf.get(leadId) || ""];
    for (let i = 0; i < thread.length; i++) {
      const cur = thread[i];
      if (cur.detail?.direction !== "outbound") continue;
      const body = redact(String(cur.detail?.body || ""), names);
      if (body.length < 30) { dropped.tooShort++; continue; }
      if (stillIdentifying(body)) { dropped.redaction++; continue; }
      // Did a human answer within 72h?
      const t0 = new Date(cur.created_at).getTime();
      const reply = thread.slice(i + 1).find((n: any) =>
        n.detail?.direction === "inbound" && new Date(n.created_at).getTime() - t0 < 72 * 3600_000);
      reply ? answered++ : unanswered++;
      pairs.comms.push({
        messages: [
          { role: "system", content: "You write borrower messages for a mortgage broker. Judge whether this outreach earns a human reply." },
          { role: "user", content: body.slice(0, 1200) },
          { role: "assistant", content: reply ? "EARNED A REPLY" : "NO REPLY" },
        ],
        meta: { source: "comms.message", at: cur.created_at, answered: !!reply },
      });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────────────────────
  const total = Object.values(pairs).reduce((s, a) => s + a.length, 0);
  console.log("TRAINING SET — mined from Ramon's own decisions\n");
  console.log(`  ${String(pairs.underwriting.length).padStart(5)}  underwriting overrides   ← the gold: a licensed broker overruling the engine`);
  console.log(`  ${String(pairs.income.length).padStart(5)}  settled worksheets       ← documents in -> qualifying income out`);
  console.log(`  ${String(pairs.comms.length).padStart(5)}  outbound messages        ← ${answered} earned a reply / ${unanswered} did not`);
  console.log(`  ${String(total).padStart(5)}  TOTAL usable pairs`);
  console.log(`\n  dropped: ${dropped.testLead} test leads, ${dropped.tooShort} too short, ${dropped.redaction} still identifying after redaction, ${dropped.noSignal} no signal`);

  const replyRate = answered + unanswered ? (answered / (answered + unanswered)) * 100 : 0;
  console.log(`\n  reply rate across all outbound: ${replyRate.toFixed(1)}%`);
  console.log(`  -> a classifier trained on this learns what Ramon's borrowers actually answer.`);

  console.log(`\n  VERDICT: ${total >= 1000 ? "ENOUGH to train a LoRA today (1k-10k is the useful band)."
    : total >= 300 ? "Enough to prove the pipeline; keep accumulating before trusting the output."
    : "Not yet enough — build the flywheel, revisit in a few weeks."}`);

  if (!WRITE) { console.log(`\n  (report only — re-run with --write to emit dataset/*.jsonl)`); return; }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  for (const [name, rows] of Object.entries(pairs)) {
    if (!rows.length) continue;
    // Hold out 15% for evaluation, deterministically (every 7th row) so "better" is measurable
    // rather than asserted — the whole point of doing this at all.
    const train = rows.filter((_, i) => i % 7 !== 0);
    const evalSet = rows.filter((_, i) => i % 7 === 0);
    writeFileSync(path.join(OUT, `${name}.train.jsonl`), train.map((p) => JSON.stringify(p)).join("\n") + "\n");
    writeFileSync(path.join(OUT, `${name}.eval.jsonl`), evalSet.map((p) => JSON.stringify(p)).join("\n") + "\n");
    console.log(`  wrote dataset/${name}.train.jsonl (${train.length}) + ${name}.eval.jsonl (${evalSet.length})`);
  }
  console.log(`\n  dataset/ is gitignored — it holds redacted borrower data and must never be committed.`);
}

main().catch((err) => { console.error("dataset build failed:", err.message); process.exit(1); });
