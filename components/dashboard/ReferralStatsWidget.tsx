'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Users, Share2, TrendingUp } from 'lucide-react';

export default function ReferralStatsWidget() {
    const [totalReferrals, setTotalReferrals] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            const { count, error } = await supabase
                .from('referrals')
                .select('*', { count: 'exact', head: true });

            if (error) {
                console.error('Error fetching referral stats:', error);
                return;
            }

            setTotalReferrals(count || 0);
            setLoading(false);
        }

        fetchStats();
    }, []);

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 shadow-[0_0_0_1px_rgba(15,23,42,0.7)]">
            <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Viral Growth
                </p>
                <Share2 size={16} className="text-emerald-500" />
            </div>

            {loading ? (
                <div className="animate-pulse space-y-2">
                    <div className="h-8 w-12 bg-slate-800 rounded" />
                </div>
            ) : (
                <div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-white">{totalReferrals}</span>
                        <span className="text-xs text-slate-500">referrals</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
                        <TrendingUp size={12} />
                        <span>Tracking active</span>
                    </div>
                </div>
            )}
        </div>
    );
}
