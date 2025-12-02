import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const { action, email, code } = await req.json();

        if (action === 'send_code') {
            // 1. Check if lead exists
            const { data: lead, error } = await supabase
                .from('leads')
                .select('id')
                .eq('email', email)
                .single();

            if (error || !lead) {
                // Security: Don't reveal if email exists, just pretend to send
                return NextResponse.json({ message: 'Code sent' });
            }

            // 2. Generate Code
            const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

            // 3. Save to DB
            const { error: updateError } = await supabase
                .from('leads')
                .update({
                    access_code: generatedCode,
                    access_code_expires_at: expiresAt
                })
                .eq('id', lead.id);

            if (updateError) throw updateError;

            // 4. "Send" Email (Log for Demo)
            console.log(`[PORTAL AUTH] Code for ${email}: ${generatedCode}`);

            return NextResponse.json({ message: 'Code sent' });
        }

        if (action === 'verify_code') {
            // 1. Verify Code
            const { data: lead, error } = await supabase
                .from('leads')
                .select('id, access_code, access_code_expires_at')
                .eq('email', email)
                .single();

            if (error || !lead) {
                return NextResponse.json({ message: 'Invalid code' }, { status: 401 });
            }

            if (lead.access_code !== code) {
                return NextResponse.json({ message: 'Invalid code' }, { status: 401 });
            }

            if (new Date(lead.access_code_expires_at) < new Date()) {
                return NextResponse.json({ message: 'Code expired' }, { status: 401 });
            }

            // 2. Clear Code (One-time use)
            await supabase
                .from('leads')
                .update({ access_code: null, access_code_expires_at: null })
                .eq('id', lead.id);

            return NextResponse.json({ leadId: lead.id });
        }

        return NextResponse.json({ message: 'Invalid action' }, { status: 400 });

    } catch (error) {
        console.error('Auth API Error:', error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
