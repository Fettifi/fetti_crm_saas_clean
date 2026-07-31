import { scoreLead } from '../lib/leadScore';

/**
 * Permanent Verification Script for canonical lead scoring (lib/leadScore.ts).
 *
 * scoreLead is the SINGLE source of truth for score/tier across every intake path
 * (/api/apply, the Meta Lead Center importer, the requalify cron, Calendly), so a
 * silent regression here mis-prioritizes the entire pipeline at once. This script
 * pins the behaviour that is easy to break and expensive to notice.
 *
 * The headline case is CREDIT BAND BOUNDS. Meta instant forms answer with a
 * ceiling ("below_650"), and reading that as a point estimate promotes the
 * borrower a full bucket. On 2026-07-31 that was 54% of all Facebook leads.
 */

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ✅ ${label} → ${String(actual)}`);
  } else {
    console.error(`  ❌ ${label}: expected ${String(expected)}, got ${String(actual)}`);
    failures++;
  }
}

function verifyLeadScore() {
  console.log('🔍 Starting Lead Scoring Verification...');

  // 1. CREDIT BAND BOUNDS — ceilings, ranges, floors and bare point estimates.
  // Credit is scored alone here (no other signals), so `score` IS the credit points:
  // >=700 → 40, >=680 → 30, >=650 → 20, >=600 → 10, else 0.
  console.log('\n--- Credit band bounds (credit points only) ---');
  const creditOnly = (credit_band: string) => scoreLead({ credit_band }).score;

  // CEILING: strictly below the stated number → must NOT collect that number's bucket.
  // This is the real Meta vocabulary and the bug this suite exists for.
  check('below_650 (ceiling → 649, the 600-649 bucket)', creditOnly('below_650'), 10);
  check('Below 620 (ceiling → 619)', creditOnly('Below 620'), 10);
  check('under 700 (ceiling → 699, must not earn the 700+ bucket)', creditOnly('under 700'), 30);
  check('<650 (symbolic ceiling)', creditOnly('<650'), 10);
  check('below 600 (ceiling → 599, below every bucket)', creditOnly('below 600'), 0);

  // RANGE: the low end governs — the only value the whole band supports.
  check('650_679 (range → 650)', creditOnly('650_679'), 20);
  check('680-699 (range → 680)', creditOnly('680-699'), 30);
  check('700_719 (range → 700)', creditOnly('700_719'), 40);

  // FLOOR / BARE: the stated number stands.
  check('720_plus (floor → 720)', creditOnly('720_plus'), 40);
  check('c700 (coded point estimate)', creditOnly('c700'), 40);
  check('c649 (coded point estimate)', creditOnly('c649'), 10);
  check('c650 (coded point estimate)', creditOnly('c650'), 20);

  // A ceiling and a genuine in-band borrower must NOT score alike — the whole point.
  if (creditOnly('below_650') === creditOnly('650_679')) {
    console.error('  ❌ "below_650" scores the same as a genuine 650-679 borrower');
    failures++;
  } else {
    console.log('  ✅ "below_650" scores strictly below a genuine 650-679 borrower');
  }

  // 2. ROBUSTNESS — malformed and absent bands must fail soft, never throw.
  console.log('\n--- Robustness ---');
  check('no band at all', scoreLead({}).score, 0);
  check('null band', scoreLead({ credit_band: null }).score, 0);
  check('non-numeric band', scoreLead({ credit_band: 'unknown' }).score, 0);
  check('out-of-range number ignored', scoreLead({ credit_band: '999' }).score, 0);
  check('explicit credit_score wins over band', scoreLead({ credit_score: 720, credit_band: 'below_650' }).score, 40);

  // 3. TIER BANDING — the thresholds the follow-up queue is built on.
  console.log('\n--- Tier banding ---');
  check('score >= 70 → Tier 1', scoreLead({ credit_band: 'c700', liquid_assets: 100000, property_value: 750000 }).tier, 'Tier 1');
  check('mid score → Tier 2', scoreLead({ credit_band: 'c700', liquid_assets: 50000 }).tier, 'Tier 2');
  check('thin lead → Tier 3', scoreLead({ credit_band: 'below_650' }).tier, 'Tier 3');

  // THE MARGIN THIS FIX ACTUALLY BUYS. Re-scoring the 2026-07-31 book moved 61 of 199
  // leads down a credit bucket but flipped ZERO tiers, because those leads had no other
  // points. The cost of the old bug was never the thin leads — it was the borderline
  // one, where a ceiling band's undeserved +20 carried a lead over a queue threshold.
  // A "below 650" borrower with a $350K property on an investor purpose is a Tier 3
  // nurture lead; the old scorer made it 40 and promoted it into the hand-worked queue.
  check(
    'ceiling band must not buy a false Tier 2 promotion',
    scoreLead({ credit_band: 'below_650', property_value: 350000, loan_purpose: 'DSCR Purchase' }).tier,
    'Tier 3',
  );
  check(
    'a genuine 650-679 borrower with the same file still earns Tier 2',
    scoreLead({ credit_band: '650_679', property_value: 350000, loan_purpose: 'DSCR Purchase' }).tier,
    'Tier 2',
  );

  // 4. CODED MONEY — Meta sends thousands (350 = $350K); dollars pass through.
  console.log('\n--- Coded money normalization ---');
  check('coded property_value 350 == literal 350000', scoreLead({ property_value: 350 }).score, scoreLead({ property_value: 350000 }).score);
  check('coded liquid_assets 50 == literal 50000', scoreLead({ liquid_assets: 50 }).score, scoreLead({ liquid_assets: 50000 }).score);

  if (failures) {
    console.error(`\n❌ Lead Scoring Verification FAILED — ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\n✨ Lead Scoring Verification Successful!');
}

verifyLeadScore();
