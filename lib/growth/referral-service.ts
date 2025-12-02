import { supabase } from '@/lib/supabaseClient';

export async function getOrCreateReferralCode(leadId: string): Promise<string | null> {
    // 1. Check if code exists
    const { data: lead, error: fetchError } = await supabase
        .from('leads')
        .select('referral_code')
        .eq('id', leadId)
        .single();

    if (fetchError) {
        console.error('Error fetching referral code:', fetchError);
        return null;
    }

    if (lead?.referral_code) {
        return lead.referral_code;
    }

    // 2. Generate new code
    const code = `FETTI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 3. Save code
    const { error: updateError } = await supabase
        .from('leads')
        .update({ referral_code: code })
        .eq('id', leadId);

    if (updateError) {
        console.error('Error saving referral code:', updateError);
        return null;
    }

    return code;
}

export async function getReferralStats(leadId: string) {
    const { count, error } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', leadId);

    if (error) {
        console.error('Error fetching stats:', error);
        return 0;
    }

    return count || 0;
}
