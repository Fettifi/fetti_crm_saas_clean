import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdminClient';
import { verifyPortalSession, PORTAL_COOKIE } from '@/lib/portalSession';

export const dynamic = 'force-dynamic';

// Server-side portal read. Authorization is the signed httpOnly session cookie — NOT
// a client-controlled localStorage value or the lead id in the URL. Data is fetched
// with the service role for the cookie's OWN leadId only, so a borrower can never read
// another borrower's application by changing the URL (the previous IDOR).
export async function GET(req: NextRequest) {
    const leadId = verifyPortalSession(req.cookies.get(PORTAL_COOKIE)?.value);
    if (!leadId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data: app } = await supabaseAdmin
        .from('applications')
        .select('id, status, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('first_name, full_name')
        .eq('id', leadId)
        .maybeSingle();

    // Least privilege: return only what the portal renders — no raw PII, no other rows.
    return NextResponse.json({
        leadId,
        firstName: (lead as any)?.first_name || String((lead as any)?.full_name || '').split(' ')[0] || null,
        application: app ? { id: (app as any).id, status: (app as any).status || 'Under Review' } : null,
    });
}

// Sign-out: clear the httpOnly session cookie (the client can't clear it itself).
export async function DELETE() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return res;
}
