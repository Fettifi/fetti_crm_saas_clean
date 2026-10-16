import { NextRequest, NextResponse } from 'next/server';
// Server-side OTP must use the service role (bypasses RLS), NOT the public anon
// key — the anon key has no access to the leads table after the RLS lockdown.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdminClient';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { hashOtp } from '@/lib/portalSession';
import { senderFrom } from '@/lib/notify/mailFrom';
import { randomInt } from 'crypto';

export const dynamic = 'force-dynamic';

// Emails a one-time access code to the borrower so they can open their portal.
// The code is HASHED at rest (never stored or logged in plaintext) and delivered by
// email — the previous version logged the code to the server and never sent it, which
// both broke login and leaked a working code to anyone with server-log access.
async function emailCode(to: string, code: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    // THE SENDER COMES FROM ONE PLACE. This line used to read
    //   process.env.LEAD_NOTIFY_EMAIL_FROM || 'Fetti Financial Services <noreply@fettifi.com>'
    // which was the ONLY borrower-facing send in the app that bypassed lib/notify/mailFrom.ts —
    // the module written specifically to be the single source of truth for the visible From.
    // Two things were wrong with it, found 2026-10-16:
    //
    //  1. LEAD_NOTIFY_EMAIL_FROM is "FettiFinancialServices<hello@fettifi.com>", and hello@ HAS NO
    //     INBOX (Ramon confirmed 2026-07-14). So a borrower who replied to her own access-code email
    //     reached a dead mailbox. mailFrom.ts already coerces hello@ -> frank@ for exactly this
    //     reason; this route never consulted it.
    //  2. The `||` fallback named noreply@fettifi.com, and fettifi.com is a VERIFIED Resend sending
    //     domain (confirmed against the Resend API 2026-10-16), so Resend will happily send as ANY
    //     local-part on it, DKIM-signed and DMARC-aligned. Clearing one dashboard env var would have
    //     silently moved every borrower access code onto an address nobody monitors — and one that
    //     now carries a block entry on our mail perimeter.
    //
    // senderFrom() resolves to frank@fettifi.com, the only monitored fettifi.com mailbox.
    const from = senderFrom();
    if (!key) { console.error('[portal/send-otp] RESEND_API_KEY missing — cannot deliver code'); return false; }
    const html = `<div style="font-family:ui-sans-serif,system-ui,Arial;max-width:440px;margin:0 auto;padding:24px">
      <p style="font-size:15px;color:#0f172a">Your Fetti Financial Services secure-portal access code:</p>
      <p style="font-size:34px;font-weight:700;letter-spacing:.28em;color:#0b7a53;margin:14px 0">${code}</p>
      <p style="font-size:13px;color:#64748b">This code expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
    </div>`;
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject: 'Your Fetti access code', html }),
        });
        if (!r.ok) { console.error('[portal/send-otp] Resend rejected:', r.status, (await r.text()).slice(0, 200)); return false; }
        return true;
    } catch (e: any) { console.error('[portal/send-otp] Resend failed:', e?.message); return false; }
}

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();
        if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

        // Throttle OTP requests per IP and per email (anti brute-force/enumeration).
        // failClosed: a limiter error must DENY, so it can't be used to blast codes.
        if (!(await rateLimit(`otp-send:${clientIp(req)}`, 6, 900, { failClosed: true })) || !(await rateLimit(`otp-send:${String(email).toLowerCase()}`, 6, 900, { failClosed: true }))) {
            return NextResponse.json({ message: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
        }

        const { data: lead, error: findError } = await supabase
            .from('leads').select('id').eq('email', email).single();

        // Always return the same message — never reveal whether the email is on file.
        const genericOk = NextResponse.json({ message: 'If that email is on file, a code has been sent.' });
        if (findError || !lead) return genericOk;

        // CSPRNG, NOT Math.random(). This code is the borrower portal's ONLY authentication
        // factor — it is what stands between a stranger and that borrower's pay stubs, bank
        // statements and tax returns.
        //
        // V8 implements Math.random() as xorshift128+, which is fast, seeded per-context, and
        // RECOVERABLE: an attacker who can observe a handful of outputs can reconstruct the
        // internal state and predict the rest. Observing outputs here costs nothing — anyone can
        // request codes for an address they control and read them out of their own inbox, then
        // predict the next code issued to somebody else.
        //
        // randomInt is rejection-sampled, so it is also uniform across the range; the old
        // expression inherited Math.random()'s float rounding at the edges of a 900,000 span.
        // Brute force is separately contained by the verify route's 10-per-15-min limit, per IP
        // AND per email, fail-closed — but a rate limit does nothing about a PREDICTED code,
        // which arrives correct on the first attempt.
        const code = randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        // Store only the HASH of the code (never the code itself).
        const { error: updateError } = await supabase
            .from('leads')
            .update({ access_code: hashOtp(code), access_code_expires_at: expiresAt })
            .eq('id', lead.id);
        if (updateError) throw updateError;

        await emailCode(String(email), code); // delivery failures are logged inside; response stays generic
        return genericOk;
    } catch (error) {
        console.error('Send OTP Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
