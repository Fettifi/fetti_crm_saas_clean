import * as dotenv from 'dotenv'; dotenv.config({ path: '/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local' });
import Module from 'module';
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (r: string, ...a: any[]) { return r === 'server-only' ? process.env.SO_STUB! : orig.call(this, r, ...a); };
import fs from 'fs';
const { buildTitleOrderPdf } = await import('/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/lib/titleOrderPdf.ts');
const pdf = await buildTitleOrderPdf({ toCompany: 'Pacific Coast Title', toContact: 'Sandra Lee', toEmail: 'sandra@pctitle.com', transaction: 'Purchase', propertyAddress: '4821 Crenshaw Blvd, Los Angeles, CA 90043', borrowers: 'Jazmine Wilson & Paul Davis', borrowerPhone: '323-555-0182', purchasePrice: 685000, loanAmount: 616500, estClosing: 'August 15, 2026', fileNumber: 'FF-202607-4821', notes: 'Rush prelim appreciated — borrower is in a 21-day contract.' });
fs.writeFileSync('/tmp/title-order.pdf', pdf);
console.log('built', pdf.length, 'bytes');
