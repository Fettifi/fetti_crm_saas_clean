# Architectural sweep — 2026-10-17

Ramon asked for an overall sweep of the build, the design architecture, the skills/memory machinery
and the security posture, measured against the thing he is actually trying to do:

> *"I am trying to replace myself and all functions and features of running this company while
> maintaining compliance and a human-like feel. So you need to make sure that you're building skills,
> maintaining memory, and keeping everything straight and improving yourself every day with every
> single action without me having to tell you, but you just understand that that's in your base code
> and that's in your base skill."*

This file exists because of [[findings-reported-into-chat-are-not-findings]] — 68 findings were once
reported into a chat window and lost to compaction, and 5 of the 6 later recovered had already been
fixed. **Findings are written here as they are found, with the read time, before they are summarised
to anyone.** A finding that lives only in a reply is not a finding.

Status: **IN PROGRESS.** Part 1 below is verified first-hand during the live desk run that opened this
session. Part 2 (the five-area audit and its adversarial verification) is appended when it lands.

---

## PART 1 — found live, 2026-10-17 05:26–05:33Z

Each item below was read first-hand in this session. Where a fact came from a prior read, it says so
and it was re-read before being written here, per [[state-decays-reread-before-you-report]].

### 1.1 — SEVERITY: CRITICAL · The production CRM repository is public

**Read live 2026-10-17T05:33Z**, unauthenticated, no token, no session:

| repo | result | last push | size |
|---|---|---|---|
| `Fettifi/fetti_crm_saas_clean` | **PUBLIC** — anonymous `GET /repos` returned 200 | **2026-10-17T05:19:49Z** | 25,756 KB |
| `Fettifi/fetti-leads` | **PUBLIC** | 2025-11-23T03:38:39Z | 23 KB |
| `Fettifi/fetti_crm_saas` | **PUBLIC** | 2025-11-23T05:50:04Z | 25 KB |

The first one is not dormant. `~/Desktop/fetti_crm_saas_clean_fresh` has
`origin git@github.com:Fettifi/fetti_crm_saas_clean.git`, and the 05:19:49Z push is **this session's
own website deploy**. So the live repository of a licensed mortgage brokerage's CRM — the system that
handles borrower NPI — is world-readable and took a commit minutes ago.

`verify-repo-visibility --audit` has already established there are no live secrets in the three repos,
which is the thing that would have made this an emergency rather than a serious exposure. It is still
a serious exposure: schema, RLS policy shape, API routes, validation logic and auth gates are a map
for anyone who wants to probe the deployed app.

**Why it has not been fixed, stated honestly:** there is no route to it that is not Ramon's password.
Checked this session — `gh` is not installed; `GITHUB_TOKEN` / `GH_TOKEN` / `FETTI_GITHUB_TOKEN` are
all unset; the git credential helper holds nothing; the remote is **SSH**, which carries `git push`
but cannot reach the REST API, so `PATCH /repos/{owner}/{repo}` with `private: true` is not available.
The GitHub web UI is the only route and it is sitting in **sudo mode with an empty password field** in
his Chrome at `github.com/Fettifi/fetti_crm_saas_clean/settings/set_visibility`. That is the one
boundary that does not bend ([[autonomy-granted]]: only passwords, money and third-party sends stop).

**Fix:** three visibility flips, ~60 seconds, tab already open. Do `fetti_crm_saas_clean` first — it
is the only one that is live.

### 1.2 — SEVERITY: HIGH · The desk cron was 1.8 days from silent expiry — FIXED THIS SESSION

`mail-watch` printed `🔴 THIS CRON EXPIRES IN 1.8 DAY(S) — 10/18/2026, 5:36:58 PM PT`. Recurring crons
auto-expire at 7 days, and the cron prompt itself carries the instruction *"When you see that warning,
recreate the job with this same prompt."*

The failure mode is the dangerous one and the brief names it: **the desk goes silent and the silence
looks like a quiet inbox.** Nothing distinguishes "no new mail" from "nothing is reading the mail."

**Fixed 05:27Z:** job `85952403` deleted, replacement created with the prompt recovered verbatim from
the transcript, same schedule (`7,22,37,52 8-19 * * *`).

**AND THE FIX BROKE THE ALARM, WHICH IS THE MORE USEFUL HALF OF THIS FINDING.** The replacement was
created **session-only**. Two consequences, neither visible from the "job created" confirmation:

1. A session-only job dies when the Claude session exits. The desk would have stopped at the end of
   this conversation rather than on 10/24.
2. Worse: `mail-watch`'s `deskLiveness()` reads its countdown out of
   `…/fetti-capital-ai/.claude/scheduled_tasks.json`, and a session-only job is **not written there**.
   Deleting the old durable entry emptied the file, so the next run printed
   `⚠ no recurring task found in scheduled_tasks.json — the desk may already be dead` — and would have
   printed it on every run from then on. **A death alarm stuck permanently ON is a desk with no death
   alarm**, because the one state it can no longer express is the true one.

Caught by re-reading the file instead of trusting the creation confirmation
([[things-that-look-like-they-work]]). Re-created durable as `fb3905b3`; verified by running
`mail-watch` again — `[desk] cron life: 7.0d remaining (auto-expiry 10/23/2026, 10:35:22 PM PT)`.
The `durable: true` requirement and the reason for it are now written into the cron prompt itself, so
the next recreation carries it.

**The structural finding stands, though, and the fix above does not address it.** The desk's liveness
still depends on someone noticing a warning line inside a 40-line report, during a 3-day window, in a
session that happens to be running. The scheduler is a monitored dependency with no independent
monitor. Carried into Part 2.

### 1.3 — SEVERITY: HIGH · Michigan: three legs, and the one underneath was mis-counted

`licence-watch` tracks the Michigan MLO bond ($187.50, due **2026-10-20 — 3 days**) and the 2027 NMLS
renewal ($150 + $35). Both are held **against the entity**. The entity's standing, read live off the
MiBusiness Registry Portal at **2026-10-17T05:31Z**:

```
FETTI FINANCIAL SERVICES LLC · Entity 802886785 · Foreign LLC (California)
Entity Status  Active
AR Standing    NOT GOOD
AR Due Date    02/15/2024
Inactive Date  03/01/2026
Resident Agent ARMAND VELARADO, 65 SOUTHBOUND GRATIOT, MOUNT CLEMENS MI 48043
```

Paying the bond and attesting the renewal against an entity in this state does not produce a licensed
Michigan brokerage — it produces two paid obligations hanging off an entity that cannot hold them.
All three must be true on the same day.

**Two defects found, both corrected in `~/.claude/bin/licence-watch.mjs` this session:**

**(a) The remedy is bought and stalled, and nothing tracked it.** Michigan Registered Agent, LLC has
been engaged to file the reinstatement and has written **four times** — 10/06, 10/09, 10/12, 10/16,
identical subject — saying only *"we still need some information from you."* **Which** information
appears in none of the four. Eleven days, no deadline stated, no money attached, so nothing forced it
up any list. Found by `licence-watch`'s own not-yet-in-the-table sweep, which flagged the sender as one
nothing in the table came from — **the sweep caught what the table could not.** Now row
`mi-entity-reinstatement-2026`. This also supersedes the existing row's line *"THE FILER IS NOT OUR
AGENT AND CANNOT FILE THIS"*: a filer **is** engaged.

**(b) The delinquency was under-counted, and the row contained its own refutation.** It read
*"UNFILED FOR TWO CONSECUTIVE YEARS (due 2/15/2025 and 2/15/2026)"* while carrying `AR due 02/15/2024`
in its own `pay` field, read off the registry the day before. Michigan's AR Due Date is the **oldest**
unfiled statement, so **three** are owed: 2/15/2024, 2/15/2025, 2/15/2026.

This is [[verified-the-check-never-read-the-value]] exactly — the instrument was sound and nobody read
the value. And the consequence is the nasty kind: filing only 2025 and 2026 costs the fee, returns a
confirmation, and leaves the entity exactly as delinquent as before. **The failure would have looked
like a success** until the next DIFS read.

Recorded to the fact ledger under `Fetti Financial Services LLC — Michigan / entity standing`.

### 1.4 — SEVERITY: MEDIUM · The quarantine perimeter ate four regulator notices

Already known and already carried by `quarantine-watch`'s licence tier, but it belongs in a security
sweep because of what it implies rather than what it is: **four NMLS/DIFS renewal notices were held in
quarantine and none reached the inbox.** Anything in this architecture that assumes *"we would have
heard"* about a licence obligation is unsafe while that is true, and the Michigan finding above is a
direct instance — the regulator wrote, repeatedly, and the perimeter ate it.

The structural point for Part 2: **the mail perimeter is a single point of failure with no independent
corroboration.** `licence-watch`'s obligation table is currently the only thing that would notice a
deadline nobody was told about, and it only knows the rows someone entered.

---

## PART 2 — the five-area audit

Five independent auditors read the live tree — architecture, security, the autonomy loop, compliance,
and the gap to "replace myself". They raised **28 findings**. Every non-trivial one was then handed to
a separate agent whose instructions were to **refute** it, defaulting to *not upheld* where it could
not be independently confirmed from the tree. **15 survived; 13 were refuted or already fixed.**

That ratio is the point of the exercise. Several of the refuted findings were confident, well-written
and wrong — a fabricated borrower-harm code path, a claimed service-role credential leak, a claimed
live anon-insert path. Had they been reported unchallenged they would have sent real work in the wrong
direction. The controls here were better than the audits credited.

Independent corroboration worth noting: the auditors reached Part 1's public-repo finding by a
different route (running `verify-repo-visibility.mjs`) than the live API read above. Two methods, same
answer.

---

**Read 2026-10-17T05:57Z.** Every claim below was verified against the live tree in this session. Where the five audits were wrong, I say so.

---

### 1. THE DIRECT ANSWER

**Yes, the method is right, and the build is further along than most production systems I read.** The thing that is genuinely unusual here is not the volume of code — it is that your guards are built to *fail on purpose*, and several of them carry the story of the real loss that created them. `scripts/verify-rls-lockdown.ts:104` records that its first version asserted the *opposite* condition and passed on a correct schema. `scripts/verify-hook-wired.ts` strips comments before matching because version one matched its own prose and stayed green after you deliberately unwired a guard to test it. Commit `6518f51` is literally *"hook: wire verify:brand-palette (verify:hook-wired caught it unwired)"* — the meta-guard catching a real regression, unprompted. That is the standing rule actually executing, not described. And the lending footprint is **derived, never retyped**: `lib/lendingMatrix.ts:27` holds `CONSUMER_STATES` once, `lib/licensedStates.ts:19` imports and derives from it, and the guard asserts both that the import exists *and* that the file does not hardcode its own list. That is the correct shape for every rule in this system, and it already works.

**What is structurally at risk is not intelligence — it is enforcement placement and survivability, and there are exactly three facts behind that.** First: **your CRM source is a public GitHub repository right now.** `fetti_crm_saas_clean`, 25.8 MB, pushed today, zero unpushed commits — I ran your own `verify-repo-visibility.mjs`, and it has been telling you this. Second: **the licence footprint refuses nothing, anywhere in the tree.** It is advisory at every door. The Georgia FHA application is not blocked at `/api/apply` — it is *stamped and processed*, and six separate code paths open a loan file with no check at all, one of them triggered by a borrower's own document upload with no human present. Third: **all 130 guards run on this one laptop's pre-commit hook; zero run in CI.** Every path meant to scale past you — a worktree, a cloud session, a commit from the browser, a second machine — is a path that reaches production unchecked. You are not blocked by the agent being insufficiently capable. You are blocked by controls sitting on the wrong side of the acts they govern, on one machine.

---

### 2. WHAT TO KEEP

A rebuild would destroy these. Do not let anyone refactor them away.

- **Guards engineered against their own failure modes.** `scripts/verify-rls-lockdown.ts` asserts `parsedCreates > 0` as an anti-vacuous companion, and its `--live` path refuses to print success unless a service-role count proves the table actually holds rows — so a zero-row anon read on an empty table exits 2 instead of green. `scripts/verify-licensed-states.ts:43-45` specifically defeats a `const lic = ({ok:true} as any) || licenceCheck(...)` sabotage by requiring the bare assignment. These were made to fail on purpose. That is the rarest thing in the build.
- **Derive-never-retype on lending rules.** `lib/lendingMatrix.ts:27` → `lib/licensedStates.ts:19`. One definition, a guard on the import. This is the template for every rule you add.
- **The lib/UI boundary is genuinely held.** `app/apply/form/page.tsx` is 1,613 lines and contains **zero** qualification math — its only lending imports are `zipToState` and the authorization text. `components/los/IncomeQualifier.tsx` imports `maxHousingPayment`, `dscrExact`, `miAnnualFactor`, `FHA_UFMIP_PCT` from `lib/income` rather than restating them. For a system with this much money logic, that is discipline.
- **One Supabase client construction site** in the whole app (`lib/supabaseAdminClient.ts`), across 221 routes and 175 components. It is why finding #5 below is a single-file fix instead of a 150-file migration.
- **The `MANUAL` registry pattern** at `scripts/verify-hook-wired.ts:24-28` — enumerate the surface, allowlist exceptions *with a written reason*, make a stale exemption its own failure. **This is the single most valuable pattern you have built, and it is applied in exactly one place.** Sections 3 and 5 are mostly about copying it.
- **`docs/application-audit-findings.md`** — it carries the reason it exists (*68 findings reported into a chat message and written to nothing*) and re-verifies its own status against live code rather than carrying forward stale claims. That is the right destination for everything below.
- **Memory keyed to MOMENTS, not topics.** The `MEMORY.md` preflight table fires on "about to click BLOCK" and "writing 'say the word'" rather than filing knowledge under subjects you would have to think to look up. With `recall.mjs` as lexical retrieval behind it — exact matching on loan numbers and surnames, no network, no spend — this is the correct architecture for an operating memory. `verify-skills.mjs` runs CLEAN: all 17 skills load and every script they name exists.
- **All 20 cron routes fail closed.** `if (!secret || auth !== Bearer ${secret}) return 401` — unset `CRON_SECRET` means 401, not open. Zero misses across all 20.
- **`~/.claude/.gitignore` is deny-by-default** (`/*`, then re-allow only `/skills`, `/projects/*/memory`, `/CLAUDE.md`, `/scripts`, `/hooks`), and it documents that later rules win so a new re-allow must go *above* the denial block. A new folder in `~/.claude` is ignored automatically. This is the right instinct and it is why your memory repo is private.

---

### 3. THE TOP FIVE, RANKED BY LEVERAGE

#### #1 — Your CRM source is public on GitHub. Fix today.
**This was not in any of the five audits.** Your own guard found it.

`git remote -v` in `/Users/fetti/Desktop/fetti_crm_saas_clean_fresh` → `git@github.com:Fettifi/fetti_crm_saas_clean.git`. I ran `node /Users/fetti/.claude/bin/verify-repo-visibility.mjs`:

```
PUBLIC fetti-leads                23K  pushed 2025-11-23
PUBLIC fetti_crm_saas             25K  pushed 2025-11-23
PUBLIC fetti_crm_saas_clean    25889K  pushed 2026-10-17
```

`git log origin/main..HEAD` returns 0 — the live tree is fully pushed. Anyone can read all 221 routes, the lending matrix, your guard scripts, and `proxy.ts:116`, which is the complete list of the 42 API prefixes that require a session. Publishing that list tells a reader precisely which prefixes are gated, and by subtraction which of the other 99 are not. It compounds #3 directly.

**Why it matters:** NMLS #2267023 and DFPI #60DBO-153798 are examinable. "Our borrower-facing loan origination system's source is world-readable" is not a conversation to have with a DFPI examiner, and your memory already holds the label `[[a-private-company-had-a-public-repo]]` — the lesson was learned and the condition came back.

**Already mitigated, so do not panic:** I re-ran `--audit` (the guard flagged itself stale because of today's push). Verdict: **no live critical secret in any public repo's history**, 7 known-leak probe paths × 3 repos, all clean. This is exposed *source*, not exposed *credentials or borrower data*.

**Fix:** three repos → Settings → General → Danger Zone → Change visibility → Private. Then wire `verify-repo-visibility.mjs` into `desk-run.mjs`'s `READS` array so it cannot silently drift back — it is on disk and the desk does not run it. **Size: 5 minutes, plus 10 to wire the watcher.**

#### #2 — The licence footprint refuses nothing, at any of six doors, and the verdict it writes is read by nothing.
`licenceCheck` has exactly one calling module: `app/api/apply/route.ts` (import `:8`, calls `:185` and `:436`).

**The audit's premise is wrong in your favour, and that is bad news.** It claims a Georgia owner-occupied FHA application is "correctly blocked at /api/apply". It is not blocked. The only refusal in that route is 422 for a missing signature (`:165-168`). For an unlicensed consumer state it stamps `rawBody.licence_block` at `:187`, softens the alert copy at `:436-441` — **and proceeds.** The lead is written, the signed borrower authorization is captured and rendered to a PDF in the loan-docs bucket (`:181-215`), the lead advances, and the auto-responder fires. The application is being *taken* in a state with no consumer licence.

Then the stamp is inert. `grep -rn licence_block app lib components` returns **one write** (`:187`) and zero reads. Nothing renders it — not the LOS header, not the leads row.

And six paths open a loan file with no check at all:
- `app/api/los/files/route.ts:58` (both LOS UI buttons)
- `app/api/underwriter-desk/route.ts:153`
- `app/api/los/import-mismo/route.ts:111`
- `lib/selfheal.ts:42` — the autonomous healer, no human
- `lib/los.ts:380` `promoteLeadToLoanFile` ← `app/api/file/[token]/upload/route.ts:30` and `upload-url/route.ts:21` — **a borrower's own first document upload opens the loan file unattended.** That path needs no you, no teammate, no agent. It is exactly the operating mode you are building toward.

There is also a **second, diverging classifier**: `lib/los.ts:212-219` computes `isBizPurpose = investorOcc || (bizProduct && !consumerOcc)`, which falls toward *business-purpose* on blank occupancy and strips TRID milestones off the file. `lib/licensedStates.ts:43-55` falls the other way, toward consumer, and documents why: *"which way to fail: toward flagging."* Two routers, opposite defaults, one of them in the file the fix must gate.

**Why it matters:** unlicensed origination is not a bug report, it is an enforcement action against #2267023 and your own #2235992. Consumer lending is CA/FL/MI only. You cannot let an agent convert leads while the gate sits on the wrong side of the act.

**Fix:** (1) Call `licenceCheck` inside `createLoanFileFromLead`/`promoteLeadToLoanFile` in `lib/los.ts`, so all six paths inherit it instead of each route remembering. (2) **Do not return `null` on refusal** — `lib/selfheal.ts:42` swallows it in a bare `catch {}` and would retry forever (your own `[[a-retry-loop-that-cannot-succeed]]`), and in the borrower-upload path a null drops their document. Write a durable, visible refused state and stop retrying. (3) **Reg B:** the application has already been received with a signed authorization, so you owe notice within 30 days — incompleteness, adverse action, or withdrawal. A blocked button with no decline-or-refer-out record trades a licensing exposure for an ECOA one. The gate must *create* that action. (4) Reconcile the two classifiers to one. (5) **Settle one open question first:** `licenceCheck` is fed the wizard's single `state` field (`:37`, `:238` → `lead.state`). Licensing turns on the **subject property's** state. `createLoanFileFromLead` carries both `property_address` and `state` (`lib/los.ts:252-258`). If that field is the borrower's mailing state, the gate is checking the wrong jurisdiction in both directions. (6) The audit's proposed test is not feasible — `verify-licensed-states.ts` has no Supabase. Assert the gate at the lib boundary instead, plus a static assertion that *every* caller of those three functions is downstream of it, so a seventh unguarded route cannot be added silently. **Size: half a day, plus the Reg B decision.**

#### #3 — 130 guards run on one laptop. Zero in CI. And they compare lists to each other instead of enumerating what exists.
Two halves of one problem; this is the compounding one.

**Half one — placement.** I computed it: 130 `verify:*` scripts, **127 named in `scripts/hooks/pre-commit`, 0 named anywhere in `.github/`.** `.github/workflows/verify-build.yml` is checkout, setup-node, `npm ci`, `npm run build`. Nothing else. The hook is armed only by hand — `package.json:51` has `"hooks:install"` but there is no `prepare` or `postinstall`, so a fresh clone or worktree arms nothing and every guard silently does not exist.

**Half two — shape.** `scripts/verify-auth-gate.ts:18-19` reads exactly one file (`proxy.ts`) and never opens a single route file. It prints `PASS ... 42 routes double-listed`. Measured against the tree: **221 route files, 122 covered by an `apiProtected` prefix, 99 outside the session gate.** Most are legitimately public with their own auth — but that is documented *only in prose comments*, which no guard reads. I scanned the 99 for auth signals and got 47 with none detectable; I hand-read the scariest and they were fine (`app/api/portal/data/route.ts:12` verifies a signed httpOnly cookie and its comment names the IDOR it fixed; `app/api/proof/submit/route.ts` is deliberately public behind a rate limit and an admin-approval gate). My heuristic undercounted because each route names its own helper. **That is the finding: today the auth mechanism is legible only to a human reader.** At 400 routes nobody will read them.

Same shape in RLS. `scripts/verify-rls-lockdown.ts:61-65` iterates a 14-entry hand-written `PROTECTED` array. The decisive line is the filter — `holes = [...live.values()].filter(p => p.permissive && PROTECTED.includes(p.table))` — so a permissive policy on a table *outside* that array is parsed and then **discarded**. The replay reads only `supabase/migrations`, never `supabase/schema.sql`, whose lines 37, 38 and 54 create three `with check (true)` insert policies that no migration ever drops.

Worse than the audit reported: `scripts/hooks/pre-commit:60` triggers `verify:auth` only when the staged diff mentions `proxy.ts` or the guard itself. Adding `app/api/payoffs/route.ts` does not merely pass the guard — **it never invokes it.**

**Fix:** copy `verify-hook-wired.ts:24-28` onto both. (1) `verify:auth-gate`: glob `app/api/**/route.ts`; require every route to be in `apiProtected` *or* in a new `PUBLIC_BY_DESIGN` registry naming its actual mechanism (`cron:CRON_SECRET`, `token:HMAC`, `cookie:portalSession`, `genuinely-public`). A new route then defaults to FAIL. Also widen the pre-commit trigger to `app/api/`. (2) `verify:rls`: derive the table list from the live project's OpenAPI root **unioned with** the `create table` statements `scripts/verify-supabase-grants.ts:92-101` already parses (the OpenAPI document reflects grants, so a newly created table with no grant is invisible there too), add `schema.sql` to the replay, and assert **"RLS is ENABLED on this table"**, not only "no permissive policy survives" — a table created by hand in the dashboard has RLS off with no policy at all, which the current replay reads as clean. (3) Add a `verify` job to CI running the full suite on PR, and a `prepare` script so a clone arms the hook. Prove each by adding a throwaway open route and a throwaway permissive policy and watching both go red. **Size: 1 day. Highest compounding value in the list.**

#### #4 — The desk that does the replacing cannot survive this laptop.
`/Users/fetti/.claude/bin`: 102 scripts, 30,132 lines, 50 commits, **no git remote**, **no hooks** (`core.hooksPath` unset, `.git/hooks` empty), and **51 scripts carrying `--selftest` with no runner to invoke them.** The CRM has 130 guards and a meta-guard; the desk that actually operates the company has zero.

And it cannot simply be pushed: the history carries borrower NPI. `git log -p --all` surfaces `"Timothy Bryant"`, `gatorwealth@gmail.com`, `isaacodell@gmail.com`, `crystalgrealestate@gmail.com`, and street addresses (`38 Cane Brook`, `N Temple PA`) in commit bodies and code comments. The correct instruction for exactly this was already written in `~/.claude/.gitignore` and never applied to `bin`'s own repo.

**Why it matters:** one SSD failure costs 30,000 lines of operating logic, 51 self-tests, and the entire desk. "Replace myself" currently means "replace myself on this specific Mac."

**Fix:** (1) A `run-selftests.mjs` that discovers every `--selftest` and runs it — a wrapper, not new tests. (2) A pre-commit hook in `bin` that runs it plus a borrower-PII refusal on staged content, so no future commit adds NPI. (3) A **private** remote; scrub or squash the history that carries names first (`git-filter-repo`), because pushing as-is puts borrower NPI on GitHub even in a private repo. **Size: half a day.**

#### #5 — Every database read in the company runs through 36 lines that fail open and are typed `any`.
`lib/supabaseAdminClient.ts`: `let supabaseAdmin: any;` at line 7, and when either env var is missing it substitutes a mock. The mock implements six builder methods — `select`, `single`, `insert`, `update`, `delete`, `eq`. The codebase calls `maybeSingle`, `order`, `limit`, `gte` and others on these chains hundreds of times. **150 modules import it.** So a misconfiguration answers `{data: null, error: "Supabase Admin Client Disabled"}` on some paths and throws `TypeError: .maybeSingle is not a function` on others, and the `any` type means nothing can catch it at build time. There are 152 npm scripts and not one runs `tsc`.

**The audit called this critical on two pillars that are both false, and I confirmed the refutations myself** — see section 4. It is a robustness defect, not an exposure. Real, worth fixing, not an emergency.

**Fix:** (a) add `import "server-only"` (already a dependency, `package.json:180`). (b) Fail closed — but **lazily**, via a Proxy or getter, *not* a module-scope `throw`. 150 importers include the public marketing pages that carry your NMLS and licence disclosures; a module-scope throw executes during `next build` prerendering and takes the compliance disclosures dark along with the CRM. (c) A guard asserting the client/server boundary, which is the genuinely absent half. Skip the `any`→typed change for now: `next.config.mjs` sets no `ignoreBuildErrors`, so `next build` type-checks and retyping the export surfaces errors across 150 files. **Size: 2 hours for (a)+(b)+(c).**

---

### 4. SECURITY

**One thing is live and should be fixed today:** the public repos (#1). Exposed source, not exposed credentials — the secret probe is clean.

**Already mitigated — do not spend worry here:**
- **RLS is proven against production**, not asserted. `verify:rls-live` prints the true service-role row count beside every anon read (leads 219, loan_documents 825, activity_log 26,559) and anon reads **zero** from all of them. The `--live` path refuses to call a zero-row table clean.
- **The service-role key cannot reach a browser.** `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js never inlines it into client bundles — it resolves to `undefined` there. A client import would activate the *mock*, not disclose the key. The "credential in browser JS" scenario is structurally impossible by this path.
- **Zero client components import a service-role-tainted module**, and it was engineered that way on purpose: `lib/fileLiveness.ts:32`, `lib/continuity.ts:1-12` and `lib/rateEstimator.ts:7` all carry comments explaining they were kept pure for exactly this reason.
- **The portal IDOR is fixed.** `app/api/portal/data/route.ts:12` authorizes on a signed httpOnly cookie for that cookie's own `leadId`, not a URL parameter.
- **All 20 cron routes fail closed.**
- **The three `with check (true)` policies in `schema.sql` are latent, not live.** `automation_queue`, `referrals` and `verifications` do not exist in the production project (PGRST205). `schema.sql` was never applied there. It is a rebuild hazard — real, and fixed by deleting those demo policies and adding the file to the replay — not an open insert path. The audit's claim that "anyone with the public key can insert rows into the outbound message queue" is **false.**
- **Your memory repo is private** (`fetti-claude-memory` does not appear in the public list), and the corpus is clean: zero SSN patterns across 378 files, one consumer email address total.

**Real residue, in order:** 99 routes whose auth mechanism exists only in prose (#3); the admin client failing open (#5); borrower NPI in `bin`'s git history, which is what blocks backing the desk up at all (#4).

**Briefly, on the 13 refuted/already-fixed findings:** they were checked and dismissed. The ones I re-verified myself are the three above — the service-role credential leak, the client-bundle leak, and the live anon-insert path — none of which exist. One audit also fabricated a borrower-harm path (`if (!documents?.length)` appears nowhere in the repo; that chain throws before reaching it) and inflated several grep counts. Your controls were better than the audits credited.

---

### 5. THE AUTONOMY LOOP

**Does it compound? Partly — and the evidence that it does is real.** Commit `6518f51` is the meta-guard catching a guard you left unwired. `verify-skills.mjs` runs CLEAN across all 17 skills. 127 of 130 guards are hook-invoked, the 3 exceptions are declared MANUAL with per-entry reasons, and a guard enforces that registry. The memory index is keyed to *moments* rather than topics, which is the hard part and you got it right.

**It breaks in three specific places as it scales.**

**(a) The index is 83% full and the overflow is silent.** `MEMORY.md` is **17,035 of 20,480 bytes — 3,445 left** — against 378 memory files and 3.2 MB of corpus. The file's own header says over the cap *"the loader truncates, LAST go."* So the failure mode of learning one more lesson is that an older trigger stops firing, with no error. Every new lesson now competes for 3.4 KB against every existing one. This is the hard ceiling on the whole loop.

**(b) Lessons land as prose unless someone remembers to wire them.** Your rule says convert learning into something that RUNS. `zoom-watch.mjs` is the counterexample and it is damning: 16 `*-watch.mjs` files on disk, 40 scripts named in `desk-run.mjs`'s `READS` array, and **`zoom-watch.mjs` is invoked by nothing.** It was built from your own spoken instruction. `READS` is a hand-maintained array with no coverage check — the identical failure mode `verify-hook-wired.ts` was written to end, never applied to the desk.

**(c) Findings still evaporate.** `docs/application-audit-findings.md` exists and is honest, but five audits just produced their findings into a chat transcript, which is precisely the loss your `[[findings-reported-into-chat-are-not-findings]]` label records (68 findings reported into chat, 1.5 GB of JSONL mined to recover six, five of which were already fixed).

**The one change that most improves the self-improvement rate: make every registry enumerate its own surface.** Concretely, the first instance: a `verify-desk-reads.mjs` asserting that every `*-watch.mjs` on disk appears in `READS` or in a MANUAL registry with a written reason. It would have caught `zoom-watch` the day it was written. Then the same shape on `apiProtected`, on `PROTECTED`, and on the skills registry. **That is the change that converts "I must remember to wire it" into "it fails until wired" — and it is the difference between a system that compounds and one that accumulates.** You have already built the pattern once and proved it catches real regressions; it is applied in one place out of five where it belongs.

Second, smaller: the index cap needs a pressure valve before it needs one urgently. Make `verify-memory-index.mjs` fail at **90%**, not at 100%, so you get warning instead of silent truncation — and have it enforce that any trigger it cannot fit is retrievable by `recall.mjs`, which you already have the machinery for.

---

### 6. THE NEXT THREE BUILDS

**Build 1 — Private the repos, then wire the watcher that keeps them private.** (~15 min + 10 min)
Three repos to private; add `verify-repo-visibility.mjs` to `desk-run.mjs`'s `READS`.
**Unlocks:** removes the only live external exposure, and makes #4 possible — you cannot safely give the desk a remote while the org's default posture is public.

**Build 2 — Move the licence gate onto the act, and give it a Reg B exit.** (~half a day)
`licenceCheck` inside `lib/los.ts`'s three file-creation functions; a durable refused state instead of `null`; `licence_block` rendered on the LOS header and the leads row; the two classifiers reconciled; the property-vs-mailing-state question settled first.
**Unlocks: autonomous lead conversion.** This is the gate on "replace myself" for origination. Until the refusal lives on the act, no agent — and no borrower upload at `app/api/file/[token]/upload/route.ts:30` — can be allowed to open a file unattended.

**Build 3 — Guards in CI, registries that enumerate, `prepare` to arm the hook.** (~1 day)
A `verify` job on PR; `PUBLIC_BY_DESIGN` for routes; live-table derivation plus `schema.sql` plus an RLS-enabled assertion for tables; `verify-desk-reads.mjs`; widen the pre-commit trigger to `app/api/`. Prove every one by breaking it on purpose.
**Unlocks: a second machine.** A worktree, a cloud session, a browser commit, a teammate. Today all four deploy unchecked, so the autonomy claim is true on exactly one laptop. After this it is true anywhere.

Then fold #5 in behind them — it is two hours and no longer urgent once it is understood as robustness.

---

### 7. WHAT SHOULD NEVER BE AUTOMATED

Not "too hard." These are the ones where automation transfers a licensed human's legal accountability to a system that cannot hold it.

1. **The ability-to-repay determination.** ATR/QM is a reasoned judgment a licensed individual makes and stands behind. The agent should assemble every input, show the math, and flag the thin spots — the conclusion carries MLO #2235992 and must be yours.
2. **The decision to decline.** An agent may detect ineligibility, draft the adverse-action notice, and start the 30-day clock — but a human decides, because ECOA liability attaches to the decision and a declined borrower is the single most likely source of a complaint. Corollary, and it cuts the useful way: **an agent may autonomously REFUSE and must never autonomously APPROVE past a refusal.** Refusing is safe; overriding is not.
3. **Signing as Ramon.** Your e-signature and your NMLS number on anything. The agent prepares; you sign. Typing a credential is already your stated boundary — this is the same boundary wearing a different hat.
4. **The borrower's letter of explanation.** Their words, their voice, plain paper, no Fetti letterhead or NMLS. An agent writing a borrower's LOE manufactures evidence, and an underwriter who notices is right to.
5. **Anything that crosses from estimate to disclosure.** The pricer output is an ESTIMATE. A Loan Estimate is a federal disclosure with TRID timing, tolerance cures and liability. An agent may produce the first and must never be able to emit the second unreviewed — the structural distinction your `price-the-loan` skill already draws is the right one; keep the hard stop.
6. **Money movement and wire instructions.** Never generated, never altered, never confirmed by an agent. Wire fraud in this industry runs on exactly the plausible, well-formatted message an agent is best at producing.
7. **Deleting or altering anything in a loan file.** Records are the audit trail. An agent may add and supersede; only a human removes, and ideally nothing is ever removed.
8. **Any communication with a regulator or examiner.** DFPI, NMLS, a state examiner, a subpoena. The agent assembles the response packet; a licensed human sends it.

Everything else — the sweeps, the document chasing, the condition uploads, the pricing runs, the lock watching, the licence deadlines, the pipeline hygiene, the inbox at >95% confidence on factual recoverable answers — is fair game, and that is most of the job.

---

**One closing note, per your own standing rule:** this review is currently a chat message, which is the exact shape of the 68-findings loss. Before this session compacts, the five items in section 3 belong in `/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/docs/application-audit-findings.md` as rows with their file:line evidence and a status column. I was read-only for this pass and did not write them — that is the first thing to do with this document, ahead of Build 1.

---

## PART 3 — what was executed, 2026-10-17 06:00–06:10Z

A ranked list is authorization to execute it, so the items that needed no credential, no money and no
third-party send were done in this session rather than handed back. What follows is what changed, and
what was *verified* rather than assumed.

### Done

**§5's top recommendation — `verify-desk-reads.mjs`.** Every `*-watch.mjs` on disk must now appear in
`desk-run.mjs`'s `READS` or in a `MANUAL` list with a written reason. The claim was verified
independently before acting: 16 watchers on disk, 15 wired, `zoom-watch.mjs` alone running nowhere.
12 selftests, each one a sabotage, plus **proof against the real tree** — removing the `zoom-watch`
line turns the guard red, restoring it turns it green. The guard is itself wired into `READS`, so it
runs three times a day.

Writing the sabotage cases first caught a defect in the guard itself: `audit()` called `fs.existsSync`
directly, reaching past its own arguments into the live bin, so three cases failed against synthetic
names. `exists` is injected now. A check that cannot be tested cannot be trusted to fire.

**`zoom-watch` wired, not exempted.** It reads RED (exit 1, NOT CONFIGURED) until a Zoom
Server-to-Server OAuth app exists and three values are in `~/.claude/state/zoom.env`. Exempting it
would have recorded that gap in a file nobody opens; wiring it prints the three setup steps on every
desk run. **The rule this sets: exempt a watcher because it SHOULD NOT run, never because it currently
fails.**

**§5's second recommendation — the memory index gate.** `verify-memory-index` only failed at 100% of
the 20,480-byte cap, where the loader has already begun truncating silently, last entries first. A
second gate now fires at 90%. Sabotage-proven, and the demonstration is the exact one that matters:
padded to 18,615 bytes, the **old** check still printed ✅ at 90.9% while the new gate went red. Index
restored and now 17,247 / 20,480 = 84.2%, 1,185 bytes of runway.

**The two desk findings from Part 1** — the durable cron and the Michigan rows — are committed as
`bb08d3f` in `~/.claude/bin` (no remote, by rule).

### Correction to the audit

**§3 #1's closing claim is wrong:** *"wire `verify-repo-visibility.mjs` into `desk-run.mjs`'s `READS`
— it is on disk and the desk does not run it."* It **is** wired, at `desk-run.mjs:367`, and it has been
running and reporting red — `desk-cron --check` lists `repo-visibility` among the red reads. The
finding that the repos are public is correct and was reached twice by two methods; the remediation
step attached to it was not. Verified before acting on it, which is why nothing was done twice.

### Not done, and why

**The three repos are still public.** No route exists that is not Ramon's password: `gh` is not
installed, `GITHUB_TOKEN`/`GH_TOKEN`/`FETTI_GITHUB_TOKEN` are unset, the git credential helper is
empty, and the remote is SSH — which carries `git push` but cannot reach the REST API, so
`PATCH /repos/{owner}/{repo}` is unavailable. The web UI is the only route and it sits in sudo mode
with an empty password field.

**Builds 2 and 3 are not started.** Build 2 (the licence gate on the act) turns on a question only
Ramon can settle — whether the `state` field fed to `licenceCheck` is the **subject property's** state
or the borrower's mailing state. `lib/los.ts:252-258` carries both. If it is the mailing state the
gate is checking the wrong jurisdiction in both directions, and moving an incorrect gate closer to the
act makes it worse, not better. That question is also upstream of the Reg B decision, since a refusal
must create an adverse-action or incompleteness record rather than a dead button.

### The four registries that still need the pattern

This is the shape §5 says governs the compounding rate, and it is applied in two places out of six:

| registry | where | surface it fails to enumerate |
|---|---|---|
| `apiProtected` | `proxy.ts:116` | 221 route files; 99 sit outside the session gate, auth legible only in prose |
| `PROTECTED` | `verify-rls-lockdown.ts:61-65` | 14 hand-written tables; a permissive policy on any table outside the array is parsed and then **discarded** |
| skills | `verify-skills.mjs` | proves listed skills load; does not prove every skill on disk is listed |
| `READS` non-watchers | `desk-run.mjs` | `verify-desk-reads` covers `*-watch.mjs` only — a stated limit, not silent coverage |

Recorded as the memory `a-registry-must-enumerate-its-own-surface`.
