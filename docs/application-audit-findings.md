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

### The other ~62

Not recoverable from the transcript as a ranked list; they live across 78 agent outputs. **Do not
re-run the audit to rediscover them before the six above are closed** — rediscovery is cheap
compared with the risk of leaving #4 open, and the next audit must write its findings here as it
goes rather than reporting them into a chat message.
