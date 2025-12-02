import { NextResponse } from 'next/server';
import { getOrCreateReferralCode, getReferralStats } from '@/lib/growth/referral-service';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('leadId');

    if (!leadId) {
        return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });
    }

    const code = await getOrCreateReferralCode(leadId);
    const count = await getReferralStats(leadId);

    return NextResponse.json({ code, count });
}
