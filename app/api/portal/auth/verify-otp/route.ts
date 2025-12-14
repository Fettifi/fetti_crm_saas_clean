import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const { email, code } = await req.json();

        if (!email || !code) {
            return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
        }

        // 1. Find Lead with matching code
        const { data: lead, error: findError } = await supabase
            .from('leads')
            .select('id, access_code, access_code_expires_at')
            .eq('email', email)
            .single();

        if (findError || !lead) {
            return NextResponse.json({ error: 'Invalid email or code' }, { status: 401 });
        }

        // 2. Verify Code
        if (lead.access_code !== code) {
            return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
        }

        // 3. Verify Expiration
        if (new Date(lead.access_code_expires_at) < new Date()) {
            return NextResponse.json({ error: 'Code expired' }, { status: 401 });
        }

        // 4. Clear Code (One-time use)
        await supabase
            .from('leads')
            .update({
                access_code: null,
                access_code_expires_at: null
            })
            .eq('id', lead.id);

        // 5. Return Success (Client will store lead_id as session)
        return NextResponse.json({
            message: 'Login successful',
            leadId: lead.id
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
