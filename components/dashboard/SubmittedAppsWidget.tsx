import { ApplicationStatus } from '@/lib/leadStatus';

interface Application {
    id: string;
    applicantName: string;
    amount: number;
    status: ApplicationStatus;
    submittedAt: string;
}

export default function SubmittedAppsWidget() {
    const apps: Application[] = [
        { id: '201', applicantName: 'Tech Startups LLC', amount: 150000, status: 'SUBMITTED', submittedAt: new Date(Date.now() - 86400000).toISOString() },
    ];

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Submitted Apps</h3>
                <span className="bg-purple-500/10 text-purple-400 text-xs px-2 py-1 rounded-full font-medium">
                    {apps.length} Pending
                </span>
            </div>
            <div className="space-y-3">
                {apps.length === 0 ? (
                    <p className="text-sm text-slate-500">No submitted applications.</p>
                ) : (
                    apps.map((app) => (
                        <div key={app.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800/50 hover:border-slate-700 transition-colors">
                            <div>
                                <p className="text-sm font-medium text-slate-200">{app.applicantName}</p>
                                <p className="text-xs text-slate-500">${app.amount.toLocaleString()}</p>
                            </div>
                            <span className="text-xs font-medium text-purple-400 bg-purple-950/30 px-2 py-0.5 rounded">
                                {app.status}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
