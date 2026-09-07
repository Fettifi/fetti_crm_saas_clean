// "OMIT" MUST NOT LOOK LIKE IT COUNTS MONEY WHEN IT COUNTS NOTHING.
//
// Ricardo Barron (FF-202608-5944), 2026-08-29: the QC finding "Documented, countable retirement
// income omitted — worksheet counted none" was Omitted three times, 20:39:26 / :37 / :42, and
// added $0 each time. It carries no `addBackMonthly`, so the only button on it did nothing but
// grey out the sentence. Five live flags go further and end with the words "Omit to count it now"
// while carrying an add-back of $0 — the text promises money the click cannot deliver.
//
// This checks the classifier against EVERY flag in the live corpus, not invented examples, and
// checks the screen actually says what the click does.
//
//   npm run verify:flag-action
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { readFileSync } from "fs";
import { flagAction, omitConsequence, offersAddIncome, labelFromFlag, type FlagAction } from "../lib/incomeFlagAction";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

// Strip comments before grepping source: a guard in this repo once passed with the code DELETED
// because it matched the comment explaining the code, and the file below is heavily commented.
const code = (f: string) => readFileSync(f, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((ln) => {
    let out = "", q: string | null = null;
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i], n = ln[i + 1];
      if (q) { out += c; if (c === q && ln[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
      if (c === "/" && n === "/") break;
      out += c;
    }
    return out;
  }).join("\n");

(async () => {
  console.log("\nWHAT DOES OMIT DO? — classified against the live flag corpus\n");
  await requireLiveDb("verify:flag-action");

  const verifies = await rows<any>("verify:flag-action",
    supabaseAdmin.from("app_settings").select("key, value").like("key", "los_income_verify:%"), { minRows: 1 });

  type F = { text: string; add: number; action: FlagAction };
  const all: F[] = [];
  for (const r of verifies) {
    let p: any = null; try { p = JSON.parse(r.value)?.payload; } catch { continue; }
    for (const f of (p?.report?.flags || p?.flags || [])) {
      const text = String(f?.text || ""), add = Number(f?.addBackMonthly) || 0;
      if (!text) continue;
      all.push({ text, add, action: flagAction(text, add) });
    }
  }
  const by = (a: FlagAction) => all.filter((f) => f.action === a);
  console.log(`  corpus: ${all.length} live flags — ` +
    (["omit-counts", "omit-counts-zero", "add-manually", "re-request-doc", "dismiss"] as FlagAction[])
      .map((a) => `${a}:${by(a).length}`).join("  ") + "\n");

  // A classifier proven only against categories that do not occur proves nothing.
  ck("the corpus contains flags that DO carry money", by("omit-counts").length > 0);
  ck("…and flags whose Omit counts NOTHING despite saying otherwise", by("omit-counts-zero").length > 0);
  ck("…and QC findings that say income was MISSED", by("add-manually").length > 0);
  ck("…and documents that could not be read", by("re-request-doc").length > 0);

  console.log("\n── money always wins over wording ──");
  ck("every flag with an add-back is 'omit-counts'",
     all.every((f) => f.add <= 0 || f.action === "omit-counts"),
     all.filter((f) => f.add > 0 && f.action !== "omit-counts").map((f) => f.action).join(", "));
  ck("nothing WITHOUT an add-back is ever called 'omit-counts'",
     all.every((f) => f.action !== "omit-counts" || f.add > 0));

  console.log("\n── the dangerous confusion: an OVER-count is not a MISSED income ──");
  const overCount = all.filter((f) => /over-?count|double-?count|reasonableness|does not reconcile|exceeds/i.test(f.text));
  ck("there are over-count / reconciliation findings in the corpus", overCount.length > 0, `${overCount.length} found`);
  ck("NONE of them is classified 'add-manually'",
     overCount.every((f) => f.action !== "add-manually"),
     overCount.filter((f) => f.action === "add-manually").map((f) => f.text.slice(0, 60)).join(" | "));

  console.log("\n── an OBLIGATION is never income, and a ROLLOVER is never income ──");
  // Both regressions this guard exists for came off ONE 1040. Exemplars, not live corpus:
  // the engine only started capturing these on 2026-09-06, so no stored read has them yet.
  const ALIMONY = "Alimony PAID $18,000/yr ($1,500/mo) on the 2024 and 2025 return, Schedule 1 line 19a — a recurring OBLIGATION, not income. It is not in this worksheet because it is a DEBT: enter it in the liabilities below so it reaches DTI.";
  const ROLL = "1040 ROLLOVER box is ticked on the retirement lines (2025). Line 5a gross $109,320 against $7,686 taxable — about $101,634 of it moved between accounts. A rollover is a transfer between retirement accounts, NOT income.";
  ck("alimony PAID routes to the DEBTS box, not the income worksheet", flagAction(ALIMONY, 0) === "add-to-debts", flagAction(ALIMONY, 0));
  ck("…and is NOT offered an “+ Add income” shortcut", !offersAddIncome(flagAction(ALIMONY, 0)));
  ck("…and its advice names the liabilities", /liabilit|DTI|debt/i.test(String(omitConsequence("add-to-debts"))));
  ck("a ticked rollover box is called out as NOT income", flagAction(ROLL, 0) === "not-income", flagAction(ROLL, 0));
  ck("…and is NOT offered an “+ Add income” shortcut", !offersAddIncome(flagAction(ROLL, 0)));
  ck("…and its advice says it must not be counted", /not be counted|not income/i.test(String(omitConsequence("not-income"))));
  // The dangerous inverse: alimony RECEIVED is income and must NOT be pushed into the debts box.
  ck("alimony RECEIVED is not mistaken for an obligation",
     flagAction("Alimony received $1,200/mo documented — needs 6-month receipt history. Omit to count it.", 1200) === "omit-counts");

  console.log("\n── every flag whose Omit counts $0 explains itself ──");
  for (const a of ["omit-counts-zero", "add-manually", "re-request-doc"] as FlagAction[]) {
    const msg = omitConsequence(a);
    ck(`${a} produces an explanation`, !!msg && msg.length > 30);
    if (a !== "re-request-doc") ck(`  …and points at "+ Add income"`, !!msg && /\+ Add income/i.test(msg));
    ck(`  …and says it counts nothing`, !!msg && /\$0|nothing|only marks/i.test(msg));
  }
  ck("a flag that really does add money gets NO warning", omitConsequence("omit-counts") === null);
  ck("a plain observation gets NO warning", omitConsequence("dismiss") === null);
  ck("add-to-debts and not-income both explain themselves",
     !!omitConsequence("add-to-debts") && !!omitConsequence("not-income"));
  ck("the shortcut is offered exactly where money must be typed in by hand",
     offersAddIncome("add-manually") && offersAddIncome("omit-counts-zero") &&
     !offersAddIncome("omit-counts") && !offersAddIncome("dismiss") && !offersAddIncome("re-request-doc"));

  console.log("\n── a label is never a number ──");
  const bad = all.filter((f) => { const l = labelFromFlag(f.text); return !l || /\$\s?[\d,]/.test(l); });
  ck("no flag yields an empty label or a label carrying a dollar figure", bad.length === 0,
     bad.slice(0, 2).map((f) => labelFromFlag(f.text)).join(" | "));
  ck("a real employer flag labels the EMPLOYER",
     labelFromFlag("MARITECH EQUIPMENT PARTS & SERVICES INC: no current pay stub on file") === "MARITECH EQUIPMENT PARTS & SERVICES INC",
     labelFromFlag("MARITECH EQUIPMENT PARTS & SERVICES INC: no current pay stub on file"));

  console.log("\n── the ENGINE captures what the 1040 discloses ──");
  const rd = code("lib/income/readDocument.ts"), df = code("lib/income/docFacts.ts");
  for (const f of ["alimonyPaidAnnual", "retirementRolloverChecked", "pensionGrossAnnual"]) {
    ck(`readDocument captures ${f}`, new RegExp(`\\b${f}\\b`).test(rd));
    ck(`  …and DocFact carries it through`, new RegExp(`\\b${f}\\b`).test(df));
  }
  ck("the reader is TOLD to look for Schedule 1 line 19a", /19a/.test(rd));
  ck("…and told a ticked rollover box means it is not income", /Rollover/i.test(rd) && /not income/i.test(rd));
  ck("docFacts raises a flag for alimony paid", /Alimony PAID/.test(df));
  ck("…and for a ticked rollover box", /ROLLOVER box is ticked/.test(df));
  ck("neither flag adds income back — an obligation is not income",
     !/Alimony PAID[\s\S]{0,900}?addBackMonthly: (?!0)/.test(df) && !/ROLLOVER box[\s\S]{0,600}?addBackMonthly: (?!0)/.test(df));

  console.log("\n── the screen actually uses it, and never invents an amount ──");
  const iq = code("components/los/IncomeQualifier.tsx");
  ck("the flag row classifies the flag", /flagAction\(/.test(iq));
  ck("…and renders the consequence", /omitConsequence\(/.test(iq) && /\{consequence\}/.test(iq));
  ck("…and offers the shortcut where it applies", /offersAddIncome\(/.test(iq) && /addIncomeFromFlag\(/.test(iq));
  // THE ONE THAT MATTERS. A seeded line must arrive BLANK: these flags quote figures, and lifting
  // one into qualifying income is the screen inventing a number out of a sentence.
  const seeded = (iq.match(/function addIncomeFromFlag[\s\S]{0,600}?\n  \}/) || [""])[0];
  ck("the seeded line exists", seeded.length > 0);
  ck("…and its amount is HARD-CODED to 0 — never parsed from the flag text",
     /monthly:\s*0\s*,/.test(seeded), seeded.match(/monthly:[^,]*/)?.[0] || "(not found)");
  ck("…and nothing in it scrapes a dollar figure out of the prose",
     !/\$|parseFloat|Number\(\s*(m|match)/.test(seeded.replace(/labelFromFlag\([^)]*\)/g, "")));

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : `\n✅ ALL PASS — Omit says what it does, and a missed income has a way to be counted\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
