# Application-system audit — the queue, and what is actually left

**Ramon's ask A479195 (2026-10-07):** *"AUDIT the application system: borrower AUTHORIZATIONS must
be captured at application time, ALL URLA declarations present and stored, and a COMPLETE COMPLIANT
1003 — MISMO exports are missing information when he uploads to lender portals."*

The audit ran 78 agents and produced **70 adversarially-confirmed findings, 3 refuted**. Two
criticals were fixed and guarded the same night.

> **Why this file exists.** The other 68 findings were ranked, reported in a chat message, and
> **written to nothing**. Nine days later the ranking existed only inside a session transcript that
> had been compacted — 1.5 GB of JSONL that had to be mined to get six of them back. An audit that
> produces 70 confirmed findings and no durable artifact has produced nothing anyone can execute.
> **Findings go in a file, in the repo, or they are not findings.**

## Status of the ranked queue — re-verified against live code 2026-10-16

Every line below was checked against the working tree today, not carried forward from the report.

| # | Finding | Status 2026-10-16 | Evidence |
|---|---|---|---|
| 1 | Loan amount never asked on buy / refi / invest / reverse — 1003 ships a blank `BaseLoanAmount` | **FIXED** | `app/apply/form/page.tsx` asks `loan_amount_requested` on every flow (buy :114, refi :133, invest :148, flip :167, equity :184, business :193, reverse :203), with the rationale in the comment at :107 |
| 2 | `loan_amount_requested` carried the **rehab budget** on flip and the **existing mortgage balance** on equity, and was submitted as the amount requested | **FIXED** | `rehab_budget` (:167) and `existing_mortgage_balance` (:184) now keep their own names; comments at :159 and :177 |
| 3 | `<LIABILITIES>` container missing from the exporter — lenders import a 1003 showing zero debts | **FIXED** | `lib/mismo.ts:239–270`, deal-level LIABILITY / LIABILITY_DETAIL / LIABILITY_HOLDER |
| 5 | Veteran exports as `MortgageType Conventional`, `SelfDeclaredMilitaryServiceIndicator` hardcoded false | **FIXED in MISMO** | `lib/mismo.ts:537` derives it from the borrower's own answers and emits **undefined when unanswered** rather than false |
| 6 | Co-borrower declarations / military / demographics stamped borrower 1's answers onto borrower 2 | **FIXED (the dangerous half)** | `lib/mismo.ts:535` — `const mil = i === 0 ? u.military \|\| {} : {}`, so borrower 2 is empty rather than wrong |
| 4 | **The signed authorization is never turned into a document**, so nothing can be handed to an underwriter | **FIXED 2026-10-16** | `lib/authorizationPdf.ts` + apply-route upload to the private `loan-docs` bucket; `verify:authorization-document` (12 checks, in the hook, failed on purpose three ways) |

**So the blocker note on A479195 was stale.** It read *"68 findings remain, ranked, not yet fixed"*
while most of the top of that ranking had in fact been executed. Correcting a count nobody is
tracking is the same failure as a roster that still announces a withdrawn loan.

## What is genuinely still open, and what it needs

### 4 — the signed authorization produces no document  — **FIXED 2026-10-16, commit below**

The wizard **does** capture it: `app/apply/form/page.tsx:751` pushes a
`{ kind: "authorization", id: "borrower_authorization" }` step, and the comment above it is explicit
that the borrower *"reads and authorization and signs it before the 1003 is submitted."*

But:

- There is **no authorization PDF builder.** The repo has fifteen (`bizAppPdf`, `cardAuthPdf`,
  `preapprovalPdf`, `urlaPdf`, `incomePdf`, `letterPdf`, …) and **none** of them renders the
  borrower's application authorization.
- **Nothing in `app/api/apply/` writes to `loan_documents`.** The signature exists as a field on a
  row; it never becomes an artifact with a page, a date and a name on it.

So when an underwriter asks for the signed authorization, there is nothing to send — which is the
same shape as the Metoyer credit-authorization gap that prompted the ask in the first place.

**What it needs** (deliberately not started in a 15-minute desk tick — it is a build, not an edit):

1. `lib/authorizationPdf.ts` rendering the exact text the borrower agreed to, their typed/drawn
   signature, the UTC timestamp, the capturing IP/user-agent, and the loan/lead identifier.
   **The text must be the version they signed, not today's version** — version the consent text and
   store the version id on the row, or the PDF is a reconstruction rather than a record.
2. Write it into `loan_documents` on submission, so the existing document machinery can hand it to
   a lender.
3. A guard that FAILS when an application row carries an authorization signature with no
   corresponding document — the condition that is true right now, for every application ever taken.

### 71 — two Section 5 declarations were never ASKED — **FOUND AND FIXED 2026-10-16**

Found while re-auditing the second clause of A479195, *"ALL URLA declarations present and stored"*,
on a quiet desk cycle. Written here before it was fixed, per the rule at the top of this file.

`SECTION_5_DECLARATIONS` lists fifteen. The apply wizard could produce **thirteen**:

| ref | field | why it could never be answered |
|---|---|---|
| 5a(5) | `applyingOtherMortgage` | no option in the `decl_financial` checklist, so `declFrom()` had nothing to map |
| 5a(2) | `priorOwnershipLast3Years` | no step existed in the wizard at all |

Both are parsed on the way IN (`lib/mismoImport.ts:200` and `:207`) and printed on the 1003 as
**D.1** and **A.1**, so a file imported from a lender carried them while **every file originated by
our own application shipped them blank** — one of the literal "MISMO exports are missing
information" complaints behind this ask. 5a(5) is not a duplicate of 5a(6) `applyingNewCredit`: a
second *mortgage* application is the one that changes the debt picture at closing, which is why the
URLA asks them separately.

**Why nothing caught it, and this is the reusable part.** `verify:mismo-decl` was green before,
during and after — it asserts that the *exporter* emits each declaration correctly and omits it
rather than writing `false` when unanswered. All true, and all beside the point. **A guard on the
field is not a guard on the metric.**

**Fixed:** checklist option `other_mortgage` plus a `decl_prior_ownership` step shown only to
owner-occupants (the URLA asks 5a(2) only when 5a(1) is YES); both mapped in `declFrom()`.

**Guarded:** `npm run verify:declaration-capture`, wired into the pre-commit hook. It asserts the
metric — a fully-answered application reports **15 of 15** — reads the *wizard's own source* for the
option values so a new declaration without a way to answer it goes red, and still asserts that an
unasked declaration stays `""` and is never fabricated as `"No"`. Made to fail on purpose three
ways: delete the checklist option (red), drop the `declFrom` mapping (red), default an unasked
answer to `"No"` (red). Files restored byte-identical after each.

**One correction worth recording:** my first version of that guard reported four failures that were
entirely its own — it read `borrowers[0].declarations` when the assembled declarations hang off the
Urla root, and put `occupancy` in `raw` when `assembleUrla` reads the lead *column*
(`lib/urla.ts:508`, written by `app/api/apply/route.ts:240`). Reconciled against a real
`assembleUrla` dump before trusting a single result. A red guard is a hypothesis.

### The other ~62

Not recoverable from the transcript as a ranked list; they live across 78 agent outputs. **Do not
re-run the audit to rediscover them before the six above are closed** — rediscovery is cheap
compared with the risk of leaving #4 open, and the next audit must write its findings here as it
goes rather than reporting them into a chat message.
