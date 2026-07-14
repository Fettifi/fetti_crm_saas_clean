import { NextRequest, NextResponse } from 'next/server';
// Service role (server-side), not the public anon key — required after RLS lockdown.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdminClient';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { otpMatches, signPortalSession, PORTAL_COOKIE } from '@/lib/portalSession';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { email, code } = await req.json();
        if (!email || !code) {
            return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
        }

        // Throttle verification attempts (anti brute-force on the 6-digit code).
        if (!(await rateLimit(`otp-verify:${clientIp(req)}`, 10, 900)) || !(await rateLimit(`otp-verify:${String(email).toLowerCase()}`, 10, 900))) {
            return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
        }

        const { data: lead, error: findError } = await supabase
            .from('leads')
            .select('id, access_code, access_code_expires_at')
            .eq('email', email)
            .single();

        if (findError || !lead) {
            return NextResponse.json({ error: 'Invalid email or code' }, { status: 401 });
        }
        // Compare the HASH of the submitted code (constant-time) + check expiry.
        if (!otpMatches(String(code), lead.access_code) ||
            !lead.access_code_expires_at || new Date(lead.access_code_expires_at) < new Date()) {
            return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
        }

        // One-time use: clear the code immediately.
        await supabase.from('leads').update({ access_code: null, access_code_expires_at: null }).eq('id', lead.id);

        // Mint the real session as a signed, httpOnly cookie. Authorization now lives
        // server-side — the client can no longer grant itself access by writing a leadId
        // into localStorage. /api/portal/data validates this cookie on every read.
        const res = NextResponse.json({ message: 'Login successful', leadId: lead.id });
        res.cookies.set(PORTAL_COOKIE, signPortalSession(lead.id), {
            httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 14,
        });
        return res;
    } catch (error) {
        console.error('Verify OTP Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
