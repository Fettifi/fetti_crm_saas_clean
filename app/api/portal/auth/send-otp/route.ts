import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // 1. Check if lead exists
        const { data: lead, error: findError } = await supabase
            .from('leads')
            .select('id')
            .eq('email', email)
            .single();

        if (findError || !lead) {
            // Return success even if email not found to prevent enumeration
            return NextResponse.json({ message: 'If that email exists, a code has been sent.' });
        }

        // 2. Generate 6-digit Code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

        // 3. Save to DB
        const { error: updateError } = await supabase
            .from('leads')
            .update({
                access_code: code,
                access_code_expires_at: expiresAt
            })
            .eq('id', lead.id);

        if (updateError) throw updateError;

        // 4. Send Email (Mock for now)
        console.log(`[OTP] Sending code ${code} to ${email}`);

        // TODO: Integrate Resend or SendGrid here
        // await sendEmail({ to: email, subject: 'Your Access Code', text: `Your code is: ${code}` });

        return NextResponse.json({ message: 'Code sent successfully' });

    } catch (error) {
        console.error('Send OTP Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
