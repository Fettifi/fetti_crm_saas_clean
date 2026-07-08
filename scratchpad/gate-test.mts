import * as dotenv from 'dotenv'; dotenv.config({ path: '/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local' });
import Module from 'module';
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (r: string, ...a: any[]) { return r === 'server-only' ? process.env.SO_STUB! : orig.call(this, r, ...a); };
const { MARK_EXPERTISE } = await import('/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markConcierge.ts');
const src = (await import('fs')).readFileSync('/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markConcierge.ts','utf8');
const m = src.match(/const RATE_PROMISE = (\/.+\/i);/s)!;
const RATE = eval(m[1]);
// every expertise nugget must PASS (teaching)
let fails = 0;
for (const [k, v] of Object.entries(MARK_EXPERTISE)) if (RATE.test(v as string)) { console.log('✗ FALSE POSITIVE on expertise:', k); fails++; }
// real quotes must still be CAUGHT
for (const bad of ["your rate would be 6.25%", "we can get you 5.9%", "today's rates are 6.5%", "as low as 5.99%", "that's a 6.5% rate", "6.125% APR", "we could lock 6% for you"])
  if (!RATE.test(bad)) { console.log('✗ MISSED quote:', bad); fails++; }
console.log(fails === 0 ? 'gate: all 10 expertise nuggets pass + all 7 quotes caught ✓' : fails + ' failures');
