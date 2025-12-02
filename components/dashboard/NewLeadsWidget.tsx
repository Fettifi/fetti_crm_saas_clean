import { LeadStatus } from '@/lib/leadStatus';

// Mock data type
interface Lead {
    id: string;
    name: string;
    status: LeadStatus;
    createdAt: string;
}

export default function NewLeadsWidget() {
    // Mock data - in real app this would come from an API/DB
    const leads: Lead[] = [
        { id: '1', name: 'Acme Corp', status: 'NEW', createdAt: new Date(Date.now() - 86400000 * 1).toISOString() },
        { id: '2', name: 'Globex Inc', status: 'NEW', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
        { id: '3', name: 'Soylent Corp', status: 'NEW', createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
    ];

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">New Leads (7D)</h3>
                <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-1 rounded-full font-medium">
                    {leads.length} New
                </span>
            </div>
            <div className="space-y-3">
                {leads.length === 0 ? (
                    <p className="text-sm text-slate-500">No new leads this week.</p>
                ) : (
                    leads.map((lead) => (
                        <div key={lead.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800/50 hover:border-slate-700 transition-colors">
                            <div>
                                <p className="text-sm font-medium text-slate-200">{lead.name}</p>
                                <p className="text-xs text-slate-500">{new Date(lead.createdAt).toLocaleDateString()}</p>
                            </div>
                            <span className="text-xs font-medium text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded">
                                {lead.status}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
