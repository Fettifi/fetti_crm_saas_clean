// ONE NAME ON THE EMAIL, AND NEVER A BROKEN MERGE.
//
// Ramon, 2026-08-02. 448 of 576 outbound emails were signed "— Mark" in the body while the
// signature block said Frank and the From header said "Fetti Financial Services" — three
// different people on one message. Two borrowers wrote back to ask who they were talking to.
// COMMS_PERSONA had been wired into SMS, doc requests, connect offers and the email FOOTER,
// and into no email BODY at all. The drift has now happened twice, so it is a guard.
//
// The proximate cause of the worst symptom was smaller and nastier: lib/markConcierge.ts
// nested a double-quoted string inside a template-literal ternary, so the literal characters
// ${COMMS_PERSONA} were sent to the model — and lib/inbound/ingestEmail.ts passed
// firstAiReply: true HARDCODED, so every borrower email reply hit that branch forever.
//
//   npx tsx scripts/verify-persona.ts
import { renderTouch, renderFirstTouch, safeFirstName, EMAIL_TOUCHES } from "../lib/notify/emailCopy";
import { COMMS_PERSONA } from "../lib/markPersona";
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nPERSONA — one name, and no broken merges (persona = ${COMMS_PERSONA})\n`);

// ── 1. NO HARDCODED SIGN-OFF anywhere a borrower-facing body is built.
for (const f of ["lib/notify/emailCopy.ts", "app/api/apply/route.ts", "lib/nurture.ts", "lib/markConcierge.ts"]) {
  const src = code(f);
  const hits = (src.match(/—\s*(Mark|Frank|Ramon)\b/g) || []).filter((h) => !h.includes(COMMS_PERSONA));
  chk(hits.length === 0, `${f} signs with COMMS_PERSONA, not a hardcoded name${hits.length ? ` (found ${hits.join(", ")})` : ""}`);
}

// ── 2. EVERY RENDERED BODY carries the persona and no other name.
const lead: any = { first_name: "Dawn", full_name: "Dawn Engler", loan_purpose: "purchase", state: "FL", property_value: 168000 };
for (const [key, t] of Object.entries(EMAIL_TOUCHES)) {
  const r = renderTouch(t, lead);
  chk(r.body.includes(COMMS_PERSONA), `touch "${key}" signs as ${COMMS_PERSONA}`);
  chk(!/\b(Mark|Ramon)\b/.test(r.body), `touch "${key}" names nobody else`);
}
{
  const ft = renderFirstTouch(lead, {});
  chk(ft.body.includes(COMMS_PERSONA), "the first-touch email signs as the persona too");
}

// ── 3. THE MODEL MUST NOT BE SHIPPED A RAW TOKEN. A double-quoted string inside a
//      template-literal ternary sends the characters, not the value.
{
  const src = readFileSync("lib/markConcierge.ts", "utf8");
  const escaped = /\\"It's \$\{COMMS_PERSONA\}/.test(src);
  chk(!escaped, "the concierge disclosure INTERPOLATES the persona rather than sending the literal ${COMMS_PERSONA}");
  chk(!/firstAiReply:\s*true\b/.test(code("lib/inbound/ingestEmail.ts")),
    "and firstAiReply is derived from prior ai_reply rows, not hardcoded true on every reply");
}

// ── 4. A JUNK NAME DROPS THE GREETING. Eight real sends opened "Hey there —", "Test —",
//      "Shield —", "Wtwo —". Substituting "there" is not a fallback, it is a broken merge.
for (const junk of ["there", "Test", "Shield", "WTWO", "N/A", "unknown", "admin", ""]) {
  chk(safeFirstName({ first_name: junk, full_name: junk } as any) === "", `"${junk}" yields no greeting`);
}
chk(safeFirstName({ first_name: "Dawn", full_name: "Dawn Engler" } as any) === "Dawn", "a real name is used");
chk(safeFirstName({ first_name: "MARIA", full_name: "MARIA LOPEZ" } as any) === "Maria", "an ALL-CAPS name is normalised, not shouted back");
chk(safeFirstName({ first_name: "Zzz", full_name: "Dawn Engler" } as any) === "",
  "a first name absent from the stored full name is a parsing artifact, not a name");

// ── 5. AND THE RENDER MUST NOT LEAVE THE ARTIFACT BEHIND. Dropping the token is only half
//      the job — "Hey  — saw your inquiry" is worse than no greeting.
for (const junk of ["there", "Test", null]) {
  const r = renderTouch(Object.values(EMAIL_TOUCHES)[0], { first_name: junk, full_name: junk, loan_purpose: "purchase" } as any);
  chk(!/^Hey\s+—/.test(r.body) && !/^\s*—/.test(r.body) && !/\{first_name\}/.test(r.body),
    `a body rendered for ${JSON.stringify(junk)} starts clean: ${JSON.stringify(r.body.slice(0, 34))}`);
}

// ── 6. EVERY TOUCH STAYS SPECIFIC EVEN WHEN THE OPTIONAL FIELDS ARE NULL.
//    The old degradation stripped the only specific thing in a sentence and still produced
//    grammatical English, so it read fine in review while saying nothing: d1 shipped WITHOUT
//    its dollar hook on 36 of 86 sends, d7 lost the state on 32 of 43. And d3/d7/d14 — 164
//    sends, the highest-volume emails in the database — contained no {first_name} token at all
//    and earned zero replies. The two templates that DID earn replies name the person, name
//    their deal, and ask ONE question. That is now asserted, not hoped for.
{
  const rich: any = { first_name: "Dawn", full_name: "Dawn Engler", loan_purpose: "purchase", state: "FL", property_value: 168000 };
  const bare: any = { first_name: "Dawn", full_name: "Dawn Engler", loan_purpose: "refinance", state: null, property_value: null };
  for (const [key, t] of Object.entries(EMAIL_TOUCHES)) {
    for (const [label, l] of [["all fields", rich], ["state+value null", bare]] as [string, any][]) {
      const b = renderTouch(t, l).body;
      chk(b.includes("Dawn"), `${key} (${label}) names the borrower`);
      chk(/purchase|refinance|FL|168k|investors like you/.test(b), `${key} (${label}) still carries a lead-specific fact`);
      const qs = (b.match(/\?/g) || []).length;
      chk(qs === 1, `${key} (${label}) asks exactly ONE question (found ${qs})`);
    }
  }
}

// ── 7. NO EMAIL CLAIMS AN ACTION THE LEAD NEVER TOOK. 185 emails to 160 leads said "your
//    saved application is right here" to people who had never started one — the same
//    fabricated-prior-action defect as a body telling a lead her file was "still sitting on
//    my desk" before Fetti had ever contacted her.
{
  const nurture = code("lib/nurture.ts");
  chk(/function applyCta\(/.test(nurture), "the apply CTA branches on whether an application actually exists");
  const claims = (nurture.match(/your saved application/g) || []).length;
  chk(claims <= 2, `the "saved application" wording survives only inside the started-an-application branch (${claims} occurrence(s))`);
  chk(!/saved application/.test(code("app/api/apply/route.ts")),
    "and the returning-visitor email no longer asserts one");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). Three names on one email is the loudest automation tell in the send, and it is the first thing a stranger notices.\n`); process.exit(1); }
console.log(`PASS — one name on the email, and a broken merge drops the greeting instead of printing it.\n`);
