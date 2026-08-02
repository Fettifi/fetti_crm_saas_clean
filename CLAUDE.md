# Fetti CRM — rules that are not optional

Ramon Dent's lending business runs on this repo. The numbers here decide real loans for real
families. Everything below was written after something went wrong and cost money.

This file loads into every session automatically. That is the point — the lessons that lived
in memory files kept failing because nothing put them in front of anyone at the moment of the
decision.

---

## 1. Never trust a name — read what the code does

**2026-08-01:** a constant named `MAX_DOCS = 8` capped nothing (it only ordered a list). It was
read, believed, and used to justify a change that re-rolled a settled **$11,701** qualifying
income to **$3,129** on a live client file. Same day, a prompt named `EXTRACT_SYSTEM` was
"fixed" and shipped — it had **zero importers**. The live reader is `READ_ONE_SYSTEM` in
`lib/income/readDocument.ts`.

Before reasoning from any constant, comment or prompt name: **open the thing that uses it.**
`grep` for its call sites. A name that lies is a trap for whoever reads it next.

## 2. Verify the OUTCOME, not the stage you touched

"The document entered the candidate list" is not verification — that was the claim made the
morning the Wilson file broke. The only question that counts: **did a borrower's NUMBER move,
and is the new number defensible against the documents?**

## 3. The income guards are free — run them

```bash
npm run verify:income      # no file's doc set or settled number moves unseen
npm run verify:employer    # one employer read two ways is ONE job (both directions)
npm run verify:benefits    # documented benefit deposits reach the worksheet
```

Zero API calls, seconds to run. A **git pre-commit hook** runs them on any commit touching
`lib/income/**` or the verify-income route and will refuse the commit. Don't fight it:

- change intended? → `npm run verify:income -- --save`, then commit again
- genuinely need to bypass? → `git commit --no-verify`
- fresh clone? → `npm run hooks:install` (`core.hooksPath` is local config; it does not clone)

## 4. `LOGIC_VERSION` is global

Bumping it invalidates the stability cache for **every** file. Every borrower then re-reads on
their next verify, and the AI read is non-deterministic — which is precisely the complaint that
created the cache ("income I verified last week is completely different this week on the same
file"). Bump it only when the **math** genuinely changed, and say so out loud.

## 5. Money is in the deposits

A status document proves income **exists**; it rarely states the amount.

| Document | Proves | Dollars? |
|---|---|---|
| DD-214 | veteran status, service dates | none, ever |
| VA COE | entitlement + **funding-fee exemption** | none — but *exempt* ⇒ disability IS being paid |
| VA award letter | monthly compensation | **yes** — non-taxable, gross up ×1.25 conv / ×1.15 FHA |
| Military LES | base pay + BAH/BAS | yes; allowances non-taxable |
| **Bank statement** | recurring Treasury ACH | **yes** — `VACP TREAS 310` = VA disability, `SSA TREAS 310` = Social Security |

**$4,898.05/mo of VA compensation sat in a bank statement while the file qualified that
borrower at $750.** When a status document appears, ask where the money lands — don't stop at
"no award letter on file."

## 6. Automation must never message a converted client

`lib/inProcess.ts` is the single source of truth: an application completed, a loan file, an
uploaded document, or a post-application stage all mean **client**. Enforced as rule 2c in
`lib/conversation/governor.ts`. The **doc-chaser is the only exception** (`OPERATIONAL_KINDS`) —
Ramon's explicit call, because chasing a document moves the client's own file forward.

`AUTOMATION_PAUSED` is the master shutoff; `AUTOMATION_ALLOWLIST` is the pilot list. Not every
sender routes through the governor — check before assuming a new sender is covered.

## 7. Never test on real contacts

`@fetti-internal.test` addresses and fictional `555-01xx` numbers only. This has burned real
borrowers twice. Lead Shield quarantines such rows; clean them up afterwards.

## 8. Comms sign as Frank

`frank@fettifi.com` is the only monitored mailbox. Mark is the mascot, not the sender. Never
claim "our own capital" — Fetti gets deals funded.

## 9. When you find a defect, add the case BEFORE you fix it

Every real-world failure becomes a permanent assertion in `scripts/verify-*.ts`. That is the
only thing in this repo that has ever stopped a repeat — prose lessons did not. If a bug was
worth an hour of Ramon's time, it is worth three lines in a test.

This is the mechanism by which the system actually improves: the guards only ever grow, and
they run whether or not anyone remembers why they exist.

## 10. Deploy and prove it

`git push origin HEAD:main`, then poll `https://app.fettifi.com/api/version` until it serves
the new SHA. Vercel promotions can land staged — a green build is not a live deploy. Report the
SHA you verified, not the one you pushed.
