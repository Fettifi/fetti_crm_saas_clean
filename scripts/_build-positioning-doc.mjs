// One-shot: turn the 20-agent positioning run into a readable deliverable.
// Kept out of the hook suite (leading underscore); it reads a workflow journal and writes a doc.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const D = process.argv[2];
const OUT = process.argv[3];
const rows = fs.readFileSync(path.join(D, "journal.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const val = (r) => { const v = r.result; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

const ap = [], sc = [], au = [];
for (const r of rows) {
  if (r.type !== "result") continue;
  const v = val(r);
  if (!v || typeof v !== "object") continue;
  if (v.taglines) ap.push(v); else if (v.total !== undefined) sc.push(v); else if (v.audience) au.push(v);
}
sc.sort((a, b) => b.total - a.total);
const L = [];
const P = (...x) => L.push(...x);

P("# fettifi.com — positioning and all-audience copy", "");
P("Produced 2026-10-17 by a 20-agent panel: five independent positioning approaches, each scored");
P("adversarially by a separate agent, then one agent per audience Fetti actually serves.");
P("**Nothing here is live.** It is a recommendation to accept, amend or reject.", "");
P("## The brief", "");
P('Ramon, 2026-10-17: *"Treat this as if I paid $150,000 to have this website made... make it an');
P('all-inclusive for the entire world."* He also put the current hero line in question.', "");
P('**The current line — "Built for how you actually earn" — is strong and narrow.** It names the');
P("self-employed and commissioned borrower exactly, and says nothing to a salaried first-time buyer,");
P("a veteran, a retiree on assets, or a business owner. All four are real Fetti customers. That gap");
P("is what the panel was asked to close.", "");

P("## Scores — nothing here is ready to ship unedited", "");
P("| total | incl | dist | conv | comp | voice | approach |", "|---|---|---|---|---|---|---|");
for (const s of sc) P(`| ${s.total} | ${s.inclusion} | ${s.distinctiveness} | ${s.conversion} | ${s.compliance} | ${s.voice} | ${String(s.approach).slice(0, 70)} |`);
P("");
P("**Read the compliance column.** Every approach scored 4–6 of 10. The judges were told to be");
P("adversarial and they were: each found sentences that blur jurisdictions, overclaim, or assert");
P("things the live system contradicts. This is a synthesis exercise, not an adoption one.", "");

P("## Tagline shortlist", "");
for (const s of sc) P(`- **"${s.bestTagline}"** — from ${String(s.approach).slice(0, 52)}`);
P("");
P("### Recommendation", "");
P(`**"Everyone's income is unusual up close."**`, "");
P("It is the only line that does what was asked. It keeps the whole point of the current hero — that");
P("Fetti is built for income that does not fit a template — and inverts it so it INCLUDES rather than");
P("selects. The W-2 nurse with overtime, the veteran with BAH, the retiree drawing down assets and the");
P("investor with four doors are all unusual up close, and each reads it as being about them. It also");
P("sets up the page beneath it: a register of income shapes rather than a menu of products.", "");
P(`Runner-up: **"One rulebook can only ever say no."** — sharper and more competitive; it sells the`);
P("broker model itself, and is colder.", "");

P("## Every approach in full", "");
for (const a of ap) {
  P(`### ${String(a.approach).slice(0, 90)}`, "");
  P(`**Big idea.** ${a.bigIdea}`, "");
  P("Taglines:");
  for (const t of a.taglines || []) {
    P(`- "${t.line}" — ${t.why}`);
    P(`  - leaves out: ${t.whoItLeavesOut}`);
  }
  P("");
  P(`**Hero subhead.** ${a.heroSubhead}`, "");
  P(`**CTAs.** ${a.ctaPrimary} / ${a.ctaSecondary || ""}`);
  P(`**Trust line.** ${a.trustLine || ""}`, "");
  P("**Page architecture.**");
  for (const s of a.sectionArchitecture || []) {
    P(`- **${s.heading}** — ${s.job}`);
    if (s.copy) P(`  > ${String(s.copy).slice(0, 700).replace(/\n/g, " ")}`);
  }
  P("");
  P(`**Audiences named.** ${(a.audiencesNamed || []).join(", ")}`, "");
  P(`**Compliance self-check.** ${String(a.complianceSelfCheck || "").slice(0, 1000)}`, "");
}

P("## The audience sections", "");
P("One per audience, written to be dropped onto the page. Each states its own jurisdiction, because");
P("owner-occupied is CA/FL/MI, investment and business-purpose is all 50, and the two must never blur.", "");
for (const s of au) {
  P(`### ${s.audience}`);
  P(`- **They fear:** ${s.theyFear}`);
  P(`- **Headline:** ${s.headline}`);
  P(`- **Body:** ${s.body}`);
  P(`- **Proof:** ${s.proofPoint}`);
  P(`- **Jurisdiction:** ${s.jurisdictionNote}`);
  P(`- **CTA:** ${s.cta}`, "");
}

P("## The judges' fatal flaws, verbatim — read before using any of this", "");
P("Several of these are findings about the LIVE SYSTEM rather than about the copy, which is why this");
P("document matters beyond taglines. Verify each before acting; a subagent finding is a hypothesis.", "");
for (const s of sc) {
  P(`**${String(s.approach).slice(0, 70)}**`);
  for (const f of (s.fatalFlaws || []).slice(0, 7)) P(`- ${String(f).slice(0, 900)}`);
  P("");
  if ((s.stealThis || []).length) {
    P("_Worth grafting into the winner:_");
    for (const t of s.stealThis.slice(0, 5)) P(`- ${String(t).slice(0, 500)}`);
    P("");
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log(OUT, fs.statSync(OUT).size, "bytes ·", ap.length, "approaches,", sc.length, "scores,", au.length, "audiences");
