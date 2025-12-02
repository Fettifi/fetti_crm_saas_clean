'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Mail, Clock, CheckCircle, AlertCircle } from 'lucide-react';

interface AutomationStat {
    status: string;
    count: number;
}

export default function AutomationsWidget() {
    const [stats, setStats] = useState<AutomationStat[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            const { data, error } = await supabase
                .from('automation_queue')
                .select('status');

            if (error) {
                console.error('Error fetching automation stats:', error);
                return;
            }

            const counts = data.reduce((acc: Record<string, number>, curr) => {
                acc[curr.status] = (acc[curr.status] || 0) + 1;
                return acc;
            }, {});

            const formattedStats = Object.entries(counts).map(([status, count]) => ({
                status,
                count,
            }));

            setStats(formattedStats);
            setLoading(false);
        }

        fetchStats();
    }, []);

    const getIcon = (status: string) => {
        switch (status) {
            case 'pending': return <Clock size={16} className="text-yellow-400" />;
            case 'sent': return <CheckCircle size={16} className="text-emerald-400" />;
            case 'failed': return <AlertCircle size={16} className="text-red-400" />;
            default: return <Mail size={16} className="text-slate-400" />;
        }
    };

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 shadow-[0_0_0_1px_rgba(15,23,42,0.7)]">
            <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Active Automations
                </p>
                <Mail size={16} className="text-slate-500" />
            </div>

            {loading ? (
                <div className="animate-pulse space-y-2">
                    <div className="h-4 w-20 bg-slate-800 rounded" />
                    <div className="h-4 w-16 bg-slate-800 rounded" />
                </div>
            ) : (
                <div className="space-y-3">
                    {stats.length === 0 ? (
                        <p className="text-xs text-slate-500">No active automations.</p>
                    ) : (
                        stats.map((stat) => (
                            <div key={stat.status} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 capitalize text-slate-300">
                                    {getIcon(stat.status)}
                                    <span>{stat.status}</span>
                                </div>
                                <span className="font-mono font-medium text-slate-50">{stat.count}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
