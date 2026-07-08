import * as dotenv from 'dotenv'; dotenv.config({ path: '/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local' });
import Module from 'module';
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (r: string, ...a: any[]) { return r === 'server-only' ? process.env.SO_STUB! : orig.call(this, r, ...a); };
const { markConciergeReply, expertiseFor, handoffSignal } = await import('/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/markConcierge.ts');

// REAL CASE 1: Marilou — DPA for her daughter (old reply was brochure filler)
const lead1 = { first_name: 'Marilou', full_name: 'Dominique Pasion-Bustamante', loan_purpose: 'FHA Purchase + Down Payment Assistance', state: 'CA', stage: 'Contacted' };
const h1: any[] = [{ role: 'user', content: "I'm inquiring for the down payment assistance for my daughter how does it work" }];
const r1 = await markConciergeReply({ lead: lead1, history: h1, appLink: 'https://app.fettifi.com/apply/form?lead=x&t=y&goal=buy', calendlyUrl: 'https://calendly.com/fetti/15', firstAiReply: true, expertise: expertiseFor(lead1, h1[0].content), knownFacts: [] });
console.log('=== CASE 1 (DPA for daughter) ===\n' + r1.reply + '\n');

// follow-up turn with memory
const h1b: any[] = [...h1, { role: 'assistant', content: r1.reply }, { role: 'user', content: 'Citrus Heights or around. she rents now, never owned. what would she need?' }];
const r1b = await markConciergeReply({ lead: lead1, history: h1b, appLink: 'https://app.fettifi.com/apply/form?lead=x&t=y&goal=buy', calendlyUrl: 'https://calendly.com/fetti/15', expertise: expertiseFor(lead1, h1b[h1b.length-1].content), knownFacts: ['buying for her daughter (daughter = borrower)', 'area: Citrus Heights CA'] });
console.log('=== CASE 1b (follow-up w/ memory) ===\n' + r1b.reply + '\n');

// REAL CASE 2: Elizabeth — docs stage (old reply was empty encouragement)
const lead2 = { first_name: 'Elizabeth', full_name: 'Elizabeth Disimone', loan_purpose: 'purchase', state: 'FL', stage: 'Engaged' };
const h2: any[] = [{ role: 'user', content: 'Submitted everything that I have and left out what I don\'t have' }];
const r2 = await markConciergeReply({ lead: lead2, history: h2, fileLink: 'https://app.fettifi.com/file/abc123', calendlyUrl: 'https://calendly.com/fetti/15', missingDocs: ['W-2 (2025)', 'Most recent pay stub', 'June bank statement — account x9140'], expertise: expertiseFor(lead2, h2[0].content), knownFacts: [] });
console.log('=== CASE 2 (docs, knows the missing list) ===\n' + r2.reply + '\n');

// handoff check
console.log('handoff tests:', handoffSignal('can I just talk to a real person'), '|', handoffSignal('we are under contract and close in 3 weeks'), '|', handoffSignal('another lender quoted me better'));
