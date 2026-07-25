# INCOME-DOCUMENTATION METHOD REFERENCE — single source for `lib/income/programs.ts`

Scope note for the engineer: keys are METHOD ids, not program marketing names. A program = family + method + gates. Full-doc non-QM / expanded-ratio jumbo reuses agency methods 1–14 unchanged (only DTI/feature tolerances move). ITIN is an identity feature, never a method — an ITIN file routes to whichever method its docs support. Non-warrantable condo is a collateral overlay — it NEVER changes the income method.

---

## SECTION 1 — METHOD TABLE

Each entry: **id** | qualifies-as-income | requiredDocs | calc (deterministic, standard numbers) | neverDemand (QC hard list) | qc (doctrine paragraph).

### CONSUMER FULL-DOC CALCULATORS (families: agency DU/LPA, FHA, VA, USDA-repayment, full-doc non-QM — parameterize by family)

**1. `W2_BASE`** — fixed salary or fixed-hourly W-2 wages.
Docs: paystub(s) covering 30 days w/ YTD; W-2s 1–2 yrs per AUS findings; VVOE ≤10 business days before note (VA active duty: LES ≤120 days); Form 1005 WVOE may substitute for paystub+W-2.
Calc: salary/12. Hourly: rate × scheduled hrs × 52/12. Biweekly salary: pay × 26/12; semi-monthly × 24/12. Sanity: YTD ÷ elapsed months must support the rate; if YTD undershoots, investigate hours — never silently average a fixed salary. Raises effective from start date; never average down with prior year.
NeverDemand: tax returns/transcripts for pure W-2; 2 yrs same employer; 2 yrs of W-2s when AUS grants 1.
QC: Check pay-rate math, YTD consistency, VVOE recency. Do NOT flag job changes in same field (job-change≠break doctrine), education-as-history (transcripts count), or absence of returns. Gaps ≥6 months need 6 months on new job; short gaps need only an LOE.

**2. `W2_VARIABLE`** — OT, bonus, commission (ANY %), tips, shift differential, fluctuating hourly.
Docs: paystub 30 days with per-type YTD breakout; 2 yrs W-2s or 1005 breaking out types; VVOE.
Calc: per component: (Yr-2 + Yr-1 + YTD) ÷ total elapsed months. Stable/rising → average. Declining → lower of most-recent-12-mo average or YTD average; sharply declining → unusable. <12 months history of a component → unusable (FHA: OT/bonus need ≥1 yr). Never annualize a partial-year spike. Base is computed under W2_BASE, never blended in.
NeverDemand: tax returns because commission ≥25% (rule dead for agency AND FHA); unreimbursed-expense deductions.
QC: Verify per-component trending and that base was not averaged. Flag declining components computed at the flattering average. Do not flag multiple staffing-agency W-2s as instability — trend combined earnings.

**3. `W2_SECONDARY_SEASONAL`** — second/part-time/seasonal jobs; seasonal unemployment for documented seasonal workers.
Docs: paystubs+W-2s per job; VVOE each employer; seasonal: rehire expectation letter; seasonal unemployment: 2 yrs on returns.
Calc: each job under its own rules; seasonal = 24-mo total ÷ 24; sum jobs.
NeverDemand: nothing beyond per-job packages; never treat the second job's existence as a defect against primary income.
QC: <12 months on a part-time job → income unusable but file not defective. Never annualize seasonal as year-round.

**4. `SE_SCHEDULE_C`** — sole prop / 1099 filer with ≥25% ownership; cash flow per Form 1084/91.
Docs: 1040s w/ all schedules, 1 or 2 yrs per AUS (FHA: 2 yrs mandatory, or 1–2 yrs only with ≥2 prior yrs in related occupation); YTD P&L when returns aged (supporting statements only if P&L used to support HIGHER income); business-existence verification ≤120 days of note; 4506-C at closing per investor QC.
Calc: per year: Sch C line 31 + depletion + depreciation + amortization/casualty + business-use-of-home + (business miles × IRS depreciation ¢/mi for that tax year — VERIFY current rate, ~30¢) − disallowed meals − nonrecurring income. Sum ÷ 24 (or 12). Declining YoY → most recent year alone or exclude.
NeverDemand: 1065/1120 (none exist for sole prop); 2 yrs when AUS grants 1 (agency only — FHA gets no shortcut); full SE packaging for a W-2 borrower's small side-Sch-C loss (subtract the loss, move on).
QC: Gross receipts are never income. Ownership <25% → not self-employed → do not run SEB. Family-branch check: FHA files must carry the 2-yr (or related-occupation) floor even with TOTAL approval.

**5. `SE_ENTITY_K1`** — ≥25% owner of 1065/1120S/1120 entity.
Docs: 1040s 1–2 yrs per AUS; K-1s showing ownership %; business returns when K-1 income used beyond W-2 wages; YTD P&L + balance sheet ONLY when distributions < K-1 income used; existence verification ≤120 days.
Calc: per year: entity W-2 wages + K-1 ordinary + K-1 rental + guaranteed payments ± business-level add-backs allocated by ownership % (add depreciation/depletion/amortization/casualty; subtract meals exclusion, mortgages/notes payable <1 yr unless revolving) − nonrecurring. Liquidity gate when distributions < K-1 used: Quick Ratio (cash+equivalents+net A/R)/current liabilities ≥ 1.0. Losses flow against income at ownership share. Average ÷ months.
NeverDemand: balance sheet when distributions cover K-1 income used; business returns/P&L for <25% owners (their K-1 is "other income": 2 yrs of K-1s only).
QC: Never double-count entity W-2 with K-1. Depreciation add-back comes from the BUSINESS return allocated by %, not the K-1 alone.

**6. `RENTAL_LEASE_75`** — subject or departing-residence rent with no tax-return history: market rent (1007/1025) or executed lease.
Docs: 1007 (1-unit) / 1025 (2–4) with appraisal and/or executed lease; recent-acquisition evidence when Schedule E absent. FHA departing residence: lease + deposit/first-month + (25% equity appraisal OR 100-mile relocation).
Calc: net rent = gross × 0.75. Subject: subtract full subject PITIA — positive adds to income, negative adds to liabilities (and then PITIA is NOT separately in DTI). Experience gate (agency): borrower with no primary and <1-yr landlord history → subject rent offsets subject PITIA only, no positive income.
NeverDemand: Schedule E for a just-acquired property; 2 yrs landlord experience (gate is 1 yr OR owns a primary); 25%-equity/100-mile on CONVENTIONAL departing residences (FHA-only rule).
QC: The 75% factor and Schedule E are mutually exclusive tracks — flag any file applying both. Double-count killer: PITIA netted here must not also appear in DTI. STR income via this track = long-term market rent only.

**7. `RENTAL_SCHEDULE_E`** — property on most recent 1040.
Docs: 1040 w/ Schedule E; leases optional corroboration.
Calc: per property/year: rents − total expenses + depreciation + interest + taxes + insurance + HOA + nonrecurring ÷ months in service = gross cash flow; subtract current PITIA; positive → income, negative → debts.
NeverDemand: 1007-based 75% math on top of Schedule E.
QC: Verify months-in-service divisor for mid-year placements. FHA 3–4 unit files additionally require the self-sufficiency GATE (below) — an eligibility test, not income math.

**8. `OTHER_FIXED_BENEFIT`** — Social Security (retirement/survivor/disability), pension, annuity, VA benefits, LTD.
Docs: award letter or SSA-1099/benefit statement + one recent receipt. Trust: trust agreement/trustee statement (amount, frequency, duration).
Calc: monthly benefit as stated; apply GROSSUP modifier to nontaxable portion.
NeverDemand: 3-yr continuance proof for SS retirement/survivor or defined pensions (PRESUMED); medical evidence a disability will continue (fair-lending violation — document the benefit, never the condition).
QC: Flag files where the engine skipped gross-up on SS (money left on the table). Streams WITH expiration dates (annuity term, child's SS) need ≥3-yr continuance.

**9. `OTHER_COURT_ORDERED`** — alimony, child support, separate maintenance.
Docs: decree/court order/notarized agreement + 6 months receipt proof.
Calc: monthly amount if ≥3 yrs continuance remains; child support steps down per child aging out — model per-child against the 3-yr horizon. Gross up if nontaxable (child support is). Fannie option: alimony PAID may reduce income instead of counting as debt — engine should compute both and use the better DTI.
NeverDemand: receipt history >6 months.
QC: Verify remaining term ≥36 months per child/obligation.

**10. `OTHER_ASSET_DERIVED`** — interest, dividends, capital gains, royalties, notes receivable, trust distributions.
Docs: 2 yrs 1040s + proof underlying asset still owned.
Calc: (Yr-2 + Yr-1) ÷ 24; subtract assets liquidated for closing; drop if trend negative or asset base being consumed.
NeverDemand: continuance beyond asset-ownership proof.
QC: Cross-check against ASSET_DEPLETION — the same dollars may not produce both depletion income and interest/dividend income.

**11. `ASSET_DEPLETION_AGENCY`** — Fannie B3-3.1-09 / Freddie 5307.1 employment-related assets. THE AGENCY ANSWER FIRST — never route an asset-rich retiree to non-QM by default.
Docs: 2 months/most-recent-quarterly statements per account; penalty-free-access proof for retirement funds (age 59½+ — Fannie historically used 62; **VERIFY live guide**); ownership individually or joint-with-spouse-borrower.
Calc: net assets = balances − haircuts (30% on non-retirement securities, Freddie-style) − down payment − costs − reserves; monthly income = net ÷ divisor. **Divisor is guide-version-sensitive: Freddie 240; Fannie per current B3-3.1-09 (historically 360) — encode as a flagged constant, VERIFY before hardcoding.** Constraints: fixed-rate purchase/limited cash-out, LTV 70–80 band, DU/LPA processed; cash-out ineligible (Fannie).
NeverDemand: employment or income docs; the assets ARE the income.
QC: No double-count with reserves or with OTHER_ASSET_DERIVED. Flag cash-out refis.

**12. `BOARDER_ADU`** — boarder rent (HomeReady/Home Possible ONLY; standard conventional allows only a disabled borrower's live-in aide) + ADU rent on 1-unit primary.
Docs: boarder: shared-residency statement + 12 months payment evidence (≥9 of 12 received) + shared-address proof; ADU: appraisal recognizing the unit + 1007 or lease.
Calc: boarder = 12-mo total ÷ 12 (divide by 12 even if fewer months received), capped at 30% of TOTAL qualifying income (max usable = 0.30/0.70 × other income). ADU = gross rent × 0.75.
NeverDemand: 12-of-12 perfection (9-of-12 rule).
QC: Boarder cash on a standard conventional file = instant program-mismatch defect. No appraisal ADU recognition → no ADU income.

**13. `OFFER_LETTER_FUTURE`** — executed non-contingent offer/contract, job starts after closing.
Docs: offer letter with fixed salary + start date, contingencies cleared in writing; reserve statements covering gap (+6 months obligations if no paystub before delivery, agency path); 2-yr history behind borrower (education counts).
Calc: contract base ÷ 12. Windows: start ≤90 days of note (agency) / ≤60 days of closing (FHA). Reserves ≥ (gap months + buffer) × monthly obligations.
NeverDemand: paystubs from the not-yet-started employer; projected bonus/OT of the future job.
QC: Contingent offers unusable until cleared. Outside-window start date kills the path — that IS a valid flag.

**14. `TEMP_LEAVE`** — borrower on parental/medical leave with intent to return.
Docs: borrower's written return statement + date; employer leave-terms confirmation (no "guarantee" required); leave-income statement; asset statements for supplement.
Calc: returns before first payment → regular income. After → leave income + (net liquid reserves ÷ months to return), capped at regular income.
NeverDemand: return-to-work before closing; treating leave as a gap.
QC: Fair-lending landmine — never flag parental leave as an employment break or income instability.

**Modifier `GROSSUP`** (applies to any nontaxable stream): agency = ×1.25; FHA = greater of 15% or actual tax rate (15% default, NOT 25%); VA ≈ ×1.25 for DTI ONLY — **never grossed up in residual income**; USDA per handbook. Store raw amount, nontaxable portion, factor, family — traceable always.

### NON-QM ALT-DOC CALCULATORS

**15. `BANK_STMT_PERSONAL`** (monthsParam ∈ {1, 2, 3, 12, 24}; 12/24 mainstream) — deposits into PERSONAL accounts in lieu of returns/W-2s. **NOT business-owner-only**: serves 1099 contractors, gig workers, commission earners, mixed-income borrowers who deposit earnings personally; most programs require a self-employment/independent-earner seasoning showing (2 yrs standard, 1 yr with LTV/price hit) — verify the program's rule, never assume "must own a business."
Docs: N consecutive months, ALL pages, ALL accounts used; SE/independent-earner evidence (license, CPA/EA/preparer letter, SoS filing, or website); deposit worksheet/LOEs for excluded or large deposits; ending ≤60 days of application (program range 30–90).
Calc: income = eligible deposits ÷ N × **100%** (no expense factor on the personal path). Exclusions: inter-account transfers, refunds/reversals, cash advances/loan proceeds, tax refunds, gifts, asset sales, unsourced large deposits (default threshold: any single deposit > 50% of derived monthly income, or > $10k — source it or exclude it). Same deposit never counted twice across accounts. Commingled business revenue → apply business expense factor to those deposits or cap at ownership % (conservative default: apply the factor). Declining trend: recent 6–12 months down >10% vs earlier period → flag; down materially (program range 10–25%) → re-average on the lower recent period or decline.
NeverDemand: **tax returns, W-2s, 4506-C/transcripts, paystubs, P&L** — collecting returns can contractually kill the loan (once in file, most guides require using them).
QC: Check consecutiveness (a gap month invalidates the sample), all-pages completeness, NSF count (cap 3 in 12 / 6 in 24 without LOE), large-deposit sourcing, no double-count. Do NOT flag "borrower is not a business owner," absence of any tax document, or 100% deposit credit as errors. DTI ceiling 50% default (some 55%); reserves 3–12 months PITIA. Short-window variants (1–3 mo): tighter LTV ≤75–80, FICO 700+, reserves 6–12 mo; single-month anomalies get flagged to human, not auto-rejected; verify the program's month count before flagging "insufficient statements."

**16. `BANK_STMT_BUSINESS`** (monthsParam ∈ {1, 2, 3, 12, 24}) — BUSINESS account deposits, ≥25% ownership (some programs 50%+ for 100% deposit credit).
Docs: N consecutive months all pages; 2-yr SE + ownership % evidence (CPA letter, operating agreement, K-1, state filing); if expense-letter method: signed CPA/EA/preparer letter; if P&L method: third-party P&L; LOEs.
Calc: income = eligible deposits ÷ N × (1 − expenseFactor) × ownership%. **expenseFactor default = 0.50** (menu 10–90% by business type: no-employee service 20–30%, inventory/labor-heavy 50–70%); CPA-letter ratio usable with 10–20% floor; never 0%. Exclusions add: MCA/financing lump-sum advance patterns (detect and exclude — loan proceeds are never income). Personal OR business statements for a given deposit stream, never both.
NeverDemand: business or personal returns, transcripts, W-2s.
QC: Ownership multiplier is mandatory — 100% of deposits to a 50% owner is a defect unless the program explicitly allows with all-owner consent. Unknown expense factor → 50%, flag for LO. Same NSF/declining/large-deposit rules as personal.

**17. `PNL_ONLY`** — licensed-preparer P&L is the sole income doc.
Docs: CPA/EA/registered-preparer-signed P&L covering 12 (or 24) months through most recent quarter-end, dated ≤60–90 days; preparer license verification + letter; 2-yr SE + ownership % (many programs require majority/100% for P&L-only).
Calc: income = P&L NET income ÷ months × ownership%. Example: $300k net / 12 mo / 100% = $25,000/mo.
NeverDemand: returns, W-2s, transcripts, or (true P&L-only) any bank statements.
QC: NET, never gross revenue. Borrower-prepared P&L is ineligible as income (YTD supplement only elsewhere). Deepest overlays: LTV ≤75–80, FICO 680–700+. Reconcile declining income vs any prior P&L/statements in file.

**18. `PNL_PLUS_STMTS`** — P&L income with 2–3 months business statements as reasonableness check only.
Docs: PNL_ONLY package + 2–3 months business statements all pages.
Calc: income from P&L net (as above). Support test: eligible deposits in sampled months ÷ (P&L monthly gross × months sampled) ≥ floor — **default 0.50** (program range 50–75%). Fail → recalc under BANK_STMT_BUSINESS or decline. Deposits materially EXCEEDING the P&L: P&L still governs (conservative), flag for underwriter.
NeverDemand: returns/W-2s/transcripts.
QC: Statements corroborate GROSS revenue; income comes from NET P&L — never average the two.

**19. `IRS_1099_ONLY`** — gross 1099 comp (NEC/MISC/K) with fixed expense factor. The contractor's path, not the corporate owner's.
Docs: 1 or 2 years of 1099s (2-yr standard, 1-yr with overlays); YTD continuation evidence (1–3 mo statements showing the deposits, payor printout, or contract); 2-yr same-LINE-of-work history (not same payor); payor-change LOEs.
Calc: income = Σ1099 × (1 − expenseFactor) ÷ months; **expenseFactor default 0.10** (90% credit; some programs 20–25%; CPA letter can lower). Two years with lower recent year → lower year (or per program); rising → average. YTD deposits must run within ~10–25% of derived monthly or recalc.
NeverDemand: tax returns, Schedule C, 4506-C/transcripts, W-2s; 100% credit is also wrong — factor always applies.
QC: Multiple payors sum. 1099-K (card processing) is gross platform volume — flag for a larger expense factor, never auto-credit at 90%.

**20. `WVOE_ONLY`** — Form 1005 is the SOLE income doc, for W-2 wage earners. Proof the alt-doc space is not business-owner-only.
Docs: fully completed employer-signed 1005 (≤30–60 days of closing); VVOE re-verify before closing; overlay: 1–2 months personal statements showing consistent payroll credits; arm's-length employer evidence (family employer commonly ineligible; borrower must not be an owner).
Calc: base = stated annual ÷ 12 (or rate × hours × 52/12); variable from 1005 prior-year/YTD boxes = (prior year + annualized YTD) average, 2-yr history on the form required.
NeverDemand: paystubs, W-2s, returns, transcripts — the 1005 replaces all of them.
QC: Self-employed borrowers are INELIGIBLE (can't verify their own employment). Payroll-deposit overlay: net deposits plausibly consistent with stated gross — mismatch is a flag for human decision, not an auto-fail. Caps: LTV ≤80, FICO 680+, primary/second, 3–6 mo reserves, 1–2 yrs on the job.

**21. `ASSET_DEPLETION_NONQM`** — net eligible assets ÷ divisor; no employment of any kind required.
Docs: 2–6 months (or quarterly) statements per account; seasoning 30–120 days + sourcing of large recent deposits; DOB/59½ evidence if retirement funds; **no income or employment documents at all**.
Calc: income = (Σ(balance × classPct) − down payment − closing costs − required reserves) ÷ divisor. classPct grid (conservative defaults): cash/checking/savings/MM/CD 100%; non-retirement securities 80% (range 80–90); retirement 70% if age ≥59½ (range 70–80; under 59½: 50–60% or ineligible per program); business funds, RE equity, private/restricted stock, unvested RSUs, crypto: 0% default (some programs 50–70% seasoned exchange crypto — program-set). **Divisor is program-set: 120 conservative mainstream default, 84 common, 60 aggressive, 360 term-based variants — read from program, never assume.**
NeverDemand: W-2s, paystubs, returns, 1099s, VOEs — "no income source" is not a defect here.
QC: Always net out down/costs/reserves BEFORE dividing; same dollars can't be both depletion assets and reserves. Distinct from OTHER_ASSET_DERIVED (actual yield off returns) — never both on the same assets. Agency-first doctrine: if the borrower fits ASSET_DEPLETION_AGENCY constraints, suggest that first.

**22. `ASSET_QUALIFIER`** — pure coverage test; **no income figure, no DTI, ever**.
Docs: seasoned asset statements 2–6 months; large-deposit sourcing; nothing else.
Calc: pass if net eligible assets (same class haircuts as 21) ≥ loan amount + 60 × total monthly obligations (PITIA + debts) + down payment + closing costs. (Variant: ≥1.0–1.25× loan + 5 yrs obligations.) Output: qualifying_income = N/A.
NeverDemand: any income/employment/tax doc; any DTI computation.
QC: The engine's whole job is the coverage arithmetic and haircuts. Typically primary/second, LTV ≤75–80, strong FICO.

**23. `FN_FOREIGN_INCOME`** — foreign-national second-home/full-doc variant (FN investment default is DSCR_1_4).
Docs: passport + visa/ESTA; NO US credit — 2–3 international credit/bank reference letters or foreign bureau report; US bank account (funds seasoned 30–60 days US-side; ACH auto-pay commonly mandatory); employer or CPA letter from home country stating position, tenure, income (translated); foreign statements/returns translated as program requires; W-8BEN not W-9; LLC docs if entity.
Calc: income = letter amount × documented spot FX rate (rate and date stored in calc trail) × any program haircut; DTI ≤43–50; LTV ≤65–75 (70 conservative).
NeverDemand: SSN, US credit report/FICO ("no score" is not a defect — FN credit grade prices it), US returns, W-2s, US paystubs, 4506-C, US employment.
QC: OFAC/SDN screening on borrower + source-of-funds country is a compliance flag, not income. FN claiming primary occupancy without US residency = red flag. **FN ≠ ITIN**: FN = no US footprint; ITIN = US-resident filer without SSN (ITIN files use the normal method menu; owner-occ ITIN is CONSUMER credit — ATR applies, real income must be calculated; W-2/SSN mismatch is an expected artifact, flag per policy, never auto-fail as fraud; accept nontraditional tradelines).

### PROPERTY-CASH-FLOW & NO-INCOME METHODS (business-purpose, non-owner-occupied; ATR/QM exempt — never apply consumer income rules)

**24. `DSCR_1_4`** — subject property gross rent vs PITIA; borrower personal income neither documented nor computed; no DTI exists.
Docs: appraisal with 1007/1025 rent schedule; executed lease(s) (MTM ok with receipt proof; 2–3 mo receipts when lease > market); insurance dec page; tax bill/cert; HOA statement; flood if applicable; business-purpose/occupancy attestation; entity docs if LLC; asset statements for down + reserves (3–6 mo PITIA) ONLY — never for income.
Calc: DSCR = monthly gross rent ÷ monthly PITIA. Rent = **LESSER of lease and market** (conservative default; program may allow lease to 100–120% of market with receipt proof). Vacant: 100% market rent (some refi programs 90% — soft flag). PITIA = P&I at note rate (**IO loans: conservative default qualify at fully amortizing; program flag may allow IO payment**) + taxes/12 + insurance/12 + HOA + flood/12. Tiers: ≥1.25 best; ≥1.10 standard; ≥1.00 min at max LTV (~80 purch / 75–80 R&T / 70–75 cash-out); 0.75–0.99 at ~65–70 LTV with adders.
NeverDemand: **tax returns, W-2s, paystubs, 1099s, P&L, VOE/employment verification, 4506-C/transcripts, personal bank statements for income, DTI**. Flagging "missing income docs" here is a program-classification error.
QC: The valid defects are DENOMINATOR defects: missing tax bill, insurance, or HOA dues IS a real flag (PITIA incomplete). Verify rent evidence exists. First-time investor restrictions (min 1.00+, lower LTV) and first-time-homebuyer ineligibility are eligibility flags. Gifts usually barred for reserves. Condotel/STR/rural = LTV overlay flags, not income issues.

**25. `DSCR_STR`** — short-term-rental revenue variant.
Docs: 12 months platform host statements (Airbnb/VRBO) or PM statements (seasoned); AirDNA-style projection (purchase/no history); 1007 fallback; STR legality permit where required; PITIA components.
Calc: seasoned: rent = trailing-12 gross ÷ 12 × **0.80** haircut (some programs 100% with 1.25 floor). No history: AirDNA annual ÷ 12 × 0.80, OR 1007 long-term rent at 100%. Both exist → **LESSER** (conservative default). <12 months actuals → NEVER annualize a partial season; fall to projection/1007. DSCR floors 1.00–1.25; LTV ~5% below standard grid (max ~75).
NeverDemand: Schedule E, tax returns, or any personal income doc to "verify" STR revenue — platform statements are the source of truth.
QC: 12-month average, never best-month/last-month. STR-banned jurisdiction → revert to 1007 rent and flag legality; don't fail income. Condotel/resort overlay: LTV 65–70.

**26. `DSCR_NO_RATIO`** — no personal income AND no property ratio. Equity + credit + reserves only.
Docs: appraisal (value); asset statements (reserves 6–12 mo PITIA); attestations; tax/ins/HOA figures (to SIZE reserves only); entity docs.
Calc: none. Output qualifying_income = N/A, DSCR = not computed, reserves_required = N × PITIA. LTV 70–75 purch/R&T, 65–70 cash-out; FICO ~680–700.
NeverDemand: any income doc; and never fail for DSCR < 1.0 — do not "helpfully" compute DSCR from the 1007 and flag it; no-ratio pricing assumes the worst already.
QC: Missing asset statements IS a valid defect (reserves are the underwrite). Owner-occupancy indicia (mailing address = subject, homestead exemption, borrower statements) = hard fraud flag.

**27. `DSCR_PORTFOLIO`** — blanket loan, aggregate rents vs aggregate debt service.
Docs: certified rent roll (unit/tenant/dates/rent) — THE income document; leases or lender sample; T-12 if available; appraisal/BPO per property; per-property tax/ins/HOA (blanket insurance common); entity docs; reserves 6–12 mo aggregate PITIA.
Calc: portfolio DSCR = Σ qualifying rents ÷ Σ PITIA (per-property rent = lesser lease/market). Floors 1.20–1.25 (some 1.10); aggregate LTV ~70–75; release price 115–125% allocated; occupancy floor ~85–90% leased. Balloon notes: qualify at actual note payment, never an imagined 30-yr amortization.
NeverDemand: personal returns, Schedule E, K-1s — even though the entity obviously files taxes.
QC: A single vacant/sub-1.0 property does NOT fail the file — only the aggregate; flag concentration. Rent-roll-vs-lease mismatch IS a real defect.

**28. `DSCR_NOI_COMMERCIAL`** — 5–8+ unit / mixed-use (≥50% residential): NOI ÷ annual P&I.
Docs: certified rent roll (residential + commercial tenants); commercial + residential leases; T-12 for seasoned; commercial narrative appraisal (income approach, market rents, expense comps); tax/insurance/utility/management evidence; entity docs; reserves 6–12 mo debt service.
Calc: EGI = scheduled gross rents (lesser actual/market) × (1 − vacancy: 5% residential / 10% commercial or appraiser market). NOI = EGI − operating expenses (greater of T-12 actual or appraiser stabilized; no T-12 → flat ratio 25–35%, **30% conservative default**; T&I live in EXPENSES here). **DSCR = NOI ÷ annual P&I only.** Floors 1.20–1.25 (1.25–1.30 mixed-use); LTV 65–75.
NeverDemand: personal returns, K-1s, W-2s, personal DTI — "commercial-looking" docs don't change that.
QC: **CRITICAL FORMULA FORK: 1–4 unit = rent/PITIA (T&I in denominator); 5+/mixed = NOI/P&I (T&I in expenses). Mixing them double-counts T&I and wrongly fails good deals.** Vacant storefront ≠ zero — market rent × vacancy, flag concentration. <50% residential = true commercial: route out of the residential engine entirely. Use actual note amortization for balloon/ARM.

**29. `DSCR_SECOND_COMBINED`** — business-purpose second lien / investor HELOAN.
Docs: current first-mortgage statement (payment, balance, escrow breakdown) — a REQUIRED calc input; lease + 1007/AVM; T/I/HOA; attestation; entity docs; reserves 3–6 mo combined payments.
Calc: combined DSCR = qualifying rent ÷ (first-lien P&I + second P&I + T + I + HOA). **Escrowed firsts: strip escrow from the stated payment before adding standalone T&I — the classic double-count bug.** Floors 1.00–1.15; CLTV 65–75 (**70 conservative default**); $50k–500k, fixed 10–30 yr.
NeverDemand: income docs, DTI, the first lender's original underwriting file.
QC: Missing first-mortgage statement IS a valid defect (denominator input). Consumer HELOC/HELOAN on a primary is TILA full-doc territory — fork on purpose+occupancy, never apply this method to a primary.

**30. `NO_INCOME_FLIP`** — fix & flip / rehab. Asset + exit based; no income of any kind.
Docs: purchase contract; line-item rehab budget/scope; as-is + ARV appraisal (or BPO/AVM per tier); experience docs (HUDs/deeds; tiers 0–2 / 3–9 / 10+ deals in 36 mo); asset statements for down + interest reserve + rehab gap; credit (~660 floor); entity docs; business-purpose affidavit.
Calc: loan = MIN(initial advance ≤80–90% price by experience, total ≤85–90% LTC (loan ÷ (price + rehab)), ≤70–75% ARV). Liquidity: liquid assets ≥ down + costs + 6 mo interest + rehab shortfall. IO at note rate; draws vs inspections.
NeverDemand: returns, W-2s, paystubs, statements-for-income, DTI, DSCR, rent schedule — mid-renovation, there is no income to measure.
QC: Legitimate checks = liquidity math + experience tier. Exit-strategy weakness (comps don't support ARV; stated refi exit fails DSCR-at-exit) = soft flag. Owner-occupancy intent = hard stop (converts to consumer TILA rehab loan).

**31. `NO_INCOME_BRIDGE`** — stabilized bridge / hard money. Collateral-first.
Docs: valuation (appraisal/BPO/AVM); title/payoff on refis; proof of funds for down + prepaid interest reserve; exit narrative (listing, refi term sheet); business-purpose affidavit; entity docs; rent roll only if lender applies a coverage test.
Calc: bridge: loan ≤65–75% as-is (cash-out 65–70); optional coverage: in-place rent ≥ ~0.75–1.0× (IO + T&I) else escrowed interest reserve = N months × IO. Hard money: loan ≤50–70% as-is (65 classic); 10–15% rate, 2–5 pts, 6–18 mo. Output qualifying_income = N/A; computed figures = LTV + reserve months only.
NeverDemand: employment, income docs, returns, DTI, DSCR; never flag "unable to determine repayment ability" — the collateral is the repayment source by design. An escrowed interest reserve is normal, not "can't pay."
QC: Real jobs: verify NON-owner occupancy, value support, liquidity. Recent BK/FC/lates generally not disqualifying — do NOT import agency 4–7 yr seasoning. Cross-collateral blankets = combined LTV test. Primary residence → consumer TILA/HOEPA — hard stop/escalate.

**32. `NO_INCOME_CONSTRUCTION`** — investor ground-up/spec.
Docs: land contract or ownership (seasoning 6–12 mo for equity credit); budget + plans + permits; as-completed appraisal; builder/GC resume + license + prior-build docs; assets for equity gap + interest reserve + 5–10% contingency; lender feasibility review; entity docs; affidavit.
Calc: loan = MIN(85–90% LTC, 70–75% as-completed); land advance ≤50–60% land value; financed interest reserve = 9–12 mo × IO on projected average balance; draws vs milestones; liquidity ≥ equity gap + contingency + unfinanced interest.
NeverDemand: personal income docs, DTI, DSCR — no rent exists.
QC: Inexperience = eligibility issue, not income. Financed interest reserve = designed payment source, not inability to pay. Budget-vs-appraisal cost mismatch = valid flag; missing paystubs is not. Owner-occ intent → consumer construction-to-perm (full doc + ATR): fork the program, never blend.

### PROGRAM GATES (run only where they belong; each outside its program = defect)

- `GATE_AMI` (HomeReady/Home Possible only): Σ all borrowers' QUALIFYING income ≤ 0.80 × AMI(subject). Tests income USED, not household earnings — legitimately excluding a bonus to fit is the document-everything/use-what-fits doctrine, not manipulation. Non-borrower household income = DU risk factor only, never qualifying income. Never apply AMI to standard conventional.
- `GATE_VA_RESIDUAL` (every VA loan, mandatory even with AUS approval): residual = gross − tax/SS withholding (actual filing situation) − PITIA − 0.14 $/sqft maintenance/utilities (sqft is an engine input on VA only) − debts − documented child/job expenses; must meet the regional family-size table (≥$80k loans: family 1 NE 450/MW 441/S 441/W 491; 2: 755/738/738/823; 3: 909/889/889/990; 4: 1025/1003/1003/1117; 5: 1062/1039/1039/1158; +$80 per member to 7; separate <$80k table). DTI 41% is a BENCHMARK not a wall — >41% needs justification or residual ≥120% of table. After-tax income; nontaxable enters at face value (no gross-up in residual). BAH/BAS count. ETS <12 months = continuance analysis, not denial.
- `GATE_FHA_SELF_SUFFICIENCY` (FHA 3–4 unit ONLY): 0.75 × gross market rent of ALL units (incl. owner's) ≥ full PITI, or ineligible regardless of borrower income. Never on 1–2 units or conventional.
- `GATE_USDA_HOUSEHOLD` (USDA only): eligibility calc uses ALL adult household members' projected 12-mo income − $480/dependent − $400 elderly − childcare − disability-assistance − medical >3% (elderly) ≤ ~115% AMI limit. REPAYMENT income = borrowers only, agency-like math, 29/41 benchmarks (GUS higher; waiver ~32/44). **Household income counts AGAINST eligibility, never TOWARD repayment — the #1 USDA miscoding.** Deductions apply only to eligibility. No-income adult members still need a signed statement.
- `GATE_NON_OCC_COBORROWER`: conventional — blend income and debts of all note-signers, no occupant-only DTI cap with AUS, LTV ≤95 (HomeReady to program max); include the non-occupant's own housing expense in debts. FHA — blend the same, but 96.5% LTV only if FAMILY member (HUD list); non-family caps LTV at 75% — branch BEFORE computing max loan. Never impose FHA's family split on conventional. On-the-note only — guarantors' income never counts.
- `GATE_DTI` (per family): conventional AUS 50; FHA AUS to 46.9/56.9, manual 31/43 (comp factors to 40/50); VA benchmark 41 + residual; USDA 29/41; non-QM 50 standard / 55 some; DSCR/no-income = no DTI exists. Never fail an FHA AUS-approved 55 DTI against conventional's 50.

### CENTRALIZED CONSTANTS (single source of truth)

rentalVacancyFactor 0.75 (agency + FHA subject units) · boarderCap 0.30 of total qualifying · grossUp: agency 1.25, FHA 1.15-or-actual, VA 1.25-DTI-only · AMI cap 0.80 · USDA limit ~1.15 AMI, deductions 480/400 · VA maintenance 0.14/sqft, residual trigger 1.20 above 41 DTI · offer windows 90d agency / 60d FHA · VVOE 10 business days · SE existence check 120 days · SE ownership threshold 25% · bizStmtExpenseFactor 0.50 default (floor 0.10–0.20 w/ CPA letter) · personalStmtCredit 1.00 · 1099 factor 0.10 · largeDepositThreshold 0.50 × monthly income (or $10k) · NSF cap 3/12mo, 6/24mo · statement recency 60d default (30–90 program) · P&L support floor 0.50 (to 0.75) · STR haircut 0.80 · assetClassPct: cash 1.00, securities 0.80, retirement59.5+ 0.70, business/crypto/RE-equity 0.00 default · depletion divisors: agency Freddie 240 / Fannie **VERIFY (360 vintage)**; non-QM 120 default / 84 / 60 · assetQualifierCoverage: loan + 60 × obligations · NOI vacancy 0.05 res / 0.10 comm, flat expense 0.30 default · DSCR floors 1.00/1.10/1.25; portfolio 1.20–1.25; NOI 1.20–1.30 · **VERIFY-BEFORE-HARDCODE flags: Fannie depletion divisor; Fannie retirement-access age (59½ vs 62); current-year IRS depreciation ¢/mi.**

---

## SECTION 2 — METHOD-SELECTION LOGIC

**Step 0 — occupancy/purpose fork (before anything else).** `loanPurpose ∈ {owner-occ consumer, second home, investment/business-purpose}`. Business-purpose + non-owner-occupied → DSCR/no-income branch is legal; owner-occupied or consumer-purpose → DSCR/no-income methods are STRUCTURALLY FORBIDDEN (TILA/ATR) — any owner-occ indicia on a business-purpose file is a hard escalation, and a primary-residence hard-money/bridge/flip file must never be processed as asset-based.

**Step 1 — explicit program designation wins.** If the file carries a program code / AUS findings (DU/LPA/TOTAL/GUS), that designation selects family + method, and AUS doc-relief messages OVERRIDE default doc lists (1 yr W-2s/returns when findings say so — never hard-code 2). Brand DU-vs-LPA and never mix agency variants on one file.

**Step 2 — no designation: infer candidates from the document signature + purpose.**

| Uploaded document signature | Auto-suggest | Confidence |
|---|---|---|
| Paystubs + W-2s (± VVOE) | W2_BASE (+ W2_VARIABLE if per-type YTD variance) | auto |
| Form 1005 alone, no paystubs/W-2s | WVOE_ONLY | auto |
| 1040 w/ Schedule C | SE_SCHEDULE_C | auto |
| K-1s ± 1065/1120S/1120 | SE_ENTITY_K1 (<25% ownership → other-income K-1 path) | auto |
| 1099 forms, NO 1040 | IRS_1099_ONLY | auto |
| 12/24 mo personal statements, no returns/W-2s | BANK_STMT_PERSONAL | auto |
| 12/24 mo business statements | BANK_STMT_BUSINESS | auto |
| 1–3 mo statements only | short-window bank-stmt tier — verify program month count first | LO confirm |
| Signed preparer P&L, no statements | PNL_ONLY | auto |
| P&L + 2–3 mo business statements | PNL_PLUS_STMTS | auto |
| Asset statements only + employment-age/retiree profile, consumer purpose | ASSET_DEPLETION_AGENCY first (agency-first doctrine); ASSET_DEPLETION_NONQM if agency constraints fail (cash-out, LTV, divisor need); ASSET_QUALIFIER if program says coverage-test | LO choose among the three |
| Offer letter, no paystubs, start date future | OFFER_LETTER_FUTURE | auto |
| Leave/benefit statement + return-to-work letter | TEMP_LEAVE | auto |
| Award letters / SSA-1099 / decree | OTHER_FIXED_BENEFIT / OTHER_COURT_ORDERED | auto |
| Investment: 1007/1025 + lease + tax/ins/HOA, no income docs | DSCR_1_4 | auto |
| Investment: platform host statements / AirDNA | DSCR_STR | auto |
| Investment: rent roll, multiple properties, one note | DSCR_PORTFOLIO | auto |
| 5+ units or mixed-use, T-12/commercial appraisal | DSCR_NOI_COMMERCIAL (verify ≥50% residential else route out) | auto |
| First-mortgage statement + rent evidence, second lien | DSCR_SECOND_COMBINED | auto |
| Rehab budget + ARV appraisal | NO_INCOME_FLIP | auto |
| As-is valuation + exit narrative, no budget | NO_INCOME_BRIDGE | auto |
| Plans/permits/builder resume | NO_INCOME_CONSTRUCTION | auto |
| Passport + foreign letters, no US docs | FN: investment → DSCR_1_4; second home → FN_FOREIGN_INCOME | auto |
| ITIN + any of the above | route by document signature to normal method; owner-occ = consumer/ATR | auto |

**Step 3 — anti-downgrade / anti-contamination rules.**
- Bank statements present on a consumer full-doc file = ASSET docs there, not an income method; presence alone never selects a bank-statement method when paystubs/W-2s/returns also exist and support the income.
- Once a file is on an alt-doc method, NEVER solicit the excluded docs "to be safe" — returns in a bank-statement file must be used per most guides and can kill the loan. Suggest-only, never request.
- Never route a DSCR/bridge/flip file into bank-statement analysis — computing personal income on a no-income program manufactures false defects. Conversely, never fail an agency file for deposit-based income: a borrower whose income only shows in deposits gets ROUTED to non-QM bank-statement (any consumer with deposit-based earnings — not just business owners), not declined.
- Streams are additive: one file may legally combine W2_BASE + W2_VARIABLE + RENTAL_SCHEDULE_E + OTHER_FIXED_BENEFIT. Methods that stand ALONE by definition: WVOE_ONLY, PNL_ONLY, IRS_1099_ONLY, ASSET_QUALIFIER, all DSCR/no-income methods.
- Same deposits/same dollars used once: personal vs business statements can't share deposits; depletion assets can't be reserves or yield income.

**Step 4 — LO must choose (never auto-commit) when:** (a) both personal and business statements uploaded — path choice changes income materially (100% vs 50% factor); (b) full-doc and alt-doc packages BOTH complete — full-doc vs bank-statement election is a pricing/approval strategy call; (c) asset-depletion agency vs non-QM vs asset-qualifier; (d) 12- vs 24-month statement window when both available (24 is default-conservative; 12 may price worse but qualify higher); (e) IO qualifying payment (IO vs amortizing) — program rule must be read, not assumed; (f) STR trailing-12 vs projection when they diverge beyond the lesser-of default; (g) any file where the doc signature matches two families (e.g., ITIN investor: full-doc vs DSCR). Engine presents candidates + computed income under each; human elects.

---

## SECTION 3 — RESOLVED CONFLICTS (explicit, conservative-mainstream defaults)

1. **Gross-up**: 25% agency vs 15% FHA — NOT one constant; per-family, and VA's applies to DTI only, never residual.
2. **Depletion divisor**: 240 (Freddie) vs 360 (Fannie vintage) vs 60/84/120 (non-QM) — program parameter with verify-flag; non-QM default 120.
3. **SE 1-year returns**: agency yes-per-AUS; FHA no (2-yr floor / related-occupation exception). Family branch, never a global rule.
4. **Commission ≥25% returns rule**: dead everywhere (agency 2018, FHA followed) — demanding returns for commission is always a defect.
5. **Business expense factor**: 50% default; CPA letter can lower to 10–20% floor; never 0%; personal statements 100% unless commingled business revenue (then factor applies).
6. **DSCR rent**: lesser-of lease/market default; lease-above-market only with receipt proof per program.
7. **DSCR IO payment**: conservative default fully amortizing; IO allowed only when program says so. (Same rule for expanded-ratio non-QM IO.)
8. **1–4 vs 5+ DSCR**: rent/PITIA vs NOI/P&I — T&I lives in exactly one place; unit count forks the formula.
9. **Departing-residence equity/distance test**: FHA-only; never on conventional.
10. **Declining income (universal doctrine)**: stable/rising → average; declining → lower recent figure or exclusion; never the flattering average. Bank-statement trigger: recent period down >10% → flag, re-average low.
11. **Boarder income**: HomeReady/HP flexibility only; on standard conventional it's a program-mismatch defect, not extra income.
12. **Retirement asset access**: age 59½ standard (Fannie vintage said 62 — verify-flag); age changes haircut, so DOB is an engine input.
13. **P&L vs deposits divergence**: deposits low → recalc/downgrade at the 50% floor; deposits high → P&L still governs, flag only.
14. **No-ratio DSCR**: never compute the ratio at all — even helpfully.
15. **FN vs ITIN**: never conflate; opposite doc expectations (no US footprint vs US filer).
16. **Statement recency/consecutiveness**: 60-day default recency, consecutive months strict, month-count is program-read before any "insufficient statements" flag.

**Master QC doctrine (encode as the engine's opening comment):** classify program family and method FIRST; judge the file ONLY by its own method's docs and math; a "missing" document from another method's list is never a defect; the deadliest QC failures are cross-contamination (demanding returns on alt-doc, computing income on no-income files, applying gates outside their program, double-counting T&I or PITIA) — every flag must cite the method id and the specific rule it violates.