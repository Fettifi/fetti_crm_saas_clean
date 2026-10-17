# Build 2 — the licence gate on the act, with a Reg B exit

**Design only. Nothing below is implemented yet.** Produced 2026-10-17 by five readers over the live
call graph, with all 72 claims handed to separate agents instructed to refute them: **46 upheld, 26
refuted.** Written here rather than left in a chat window, per
`docs/architecture-sweep-2026-10-17.md`.

Ramon settled the gating question on 2026-10-17: **the subject property's state governs.** The
wizard's input path was fixed and shipped separately as `8cc60fb` — see Part 4 of the sweep. What
remains is that the verdict is still *advisory* everywhere.

Open for Ramon, and flagged in §2 below: the Reg B / ECOA §1002.9 consequence of refusing an
application already taken under a signed authorization. That is a business and legal call, not a
code one.

---

## VERIFICATION DELTAS (all reads this reply, 2026-10-17, read-only)

Verified myself, not inherited:

- **One insert**: `lib/los.ts:266` `from("loan_files").insert([row])` — repo-wide `grep -E 'from\("loan_files"\)' | insert|upsert` (node_modules/.next excluded) returns that one hit.
- **Three creators**: `lib/los.ts:246` `createLoanFileFromLead`, `:326` `ensureLoanFileForLead` (→`:331`), `:376` `promoteLeadToLoanFile` (→`:380`).
- **Six external call sites, confirmed exhaustive**: `app/api/los/files/route.ts:58` · `app/api/underwriter-desk/route.ts:153` · `app/api/los/import-mismo/route.ts:111` · `lib/selfheal.ts:42` · `app/api/file/[token]/upload/route.ts:30` · `app/api/file/[token]/upload-url/route.ts:21`. (`app/api/apply/route.ts:525` is a comment only.)
- **`licenceCheck` has exactly two call sites**, both `app/api/apply/route.ts` (`:185`, `:436`). `lib/los.ts` contains zero licence references; `createLoanFileFromLead` copies jurisdiction forward blind at `lib/los.ts:262` (`state: lead.state || null`).
- **CORRECTION to the brief — the prefill hole is already closed.** `app/apply/form/page.tsx:1330` is now `<input type="hidden" name="state" value={zipState} />` — no `prefill?.state` fallback; the reasoning (San Juan / Guam / APO) is on the page at `:1306-1329`, and `npm run verify:licensed-states` ran **green on all 32 checks** just now, including the behavioural `zipToState("00601") === null` → refuse chain (`scripts/verify-licensed-states.ts:118-144`). **Do not spend a step there.** The surviving input defects are elsewhere: `app/api/los/import-mismo/route.ts:88` (falls back to `b0.currentAddress?.state`), `app/api/underwriter-desk/route.ts:145` (writes occupancy `"investment"`, which `lib/licensedStates.ts:45` does not recognize — it exempts only `"investor"`), and `app/api/los/files/route.ts:50-54` (walk-in lead inserted with no `state` and no property address at all).
- **`upload-url` promotes pre-byte**: `app/api/file/[token]/upload-url/route.ts:21`, before the filename check at `:25`. Reachable from the UI at `app/file/[token]/page.tsx:62-63` for any file > 4MB; a failed PUT at `:70` leaves the file open and tells the borrower only "(transfer failed)".
- **Deletion guard**: written `lib/los.ts:447`, **erased** `lib/los.ts:389-393`, read in exactly one place, `lib/selfheal.ts:34`.

---

## 1. THE DECISIONS

**D1 — One gate, one function, jurisdiction passed in explicitly.** New `openLoanFile(lead, j)` in `lib/los.ts`; it becomes the only exported creator. Not at the insert (`lib/los.ts:266`): by then only `lead.state` exists (`:262`), which is empty for walk-ins (`app/api/los/files/route.ts:50-54`) and is the *mailing* address for MISMO (`:88`) — a gate there refuses legitimate CA walk-ins and passes a GA property whose borrower lives in CA. The property address still exists at every caller, so `j` is **required and un-defaulted**: `{ state?, zip?, source: "apply_zip"|"mismo_property"|"desk_input"|"lo_entry"|"lead_row", actor, allowReopen? }`. A caller that cannot supply a jurisdiction fails to compile instead of silently inheriting one.

**D2 — A refusal is a discriminated union, never `null`.** `Promise<{ok:true; file:LoanFile} | {ok:false; refusal:LicenceRefusal}>`. `null` already means "insert failed" (`lib/los.ts:268-271`, and callers print "could not create loan file" at `app/api/los/files/route.ts:59`, `underwriter-desk:154`, `import-mismo:112`) — conflating the two records an unlicensed-origination refusal as a database hiccup. TS narrowing forces handling: touching `.file` without checking `.ok` is a type error. Per caller: the three staff routes return **451** with `refusal.reason` verbatim (staff read `j.error` already); `selfheal` holds and reports; both borrower routes return **200 + held** (D4).

**D3 — The two classifiers MERGE, on the licence module's default.** One exported `loanPurposeClass(occupancy, loanPurpose) → "consumer"|"business"` in `lib/licensedStates.ts`, built from `isConsumerRequest` (`:43-55`) plus `complianceFor`'s richer product regex (`lib/los.ts:215`), plus occupancy synonyms `investment|commercial` (today `:45` matches only `"investor"`, so the desk's `"investment"` at `underwriter-desk:145` reads consumer — harmless while advisory, but it would refuse every nationwide hard-money file the moment the gate bites). `lib/los.ts:212-220` then calls it. Default stays **consumer** (`lib/licensedStates.ts:16-17`, `:54`), which is simultaneously the safe default for TRID — so merging also fixes `lib/los.ts:220` falling toward BUSINESS on blank occupancy and stripping LE/CD/rescission. Occupancy outranks product name in both (`:45-46` before `:50`); keep that order — it is what stops an owner-occupied bridge losing TRID.

**D4 — Refused borrower upload: the document is kept, the file is not opened.** The bytes never depend on the verdict. `upload-url` creates nothing ever: when no file exists it mints the signed URL under `staging/<lead.id>/…` instead of `${file.id}/` (`upload-url/route.ts:31` is the only reason it promotes today). `upload/route.ts` on refusal: store/keep the object, append `leads.raw.held_documents[]`, log `licence.held` on the lead, alert the team once, return **200** `{ok:true, held:true, message:"We have your document. A Fetti specialist will be in touch — we can't open a file in <STATE> for an owner-occupied loan."}`. **Never 4xx**: `app/file/[token]/page.tsx:82-85` and `:91` turn any non-ok into "These didn't upload… Please try again", which trains the borrower to resend and loses the document in practice. `:46`'s prefix check must accept the staging prefix or every large upload 400s.

**D5 — Deletion outranks a borrower tap.** Delete the erasure at `lib/los.ts:389-393`. A deleted file + a borrower upload = the hold path + an alert, not a resurrection under a new file number. Re-opening is an LO action through the now-gated `/api/los/files` (`allowReopen: true`, only there). Do **not** revoke `raw.upload_token` — it is the borrower's only link in every legitimate case (`lib/los.ts:341-351`, adopted at `:382-386`).

**D6 — The autonomous healer never originates.** `lib/selfheal.ts:42` has no human in it (`app/api/cron/heal/route.ts:11-16`, Bearer-only). On refusal: no create, one idempotent record on the lead, and a `licence_held` repair row naming the state. It stops being the sole reader of `los_deleted_at` — the gate reads it too.

**D7 — apply stops handing the refused applicant the converter, and the stamp becomes readable.** Keep the 1003, the signed authorization and its PDF (`app/api/apply/route.ts:171-192`) — destroying the record of an application taken is worse than holding it. But when `rawBody.licence_block` is set: no `fileLink` built (`:529-537`), none returned (`:664`), and `licenceBlock` passed into `runNewLeadPipeline` (`:554-557`) so `lib/leadPipeline.ts:128-141` sends a neutral holding note with no `link`/`appLink`. The alert wording at `:436-448` stays.

**D8 — `licence_block` gets readers.** Today: one write (`:187`), zero reads — `scripts/verify-licensed-states.ts:46` asserts only the write. Readers: the gate, `components/LeadWorkspace.tsx` (band + disabled Convert), `app/los/page.tsx` (queue badge).

---

## 2. THE REG B EXIT

**What a refusal creates (code; this part I am sure of):**
- the lead row survives, carrying `raw.licence_block` (apply) and an append-only `raw.licence_refusals[]` — `{at, state, consumer, caller, source, actor, reason}`, **every** attempt, not just the first;
- an `activity_log` row, `action: "licence.refused"`, entity `lead` (same shape as `lib/los.ts:394-397`);
- the signed authorization record and its rendered PDF, untouched;
- held documents in the private `loan-docs` bucket at `staging/<lead.id>/`, listed on the lead; a refusal purges nothing;
- exactly one team alert (`notifyTeam`, `lib/notify/leadAlert.ts:117`) naming the state, with no "convert" line;
- a dated clock the desk can read: `raw.licence_refusals[0].at`, surfaced by a desk watcher — not left in prose.

**What the borrower is owed — my read:** certainly, not to be left believing a file is open or documents are "in review" when neither is true, and not to be silently dropped. A completed, signed 1003 with income, property, value and amount is an application in Reg B's sense (12 CFR 1002.2(f)), and action on one is notifiable within 30 days (1002.9(a)(1)).

**What I am not sure of, and will not have the code decide:** whether Fetti is the "creditor" owing that notice in a state where it cannot lawfully originate at all; whether the instrument is an adverse-action notice, a notice of incompleteness (1002.9(c)), or a withdrawal recorded after an accepted referral; and whether naming the licence footprint as the reason is the right disclosure (it is true and non-discriminatory, and it also concedes the application was taken). I am not a licensed advisor; this is a legal determination.

**Ramon's judgement, not the code's:** which instrument; whether and to whom to refer out; HMDA/register treatment; whether held documents are returned, retained or destroyed on request; and the wording of anything outbound. So in the refused lane the code sends **nothing** beyond the one neutral holding acknowledgement in D4 — no promises, no nurture, no rate talk.

---

## 3. THE CHANGES, IN ORDER

Each step compiles and is checkable on its own. **(BF)** = touches a borrower-facing path.

1. **`lib/licensedStates.ts`** — add `loanPurposeClass`; `:45` accepts `investor|investment|commercial`; keep `"second home"` consumer (`:46`); fold `lib/los.ts:215`'s product regex into `:50`; keep the consumer default (`:54`); `licenceCheck` (`:65`) delegates. *Check:* `npm run verify:licensed-states` still 32/32, plus new cases — GA + occ `"investment"` passes; GA + blank occupancy + `"Hard Money 2nd Position Cash-Out Refinance"` passes; GA owner-occupied bridge refuses.
2. **`lib/los.ts:210-224`** — delete the local `investorOcc`/`consumerOcc`/`bizProduct`/`isBizPurpose` derivation; call `loanPurposeClass`. *Check:* blank occupancy + consumer product now keeps the TRID milestone list (today `:220` sends it to the business list).
3. **`lib/los.ts`** — add `LicenceRefusal` and `openLoanFile(lead, j)`. Jurisdiction = `normalizeState(j.state) || zipToState(String(j.zip||"")) || ""` — **never** `lead.state` as a silent fallback. Run `licenceCheck`; on `!ok` write the §2 record and return `{ok:false,refusal}`; on ok delegate. Also refuse when `lead.raw.los_deleted_at` is set unless `j.allowReopen === true`. *Check:* call it from a scratch script — GA owner lead → `ok:false`, zero rows; CA → `ok:true`.
4. **`lib/los.ts:246`/`:326`/`:376`** — drop `export`, rename to `_createLoanFileFromLead`/`_ensureLoanFileForLead`/`_promoteLeadToLoanFile`; **delete `:389-393`** (the `los_deleted_at` erasure); replace the hardcoded `detail.reason: "first document upload"` at `:396` with the trigger actually passed in. *Check:* `npx tsc --noEmit` names exactly the six call sites — that compile error **is** the enumeration.
5. **`app/api/los/files/route.ts:58`** → `openLoanFile(lead, {state: lead.state, zip: lead.zip, source:"lead_row", actor:"teammate", allowReopen:true})`; refusal → 451 + reason, and `:62-65` (lead → Application) must not run. Walk-in branch `:50-54`: require `property_zip` (or `property_state`) in the body, persist it on the lead, pass as `source:"lo_entry"` — a walk-in with no jurisdiction fails visibly. Staff only (`proxy.ts:116-119`, matcher `:158`).
6. **`app/los/page.tsx`** — `:29` add `zip` to `nf`; `:95` send it; `:192-196` add a required "Property ZIP *" input; surface the 451 reason in the existing `alert` at `:98`. Staff UI.
7. **`app/api/underwriter-desk/route.ts:153`** → `openLoanFile(lead, {state: input.state, zip: input.zip, source:"desk_input", actor:"lo"})` (both present at `:141`/`:146`); refusal → 451, keep the lead row from `:139`. Staff UI.
8. **`app/api/los/import-mismo/route.ts`** — `:88` may keep the mailing-address fallback for the lead row, but `:111` passes **only** `p.property?.address?.state` / `.zip` to the gate; refusal → 451, nothing imported. Staff.
9. **`lib/selfheal.ts:42`** → `openLoanFile(l, {state: l.state, zip: l.zip, source:"lead_row", actor:"agent:healer"})`; on refusal: no create, one record, a `licence_held` repair row naming the state. Autonomous — this is the one that must be *provably* non-creating.
10. **(BF) `app/api/file/[token]/upload-url/route.ts:17-22`** — remove `promoteLeadToLoanFile` and its import (`:8`); prefix = `file ? file.id : \`staging/${lead.id}\``; 404 only when neither resolves. No licence decision here, because nothing is created.
11. **(BF) `app/api/file/[token]/upload/route.ts:26-32`** — replace the promote with `openLoanFile(...source:"lead_row", actor:"borrower")`; on refusal take the D4 hold path and return 200. Relax `:46` to accept `staging/<lead.id>/` alongside `${file.id}/`; keep the arrival check at `:47-48`. *Check:* three curls — CA lead (file opens), GA owner lead (200 held, zero `loan_files` rows, object present), deleted-file token (held, `los_deleted_at` intact).
12. **(BF) `app/api/apply/route.ts:529-537`, `:556`, `:664`** — build/return `fileLink` only when `!rawBody.licence_block`; pass `licenceBlock` to the pipeline. **`lib/leadPipeline.ts:84-85`, `:128-141`** — when set: no `link`, no `appLink`, holding template only.
13. **`components/LeadWorkspace.tsx:146-159`** — disable `convertToFile` and render the block band; **`app/los/page.tsx`** — queue badge. Staff UI. This is what makes the stamp non-inert.

---

## 4. THE GUARDS

New `scripts/verify-licence-gate.ts`, npm `verify:licence-gate`, wired into `scripts/hooks/pre-commit` beside `verify:licensed-states` (`:426-432`) under the same `[ -n "$ANYTS" ]` trigger **plus** its own `$LICENCE` filter added to the early-exit line at `:168` — the hook's documented trap (`:159-168`): a filter missing from that line is a guard that cannot fire.

- **G1 — Registry enumerates its own surface** (the `scripts/verify-auth-gate.ts:32-55` pattern, the one that already caught a public `/api/competitors`): assert (a) exactly one `loan_files` insert in the tree; (b) `_createLoanFileFromLead`/`_ensureLoanFileForLead`/`_promoteLeadToLoanFile` are called **only** from inside `lib/los.ts` and are not re-exported; (c) the set of files calling `openLoanFile` **equals** a literal `EXPECTED_CALLERS` list in the guard, each entry carrying a written one-line reason; an extra caller is an unexplained seventh path → red, a missing one → red. *Sabotage:* add `openLoanFile` to a new route without listing it; call a private creator from a route; re-export one. All three must go red.
- **G2 — A refusal is not a creation (behavioural, not textual):** stub `supabaseAdmin`, call `openLoanFile` with a GA owner lead → `ok:false` and **zero** insert attempts; CA owner lead → exactly one. *Sabotage:* make the gate return `ok:true` on refusal → red.
- **G3 — No short-circuit, no default jurisdiction:** every `openLoanFile(` call site passes a `source:` key; no `|| lead.state` / `?? lead.state` inside the jurisdiction resolution (same anti-sabotage shape as `scripts/verify-licensed-states.ts:42-45`, which caught `({ok:true} as any) || licenceCheck(...)`). *Sabotage:* default `j` to `{state: lead.state}` → red.
- **G4 — The input is the subject property** (extend `scripts/verify-licensed-states.ts:52-79`): `import-mismo` passes no `currentAddress` into the gate; the walk-in branch rejects a body with no property ZIP; keep the behavioural ZIP chain at `:118-144`. *Sabotage:* restore the mailing-address fallback → red.
- **G5 — The borrower never loses a document and never sees a 4xx for a licence refusal:** behavioural test of the refusal branch asserting 200, `held:true`, an object at the staging path, `raw.held_documents` grew by one, zero `loan_files` rows. *Sabotage:* return 403 instead → red. This red is what protects `app/file/[token]/page.tsx:91` from telling the borrower to resend.
- **G6 — `upload-url` creates nothing:** the file imports no creator (`:8`), and a POST carrying only a `fileName` against a lead token produces zero `loan_files` rows. *Sabotage:* re-add the promote → red.
- **G7 — Deletion survives a borrower tap:** `los_deleted_at` is erased nowhere in `lib/los.ts` and has ≥2 readers (`lib/selfheal.ts:34` + the gate). *Sabotage:* re-add `delete raw.los_deleted_at` → red.
- **G8 — One classifier:** no second purpose-derivation in `lib/los.ts` (no local `isBizPurpose`), `complianceFor` imports `loanPurposeClass`, and a table test over the cases where the two old implementations disagreed (blank occupancy + biz product; occ `"investment"`) shows both consumers now answering identically. *Sabotage:* reintroduce the old `:220` expression → red.
- **G9 — The stamp has readers:** `licence_block` is **read** in ≥2 files outside `app/api/apply/route.ts`. *Sabotage:* delete the LeadWorkspace band → red. (The current build has no such guard — `verify-licensed-states.ts:46` asserts only the write, which is why it stayed inert.)
- **G10 — Prove it in the hook, not just in npm:** stage a one-line neutering of the gate and confirm the hook prints `FAIL` and exits 1. A guard that reports red while the commit proceeds is a green light wearing a warning (`scripts/hooks/pre-commit:42-43`).

---

## 5. WHAT NOT TO DO

- **Don't gate at the insert** (`lib/los.ts:266`). It sees only `lead.state` (`:262`) — empty for walk-ins, the mailing address for MISMO. Refuses real CA files, passes a GA property.
- **Don't return `null` for a refusal.** Four callers already treat `null` as "insert failed" and would print "could not create loan file" — an unlicensed-origination refusal logged as a glitch.
- **Don't 4xx the borrower's upload.** `app/file/[token]/page.tsx:82-85`/`:91` converts any non-ok into "Please try again"; the document ends up emailed in or lost.
- **Don't delete the lead, the authorization record, or the PDF on refusal.** The PDF is the only evidence of what the borrower signed (`app/api/apply/route.ts:194-200`).
- **Don't revoke `raw.upload_token`** to stop the resurrection. It breaks the borrower's link in every legitimate case; the gate already refuses the create.
- **Don't let the healer "repair" a refused lead** by advancing it or counting a success. No human is in that path (`app/api/cron/heal/route.ts:11-16`).
- **Don't touch the wizard's state input.** `app/apply/form/page.tsx:1330` is already ZIP-only with the reasoning on the page (`:1306-1329`) and 32/32 green this read. Editing it re-opens a closed hole.
- **Don't widen the business-purpose regex to make the desk green.** The fix is occupancy synonyms in one classifier; loosening the product regex is how an owner-occupied bridge loses TRID.
- **Don't add a `loan_files`-shaped "pending" table.** No `loan_files`/`loan_documents` DDL exists in `supabase/migrations/` (14 files, none define them), so a migration is unverifiable from this tree. The lead row plus the private bucket hold everything the hold path needs.
- **Don't ship it advisory "for now."** That is precisely today's state: one write at `app/api/apply/route.ts:187`, zero reads.