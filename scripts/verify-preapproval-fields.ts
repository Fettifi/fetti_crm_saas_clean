// EVERYTHING ON THE TERM SHEET REACHES THE LETTER — AND THE TWO LETTERS AGREE.
//
// Ramon, 2026-08-03: "make sure that everything that I upload in the term sheet is captured and
// showed on the preapproval that I issue. It seems like it's not providing enough fields."
//
// Three failures sat behind that, and all three reported success:
//   1. The extractor's schema was a CLOSED 22-field shape against the ~130 a real wholesale term
//      sheet carries. A term with no named slot was discarded by the model — before any
//      downstream code could recover it.
//   2. The PDF and the PUBLIC WEB LETTER each kept their own hand-written row list. The PDF
//      printed 18 rows; the letter link Ramon sends to listing agents printed 8, and its API
//      never even selected the extras. One letter number, two different documents — and
//      sendPreapproval.ts puts the PDF attachment and the /letter link in the SAME email.
//   3. The PDF was ONE hardcoded page with no bounds check. pdf-lib draws at negative y without
//      complaint and pdf.js does not extract text outside the MediaBox, so content past the
//      bottom of the paper vanished invisibly. The tail is laid out last, so it died first: at
//      26 rows the licensing line, at 28 the whole Equal Housing / NMLS block, at 31 the
//      officer's name, at 33 "Sincerely,". The letter still looked official.
//
//   npx tsx scripts/verify-preapproval-fields.ts
import { readFileSync } from "fs";
import { buildPreApprovalPdf } from "../lib/preapprovalPdf";
import { letterRows, letterSections, resolveLtv, resolveDti } from "../lib/preapprovalTerms";
import { PA_FIELDS, PA_BY_KEY, PA_LETTER_KEYS, PA_INTERNAL_KEYS } from "../lib/preapprovalFields";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let t = "";
  for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ") + "\n";
  return { text: t, pages: d.numPages };
}

const LETTER = {
  letter_number: "PA-202608-1234", borrower_name: "Alexandra Whitfield-Montgomery",
  co_borrower: "Jonathan Whitfield-Montgomery", loan_type: "DSCR", purchase_price: 425000,
  loan_amount: 318750, down_payment: 106250, interest_rate: "7.375%", term: "30-year fixed",
  // A deliberately long address: the old renderer started this 24pt off the LEFT edge of the
  // paper and overprinted its own label.
  property_address: "14829 Northwest Sagebrush Ridge Parkway, Building 7 Unit 214C, Scottsdale, Arizona 85259",
  occupancy: "Investment", conditions: "Executed lease required prior to funding; entity formation documents; six months PITIA reserves verified.",
  // The INDIVIDUAL originator's id. This fixture carried the company's (2267023) — a test
  // fixture that encodes the defect keeps the defect alive, because every later reader treats
  // it as the known-good shape. scripts/verify-officer-nmls.ts owns that rule.
  officer_name: "Ramon Dent", officer_nmls: "2235992", expires_on: "2026-10-01", created_at: "2026-08-03",
};

(async () => {
  console.log("\nTERM SHEET → PRE-APPROVAL — every field reaches the letter\n");

  // ── 1. One registry, read by every layer ────────────────────────────────────────────────
  console.log("the registry is the only list:");
  for (const [label, path] of [
    ["the extractor builds its schema from it", "app/api/preapprovals/extract/route.ts"],
    ["the storage whitelist comes from it", "app/api/preapprovals/route.ts"],
    ["the LO's form is generated from it", "app/preapprovals/page.tsx"],
    ["the row builder reads it", "lib/preapprovalTerms.ts"],
  ] as [string, string][]) chk(/preapprovalFields/.test(code(path)), label);
  chk(/preapprovalTerms/.test(code("lib/preapprovalPdf.ts")), "the PDF renders the shared rows, not its own list");
  chk(/preapprovalTerms/.test(code("app/api/letter/[token]/route.ts")), "and so does the PUBLIC letter — the two cannot diverge again");
  chk(!/\["Loan program", l\.loan_type/.test(code("app/letter/[token]/page.tsx")),
    "the public letter's hardcoded 8-row array is gone");
  chk(/getSetting\(`PA_TERMS:/.test(code("app/api/letter/[token]/route.ts")),
    "the public letter loads the extra terms it never used to select");

  // ── 2. Field coverage ───────────────────────────────────────────────────────────────────
  console.log("\ncoverage:");
  chk(PA_FIELDS.length >= 120, `the registry carries ${PA_FIELDS.length} term-sheet fields (was 22)`);
  chk(PA_FIELDS.some((f) => f.key === "other_terms"),
    "plus an other_terms catch-all — a term with no named slot is kept, not discarded at the model");
  const ex = code("app/api/preapprovals/extract/route.ts");
  chk(/SCHEMA_LINES/.test(ex) && /PA_FIELDS/.test(ex), "the extraction prompt is generated, so a new field needs no second edit");
  chk(/max_tokens: 16000/.test(ex) && /stop_reason === "max_tokens"/.test(ex),
    "a dense sheet fits the budget, and a truncated read fails loudly instead of reading as empty");
  chk(/unmapped\.push/.test(ex), "a value outside the dropdowns is REPORTED, not silently replaced by the form default");

  // ── 3. Nothing falls off the letter ─────────────────────────────────────────────────────
  console.log("\nthe PDF holds a fully-populated term sheet:");
  // Per-field sentinel override, for fields whose resolver VALIDATES the value — see the note at
  // the "print by default" check below. Everything else gets the plain string marker.
  const SENTINEL: Record<string, string> = { dti: PA_BY_KEY.dti.example! };
  const marker = (k: string) => SENTINEL[k] ?? "SENSITIVE-" + k;

  const extra: any = {};
  for (const f of PA_FIELDS) if (!f.column && !f.internalOnly && f.key !== "other_terms") extra[f.key] = f.example || "value";
  // These are the toggleable/sensitive terms. Ramon asked twice that they DO print by default;
  // the switch is what holds them back. (The old comment here read "must never print" — stale.)
  for (const f of PA_FIELDS) if (f.internalOnly) extra[f.key] = marker(f.key);

  const rows = letterRows(LETTER, extra);
  const { text, pages } = await pdfText(await buildPreApprovalPdf(LETTER, extra));
  const flat = text.replace(/\s+/g, " ");
  chk(rows.length >= 90, `${rows.length} rows render across ${pages} page(s)`);

  const lostLabels = rows.filter((r) => !flat.includes(r.label.slice(0, 22))).map((r) => r.label);
  chk(lostLabels.length === 0, `every row LABEL survives to the page${lostLabels.length ? ` — lost: ${lostLabels.slice(0, 4).join(", ")}` : ""}`);
  const lostValues = rows.filter((r) => r.value !== "—" && r.value.length > 3 && !flat.includes(r.value.slice(0, 18))).map((r) => r.label);
  chk(lostValues.length === 0, `every row VALUE survives too${lostValues.length ? ` — lost: ${lostValues.slice(0, 4).join(", ")}` : ""}`);

  // The compliance tail is laid out last and therefore dies first. This is the assertion the old
  // guard never made, and the reason a letter could ship without its licensing disclosure.
  for (const must of ["Sincerely", "Ramon Dent", "NMLS #2267023", "Equal Housing Opportunity", "not a commitment to lend"])
    chk(flat.includes(must), `the tail survives: "${must}"`);

  // A LETTER A LISTING AGENT CANNOT ACT ON IS WORSE THAN NO LETTER.
  // 2026-10-02 Michelle Dubner, a buyer's agent: "the letter does not carry a phone number." A
  // pre-approval is forwarded to the listing side precisely so they can call and verify the buyer
  // is real; one they cannot verify reads as unverifiable rather than merely absent. BRAND.phone
  // was added that day — as a CONSTANT, with no assertion behind it. Verified 2026-10-03 by
  // rendering: every letter the app had actually produced, including the newest (PA-202609-2015),
  // still carries NO phone and NO email. A fix nothing asserts is a fix that regresses in silence.
  chk(/\(424\)\s*675-6295/.test(flat), "the letter carries the OFFICE line a listing agent can call");
  chk(/[\w.]+@fettifi\.com/.test(flat), "and an email address — two ways to reach a human, not zero");
  // The same breath: reachable must never mean Ramon's mobile or the Twilio DID. The DID goes busy
  // on a zero balance, and a dead number outliving the session is worse than a missing one.
  //
  // COMPARE DIGITS, NOT A SEPARATOR GUESS. The first cut allowed exactly ONE separator character
  // between each group of digits — and the ordinary rendered form carries a closing paren AND a
  // space between the first two groups, so it slipped straight through. Caught 2026-10-03 by
  // substituting the mobile into BRAND.phone on purpose: the number reached the page and this
  // check still reported ok. verify-disclosure.ts carried the identical pattern and hole.
  // Normalise to digits, then compare. Like build-business-card.cjs's doNotPrint list, a guard has
  // to name the values it forbids — so this one line is allowlisted in verify-contact-privacy.cjs,
  // pinned to the marker rather than to the text, because the assertion around it may change again.
  const PRIVATE_DIGITS = ["3236203534", "9207543647"];                // PRIVACY-NEEDLE-DIGITS
  const digits = flat.replace(/\D/g, "");
  chk(!PRIVATE_DIGITS.some((d) => digits.includes(d)),                // PRIVACY-NEEDLE-DIGITS
    "and NEITHER the personal mobile nor the Twilio DID reaches the page");

  // ── 4. Everything prints; hiding is a real control ──────────────────────────────────────
  console.log("\nsensitive terms print by default, and hiding actually holds them back:");
  // Ramon asked twice for everything off the document to reach the letter, so these no longer
  // block — but the switch has to WORK, and a hidden field must not merely be un-rendered while
  // still sitting in the blob the public PDF route serves.
  const MUST_BE_TOGGLEABLE = [
    "broker_comp",           // Reg Z 1026.36(d)(2) — beside borrower-paid points it reads as dual comp
    "lender_rebate_ysp", "base_price", "pricing_adjustments",
    "credit_score", "dti", "qualifying_income", "verified_reserves",
    "lender_name", "account_executive",
  ];
  const unflagged = MUST_BE_TOGGLEABLE.filter((k) => !PA_BY_KEY[k]?.internalOnly);
  chk(unflagged.length === 0, `the sensitive terms are still flagged, so the form offers a switch for each${unflagged.length ? ` — UNFLAGGED: ${unflagged.join(", ")}` : ""}`);
  // `dti` CANNOT carry the string sentinel, and that is the resolver doing its job.
  // 2026-10-03: this check failed on `dti` alone, and the count-only message did not say so.
  // `ltv` and `dti` are the only two fields that bypass valueOf() and go through a VALIDATING
  // resolver (resolveLtv / resolveDti). resolveDti does Number("SENSITIVE-dti") → NaN →
  // !Number.isFinite → null, so the row is correctly dropped. Demanding that a nonsense DTI reach
  // the page would push the next reader to weaken the exact guard that exists because
  // PA-202609-2015 printed DTI 16% beside a 45.5% housing ratio. So give dti a sentinel its
  // resolver can accept — its own declared example — and prove THAT reaches the page.
  // (The pitia/income cross-check inside resolveDti stays dormant here: it reads
  // x.qualifying_income, which is still the string sentinel, so it parses to 0 and is skipped.)
  const printedByDefault = MUST_BE_TOGGLEABLE.filter((k) => flat.includes(marker(k)));
  // NAME the missing keys — the line directly above already names its offenders, and a guard that
  // cannot tell you WHAT broke costs a debugging session every time.
  const missingByDefault = MUST_BE_TOGGLEABLE.filter((k) => !printedByDefault.includes(k));
  chk(printedByDefault.length === MUST_BE_TOGGLEABLE.length,
    `all ${MUST_BE_TOGGLEABLE.length} print by default — he asked for everything on the sheet` +
    (missingByDefault.length ? ` — MISSING: ${missingByDefault.join(", ")}` : ""));

  const hiddenRows = letterRows(LETTER, { ...extra, __hidden: MUST_BE_TOGGLEABLE });
  const stillThere = MUST_BE_TOGGLEABLE.filter((k) => hiddenRows.some((r) => r.key === k));
  chk(stillThere.length === 0, `unticking removes them from the letter${stillThere.length ? ` — STILL SHOWN: ${stillThere.join(", ")}` : ""}`);
  const api = code("app/api/preapprovals/route.ts");
  chk(/hidden_fields/.test(api) && /PA_INTERNAL:/.test(api),
    "and a hidden field is stored under the key no public route reads — not just left out of the render");
  chk(!/PA_INTERNAL/.test(code("app/api/letter/[token]/pdf/route.ts")) && !/PA_INTERNAL/.test(code("app/api/letter/[token]/route.ts")),
    "no public route reads that key");

  // ── 4b. Every uploaded document is read ─────────────────────────────────────────────────
  console.log("\nevery document he uploads is read:");
  chk(/getAll\("file"\)/.test(ex), "the extractor reads EVERY uploaded file, not just the first");
  chk(/multiple/.test(readFileSync("app/preapprovals/page.tsx", "utf8")), "and the picker accepts more than one");
  chk(/conflicts\.push/.test(ex), "two documents disagreeing is REPORTED, not silently resolved");
  chk(/differentBorrower/.test(code("app/preapprovals/page.tsx")),
    "a second document MERGES instead of wiping the first — but a different borrower's sheet clears the form");
  const terms = code("lib/preapprovalTerms.ts");
  chk(/valueKind === "list"/.test(terms),
    "the other_terms catch-all expands into real rows (it rendered as [object Object])");
  chk(/f\.key === "term"/.test(terms) && /loan_term_length/.test(terms),
    "one Loan term row, showing the document's own wording — a 3-year sheet printed \"12-month interest-only\"");
  chk(/LEAVE "term" OUT ENTIRELY|Never pick the nearest option/.test(ex),
    "and the extractor is told never to force-map to the nearest dropdown option");
  chk(/DICTATE, DO NOT RE-CATEGORISE|Never rename a fee/.test(ex),
    "fees keep the document's own names — an Insurance Monitoring Fee printed as a Processing fee");

  // ── 5. PDF ↔ web letter parity ──────────────────────────────────────────────────────────
  console.log("\nthe two renderings of one letter agree:");
  const secs = letterSections(LETTER, extra);
  chk(secs.flatMap((s) => s.rows).length === rows.length, "both surfaces build from letterSections — same rows, same order");
  chk(/sections\.map/.test(readFileSync("app/letter/[token]/page.tsx", "utf8")),
    "the web letter renders those sections rather than its own subset");

  // ── 6. A zero is an answer ──────────────────────────────────────────────────────────────
  console.log("\nzero is a term, not a blank:");
  const zeroRows = letterRows(LETTER, { points: "0", lender_fees: "$0", prepay_penalty: "None" });
  chk(zeroRows.some((r) => r.value === "0"), "0 points prints");
  chk(zeroRows.some((r) => /\$0/.test(r.value)), "$0 lender fees prints");
  chk(zeroRows.some((r) => r.value === "None"), "a 'None' prepayment penalty prints — often the best line on the sheet");
  chk(/n >= 0|isFinite\(n\) \? n/.test(ex), "and the extractor's number parser keeps a legitimate zero");

  // ── 7. THE TWO ARITHMETIC REFUSALS — the only reason resolveLtv/resolveDti exist ─────────
  //
  // 2026-10-04. Sections 1–6 prove every term REACHES the letter. Not one of them proves the
  // letter REFUSES an impossible one, and those refusals are the whole reason the two resolvers
  // are hand-written instead of plain field reads. Worse, this file's own comment at the
  // "print by default" check says the pitia/income cross-check "stays dormant here" — written
  // knowingly, and left as the only record. An edit reverting resolveLtv's `n <= 0` back to a
  // plain `raw !== ""` test, or deleting the housing-ratio compare, passes every check above.
  //
  // What makes this worth a gate rather than a note: PA-202609-2015 (10331 Lindley, issued
  // 2026-09-08) went to a listing agent printing **Loan-to-value 0.0%** beside a 3.5% down
  // payment and **DTI 16%** beside PITIA $4,735 on income $10,414/mo — a 45.5% housing ratio on
  // the letter's own face. The letter was in date, correctly signed, and carried the right NMLS;
  // nothing else in this repo could tell it was false. It stayed valid through 2026-11-30.
  // So the fixtures below are THAT LETTER'S REAL NUMBERS. [[a-zero-is-an-answer-except-where-it-is-impossible]]
  console.log("\nan impossible figure is refused, not printed:");
  const LINDLEY = { ...LETTER, loan_amount: 450000, purchase_price: 500000 };
  const PITIA = "4735", INCOME = "10414";          // housing ratio = 45.5%

  // LTV: a stored 0 is a MISSING value wearing a number's clothes.
  chk(resolveLtv({ ...LINDLEY }, { ltv: "0" }) !== "0%", "a stored LTV of 0 never prints as 0%");
  chk(resolveLtv({ ...LINDLEY }, { ltv: "0.0%" }) !== "0.0%", "nor does a stored \"0.0%\"");
  chk(resolveLtv({ ...LINDLEY }, { ltv: "-5" }) !== "-5%", "nor a negative one");
  // ...and because it is treated as ABSENT, the recomputation must then run and be RIGHT.
  chk(resolveLtv({ ...LINDLEY }, { ltv: "0", as_is_value: 500000, loan_purpose: "Purchase" }) === "90%",
    "with the 0 treated as absent, LTV is recomputed from the real basis (450k/500k = 90%)");
  // The basis is the LESSER of as-is value and price on a purchase — the Scenario Desk's basis.
  // An appraisal under contract price is the common case and the one that moves the number.
  chk(resolveLtv({ ...LINDLEY }, { as_is_value: 450000, loan_purpose: "Purchase" }) === "100%",
    "a purchase takes the LESSER of as-is value and price (appraisal 450k under a 500k price = 100%)");
  // A STATED, POSSIBLE ltv still wins — the refusal must not have eaten the precedence rule.
  chk(resolveLtv({ ...LINDLEY }, { ltv: "75", as_is_value: 500000, loan_purpose: "Purchase" }) === "75%",
    "but a real stated LTV still beats the recomputation — the lender's own sheet wins");
  // With NO basis at all it must print nothing — never fall back to a 0. Note the fixture: this
  // needs a record carrying neither as_is_value nor purchase_price. Asserting it against LINDLEY
  // (which has a 500k price) failed on the first run and the code was right — 450k/500k = 90% is
  // exactly what that record supports. A test that demands a blank from computable inputs would
  // have pushed the next reader to break a working recomputation. [[a-red-guard-is-a-hypothesis]]
  chk(resolveLtv({ loan_amount: 450000 }, {}) === null, "with nothing to compute from, LTV prints nothing — never a 0");
  chk(resolveLtv({ loan_amount: 450000 }, { ltv: "0" }) === null, "a stored 0 with no basis is still absent, not 0%");

  // DTI: back-end DTI includes housing, so it can never be BELOW the housing ratio.
  chk(resolveDti({ ...LINDLEY, dti: "16" }, { monthly_payment: PITIA, qualifying_income: INCOME }) === null,
    "DTI 16% is REFUSED beside PITIA 4,735 on income 10,414 — the exact figure that shipped");
  chk(resolveDti({ ...LINDLEY, dti: "40" }, { monthly_payment: PITIA, qualifying_income: INCOME }) === null,
    "and so is 40% — below the housing ratio, yet an entirely ordinary-looking DTI");
  // THE TOLERANCE IS DELIBERATE, SO PIN IT. resolveDti refuses only when `stated + 0.5 < housing`,
  // which means 45% is ACCEPTED against a 45.458% housing ratio. That is a rounding allowance, not
  // an oversight: a stated figure is a rounded one, and refusing inside half a point would reject
  // true DTIs. Asserting 45% was refused failed on the first run — the code was right. Pinning the
  // boundary in both directions means the next reader can change the tolerance ON PURPOSE and see
  // exactly what moves, instead of discovering it from a letter.
  chk(resolveDti({ ...LINDLEY, dti: "45" }, { monthly_payment: PITIA, qualifying_income: INCOME }) === "45%",
    "45% is allowed against a 45.458% housing ratio — the 0.5pp rounding tolerance, pinned on purpose");
  chk(resolveDti({ ...LINDLEY, dti: "44.9" }, { monthly_payment: PITIA, qualifying_income: INCOME }) === null,
    "44.9% falls outside that tolerance and is refused — the boundary is where it is documented to be");
  chk(resolveDti({ ...LINDLEY, dti: "48" }, { monthly_payment: PITIA, qualifying_income: INCOME }) === "48%",
    "48% prints — above housing, so it is possible; the guard refuses the impossible, not the high");
  chk(resolveDti({ ...LINDLEY, dti: "0" }, {}) === null, "a 0% DTI is not an answer either");
  // AND THE REFUSAL MUST NOT INVENT A REPLACEMENT. The housing ratio is a FLOOR, not the
  // borrower's DTI; printing it would be a figure no document supports.
  const dtiRows = letterRows({ ...LINDLEY, dti: "16" }, { ...extra, monthly_payment: PITIA, qualifying_income: INCOME });
  chk(!dtiRows.some((r) => r.key === "dti"), "the row is OMITTED — an absent figure, never a substituted one");
  chk(!dtiRows.some((r) => /45\.5/.test(r.value)), "and the housing ratio is not quietly printed in its place");
  // Both refusals must reach the PAPER, not just the row list — the PDF is what a third party reads.
  const { text: impText } = await pdfText(await buildPreApprovalPdf(
    { ...LINDLEY, dti: "16" }, { ...extra, ltv: "0", monthly_payment: PITIA, qualifying_income: INCOME }));
  const impFlat = impText.replace(/\s+/g, " ");
  chk(!/Loan-to-value \(LTV\)\s*0/.test(impFlat), "the rendered PDF carries no 0% LTV");
  chk(!/\b16%/.test(impFlat), "and no 16% DTI anywhere on the paper");

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). A term that reaches the letter for one reader and not another is a letter Ramon cannot stand behind.\n`); process.exit(1); }
  console.log(`PASS — ${PA_FIELDS.length} fields captured, ${rows.length} rows rendered on ${pages} pages, tail intact, nothing internal printed.\n`);
})();
