import { NextRequest, NextResponse } from 'next/server';
// Server-side OTP must use the service role (bypasses RLS), NOT the public anon
// key — the anon key has no access to the leads table after the RLS lockdown.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdminClient';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { hashOtp } from '@/lib/portalSession';

export const dynamic = 'force-dynamic';

// Emails a one-time access code to the borrower so they can open their portal.
// The code is HASHED at rest (never stored or logged in plaintext) and delivered by
// email — the previous version logged the code to the server and never sent it, which
// both broke login and leaked a working code to anyone with server-log access.
async function emailCode(to: string, code: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_NOTIFY_EMAIL_FROM || 'Fetti Financial Services <noreply@fettifi.com>';
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
        if (!(await rateLimit(`otp-send:${clientIp(req)}`, 6, 900)) || !(await rateLimit(`otp-send:${String(email).toLowerCase()}`, 6, 900))) {
            return NextResponse.json({ message: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
        }

        const { data: lead, error: findError } = await supabase
            .from('leads').select('id').eq('email', email).single();

        // Always return the same message — never reveal whether the email is on file.
        const genericOk = NextResponse.json({ message: 'If that email is on file, a code has been sent.' });
        if (findError || !lead) return genericOk;

        const code = Math.floor(100000 + Math.random() * 900000).toString();
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
